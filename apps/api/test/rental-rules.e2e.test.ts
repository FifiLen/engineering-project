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
import { FakePaymentProvider } from '../src/payments/provider/fake-payment-provider.js';
import { PAYMENT_PROVIDER } from '../src/payments/provider/payment-provider.js';
import { TelemetryService } from '../src/telemetry/telemetry.service.js';
import { asStaff, fundWallet, staffToken } from './helpers.js';

const adminUrl = process.env.DATABASE_URL;
const dbName = `hulajnogi_rental_rules_api_${randomUUID().slice(0, 8)}`;

// Syntetyczne współrzędne testowe: jedna strefa parkowania; 50,01 leży poza nią, w obszarze działania.
const places: PlacesFile = {
  city: 'Test',
  note: '',
  serviceArea: { code: 'AREA-TEST', name: 'Obszar testowy', centerPlace: 'P-01', radiusM: 5000 },
  places: [
    { code: 'P-01', name: 'Centrum', query: '', type: 'PARKING', radiusM: 100, capacity: 20, lat: 50.0, lon: 18.5 },
  ],
};

describe('wyliczenia przejazdu iteracji 6 w kontrakcie API są zgodne z packages/core', () => {
  it.each([
    ['END_MODES', shared.END_MODES, core.END_MODES],
    ['BATTERY_THRESHOLDS', shared.BATTERY_THRESHOLDS, core.BATTERY_THRESHOLDS],
    ['UPLOAD_FILE_PURPOSES', shared.UPLOAD_FILE_PURPOSES, core.UPLOAD_FILE_PURPOSES],
    ['FILE_CONTENT_TYPES', shared.FILE_CONTENT_TYPES, core.FILE_CONTENT_TYPES],
  ])('%s', (_name, fromShared, fromCore) => {
    expect([...fromShared]).toEqual([...fromCore]);
  });

  it('limit rozmiaru pliku jest ten sam', () => {
    expect(shared.FILE_MAX_BYTES).toBe(core.FILE_MAX_BYTES);
  });
});

/**
 * Reguły przejazdu iteracji 6: zakończenie bez łączności i limit naliczania (ADR 0056), niska bateria (ADR 0056),
 * opłata za odholowanie z portfela i kartą (ADR 0060).
 */
