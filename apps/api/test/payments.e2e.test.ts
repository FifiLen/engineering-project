import 'reflect-metadata';
import { randomUUID } from 'node:crypto';
import * as core from '@hulajnogi/core';
import { runMigrations, seedDatabase, type PlacesFile } from '@hulajnogi/db';
import * as shared from '@hulajnogi/shared';
import type { NestFastifyApplication } from '@nestjs/platform-fastify';
import { Pool } from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { LoggingSmsGateway } from '../src/auth/sms.gateway.js';
import { createApp } from '../src/bootstrap.js';
import { loadConfig } from '../src/config.js';
import { CommandsService } from '../src/fleet/commands.service.js';
import { JOBS, JobsService, type JobName } from '../src/jobs/jobs.service.js';
import { MqttService } from '../src/mqtt/mqtt.service.js';
import { PaymentsService } from '../src/payments/payments.service.js';
import { FakePaymentProvider } from '../src/payments/provider/fake-payment-provider.js';
import { PAYMENT_PROVIDER } from '../src/payments/provider/payment-provider.js';
import { asStaff, staffToken } from './helpers.js';

const adminUrl = process.env.DATABASE_URL;
const dbName = `hulajnogi_payments_api_${randomUUID().slice(0, 8)}`;

// Syntetyczne współrzędne testowe: jedna strefa parkowania, hulajnogi #1 i #2 stoją w niej.
const places: PlacesFile = {
  city: 'Test',
  note: '',
  serviceArea: { code: 'AREA-TEST', name: 'Obszar testowy', centerPlace: 'P-01', radiusM: 5000 },
  places: [
    { code: 'P-01', name: 'Centrum', query: '', type: 'PARKING', radiusM: 100, capacity: 20, lat: 50.0, lon: 18.5 },
  ],
};

describe('wyliczenia płatności w kontrakcie API są zgodne z packages/core', () => {
  it.each([
    ['PAYMENT_STATUSES', shared.PAYMENT_STATUSES, core.PAYMENT_STATUSES],
    ['PAYMENT_SOURCES', shared.PAYMENT_SOURCES, core.PAYMENT_SOURCES],
    ['RIDE_SETTLEMENTS', shared.RIDE_SETTLEMENTS, core.RIDE_SETTLEMENTS],
    ['ADJUSTMENT_REASONS', shared.ADJUSTMENT_REASONS, core.ADJUSTMENT_REASONS],
    ['REFUND_REASONS', shared.REFUND_REASONS, core.REFUND_REASONS],
    ['RECEIPT_ITEM_CODES', shared.RECEIPT_ITEM_CODES, core.RECEIPT_ITEM_CODES],
    ['TOPUP_PRESETS', shared.TOPUP_PRESETS, core.TOPUP_PRESETS],
    ['TARIFF_STATES', shared.TARIFF_STATES, core.TARIFF_STATES],
  ])('%s', (_name, fromShared, fromCore) => {
    expect([...fromShared]).toEqual([...fromCore]);
  });

  it('granice doładowania są te same', () => {
    expect([shared.TOPUP_MIN, shared.TOPUP_MAX]).toEqual([core.TOPUP_MIN, core.TOPUP_MAX]);
  });
});

describe('konfiguracja operatora płatności (ADR 0050)', () => {
  const stripe = {
    PAYMENT_PROVIDER: 'stripe',
    STRIPE_SECRET_KEY: 'sk_test_x',
    STRIPE_PUBLISHABLE_KEY: 'pk_test_x',
    STRIPE_WEBHOOK_SECRET: 'whsec_x',
  };

  it('odrzuca klucze live, niepełną konfigurację Stripe i atrapę w produkcji', () => {
    expect(() => loadConfig(stripe)).not.toThrow();
    expect(() => loadConfig({ ...stripe, STRIPE_SECRET_KEY: 'sk_live_x' })).toThrow(/live/);
    expect(() => loadConfig({ STRIPE_PUBLISHABLE_KEY: 'pk_live_x' })).toThrow(/live/);
    expect(() => loadConfig({ ...stripe, STRIPE_WEBHOOK_SECRET: '' })).toThrow(/STRIPE_WEBHOOK_SECRET/);
    expect(() =>
      loadConfig({
        NODE_ENV: 'production',
        JWT_SECRET: 'x'.repeat(32),
        TOTP_ENCRYPTION_KEY: Buffer.alloc(32).toString('base64'),
      }),
    ).toThrow(/atrapa/);
  });
});