describe.skipIf(!adminUrl)('API: przejazd bez łączności, bateria i odholowanie', () => {
  let admin: Pool;
  let pool: Pool;
  let app: NestFastifyApplication;
  let dispatcher: ReturnType<typeof asStaff>;
  const customers: Record<'anna' | 'bartek', { id: string; token: string }> = {} as never;
  let ran = 0;

  const idOf = async (number: number) =>
    (await pool.query<{ id: string }>('SELECT id FROM scooters WHERE number = $1', [number])).rows[0]!.id;
  const as = (who: keyof typeof customers) => (options: { method: 'GET' | 'POST'; url: string; payload?: object }) =>
    app.inject({ ...options, headers: { authorization: `Bearer ${customers[who].token}` } });
  const jobs = () => app.get(JobsService);
  const commands = (number: number) =>
    app
      .get(MqttService)
      .published.filter((p) => p.topic === shared.topics.command(shared.scooterTopicId(number)))
      .map((p) => p.payload as shared.Command);
  const lastCommand = (number: number) => commands(number).at(-1)!;
  const ack = (command: shared.Command, ok = true) =>
    app
      .get(CommandsService)
      .handleAck(Buffer.from(JSON.stringify({ commandId: command.commandId, ok, ts: new Date().toISOString() })));
  const view = async (who: keyof typeof customers, id: string) =>
    (await as(who)({ method: 'GET', url: `/rentals/${id}` })).json<shared.RentalView>();
  const details = async (id: string) =>
    (await dispatcher({ method: 'GET', url: `/admin/rentals/${id}` })).json<shared.RentalAdminDetails>();
  const events = async (rentalId: string, type: string) =>
    (
      await pool.query<{ data: Record<string, unknown>; created_at: Date }>(
        `SELECT data, created_at FROM rental_events WHERE rental_id = $1 AND type::text = $2 ORDER BY id`,
        [rentalId, type],
      )
    ).rows;
  /** Status z brokera (retained, Last Will). */
  const status = (number: number, online: boolean) =>
    app.get(TelemetryService).handleStatus(number, { online, since: new Date().toISOString() });
  /** Odczyt telemetrii i zapis partii (okno zapisu w teście jest ręczne). */
  async function telemetry(
    number: number,
    reading: { lat?: number; bat?: number; locked?: boolean; buffered?: boolean; at?: Date } = {},
  ) {
    app.get(TelemetryService).accept(number, {
      ts: (reading.at ?? new Date()).toISOString(),
      lat: reading.lat ?? 50.0,
      lon: 18.5,
      bat: reading.bat ?? 80,
      v: 12,
      locked: reading.locked ?? false,
      buffered: reading.buffered ?? false,
    });
    await app.get(TelemetryService).flush();
  }
  /** Start i potwierdzone odblokowanie. */
  async function ride(who: keyof typeof customers, number: number, payment: object = {}): Promise<string> {
    const start = await as(who)({
      method: 'POST',
      url: '/rentals',
      payload: { scooterId: await idOf(number), ...payment },
    });
    expect(start.statusCode).toBe(202);
    await ack(lastCommand(number));
    return start.json<shared.RentalView>().id;
  }
  /** Oś czasu przesunięta wstecz, żeby kwota nie zależała od czasu testu. */
  const shift = (rentalId: string, minutes: number, where = 'true') =>
    pool.query(
      `UPDATE rental_events SET created_at = created_at - make_interval(mins => $2) WHERE rental_id = $1 AND ${where}`,
      [rentalId, minutes],
    );

  /** Webhooki atrapy i zadania płatności z kolejki (wyłączonej w testach), aż do ciszy. */
  async function flushPayments(): Promise<void> {
    const runnable: JobName[] = [JOBS.paymentsWebhook, JOBS.chargeRide];
    const fake = app.get<FakePaymentProvider>(PAYMENT_PROVIDER);
    for (let round = 0; round < 10; round++) {
      const hooks = fake.takeOutbox();
      for (const hook of hooks) {
        const res = await app.inject({
          method: 'POST',
          url: '/payments/webhooks/stripe',
          headers: { 'content-type': 'application/json', 'stripe-signature': hook.signature },
          payload: hook.body,
        });
        expect(res.statusCode).toBe(200);
      }
      const queued = jobs()
        .sent.slice(ran)
        .filter((j) => runnable.includes(j.name));
      ran = jobs().sent.length;
      for (const job of queued) await jobs().run(job.name, job.data);
      if (!hooks.length && !queued.length) return;
    }
  }

  async function register(phone: string, name: string): Promise<{ id: string; token: string }> {
    await app.inject({ method: 'POST', url: '/auth/otp', payload: { phone } });
    const code = /(\d{6})/.exec(
      app
        .get(LoggingSmsGateway)
        .sent.filter((m) => m.phone === phone)
        .at(-1)!.text,
    )![1]!;
    const session = (
      await app.inject({ method: 'POST', url: '/auth/otp/verify', payload: { phone, code } })
    ).json<shared.CustomerSession>();
    await app.inject({
      method: 'POST',
      url: '/me/registration',
      headers: { authorization: `Bearer ${session.accessToken}` },
      payload: { name, ageConfirmed: true, acceptedVersionIds: session.me.pendingDocuments.map((d) => d.versionId) },
    });
    await fundWallet(pool, session.me.id);
    return { id: session.me.id, token: session.accessToken };
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
      fleetSize: 6,
      admin: { email: 'a@test.local', name: 'A', passwordHash: 'x' },
      staff: [{ email: 'd@test.local', name: 'D', role: 'Dyspozytor', passwordHash: 'x' }],
      documents: [
        { slug: 'regulamin', name: 'Regulamin', consentType: 'TERMS', title: 'Regulamin', bodyMd: 'Treść' },
        { slug: 'polityka-prywatnosci', name: 'Polityka', consentType: 'PRIVACY', title: 'Polityka', bodyMd: 'Treść' },
      ],
    });
    // #1, #3 i #6 w strefie P-01, #2, #4 i #5 poza strefą parkowania.
    for (const [number, lat] of [
      [1, 50.0],
      [2, 50.01],
      [3, 50.0],
      [4, 50.01],
      [5, 50.01],
      [6, 50.0],
    ] as const) {
      await pool.query(
        `UPDATE scooters SET online = true, battery_pct = 80, last_seen_at = now() - interval '1 minute',
                position = ST_SetSRID(ST_MakePoint(18.5, $2), 4326) WHERE number = $1`,
        [number, lat],
      );
    }
    app = await createApp(
      loadConfig({
        NODE_ENV: 'test',
        DATABASE_URL: url.toString(),
        MQTT_ENABLED: 'false',
        JOBS_ENABLED: 'false',
        TELEMETRY_FLUSH_MS: '10000',
        FAKE_WEBHOOK_DELIVERY: 'manual',
        FILE_STORAGE: 'memory',
        OSRM_URL: 'http://127.0.0.1:9',
      }),
      { logger: false },
    );
    await app.init();
    customers.anna = await register('+48500200100', 'Anna');
    customers.bartek = await register('+48500200200', 'Bartek');
    const { rows } = await pool.query<{ id: string }>(`SELECT id FROM staff WHERE email = 'd@test.local'`);
    dispatcher = asStaff(app, staffToken(app, rows[0]!.id));
  });

  afterAll(async () => {
    await app?.close();
    await pool?.end();
    await admin?.query(`DROP DATABASE IF EXISTS ${dbName} WITH (FORCE)`);
    await admin?.end();
  });

  it('zakończenie przy hulajnodze offline: naliczanie do żądania, blokada ważna 10 min, ENDED po powrocie', async () => {
    const rentalId = await ride('anna', 1);
    await telemetry(1);
    await status(1, false);
    expect(jobs().sent).toContainEqual(expect.objectContaining({ name: JOBS.offlineBillingStop, data: { rentalId } }));

    const res = await as('anna')({ method: 'POST', url: '/rentals/current/end' });
    expect(res.statusCode).toBe(202);
    const ending = res.json<shared.RentalView>();
    expect(ending).toMatchObject({ state: 'ENDING', endMode: 'CUSTOMER_OFFLINE', scooterOnline: false });
    const [request] = await events(rentalId, 'END_REQUESTED');
    expect(request!.data).toMatchObject({ mode: 'OFFLINE', position: { lat: 50, lon: 18.5 } });
    expect(ending.billedUntil).toBe(request!.created_at.toISOString());

    const lock = lastCommand(1);
    expect(lock.cmd).toBe('lock');
    expect(new Date(lock.expiresAt!).getTime() - new Date(lock.issuedAt).getTime()).toBe(core.OFFLINE_END_TIMEOUT_MS);
    expect(jobs().sent).toContainEqual(
      expect.objectContaining({ name: JOBS.offlineEndTimeout, data: { rentalId, commandId: lock.commandId } }),
    );
    // Zabezpieczenie limitu potwierdzenia liczy od `expires_at`: blokada czekająca 10 min nie wygasa po 10 s.
    await jobs().run(JOBS.timeoutSweep);
    expect((await view('anna', rentalId)).state).toBe('ENDING');

    // Wymagane zdjęcie parkowania klient dodaje, zanim blokada dojdzie (makieta `koniec-offline`).
    const { rows: photo } = await pool.query<{ id: string }>(
      `INSERT INTO files (storage_key, purpose, content_type, size_bytes, uploaded_by)
       VALUES ($1, 'PARKING_PHOTO', 'image/jpeg', 1024, $2) RETURNING id`,
      [`parking-photo/test/${randomUUID()}.jpg`, customers.anna!.id],
    );
    const withPhoto = await as('anna')({
      method: 'POST',
      url: `/rentals/${rentalId}/parking-photo`,
      payload: { fileId: photo[0]!.id },
    });
    expect(withPhoto.statusCode).toBe(201);
    expect(withPhoto.json<shared.RentalView>()).toMatchObject({ state: 'ENDING', parkingPhotoRequired: false });

    await status(1, true);
    await ack(lock);
    const ended = await view('anna', rentalId);
    expect(ended).toMatchObject({
      state: 'ENDED',
      endMode: 'CUSTOMER_OFFLINE',
      parkingPhotoRequired: false,
      billedUntil: request!.created_at.toISOString(),
      settlement: { state: 'WALLET_PAID' },
    });
    // Zadanie po 10 min nic już nie zmienia.
    await jobs().run(JOBS.offlineEndTimeout, { rentalId });
    expect(await view('anna', rentalId)).toMatchObject({ state: 'ENDED', endMode: 'CUSTOMER_OFFLINE' });
  });

  it('bez potwierdzenia w 10 min END_UNCONFIRMED; ruch po żądaniu z bufora i blokada hulajnogi bez przejazdu', async () => {
    const rentalId = await ride('anna', 1);
    await telemetry(1);
    await status(1, false);
    await as('anna')({ method: 'POST', url: '/rentals/current/end' });
    const lock = lastCommand(1);
    const [request] = await events(rentalId, 'END_REQUESTED');

    await jobs().run(JOBS.offlineEndTimeout, { rentalId });
    const ended = await view('anna', rentalId);
    expect(ended).toMatchObject({ state: 'ENDED', endMode: 'UNCONFIRMED', parkingPhotoRequired: true });
    expect(ended.billedUntil).toBe(request!.created_at.toISOString());
    expect((await events(rentalId, 'LOCK_FAILED')).length).toBe(1);
    const command = await pool.query(`SELECT status FROM scooter_commands WHERE id = $1`, [lock.commandId]);
    expect(command.rows).toEqual([{ status: 'TIMEOUT' }]);
    const { rows } = await pool.query(`SELECT total_amount FROM rentals WHERE id = $1`, [rentalId]);
    expect(Number(rows[0].total_amount)).toBe(ended.price.total);

    // Hulajnoga wraca i dosyła bufor: 330 m od pozycji z chwili żądania.
    await status(1, true);
    const after = request!.created_at.getTime();
    for (const [i, lat] of [50.001, 50.002, 50.003].entries()) {
      await telemetry(1, { lat, buffered: true, at: new Date(after + (i + 1) * 1000) });
    }
    const moved = await events(rentalId, 'MOVED_AFTER_END');
    expect(moved).toHaveLength(1);
    expect(moved[0]!.data.distanceM).toBeGreaterThan(core.MOVED_AFTER_END_DISTANCE_M);
    expect((await details(rentalId)).timeline.map((e) => e.type)).toContain('MOVED_AFTER_END');

    // Bieżący odczyt bez przejazdu i bez blokady: `lock` bez `rental_id`, jeden mimo kolejnego odczytu.
    await telemetry(1, { lat: 50.003, at: new Date(after + 5000) });
    await telemetry(1, { lat: 50.003, at: new Date(after + 6000) });
    const idle = await pool.query(
      `SELECT type FROM scooter_commands WHERE scooter_id = $1 AND rental_id IS NULL AND type = 'LOCK'`,
      [await idOf(1)],
    );
    expect(idle.rows).toHaveLength(1);
    expect(lastCommand(1).cmd).toBe('lock');
  });

  it('offline: pozycja starsza niż 120 s daje POSITION_STALE, poza strefą OUTSIDE_PARKING', async () => {
    const rentalId = await ride('anna', 2);
    await telemetry(2, { lat: 50.01 });
    await status(2, false);
    await pool.query(`UPDATE scooters SET last_seen_at = now() - interval '3 minutes' WHERE number = 2`);
    const stale = await as('anna')({ method: 'POST', url: '/rentals/current/end' });
    expect(stale.statusCode).toBe(422);
    expect(stale.json()).toMatchObject({ code: 'POSITION_STALE', details: { maxAgeS: 120 } });

    await pool.query(`UPDATE scooters SET last_seen_at = now() WHERE number = 2`);
    const outside = await as('anna')({ method: 'POST', url: '/rentals/current/end' });
    expect(outside.statusCode).toBe(422);
    expect(outside.json()).toMatchObject({ code: 'OUTSIDE_PARKING', details: { nearestParking: { code: 'P-01' } } });
    expect((await view('anna', rentalId)).state).toBe('ACTIVE');
  });

  it('zdalne zakończenie poza strefą z opłatą za odholowanie z portfela: dwa wpisy, paragon, audyt, limit zwrotu', async () => {
    const { rental } = (await as('anna')({ method: 'GET', url: '/rentals/current' })).json<{
      rental: shared.RentalView;
    }>();
    await shift(rental.id, 3);
    const before = await details(rental.id);
    expect(before.towing).toMatchObject({ outOfZoneFee: 2000, outsideParking: true, positionAt: expect.any(String) });

    const res = await dispatcher({
      method: 'POST',
      url: `/admin/rentals/${rental.id}/end`,
      payload: { reason: 'SCOOTER_NOT_RESPONDING', collectTowingFee: true },
    });
    expect(res.statusCode).toBe(201);
    const ended = res.json<shared.RentalAdminDetails>();
    expect(ended).toMatchObject({ state: 'ENDED', endMode: 'REMOTE', towingFee: 2000, towing: null });
    expect(ended.price.towingFee).toBe(2000);
    expect(ended.totalAmount).toBe(ended.price.total);
    const rideAmount = ended.price.total - 2000;
    expect(rideAmount).toBe(ended.price.unlockFee + ended.price.rideAmount + ended.price.pauseAmount);

    const ledger = await pool.query<{ type: string; amount: string }>(
      `SELECT type::text AS type, amount FROM wallet_ledger WHERE rental_id = $1 ORDER BY id`,
      [rental.id],
    );
    expect(ledger.rows.map((r) => [r.type, Number(r.amount)])).toEqual([
      ['RIDE_CHARGE', -rideAmount],
      ['TOWING_FEE', -2000],
    ]);
    const customerView = await view('anna', rental.id);
    expect(customerView.price).toMatchObject({ towingFee: 2000, total: ended.price.total });
    const receipt = (
      await as('anna')({ method: 'GET', url: `/me/receipts/${customerView.settlement.receiptId}` })
    ).json<shared.ReceiptView>();
    expect(receipt.totalAmount).toBe(ended.price.total);
    expect(receipt.items.at(-1)).toMatchObject({ description: 'TOWING_FEE', amount: 2000, vatRate: 23 });
    const history = (await as('anna')({ method: 'GET', url: '/rentals' })).json<shared.RentalHistoryItem[]>();
    expect(history.find((h) => h.id === rental.id)).toMatchObject({ towingFee: 2000 });

    const audit = await pool.query(
      `SELECT data FROM audit_log WHERE action = 'rental.ended_remotely' AND entity_id = $1`,
      [rental.id],
    );
    expect(audit.rows[0].data).toMatchObject({ outsideParking: true, towingFee: 2000 });

    // Limit zwrotu obejmuje opłatę: sama opłata zwrotem częściowym, potem reszta, więcej nie.
    const refund = (amount: number) =>
      dispatcher({
        method: 'POST',
        url: `/admin/rentals/${rental.id}/refund`,
        payload: { amount, reason: 'SCOOTER_FAILURE' },
      });
    const partial = await refund(2000);
    expect(partial.statusCode).toBe(201);
    expect(partial.json<shared.RentalAdminDetails>().refundable).toBe(rideAmount);
    const tooMuch = await refund(rideAmount + 1);
    expect(tooMuch.statusCode).toBe(422);
    expect(tooMuch.json().code).toBe('REFUND_EXCEEDS_PAYMENT');
  });

  it('niska bateria: LOW z cennika i CRITICAL 5% raz na przejazd, limit 10 km/h, tylko odczyt bieżący', async () => {
    const rentalId = await ride('anna', 3);
    await telemetry(3, { bat: 10, buffered: true, at: new Date(Date.now() - 2000) });
    expect((await view('anna', rentalId)).batteryAlert).toBeNull();
    // Próg z cennika (15%) to minimum wypożyczenia: odczyt na progu jeszcze nie daje LOW.
    await telemetry(3, { bat: 15, at: new Date(Date.now() - 1000) });
    expect((await view('anna', rentalId)).batteryAlert).toBeNull();

    await telemetry(3, { bat: 14 });
    expect((await view('anna', rentalId)).batteryAlert).toBe('LOW');
    await telemetry(3, { bat: 16, at: new Date(Date.now() + 100) });
    await telemetry(3, { bat: 14, at: new Date(Date.now() + 200) });
    expect((await events(rentalId, 'BATTERY_LOW')).map((e) => e.data.threshold)).toEqual(['LOW']);
    expect(commands(3).filter((c) => c.cmd === 'speed_limit')).toEqual([]);

    await telemetry(3, { bat: 4, at: new Date(Date.now() + 300) });
    expect((await events(rentalId, 'BATTERY_LOW')).map((e) => e.data.threshold)).toEqual(['LOW', 'CRITICAL']);
    expect(lastCommand(3)).toMatchObject({ cmd: 'speed_limit', params: { kmh: core.BATTERY_CRITICAL_SPEED_KMH } });
    const critical = await view('anna', rentalId);
    expect(critical).toMatchObject({ batteryAlert: 'CRITICAL', zoneControl: { speedLimitKmh: 10, stopped: false } });
    await telemetry(3, { bat: 3, at: new Date(Date.now() + 400) });
    expect(commands(3).filter((c) => c.cmd === 'speed_limit')).toHaveLength(1);
  });

  it('30 min bez łączności zatrzymuje naliczanie: BILLING_STOPPED raz, kwota stoi; w strefie bez opłaty za odholowanie', async () => {
    const { rental } = (await as('anna')({ method: 'GET', url: '/rentals/current' })).json<{
      rental: shared.RentalView;
    }>();
    await status(3, false);
    // Przed upływem limitu zadanie nic nie zapisuje.
    await jobs().run(JOBS.offlineBillingStop, { rentalId: rental.id });
    expect(await events(rental.id, 'BILLING_STOPPED')).toEqual([]);

    // Jazda od 50 min, łączność utracona 40 min temu: płatne 10 min + 30 min limitu.
    await shift(rental.id, 50, `type::text <> 'CONNECTION_LOST'`);
    await shift(rental.id, 40, `type::text = 'CONNECTION_LOST'`);
    await jobs().run(JOBS.offlineBillingStop, { rentalId: rental.id });
    await jobs().run(JOBS.offlineBillingStop, { rentalId: rental.id });
    const stopped = await events(rental.id, 'BILLING_STOPPED');
    expect(stopped).toHaveLength(1);
    const [lost] = await events(rental.id, 'CONNECTION_LOST');
    const stopAt = new Date(lost!.created_at.getTime() + core.OFFLINE_BILLING_CAP_MS).toISOString();

    const first = await view('anna', rental.id);
    expect(first).toMatchObject({ billingStopped: true, billingStoppedAt: stopAt });
    expect(first.rideSeconds).toBeGreaterThanOrEqual(40 * 60 - 5);
    expect(first.rideSeconds).toBeLessThanOrEqual(40 * 60 + 5);
    await new Promise((resolve) => setTimeout(resolve, 1100));
    expect((await view('anna', rental.id)).rideSeconds).toBe(first.rideSeconds);
    expect((await details(rental.id)).billingStoppedAt).toBe(stopAt);

    const inZone = await dispatcher({
      method: 'POST',
      url: `/admin/rentals/${rental.id}/end`,
      payload: { reason: 'SCOOTER_NOT_RESPONDING', collectTowingFee: true },
    });
    expect(inZone.statusCode).toBe(422);
    expect(inZone.json().code).toBe('TOWING_FEE_NOT_APPLICABLE');
    const ended = (
      await dispatcher({
        method: 'POST',
        url: `/admin/rentals/${rental.id}/end`,
        payload: { reason: 'SCOOTER_NOT_RESPONDING' },
      })
    ).json<shared.RentalAdminDetails>();
    expect(ended).toMatchObject({ state: 'ENDED', endMode: 'REMOTE', towingFee: null, rideSeconds: first.rideSeconds });
    const audit = await pool.query(
      `SELECT data FROM audit_log WHERE action = 'rental.ended_remotely' AND entity_id = $1`,
      [rental.id],
    );
    expect(audit.rows[0].data).toMatchObject({ outsideParking: false });
    expect(audit.rows[0].data.towingFee).toBeUndefined();
  });

  it('opłata za odholowanie kartą: jedna płatność na całą kwotę z paragonem i limitem zwrotu', async () => {
    const setup = (
      await as('bartek')({ method: 'POST', url: '/me/payment-methods/setup' })
    ).json<shared.SetupIntentResponse>();
    await as('bartek')({
      method: 'POST',
      url: '/payments/fake/setup-intents/confirm',
      payload: {
        clientSecret: setup.clientSecret,
        cardNumber: '4242424242424242',
        expMonth: 12,
        expYear: 2030,
        cvc: '123',
      },
    });
    await flushPayments();
    const rentalId = await ride('bartek', 4, { paymentSource: 'CARD' });
    await shift(rentalId, 3);

    const ended = (
      await dispatcher({
        method: 'POST',
        url: `/admin/rentals/${rentalId}/end`,
        payload: { reason: 'TERMS_VIOLATION', collectTowingFee: true },
      })
    ).json<shared.RentalAdminDetails>();
    expect(ended).toMatchObject({ towingFee: 2000, price: { towingFee: 2000 } });
    await flushPayments();

    const payments = await pool.query<{ amount: string; status: string }>(
      `SELECT amount, status FROM payments WHERE rental_id = $1`,
      [rentalId],
    );
    expect(payments.rows.map((p) => [Number(p.amount), p.status])).toEqual([[ended.price.total, 'SUCCEEDED']]);
    const paid = await view('bartek', rentalId);
    expect(paid.settlement).toMatchObject({ state: 'CARD_PAID', paidAmount: ended.price.total });
    const receipt = (
      await as('bartek')({ method: 'GET', url: `/me/receipts/${paid.settlement.receiptId}` })
    ).json<shared.ReceiptView>();
    expect(receipt.items.map((i) => i.description)).toContain('TOWING_FEE');
    expect(receipt.totalAmount).toBe(ended.price.total);

    const tooMuch = await dispatcher({
      method: 'POST',
      url: `/admin/rentals/${rentalId}/refund`,
      payload: { amount: ended.price.total + 1, reason: 'SCOOTER_FAILURE' },
    });
    expect(tooMuch.statusCode).toBe(422);
    expect((await details(rentalId)).refundable).toBe(ended.price.total);
  });

  it('zdalne zakończenie offline: blokada 10 min, potem blokada hulajnogi w serwisie bez przejazdu z limitem prób', async () => {
    const rentalId = await ride('anna', 5);
    await telemetry(5, { lat: 50.01 });
    await status(5, false);
    const res = await dispatcher({
      method: 'POST',
      url: `/admin/rentals/${rentalId}/end`,
      payload: { reason: 'SCOOTER_NOT_RESPONDING' },
    });
    expect(res.statusCode).toBe(201);
    // Hulajnoga offline: broker dostarczy blokadę po powrocie, więc czeka 10 min jak przy zakończeniu klienta offline.
    const lock = lastCommand(5);
    expect(lock.cmd).toBe('lock');
    expect(new Date(lock.expiresAt!).getTime() - new Date(lock.issuedAt).getTime()).toBe(core.OFFLINE_END_TIMEOUT_MS);
    // Poza strefą: zadanie RELOCATION, hulajnoga od razu w serwisie (A z przeglądu).
    const scooter = await pool.query(`SELECT id, status::text AS status FROM scooters WHERE number = 5`);
    expect(scooter.rows[0].status).toBe('MAINTENANCE');
    const scooterId = scooter.rows[0].id as string;

    // Hulajnoga nie wróciła w 10 min: blokada wygasa bez potwierdzenia.
    await pool.query(
      `UPDATE scooter_commands SET sent_at = now() - interval '11 minutes', expires_at = now() - interval '1 minute'
       WHERE id = $1`,
      [lock.commandId],
    );
    await jobs().run(JOBS.timeoutSweep);
    expect((await pool.query(`SELECT status FROM scooter_commands WHERE id = $1`, [lock.commandId])).rows).toEqual([
      { status: 'TIMEOUT' },
    ]);

    // Wraca odblokowana: reguła blokady działa także w MAINTENANCE.
    const idleLocks = async () =>
      (
        await pool.query<{ id: string; status: string }>(
          `SELECT id, status::text AS status FROM scooter_commands
           WHERE scooter_id = $1 AND rental_id IS NULL AND type = 'LOCK' ORDER BY sent_at`,
          [scooterId],
        )
      ).rows;
    await status(5, true);
    await telemetry(5, { lat: 50.01, locked: false });
    expect(await idleLocks()).toHaveLength(1);
    // Odrzucona blokada: kolejna próba najwcześniej po 5 min, bez pętli komend.
    await ack(lastCommand(5), false);
    await telemetry(5, { lat: 50.01, locked: false, at: new Date(Date.now() + 1000) });
    expect((await idleLocks()).map((c) => c.status)).toEqual(['REJECTED']);
    await pool.query(
      `UPDATE scooter_commands SET acked_at = now() - interval '6 minutes' WHERE scooter_id = $1 AND status = 'REJECTED'`,
      [scooterId],
    );
    await telemetry(5, { lat: 50.01, locked: false, at: new Date(Date.now() + 2000) });
    expect((await idleLocks()).map((c) => c.status)).toEqual(['REJECTED', 'SENT']);
    await ack(lastCommand(5));

    // Serwisant odblokował hulajnogę z panelu: system jej nie blokuje.
    const unlock = await dispatcher({
      method: 'POST',
      url: `/admin/scooters/${scooterId}/commands`,
      payload: { type: 'UNLOCK' },
    });
    expect(unlock.statusCode).toBe(202);
    await ack(lastCommand(5));
    const issued = await pool.query(
      `SELECT issued_by_staff IS NOT NULL AS by_staff FROM scooter_commands WHERE scooter_id = $1 AND type = 'UNLOCK'
       AND rental_id IS NULL`,
      [scooterId],
    );
    expect(issued.rows).toEqual([{ by_staff: true }]);
    await telemetry(5, { lat: 50.01, locked: false, at: new Date(Date.now() + 3000) });
    expect(await idleLocks()).toHaveLength(2);
  });

  it('zakończony przejazd pokazuje liczniki i kwotę zapisane przy zakończeniu, nie przeliczone z osi czasu', async () => {
    const { rows } = await pool.query<{ id: string; ride_seconds: number; total_amount: string; user_id: string }>(
      `SELECT id, ride_seconds, total_amount, user_id FROM rentals
       WHERE state = 'ENDED' AND user_id = $1 AND end_mode = 'CUSTOMER_OFFLINE' LIMIT 1`,
      [customers.anna!.id],
    );
    const stored = rows[0]!;
    // Oś czasu po zakończeniu mówi co innego (np. nowe reguły naliczania): widoki pokazują zapis przejazdu.
    await shift(stored.id, 120, `type::text = 'STATE_CHANGED' AND to_state = 'ACTIVE'`);
    const customer = await view('anna', stored.id);
    expect(customer.rideSeconds).toBe(stored.ride_seconds);
    expect(customer.price.total).toBe(Number(stored.total_amount));
    const admin = await details(stored.id);
    expect(admin.rideSeconds).toBe(stored.ride_seconds);
    expect(admin.price.total).toBe(Number(stored.total_amount));
  });

  it('ruch po zakończeniu offline: odczyty po starcie zadania serwisowego nie dają MOVED_AFTER_END', async () => {
    const rentalId = await ride('anna', 6);
    await telemetry(6);
    await status(6, false);
    expect((await as('anna')({ method: 'POST', url: '/rentals/current/end' })).statusCode).toBe(202);
    await jobs().run(JOBS.offlineEndTimeout, { rentalId });
    expect((await view('anna', rentalId)).state).toBe('ENDED');

    // Serwisant zabiera hulajnogę (zadanie RELOCATION w toku); dosłany bufor z drogi do serwisu to nie ruch klienta.
    const scooterId = await idOf(6);
    const task = (
      await dispatcher({
        method: 'POST',
        url: '/admin/service-tasks',
        payload: { scooterId, type: 'RELOCATION', target: { point: { lat: 50.0, lon: 18.5 } } },
      })
    ).json<shared.ServiceTaskDetails>();
    const started = await dispatcher({
      method: 'POST',
      url: `/admin/service-tasks/${task.id}/start`,
      payload: { version: task.version },
    });
    expect(started.statusCode).toBe(201);
    await status(6, true);
    const after = Date.now() + 1000;
    for (const [i, lat] of [50.001, 50.002, 50.003].entries()) {
      await telemetry(6, { lat, buffered: true, at: new Date(after + i * 1000) });
    }
    expect(await events(rentalId, 'MOVED_AFTER_END')).toEqual([]);
  });
});