describe.skipIf(!adminUrl)('API: płatności (atrapa operatora)', () => {
  let admin: Pool;
  let pool: Pool;
  let app: NestFastifyApplication;
  let customer: { id: string; token: string };
  let staff: Record<'admin' | 'dispatcher' | 'service', ReturnType<typeof asStaff>>;
  let ran = 0;

  const fake = () => app.get<FakePaymentProvider>(PAYMENT_PROVIDER);
  const jobs = () => app.get(JobsService);
  const as =
    (token: string) => (options: { method: 'GET' | 'POST' | 'DELETE' | 'PATCH'; url: string; payload?: object }) =>
      app.inject({ ...options, headers: { authorization: `Bearer ${token}` } });
  const me = () => as(customer.token);
  const idOf = async (number: number) =>
    (await pool.query<{ id: string }>('SELECT id FROM scooters WHERE number = $1', [number])).rows[0]!.id;
  const balance = async () => (await me()({ method: 'GET', url: '/me/wallet' })).json<shared.WalletView>().balance;

  const deliver = (hook: { body: string; signature: string }) =>
    app.inject({
      method: 'POST',
      url: '/payments/webhooks/stripe',
      headers: { 'content-type': 'application/json', 'stripe-signature': hook.signature },
      payload: hook.body,
    });

  /** Webhooki atrapy przez punkt webhooka i zadania płatności z kolejki (wyłączonej w testach), aż do ciszy. */
  async function flush(): Promise<void> {
    const runnable: JobName[] = [JOBS.paymentsWebhook, JOBS.chargeRide];
    for (let round = 0; round < 10; round++) {
      const hooks = fake().takeOutbox();
      for (const hook of hooks) expect((await deliver(hook)).statusCode).toBe(200);
      const queued = jobs()
        .sent.slice(ran)
        .filter((j) => runnable.includes(j.name));
      ran = jobs().sent.length;
      for (const job of queued) await jobs().run(job.name, job.data);
      if (!hooks.length && !queued.length) return;
    }
  }

  const lastCommand = (number: number) =>
    app
      .get(MqttService)
      .published.filter((p) => p.topic === shared.topics.command(shared.scooterTopicId(number)))
      .at(-1)!.payload as shared.Command;
  const ack = (command: shared.Command) =>
    app
      .get(CommandsService)
      .handleAck(Buffer.from(JSON.stringify({ commandId: command.commandId, ok: true, ts: new Date().toISOString() })));

  /** Przejazd w strefie P-01: start, odblokowanie, zakończenie, blokada. */
  async function ride(number: number, payment: object = {}): Promise<shared.RentalView> {
    const start = await me()({
      method: 'POST',
      url: '/rentals',
      payload: { scooterId: await idOf(number), ...payment },
    });
    expect(start.statusCode).toBe(202);
    const rental = start.json<shared.RentalView>();
    await ack(lastCommand(number));
    // Minuta jazdy wstecz, żeby kwota nie zależała od czasu testu.
    await pool.query(`UPDATE rental_events SET created_at = created_at - interval '3 minutes' WHERE rental_id = $1`, [
      rental.id,
    ]);
    await me()({ method: 'POST', url: '/rentals/current/end' });
    await ack(lastCommand(number));
    return (await me()({ method: 'GET', url: `/rentals/${rental.id}` })).json<shared.RentalView>();
  }

  async function addCard(number: string): Promise<shared.FakeConfirmResult> {
    const setup = (await me()({ method: 'POST', url: '/me/payment-methods/setup' })).json<shared.SetupIntentResponse>();
    expect(setup).toMatchObject({ provider: 'fake', clientSecret: expect.stringContaining('_secret_') });
    const result = (
      await me()({
        method: 'POST',
        url: '/payments/fake/setup-intents/confirm',
        payload: { clientSecret: setup.clientSecret, cardNumber: number, expMonth: 12, expYear: 2030, cvc: '123' },
      })
    ).json<shared.FakeConfirmResult>();
    await flush();
    return result;
  }

  const cards = async () =>
    (await me()({ method: 'GET', url: '/me/payment-methods' })).json<shared.PaymentMethodView[]>();

  async function topup(amount: number, method: 'CARD' | 'BLIK', blikCode?: string, paymentMethodId?: string) {
    const res = await me()({ method: 'POST', url: '/me/wallet/topups', payload: { amount, method, paymentMethodId } });
    expect(res.statusCode).toBe(202);
    const intent = res.json<shared.PaymentIntentResponse>();
    const confirm = (
      await me()({
        method: 'POST',
        url: '/payments/fake/payment-intents/confirm',
        payload: { clientSecret: intent.clientSecret, ...(blikCode ? { blikCode } : {}) },
      })
    ).json<shared.FakeConfirmResult>();
    return { intent, confirm };
  }

  beforeAll(async () => {
    admin = new Pool({ connectionString: adminUrl });
    await admin.query(`CREATE DATABASE ${dbName}`);
    const url = new URL(adminUrl!);
    url.pathname = `/${dbName}`;
    pool = new Pool({ connectionString: url.toString() });
    pool.on('error', () => undefined);
    await runMigrations(pool);
    await seedDatabase(pool, {
      places,
      fleetSize: 2,
      admin: { email: 'a@test.local', name: 'A', passwordHash: 'x' },
      staff: [
        { email: 'd@test.local', name: 'D', role: 'Dyspozytor', passwordHash: 'x' },
        { email: 's@test.local', name: 'S', role: 'Serwisant', passwordHash: 'x' },
      ],
      documents: [
        { slug: 'regulamin', name: 'Regulamin', consentType: 'TERMS', title: 'Regulamin', bodyMd: 'Treść' },
        { slug: 'polityka-prywatnosci', name: 'Polityka', consentType: 'PRIVACY', title: 'Polityka', bodyMd: 'Treść' },
      ],
    });
    await pool.query(
      `UPDATE scooters SET online = true, battery_pct = 80, position = ST_SetSRID(ST_MakePoint(18.5, 50.0), 4326)`,
    );
    app = await createApp(
      loadConfig({
        NODE_ENV: 'test',
        DATABASE_URL: url.toString(),
        MQTT_ENABLED: 'false',
        JOBS_ENABLED: 'false',
        TELEMETRY_FLUSH_MS: '10000',
        FAKE_WEBHOOK_DELIVERY: 'manual',
        OSRM_URL: 'http://127.0.0.1:9',
      }),
      { logger: false },
    );
    await app.init();

    const phone = '+48500700100';
    await app.inject({ method: 'POST', url: '/auth/otp', payload: { phone } });
    const code = /(\d{6})/.exec(app.get(LoggingSmsGateway).sent.at(-1)!.text)![1]!;
    const session = (
      await app.inject({ method: 'POST', url: '/auth/otp/verify', payload: { phone, code } })
    ).json<shared.CustomerSession>();
    await app.inject({
      method: 'POST',
      url: '/me/registration',
      headers: { authorization: `Bearer ${session.accessToken}` },
      payload: {
        name: 'Anna',
        ageConfirmed: true,
        acceptedVersionIds: session.me.pendingDocuments.map((d) => d.versionId),
      },
    });
    customer = { id: session.me.id, token: session.accessToken };
    const staffId = async (email: string) =>
      (await pool.query<{ id: string }>(`SELECT id FROM staff WHERE email = $1`, [email])).rows[0]!.id;
    staff = {
      admin: asStaff(app, staffToken(app, await staffId('a@test.local'))),
      dispatcher: asStaff(app, staffToken(app, await staffId('d@test.local'))),
      service: asStaff(app, staffToken(app, await staffId('s@test.local'))),
    };
  });

  afterAll(async () => {
    await app?.close();
    await pool?.end();
    await admin?.query(`DROP DATABASE IF EXISTS ${dbName} WITH (FORCE)`);
    await admin?.end();
  });

  it('konfiguracja i cennik bez logowania; start bez środków podaje saldo i minimum', async () => {
    const config = (await app.inject({ method: 'GET', url: '/payments/config' })).json<shared.PaymentsConfig>();
    expect(config).toEqual({
      provider: 'fake',
      publishableKey: null,
      blik: true,
      currency: 'PLN',
      topup: { presets: [2000, 5000, 10000], min: 1000, max: 50000 },
    });
    const tariff = (await app.inject({ method: 'GET', url: '/tariff' })).json<shared.TariffDetailsView>();
    expect(tariff).toMatchObject({ version: 1, minWalletBalance: 1000, vatRate: 23, outOfZoneFee: 2000 });

    const start = await me()({ method: 'POST', url: '/rentals', payload: { scooterId: await idOf(1) } });
    expect(start.statusCode).toBe(422);
    expect(start.json()).toMatchObject({
      code: 'INSUFFICIENT_BALANCE',
      details: { reason: 'BELOW_MINIMUM', balance: 0, minimum: 1000, cardAvailable: false },
    });
    const card = await me()({
      method: 'POST',
      url: '/reservations',
      payload: { scooterId: await idOf(1), paymentSource: 'CARD' },
    });
    expect(card.json()).toMatchObject({ code: 'PAYMENT_METHOD_REQUIRED' });
  });

  it('karta: zapis po webhooku, pierwsza domyślna, odmowa przy zapisie, 3-D Secure; zły podpis webhooka to 400', async () => {
    expect(await addCard('4242424242424242')).toEqual({ status: 'succeeded', failureCode: null });
    expect(await cards()).toMatchObject([{ brand: 'visa', last4: '4242', isDefault: true, state: 'ACTIVE' }]);
    expect(await addCard('4000000000000002')).toEqual({ status: 'failed', failureCode: 'card_declined' });
    expect(await addCard('4000000000000003')).toEqual({ status: 'failed', failureCode: 'incorrect_number' });

    const setup = (await me()({ method: 'POST', url: '/me/payment-methods/setup' })).json<shared.SetupIntentResponse>();
    const confirm = await me()({
      method: 'POST',
      url: '/payments/fake/setup-intents/confirm',
      payload: {
        clientSecret: setup.clientSecret,
        cardNumber: '4000000000003220',
        expMonth: 1,
        expYear: 2031,
        cvc: '123',
      },
    });
    expect(confirm.json()).toMatchObject({ status: 'requires_action' });
    await me()({
      method: 'POST',
      url: '/payments/fake/authenticate',
      payload: { clientSecret: setup.clientSecret, approve: true },
    });
    await flush();
    expect((await cards()).map((c) => [c.last4, c.isDefault])).toEqual([
      ['4242', true],
      ['3220', false],
    ]);

    const bad = await app.inject({
      method: 'POST',
      url: '/payments/webhooks/stripe',
      headers: { 'content-type': 'application/json', 'stripe-signature': 't=1,v1=00' },
      payload: '{"id":"evt_x","type":"payment_intent.succeeded"}',
    });
    expect(bad.statusCode).toBe(400);
    expect(bad.json()).toMatchObject({ code: 'WEBHOOK_SIGNATURE_INVALID' });
  });

  it('doładowanie: saldo dopiero po webhooku, powtórzony webhook nic nie zmienia, BLIK i odmowa BLIK', async () => {
    expect(
      (await me()({ method: 'POST', url: '/me/wallet/topups', payload: { amount: 3550, method: 'CARD' } })).json(),
    ).toMatchObject({ code: 'TOPUP_AMOUNT_INVALID', details: { min: 1000, max: 50000 } });

    const { intent, confirm } = await topup(5000, 'CARD');
    expect(confirm).toEqual({ status: 'succeeded', failureCode: null });
    expect(await balance()).toBe(0);
    const hooks = fake().takeOutbox();
    expect(hooks).toHaveLength(1);
    await deliver(hooks[0]!);
    await deliver(fake().resign(hooks[0]!.body));
    await flush();
    expect(await balance()).toBe(5000);
    const event = await pool.query(
      `SELECT deliveries, result, payment_id FROM payment_webhook_events WHERE payment_id = $1`,
      [intent.paymentId],
    );
    expect(event.rows).toEqual([{ deliveries: 2, result: 'APPLIED', payment_id: intent.paymentId }]);
    expect((await me()({ method: 'GET', url: `/payments/${intent.paymentId}` })).json()).toMatchObject({
      status: 'SUCCEEDED',
      purpose: 'TOPUP',
      amount: 5000,
    });

    await topup(2000, 'BLIK', '123456');
    await flush();
    const declined = await topup(2000, 'BLIK', '000000');
    await flush();
    expect((await me()({ method: 'GET', url: `/payments/${declined.intent.paymentId}` })).json()).toMatchObject({
      status: 'FAILED',
      failureCode: 'payment_method_provider_decline',
    });
    // Odrzucona płatność jest anulowana u operatora: ponowne potwierdzenie tym samym kluczem nie pobierze pieniędzy.
    const retry = await me()({
      method: 'POST',
      url: '/payments/fake/payment-intents/confirm',
      payload: { clientSecret: declined.intent.clientSecret, blikCode: '123456' },
    });
    expect(retry.json()).toMatchObject({ status: 'failed' });
    await flush();
    const wallet = (await me()({ method: 'GET', url: '/me/wallet' })).json<shared.WalletView>();
    expect(wallet.balance).toBe(7000);
    expect(wallet.entries.map((e) => [e.type, e.amount, e.balanceAfter, e.paymentMethod])).toEqual([
      ['TOPUP', 2000, 7000, 'BLIK'],
      ['TOPUP', 5000, 5000, 'CARD'],
    ]);
  });

  it('brak webhooka: sprawdzenie statusu po 2 min rozlicza doładowanie (tech-doladowanie)', async () => {
    const { intent } = await topup(1000, 'CARD');
    fake().takeOutbox(); // webhook zgubiony
    await app.get(PaymentsService).reconcile();
    expect(await balance()).toBe(7000);
    await pool.query(`UPDATE payments SET created_at = created_at - interval '3 minutes' WHERE id = $1`, [
      intent.paymentId,
    ]);
    await jobs().run(JOBS.paymentsReconcile);
    expect(await balance()).toBe(8000);
  });

  it('przejazd z portfela: obciążenie w transakcji ENDED, paragon z VAT, historia portfela', async () => {
    const ended = await ride(1);
    expect(ended.state).toBe('ENDED');
    expect(ended.settlement).toMatchObject({ state: 'WALLET_PAID', source: 'WALLET', paidAmount: ended.price.total });
    expect(await balance()).toBe(8000 - ended.price.total);
    const receipt = (
      await me()({ method: 'GET', url: `/me/receipts/${ended.settlement.receiptId}` })
    ).json<shared.ReceiptView>();
    expect(receipt).toMatchObject({
      kind: 'SALE',
      totalAmount: ended.price.total,
      paymentSource: 'WALLET',
      vatRate: 23,
      vatAmount: core.vatFromGross(ended.price.total, 23),
      seller: { name: '[dane sprzedawcy]' },
      buyer: { name: 'Anna', phone: '+48500700100' },
      rentalNumber: ended.number,
    });
    expect(receipt.items.map((i) => i.description)).toEqual(['UNLOCK', 'RIDE_MINUTES']);
    expect(receipt.vatGroups).toEqual([
      { vatRate: 23, gross: ended.price.total, vat: core.vatFromGross(ended.price.total, 23) },
    ]);
    const entry = (await me()({ method: 'GET', url: '/me/wallet?limit=1' })).json<shared.WalletView>().entries[0];
    expect(entry).toMatchObject({
      type: 'RIDE_CHARGE',
      amount: -ended.price.total,
      rentalNumber: ended.number,
      receiptId: receipt.id,
    });
    const history = (await me()({ method: 'GET', url: '/rentals' })).json<shared.RentalHistoryItem[]>();
    expect(history[0]).toMatchObject({ settlement: 'WALLET_PAID', receiptId: receipt.id });
  });

  it('przejazd kartą: odmowa daje UNPAID i blokadę startu, spłata kartą z udziałem klienta kończy przejazd z paragonem', async () => {
    await addCard('4000000000000341');
    const declining = (await cards()).find((c) => c.last4 === '0341')!;
    const ended = await ride(2, { paymentSource: 'CARD', paymentMethodId: declining.id });
    expect(ended.settlement).toMatchObject({ state: 'CARD_PENDING', source: 'CARD', card: { last4: '0341' } });
    await flush();
    const unpaid = (await me()({ method: 'GET', url: `/rentals/${ended.id}` })).json<shared.RentalView>();
    expect(unpaid).toMatchObject({ state: 'UNPAID', settlement: { state: 'FAILED', failureCode: 'card_declined' } });
    expect(jobs().sent.filter((j) => j.name === JOBS.retryRideCharge)).toHaveLength(1);
    const wallet = (await me()({ method: 'GET', url: '/me/wallet' })).json<shared.WalletView>();
    expect(wallet.overdue).toMatchObject([{ rentalId: ended.id, amount: ended.price.total, failedAttempts: 1 }]);
    expect(wallet.overdue[0]!.retryAt).not.toBeNull();
    expect(
      (await me()({ method: 'POST', url: '/rentals', payload: { scooterId: await idOf(1) } })).json(),
    ).toMatchObject({
      code: 'PAYMENT_OVERDUE',
    });
    expect((await me()({ method: 'DELETE', url: `/me/payment-methods/${declining.id}` })).json()).toMatchObject({
      code: 'PAYMENT_METHOD_IN_USE',
    });

    const paying = await me()({ method: 'POST', url: `/rentals/${ended.id}/pay`, payload: { source: 'CARD' } });
    expect(paying.statusCode).toBe(202);
    const { payment } = paying.json<{ payment: shared.PaymentIntentResponse }>();
    expect(
      (await me()({ method: 'POST', url: `/rentals/${ended.id}/pay`, payload: { source: 'CARD' } })).json(),
    ).toMatchObject({
      code: 'PAYMENT_IN_PROGRESS',
    });
    // Płatność kartą powstaje pod blokadą przejazdu, więc spłata z portfela w tym czasie jest odrzucona.
    const fromWallet = await me()({ method: 'POST', url: `/rentals/${ended.id}/pay`, payload: { source: 'WALLET' } });
    expect(fromWallet.json()).toMatchObject({ code: 'PAYMENT_IN_PROGRESS' });
    await me()({
      method: 'POST',
      url: '/payments/fake/payment-intents/confirm',
      payload: { clientSecret: payment.clientSecret },
    });
    await flush();
    const paid = (await me()({ method: 'GET', url: `/rentals/${ended.id}` })).json<shared.RentalView>();
    expect(paid).toMatchObject({ state: 'ENDED', settlement: { state: 'CARD_PAID', card: { last4: '4242' } } });
    expect(paid.settlement.receiptId).not.toBeNull();
    // Ponowienie po 24 h po spłacie nic nie robi.
    await jobs().run(JOBS.retryRideCharge, { rentalId: ended.id });
    expect(
      (await pool.query(`SELECT count(*)::int AS n FROM payments WHERE rental_id = $1`, [ended.id])).rows[0].n,
    ).toBe(2);
    const states = await pool.query(
      `SELECT from_state, to_state FROM rental_events WHERE rental_id = $1 AND type = 'STATE_CHANGED' ORDER BY id`,
      [ended.id],
    );
    for (const { from_state, to_state } of states.rows)
      expect(core.RentalStateMachine.isAllowed(from_state, to_state)).toBe(true);
    expect(states.rows.slice(-2)).toEqual([
      { from_state: 'ENDED', to_state: 'UNPAID' },
      { from_state: 'UNPAID', to_state: 'ENDED' },
    ]);
  });

  it('przejazd kartą bez saldo minimum: obciążenie po zakończeniu i paragon po webhooku', async () => {
    await pool.query(`CALL sp_wallet_post($1, 'ADJUSTMENT', $2, NULL, NULL, NULL, NULL, 'OTHER', 'test', NULL, NULL)`, [
      customer.id,
      -(await balance()),
    ]);
    const ended = await ride(1, { paymentSource: 'CARD' });
    await flush();
    const paid = (await me()({ method: 'GET', url: `/rentals/${ended.id}` })).json<shared.RentalView>();
    expect(paid.settlement).toMatchObject({ state: 'CARD_PAID', source: 'CARD', paidAmount: ended.price.total });
    expect(await balance()).toBe(0);
  });

  it('panel: zwrot z portfela z korektą paragonu, zwrot na kartę po webhooku, suma nie większa niż zapłata', async () => {
    const [cardRide, , walletRide] = (await me()({ method: 'GET', url: '/rentals' })).json<
      shared.RentalHistoryItem[]
    >();
    const refund = (id: string, amount: number, who = staff.dispatcher, reason = 'SCOOTER_FAILURE') =>
      who({ method: 'POST', url: `/admin/rentals/${id}/refund`, payload: { amount, reason } });

    expect((await refund(walletRide!.id, 100, staff.service)).statusCode).toBe(403);
    const afterWallet = (await refund(walletRide!.id, 100)).json<shared.RentalAdminDetails>();
    expect(afterWallet).toMatchObject({ refundable: walletRide!.totalAmount! - 100 });
    expect(afterWallet.refunds).toMatchObject([{ status: 'SUCCEEDED', source: 'WALLET', amount: 100, staffName: 'D' }]);
    expect(await balance()).toBe(100);
    const tooMuch = await refund(walletRide!.id, walletRide!.totalAmount!);
    expect(tooMuch.statusCode).toBe(422);
    expect(tooMuch.json()).toMatchObject({
      code: 'REFUND_EXCEEDS_PAYMENT',
      details: { remaining: walletRide!.totalAmount! - 100 },
    });
    expect((await refund(walletRide!.id, 100, staff.dispatcher, 'OTHER')).json()).toMatchObject({
      code: 'VALIDATION_FAILED',
    });
    const receipt = (
      await me()({ method: 'GET', url: `/me/receipts/${afterWallet.settlement.receiptId}` })
    ).json<shared.ReceiptView>();
    expect(receipt.corrections).toMatchObject([{ kind: 'CORRECTION', totalAmount: -100 }]);

    const card = (await refund(cardRide!.id, cardRide!.totalAmount!)).json<shared.RentalAdminDetails>();
    expect(card.refunds).toMatchObject([{ status: 'PENDING', source: 'CARD' }]);
    await flush();
    const settled = (
      await staff.admin({ method: 'GET', url: `/admin/rentals/${cardRide!.id}` })
    ).json<shared.RentalAdminDetails>();
    expect(settled.refunds).toMatchObject([
      { status: 'SUCCEEDED', providerRefundId: expect.stringMatching(/^re_fake_/) },
    ]);
    expect(settled).toMatchObject({ refundable: 0, settlement: { refundedAmount: cardRide!.totalAmount } });
    const payment = (
      await staff.admin({ method: 'GET', url: `/admin/payments/${settled.settlement.paymentId}` })
    ).json<shared.PaymentAdminDetails>();
    expect(payment).toMatchObject({ status: 'REFUNDED', refundedAmount: cardRide!.totalAmount });
    expect(payment.webhooks.map((w) => w.type)).toContain('payment_intent.succeeded');
    const audit = await pool.query(`SELECT action FROM audit_log WHERE action = 'rental.refunded'`);
    expect(audit.rowCount).toBe(2);
  });

  it('panel: korekta salda tylko z wallet.adjust, listy płatności tylko z payments.read', async () => {
    const payload = { amount: 1000, reason: 'GOODWILL', note: 'Przeprosiny' };
    expect(
      (await staff.dispatcher({ method: 'POST', url: `/admin/users/${customer.id}/wallet/adjustments`, payload }))
        .statusCode,
    ).toBe(403);
    const wallet = (
      await staff.admin({ method: 'POST', url: `/admin/users/${customer.id}/wallet/adjustments`, payload })
    ).json<shared.CustomerWalletAdmin>();
    expect(wallet).toMatchObject({ balance: 1100, outOfSync: false, minWalletBalance: 1000 });
    const entry = (await me()({ method: 'GET', url: '/me/wallet?limit=1' })).json<shared.WalletView>().entries[0];
    expect(entry).toMatchObject({ type: 'ADJUSTMENT', amount: 1000, reason: 'GOODWILL' });
    expect(entry).not.toHaveProperty('note');
    const ledger = (
      await staff.dispatcher({
        method: 'GET',
        url: `/admin/wallet-ledger?userId=${customer.id}&type=ADJUSTMENT&sort=-id`,
      })
    ).json<shared.ListResponse<shared.WalletLedgerItem>>();
    expect(ledger.items[0]).toMatchObject({ staffName: 'A', note: 'Przeprosiny', balanceAfter: 1100 });

    expect((await staff.service({ method: 'GET', url: '/admin/payments' })).statusCode).toBe(403);
    const list = (await staff.dispatcher({ method: 'GET', url: '/admin/payments?facets=status&purpose=TOPUP' })).json<
      shared.ListResponse<shared.PaymentListItem>
    >();
    expect(list.facets.status).toMatchObject({ SUCCEEDED: 3, FAILED: 1 });
    for (const resource of ['receipts', 'wallets', 'payment-methods', 'payment-webhook-events', 'refunds']) {
      const res = await staff.dispatcher({ method: 'GET', url: `/admin/${resource}` });
      expect(res.statusCode, resource).toBe(200);
      expect(res.json().total, resource).toBeGreaterThan(0);
    }
  });

  it('zwrot salda na kartę z ostatnich doładowań, potem usunięcie konta (pytanie 9)', async () => {
    const result = (
      await staff.admin({ method: 'POST', url: `/admin/users/${customer.id}/wallet/payout` })
    ).json<shared.WalletPayoutResult>();
    // Najnowsze doładowanie to BLIK 20 zł (doładowanie z testu sprawdzania statusu ma cofniętą datę).
    expect(result.refunds.map((r) => [r.amount, r.status, r.paymentPurpose])).toEqual([[1100, 'PENDING', 'TOPUP']]);
    expect(result).toMatchObject({ remainder: 0, wallet: { balance: 0 } });
    // Zwrot w toku blokuje usunięcie konta: odmowa zwrotu dopisałaby saldo do usuniętego konta.
    expect((await me()({ method: 'DELETE', url: '/me' })).json()).toMatchObject({ code: 'PAYMENT_IN_PROGRESS' });
    await flush();
    const refunds = await pool.query(`SELECT status FROM refunds WHERE reason = 'BALANCE_PAYOUT'`);
    expect(refunds.rows.every((r) => r.status === 'SUCCEEDED')).toBe(true);
    expect((await me()({ method: 'DELETE', url: '/me' })).statusCode).toBe(204);
  });

  it('panel: nowa wersja cennika od jutra jest zaplanowana, aplikacja dalej widzi obowiązującą; druga zaplanowana odrzucona', async () => {
    const tomorrow = new Date(Date.now() + 86_400_000).toISOString();
    const body = {
      unlockFee: 300,
      minuteRate: 90,
      pauseMinuteRate: 30,
      outOfZoneFee: 2000,
      freeReservationMinutes: 10,
      minWalletBalance: 1000,
      minBatteryPct: 15,
      minUserAge: 18,
      vatRate: 23,
      validFrom: tomorrow,
    };
    expect((await staff.dispatcher({ method: 'POST', url: '/admin/tariffs', payload: body })).statusCode).toBe(403);
    const created = (
      await staff.admin({ method: 'POST', url: '/admin/tariffs', payload: body })
    ).json<shared.TariffVersionItem>();
    expect(created).toMatchObject({ version: 2, state: 'SCHEDULED', createdByName: 'A', rentalsCount: 0 });
    expect((await app.inject({ method: 'GET', url: '/tariff' })).json()).toMatchObject({ version: 1, minuteRate: 80 });
    expect(
      (await staff.admin({ method: 'POST', url: '/admin/tariffs', payload: { ...body, validFrom: null } })).json(),
    ).toMatchObject({
      code: 'TARIFF_ALREADY_SCHEDULED',
      details: { version: 2 },
    });
    expect(
      (await staff.admin({ method: 'POST', url: '/admin/tariffs', payload: { ...body, minBatteryPct: 120 } })).json(),
    ).toMatchObject({ code: 'TARIFF_ALREADY_SCHEDULED' });
    const list = (await staff.dispatcher({ method: 'GET', url: '/admin/tariffs?facets=state' })).json<
      shared.ListResponse<shared.TariffVersionItem>
    >();
    expect(list.items.map((t) => [t.version, t.state])).toEqual([
      [2, 'SCHEDULED'],
      [1, 'CURRENT'],
    ]);
    expect((await staff.admin({ method: 'DELETE', url: `/admin/tariffs/${created.id}` })).statusCode).toBe(204);
    const invalid = await staff.admin({
      method: 'POST',
      url: '/admin/tariffs',
      payload: { ...body, validFrom: null, minBatteryPct: 120 },
    });
    expect(invalid.json()).toMatchObject({ code: 'TARIFF_INVALID', details: { fields: ['minBatteryPct'] } });
    const now = (
      await staff.admin({ method: 'POST', url: '/admin/tariffs', payload: { ...body, validFrom: null } })
    ).json<shared.TariffVersionItem>();
    expect(now).toMatchObject({ version: 2, state: 'CURRENT' });
    expect((await app.inject({ method: 'GET', url: '/tariff' })).json()).toMatchObject({ version: 2, minuteRate: 90 });
    const audit = await pool.query(`SELECT action, data FROM audit_log WHERE entity_type = 'tariff' ORDER BY id`);
    expect(audit.rows.map((r) => r.action)).toEqual(['tariff.created', 'tariff.deleted', 'tariff.created']);
    expect(audit.rows.at(-1)!.data.changes).toEqual({ minuteRate: { from: 80, to: 90 } });
  });
});
