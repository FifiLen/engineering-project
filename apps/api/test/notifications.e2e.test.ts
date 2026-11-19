import * as core from '@hulajnogi/core';
import type { Database } from '@hulajnogi/db';
import * as shared from '@hulajnogi/shared';
import type { NestFastifyApplication } from '@nestjs/platform-fastify';
import type { ExpoPushTicket } from 'expo-server-sdk';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { LoggingSmsGateway } from '../src/auth/sms.gateway.js';
import { DB } from '../src/database/database.module.js';
import { JOBS, type JobName } from '../src/jobs/jobs.service.js';
import { ExpoPushGateway, type ExpoClient } from '../src/notifications/expo-push-gateway.js';
import { FakePushGateway } from '../src/notifications/fake-push-gateway.js';
import { NotificationsService, RECEIPTS_AFTER_MS } from '../src/notifications/notifications.service.js';
import { PUSH_GATEWAY, type PushMessage } from '../src/notifications/push-gateway.js';
import { FakePaymentProvider } from '../src/payments/provider/fake-payment-provider.js';
import { PAYMENT_PROVIDER } from '../src/payments/provider/payment-provider.js';
import { FleetGateway } from '../src/realtime/fleet.gateway.js';
import { RentalsService } from '../src/rentals/rentals.service.js';
import { operationsContext, type OperationsContext } from './operations-helpers.js';

describe('rejestr szablonów powiadomień jest zgodny z packages/core', () => {
  it.each([
    ['NOTIFICATION_TEMPLATE_CODES', shared.NOTIFICATION_TEMPLATE_CODES, core.NOTIFICATION_TEMPLATE_CODES],
    ['NOTIFICATION_STATUSES', shared.NOTIFICATION_STATUSES, core.NOTIFICATION_STATUSES],
    ['NOTIFICATION_CHANNELS', shared.NOTIFICATION_CHANNELS, core.NOTIFICATION_CHANNELS],
    ['TEMPLATE_PARAM_TYPES', shared.TEMPLATE_PARAM_TYPES, core.TEMPLATE_PARAM_TYPES],
  ])('%s', (_name, fromShared, fromCore) => {
    expect([...fromShared]).toEqual([...fromCore]);
  });

  it('limity i preferencje są te same', () => {
    expect(shared.TEMPLATE_LIMITS).toEqual(core.TEMPLATE_LIMITS);
    for (const code of shared.NOTIFICATION_TEMPLATE_CODES) {
      expect(shared.NOTIFICATION_TEMPLATES[code].preference ?? undefined).toBe(core.NOTIFICATION_PREFERENCE[code]);
    }
  });
});

/** Atrapa klienta `expo-server-sdk`: bez sieci, z błędami HTTP do sprawdzenia ponowień. */
function expoClient(responses: Array<Error | ((messages: unknown[]) => ExpoPushTicket[])>) {
  const calls: unknown[][] = [];
  const client: ExpoClient = {
    sendPushNotificationsAsync: (messages) => {
      calls.push(messages);
      const next =
        responses.shift() ?? ((m: unknown[]) => m.map((_, i) => ({ status: 'ok', id: `t${calls.length}-${i}` })));
      if (next instanceof Error) return Promise.reject(next);
      return Promise.resolve(next(messages) as ExpoPushTicket[]);
    },
    chunkPushNotificationReceiptIds: (ids) => [ids],
    getPushNotificationReceiptsAsync: (ids) =>
      Promise.resolve(
        Object.fromEntries(
          ids.map((id) => [
            id,
            id === 'dead'
              ? { status: 'error', message: 'gone', details: { error: 'DeviceNotRegistered' } }
              : { status: 'ok' },
          ]),
        ) as never,
      ),
  };
  return { client, calls };
}

const httpError = (statusCode: number) => Object.assign(new Error(`HTTP ${statusCode}`), { statusCode });

const message = (to: string): PushMessage => ({
  to,
  title: 'Tytuł',
  body: 'Treść',
  data: { path: '/przejazd', notificationId: 1, templateCode: 'battery_low' },
});

describe('bramka Expo Push (ADR 0058)', () => {
  it('partie do 100 wiadomości, bilet o indeksie wiadomości, DeviceNotRegistered', async () => {
    const { client, calls } = expoClient([
      () => Array.from({ length: 100 }, (_, i) => ({ status: 'ok' as const, id: `a${i}` })),
      () => Array.from({ length: 100 }, (_, i) => ({ status: 'ok' as const, id: `b${i}` })),
      (m) =>
        m.map((_, i) =>
          i === 0
            ? {
                status: 'error' as const,
                message: 'not registered',
                details: { error: 'DeviceNotRegistered' as const },
              }
            : { status: 'ok' as const, id: `c${i}` },
        ),
    ]);
    const gateway = new ExpoPushGateway({ client }, { attempts: 3, baseDelayMs: 1 }, () => Promise.resolve());
    const tokens = Array.from({ length: 250 }, (_, i) => `ExponentPushToken[t${i}]`);
    const tickets = await gateway.send(tokens.map(message));
    expect(calls.map((c) => c.length)).toEqual([100, 100, 50]);
    expect(calls[0]![0]).toMatchObject({
      to: tokens[0],
      title: 'Tytuł',
      channelId: 'default',
      data: { path: '/przejazd' },
    });
    expect(tickets).toHaveLength(250);
    expect(tickets[0]).toEqual({ to: tokens[0], ok: true, ticketId: 'a0' });
    expect(tickets[200]).toEqual({
      to: tokens[200],
      ok: false,
      error: 'DeviceNotRegistered',
      deviceNotRegistered: true,
    });
    expect(tickets[249]).toMatchObject({ ok: true, ticketId: 'c49' });
  });

  it('ponowienia z wykładniczym odstępem przy 429 i 5xx, bez ponowień przy 400', async () => {
    const sleeps: number[] = [];
    const sleep = (ms: number) => {
      sleeps.push(ms);
      return Promise.resolve();
    };
    const retried = expoClient([httpError(429), httpError(503)]);
    const gateway = new ExpoPushGateway({ client: retried.client }, { attempts: 4, baseDelayMs: 100 }, sleep);
    expect(await gateway.send([message('ExponentPushToken[x]')])).toEqual([
      { to: 'ExponentPushToken[x]', ok: true, ticketId: 't3-0' },
    ]);
    expect(sleeps).toEqual([100, 200]);

    const rejected = expoClient([httpError(400)]);
    const strict = new ExpoPushGateway({ client: rejected.client }, { attempts: 4, baseDelayMs: 100 }, sleep);
    const [ticket] = await strict.send([message('ExponentPushToken[y]')]);
    expect(ticket).toMatchObject({ ok: false, deviceNotRegistered: false, error: expect.stringContaining('HTTP 400') });
    expect(rejected.calls).toHaveLength(1);

    const down = expoClient([httpError(502), httpError(502), httpError(502)]);
    const flaky = new ExpoPushGateway({ client: down.client }, { attempts: 3, baseDelayMs: 1 }, () =>
      Promise.resolve(),
    );
    expect((await flaky.send([message('ExponentPushToken[z]')]))[0]).toMatchObject({ ok: false });
    expect(down.calls).toHaveLength(3);
  });

  it('potwierdzenia: DeviceNotRegistered z receipt', async () => {
    const { client } = expoClient([]);
    const receipts = await new ExpoPushGateway({ client }).receipts(['ok-1', 'dead']);
    expect(receipts.get('ok-1')).toEqual({ ok: true });
    expect(receipts.get('dead')).toEqual({ ok: false, error: 'DeviceNotRegistered', deviceNotRegistered: true });
  });
});

interface NotificationRow {
  id: number;
  user_id: string;
  template_code: string;
  status: string;
  dedupe_key: string;
  payload: { params: Record<string, unknown>; path: string | null };
  title: string | null;
  body: string | null;
  error: string | null;
  template_version: number | null;
  provider_ref: string | null;
  sent_at: Date | null;
  rental_id: string | null;
  ticket_id: string | null;
}

/**
 * Powiadomienia z szablonów (ADR 0058): obieg QUEUED → SENT|SKIPPED|FAILED z atrapą bramki, idempotencja, tokeny
 * i ich unieważnianie, szablony w panelu z wersjami i uprawnieniami, kod SMS z szablonu i zdarzenia, które
 * zapisują powiadomienia.
 */
describe.skipIf(!process.env.DATABASE_URL)('API: powiadomienia', () => {
  let ctx: OperationsContext;
  let app: NestFastifyApplication;
  const customers = {} as Record<'anna' | 'bartek' | 'celina' | 'darek', { id: string; token: string }>;
  const as = (who: keyof typeof customers) => ctx.customer(customers[who].token);
  const push = () => app.get<FakePushGateway>(PUSH_GATEWAY);
  const notifications = () => app.get(NotificationsService);
  /** Zadania już wykonane albo pominięte (indeksy w `JobsService.sent`). */
  const done = new Set<number>();

  const rows = async (where: string, params: unknown[] = []) =>
    (await ctx.pool.query<NotificationRow>(`SELECT * FROM notifications WHERE ${where} ORDER BY id`, params)).rows;
  const byKey = async (key: string) => (await rows('dedupe_key = $1', [key]))[0];

  /** Zaplanowane zadania podanych rodzajów z kolejki (wyłączonej w testach), każde raz; zwraca liczbę wykonanych. */
  async function runJobs(...names: JobName[]): Promise<number> {
    const pending = ctx.jobs().sent.flatMap((job, i) => (!done.has(i) && names.includes(job.name) ? [i] : []));
    for (const i of pending) {
      done.add(i);
      const job = ctx.jobs().sent[i]!;
      await ctx.jobs().run(job.name, job.data);
    }
    return pending.length;
  }
  /** Zadania zaplanowane do tej chwili traktujemy jak zgubione (nie zostaną wykonane). */
  const discardJobs = () => ctx.jobs().sent.forEach((_, i) => done.add(i));
  const sendAll = () => runJobs(JOBS.notificationSend);

  /** Zakończony przejazd w bazie (wiersz pod `notifications.rental_id`) bez całego obiegu wypożyczenia. */
  async function endedRental(userId: string, scooterNumber = 10): Promise<string> {
    const row = await ctx.pool.query<{ id: string }>(
      `INSERT INTO rentals (user_id, scooter_id, tariff_id, state, started_at, ended_at, ride_seconds, pause_seconds,
                            total_amount)
       SELECT $1, s.id, (SELECT id FROM tariffs ORDER BY valid_from DESC LIMIT 1), 'ENDED', now() - interval '5 minutes',
              now(), 300, 0, 0
       FROM scooters s WHERE s.number = $2
       RETURNING id`,
      [userId, scooterNumber],
    );
    return row.rows[0]!.id;
  }

  const registerToken = (who: keyof typeof customers, token: string, platform: 'IOS' | 'ANDROID' = 'IOS') =>
    as(who)({ method: 'POST', url: '/me/push-tokens', payload: { token, platform } });

  beforeAll(async () => {
    ctx = await operationsContext('notifications_api', 10);
    app = ctx.app;
    customers.anna = await ctx.register('+48500400100', 'Anna Powiadomienia');
    customers.bartek = await ctx.register('+48500400200', 'Bartek Bez Tokenu');
    customers.celina = await ctx.register('+48500400300', 'Celina Preferencje');
    customers.darek = await ctx.register('+48500400400', 'Darek Karta');
    expect((await registerToken('anna', 'ExponentPushToken[anna-phone]')).statusCode).toBe(204);
    expect((await registerToken('celina', 'ExponentPushToken[celina-phone]', 'ANDROID')).statusCode).toBe(204);
    expect((await registerToken('darek', 'ExponentPushToken[darek-phone]')).statusCode).toBe(204);
    discardJobs();
  });

  beforeEach(() => {
    vi.restoreAllMocks();
  });

  afterAll(async () => {
    await ctx?.close();
  });

  it('dane startowe: szablony wszystkich kodów z rejestru przechodzą walidację', async () => {
    const templates = (
      await ctx.pool.query<{ code: string; channel: 'PUSH' | 'SMS'; title: string | null; body: string }>(
        `SELECT code, channel::text, title, body FROM notification_templates ORDER BY code`,
      )
    ).rows;
    expect(templates.map((t) => t.code).sort()).toEqual([...shared.NOTIFICATION_TEMPLATE_CODES].sort());
    for (const template of templates) {
      const definition = shared.NOTIFICATION_TEMPLATES[template.code as shared.NotificationTemplateCode];
      expect(template.channel).toBe(definition.channel);
      expect(core.templateIssues(template, definition.params)).toEqual([]);
    }
  });

  it('tokeny: upsert z sesją, przejęcie z innego konta, usunięcie tylko własnego, zły format', async () => {
    const token = 'ExponentPushToken[shared-device]';
    expect((await registerToken('bartek', token, 'ANDROID')).statusCode).toBe(204);
    const first = (
      await ctx.pool.query(
        `SELECT user_id, platform::text, session_id, last_seen_at FROM push_tokens WHERE expo_token = $1`,
        [token],
      )
    ).rows[0];
    expect(first).toMatchObject({ user_id: customers.bartek.id, platform: 'ANDROID', session_id: expect.any(String) });
    const session = await ctx.pool.query(`SELECT user_id, revoked_at FROM sessions WHERE id = $1`, [first.session_id]);
    expect(session.rows[0]).toMatchObject({ user_id: customers.bartek.id, revoked_at: null });

    // To samo urządzenie zalogowane na inne konto: token przechodzi do Anny.
    await registerToken('anna', token, 'IOS');
    const moved = (
      await ctx.pool.query(`SELECT user_id, platform::text, last_seen_at FROM push_tokens WHERE expo_token = $1`, [
        token,
      ])
    ).rows;
    expect(moved).toEqual([{ user_id: customers.anna.id, platform: 'IOS', last_seen_at: expect.any(Date) }]);
    expect(moved[0].last_seen_at.getTime()).toBeGreaterThanOrEqual(first.last_seen_at.getTime());

    // Bartek nie usunie tokenu Anny; Anna usuwa swój (204 także dla nieistniejącego).
    const path = `/me/push-tokens/${encodeURIComponent(token)}`;
    expect((await as('bartek')({ method: 'DELETE', url: path })).statusCode).toBe(204);
    expect((await ctx.pool.query(`SELECT 1 FROM push_tokens WHERE expo_token = $1`, [token])).rowCount).toBe(1);
    expect((await as('anna')({ method: 'DELETE', url: path })).statusCode).toBe(204);
    expect((await ctx.pool.query(`SELECT 1 FROM push_tokens WHERE expo_token = $1`, [token])).rowCount).toBe(0);

    const invalid = await registerToken('anna', 'not-a-token');
    expect(invalid.statusCode).toBe(400);
    expect(invalid.json().code).toBe('VALIDATION_ERROR');

    const list = await ctx.staff.admin({ method: 'GET', url: '/admin/push-tokens', query: { platform: 'ANDROID' } });
    expect(list.statusCode).toBe(200);
    expect(list.json<shared.ListResponse<shared.PushTokenListItem>>().items).toEqual([
      expect.objectContaining({ userId: customers.celina.id, sessionActive: true, userName: 'Celina Preferencje' }),
    ]);
    // Tokeny to dane konta: Serwisant bez users.read ich nie widzi.
    expect((await ctx.staff.technician({ method: 'GET', url: '/admin/push-tokens' })).statusCode).toBe(403);
  });

  it('rotacja sesji przenosi tokeny, wylogowanie usuwa tokeny rodziny sesji', async () => {
    const phone = '+48500400500';
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
    const token = 'ExponentPushToken[logout-device]';
    const register = await ctx.customer(session.accessToken)({
      method: 'POST',
      url: '/me/push-tokens',
      payload: { token, platform: 'IOS' },
    });
    expect(register.statusCode).toBe(204);
    const tokenSession = async () =>
      (await ctx.pool.query(`SELECT session_id FROM push_tokens WHERE expo_token = $1`, [token])).rows[0]?.session_id;
    const before = await tokenSession();

    const refreshed = (
      await app.inject({ method: 'POST', url: '/auth/refresh', payload: { refreshToken: session.refreshToken } })
    ).json<shared.CustomerTokens>();
    const after = await tokenSession();
    expect(after).not.toBe(before);
    expect(
      (await ctx.pool.query(`SELECT revoked_at FROM sessions WHERE id = $1`, [after])).rows[0].revoked_at,
    ).toBeNull();

    // Token zarejestrowany jeszcze starym tokenem dostępowym trafia do aktywnej sesji rodziny.
    await ctx.customer(session.accessToken)({
      method: 'POST',
      url: '/me/push-tokens',
      payload: { token, platform: 'IOS' },
    });
    expect(await tokenSession()).toBe(after);

    expect(
      (await app.inject({ method: 'POST', url: '/auth/logout', payload: { refreshToken: refreshed.refreshToken } }))
        .statusCode,
    ).toBe(204);
    expect(await tokenSession()).toBeUndefined();
    // Sesja nie jest usuwana, tylko unieważniana: kaskada z `sessions` nie wystarcza.
    expect(
      (await ctx.pool.query(`SELECT revoked_at FROM sessions WHERE id = $1`, [after])).rows[0].revoked_at,
    ).not.toBeNull();
  });

  it('obieg QUEUED → SENT z atrapą: zgłoszenie klienta, treść z szablonu, bilet, potwierdzenie, notification.created', async () => {
    const created = vi.spyOn(app.get(FleetGateway), 'notificationCreated');
    const res = await as('anna')({
      method: 'POST',
      url: '/tickets',
      payload: { scooterId: await ctx.idOf(3), categories: ['LIGHTS'], description: 'Nie świeci' },
    });
    expect(res.statusCode).toBe(201);
    const ticket = res.json<shared.CustomerTicketView>();
    const queued = await byKey(`ticket_received:${ticket.id}`);
    expect(queued).toMatchObject({
      user_id: customers.anna.id,
      template_code: 'ticket_received',
      status: 'QUEUED',
      ticket_id: ticket.id,
      title: null,
      sent_at: null,
      payload: {
        params: { ticketNumber: shared.ticketLabel(ticket.number), scooterNumber: '#0003' },
        path: `/zgloszenie/${ticket.id}`,
      },
    });
    expect(ctx.jobs().sent.at(-1)).toMatchObject({
      name: JOBS.notificationSend,
      data: { notificationId: Number(queued!.id) },
    });

    await sendAll();
    const sent = await byKey(`ticket_received:${ticket.id}`);
    expect(sent).toMatchObject({
      status: 'SENT',
      title: 'Otrzymaliśmy zgłoszenie',
      body: `Zgłoszenie ${shared.ticketLabel(ticket.number)} dotyczące hulajnogi #0003 jest u nas. Damy znać, gdy coś się zmieni.`,
      template_version: 1,
      provider_ref: expect.stringMatching(/^fake-/),
      error: null,
      sent_at: expect.any(Date),
    });
    expect(push().sent.at(-1)).toMatchObject({
      to: 'ExponentPushToken[anna-phone]',
      title: 'Otrzymaliśmy zgłoszenie',
      data: { path: `/zgloszenie/${ticket.id}`, notificationId: Number(sent!.id), templateCode: 'ticket_received' },
    });
    expect(created).toHaveBeenCalledWith(
      customers.anna.id,
      expect.objectContaining({
        id: Number(sent!.id),
        templateCode: 'ticket_received',
        path: `/zgloszenie/${ticket.id}`,
      }),
    );
    const receipts = ctx
      .jobs()
      .sent.filter((j) => j.name === JOBS.notificationReceipts)
      .at(-1)!;
    expect(receipts.data).toEqual({
      notificationId: Number(sent!.id),
      tickets: [{ id: sent!.provider_ref, token: 'ExponentPushToken[anna-phone]' }],
    });
    expect(receipts.startAfter!.getTime() - Date.now()).toBeGreaterThan(RECEIPTS_AFTER_MS - 60_000);

    // Powtórzone zadanie nic nie wysyła ponownie.
    const before = push().sent.length;
    await ctx.jobs().run(JOBS.notificationSend, { notificationId: Number(sent!.id) });
    expect(push().sent.length).toBe(before);

    // Lista „Wysłane”: Dyspozytor (content.read, users.read) widzi klienta, Serwisant nie ma content.read.
    const list = await ctx.staff.dispatcher({
      method: 'GET',
      url: '/admin/notifications',
      query: { templateCode: 'ticket_received', facets: 'status' },
    });
    expect(list.statusCode).toBe(200);
    expect(list.json<shared.ListResponse<shared.NotificationListItem>>().items[0]).toMatchObject({
      id: Number(sent!.id),
      status: 'SENT',
      userName: 'Anna Powiadomienia',
      ticketNumber: ticket.number,
    });
    expect((await ctx.staff.technician({ method: 'GET', url: '/admin/notifications' })).statusCode).toBe(403);
  });

  it('idempotencja: to samo zdarzenie dwa razy daje jedno powiadomienie i jedno zadanie', async () => {
    const db = app.get<Database>(DB);
    const ride = {
      id: await endedRental(customers.anna.id),
      userId: customers.anna.id,
      number: 51858,
      rideSeconds: 23 * 60 + 40,
      pauseSeconds: 0,
      totalAmount: 1960,
      towingFee: null,
    };
    const jobsBefore = ctx.jobs().sent.length;
    const first = await db.transaction((tx) => notifications().rideEnded(tx, ride, true));
    const second = await db.transaction((tx) => notifications().rideEnded(tx, ride, true));
    expect(first).toEqual(expect.any(Number));
    expect(second).toBeNull();
    expect(await rows('dedupe_key = $1', [`ride_ended:${ride.id}`])).toHaveLength(1);
    expect(
      ctx
        .jobs()
        .sent.slice(jobsBefore)
        .filter((j) => j.name === JOBS.notificationSend),
    ).toHaveLength(1);
    // Wycofana transakcja zdarzenia nie zostawia powiadomienia.
    const other = { ...ride, id: await endedRental(customers.anna.id) };
    await expect(
      db.transaction(async (tx) => {
        await notifications().rideEnded(tx, other, true);
        throw new Error('rollback');
      }),
    ).rejects.toThrow('rollback');
    expect(await byKey(`ride_ended:${other.id}`)).toBeUndefined();

    await sendAll();
    expect(await byKey(`ride_ended:${ride.id}`)).toMatchObject({
      status: 'SENT',
      body: `Przejazd R-51858 trwał 24 minuty. Koszt: ${shared.formatPln(1960)}. Paragon w aplikacji.`,
    });
  });

  it('SKIPPED: wyłączona preferencja i brak tokenu; baner tylko przy braku tokenu (wersja web)', async () => {
    const created = vi.spyOn(app.get(FleetGateway), 'notificationCreated');
    expect(
      (
        await as('celina')({
          method: 'PATCH',
          url: '/me/notifications',
          payload: { reservationEnd: true, receipts: false },
        })
      ).statusCode,
    ).toBe(200);
    const db = app.get<Database>(DB);
    const ride = (userId: string, id: string) => ({
      id,
      userId,
      number: 7,
      rideSeconds: 60,
      pauseSeconds: 0,
      totalAmount: 380,
      towingFee: null,
    });
    const celinaRide = ride(customers.celina.id, await endedRental(customers.celina.id));
    const bartekRide = ride(customers.bartek.id, await endedRental(customers.bartek.id));
    await db.transaction(async (tx) => {
      await notifications().rideEnded(tx, celinaRide, true);
      await notifications().rideEnded(tx, bartekRide, true);
      // Bateria idzie zawsze, niezależnie od preferencji.
      await notifications().batteryLow(tx, {
        rentalId: celinaRide.id,
        userId: customers.celina.id,
        scooterNumber: 7,
        batteryPct: 14,
      });
    });
    await sendAll();
    expect(await byKey(`ride_ended:${celinaRide.id}`)).toMatchObject({
      status: 'SKIPPED',
      error: 'PREFERENCE_DISABLED',
      body: expect.stringContaining(`Koszt: ${shared.formatPln(380)}.`),
      template_version: 1,
      sent_at: null,
    });
    expect(await byKey(`ride_ended:${bartekRide.id}`)).toMatchObject({ status: 'SKIPPED', error: 'NO_PUSH_TOKEN' });
    expect(await byKey(`battery_low:${celinaRide.id}`)).toMatchObject({
      status: 'SENT',
      body: 'Bateria hulajnogi #0007: 14%. Zakończ przejazd w najbliższej strefie parkowania.',
    });
    expect(created.mock.calls.map(([userId]) => userId).sort()).toEqual(
      [customers.bartek.id, customers.celina.id].sort(),
    );
  });

  it('DeviceNotRegistered przy wysyłce i w potwierdzeniu usuwa token', async () => {
    const dead = 'ExponentPushToken[anna-old-tablet]';
    const later = 'ExponentPushToken[anna-new-tablet]';
    await registerToken('anna', dead);
    await registerToken('anna', later);
    push().unregistered.add(dead);
    push().unregisteredLater.add(later);
    const db = app.get<Database>(DB);
    const rentalId = await endedRental(customers.anna.id);
    await db.transaction((tx) =>
      notifications().batteryLow(tx, { rentalId, userId: customers.anna.id, scooterNumber: 1, batteryPct: 15 }),
    );
    await sendAll();
    const notification = await byKey(`battery_low:${rentalId}`);
    // Dwa urządzenia przyjęły wiadomość: SENT, a martwy token znika od razu.
    expect(notification).toMatchObject({ status: 'SENT', error: 'DeviceNotRegistered' });
    expect(notification!.provider_ref!.split(',')).toHaveLength(2);
    const tokens = async () =>
      (
        await ctx.pool.query<{ expo_token: string }>(`SELECT expo_token FROM push_tokens WHERE user_id = $1`, [
          customers.anna.id,
        ])
      ).rows.map((r) => r.expo_token);
    expect(await tokens()).not.toContain(dead);
    expect(await tokens()).toContain(later);

    await runJobs(JOBS.notificationReceipts);
    expect(await tokens()).toEqual(['ExponentPushToken[anna-phone]']);

    // Jedyny token odrzucony: FAILED z błędem bramki.
    push().unregistered.add('ExponentPushToken[darek-phone]');
    const darekRental = await endedRental(customers.darek.id);
    await db.transaction((tx) =>
      notifications().batteryLow(tx, {
        rentalId: darekRental,
        userId: customers.darek.id,
        scooterNumber: 2,
        batteryPct: 9,
      }),
    );
    await sendAll();
    expect(await byKey(`battery_low:${darekRental}`)).toMatchObject({
      status: 'FAILED',
      error: 'DeviceNotRegistered',
      sent_at: null,
    });
    push().unregistered.delete('ExponentPushToken[darek-phone]');
    await registerToken('darek', 'ExponentPushToken[darek-phone]');
  });

  it('szablony w panelu: podgląd, błąd składni z pozycją, nieznany parametr, nowa wersja, przywrócenie, uprawnienia', async () => {
    const list = await ctx.staff.dispatcher({
      method: 'GET',
      url: '/admin/notification-templates',
      query: { channel: 'PUSH', facets: 'channel' },
    });
    expect(list.statusCode).toBe(200);
    const items = list.json<shared.ListResponse<shared.NotificationTemplateListItem>>().items;
    // Sześć szablonów push z iteracji 6 i `data_export_ready` (eksport danych klienta, ADR 0069, migracja 0011).
    expect(items).toHaveLength(7);
    const battery = items.find((t) => t.code === 'battery_low')!;
    expect(battery).toMatchObject({ version: 1, versions: 1, lastSentAt: expect.any(String) });
    expect((await ctx.staff.technician({ method: 'GET', url: '/admin/notification-templates' })).statusCode).toBe(403);

    const url = `/admin/notification-templates/${battery.id}`;
    const details = (await ctx.staff.dispatcher({ method: 'GET', url })).json<shared.NotificationTemplateDetails>();
    expect(details).toMatchObject({
      code: 'battery_low',
      channel: 'PUSH',
      path: '/przejazd',
      params: [
        { name: 'scooterNumber', type: 'text' },
        { name: 'batteryPct', type: 'number' },
      ],
      versions: [{ version: 1, current: true, staffName: null }],
    });

    const preview = (payload: object) => ctx.staff.dispatcher({ method: 'POST', url: `${url}/preview`, payload });
    const ok = await preview({
      title: 'Niska bateria',
      body: 'Hulajnoga {scooterNumber}: {batteryPct, plural, one {# procent} few {# procent} other {# procent}}.',
      values: { scooterNumber: '#0012', batteryPct: '14' },
    });
    expect(ok.statusCode).toBe(200);
    expect(ok.json()).toEqual({
      issues: [],
      rendered: { title: 'Niska bateria', body: 'Hulajnoga #0012: 14 procent.' },
    });
    const broken = (
      await preview({
        title: 'Niska bateria',
        body: 'Bateria {scooterNumber}\n{batteryPct, plural, other {#}',
        values: {},
      })
    ).json<shared.NotificationTemplatePreviewResult>();
    expect(broken.rendered).toBeNull();
    expect(broken.issues).toEqual([
      expect.objectContaining({ code: 'TEMPLATE_SYNTAX_ERROR', field: 'body', line: 2, column: expect.any(Number) }),
    ]);
    const missing = (
      await preview({ title: 'Niska bateria', body: 'Bateria {scooterNumber}', values: {} })
    ).json<shared.NotificationTemplatePreviewResult>();
    expect(missing).toEqual({ issues: [{ code: 'TEMPLATE_RENDER_FAILED', field: 'body' }], rendered: null });

    // Dyspozytor ma tylko content.read: podgląd tak, zapis nie.
    const body = 'Zostało {batteryPct}% baterii w hulajnodze {scooterNumber}. Zakończ przejazd w strefie.';
    expect(
      (await ctx.staff.dispatcher({ method: 'PATCH', url, payload: { version: 1, title: 'Niska bateria', body } }))
        .statusCode,
    ).toBe(403);

    const syntax = await ctx.staff.admin({
      method: 'PATCH',
      url,
      payload: { version: 1, title: 'Niska bateria', body: 'Bateria {scooterNumber' },
    });
    expect(syntax.statusCode).toBe(422);
    expect(syntax.json()).toMatchObject({
      code: 'TEMPLATE_SYNTAX_ERROR',
      details: { field: 'body', line: 1, column: expect.any(Number), issues: expect.any(Array) },
    });
    const unknown = await ctx.staff.admin({
      method: 'PATCH',
      url,
      payload: { version: 1, title: 'Bateria {rideNumber}', body },
    });
    expect(unknown.statusCode).toBe(422);
    expect(unknown.json()).toMatchObject({
      code: 'TEMPLATE_UNKNOWN_PARAM',
      details: { field: 'title', param: 'rideNumber', line: 1, column: 9 },
    });

    const saved = await ctx.staff.admin({
      method: 'PATCH',
      url,
      payload: { version: 1, title: 'Niska bateria', body },
    });
    expect(saved.statusCode).toBe(200);
    expect(saved.json<shared.NotificationTemplateDetails>()).toMatchObject({
      version: 2,
      body,
      updatedByName: 'Admin Testowy',
      versions: [
        { version: 2, current: true, staffName: 'Admin Testowy', body },
        { version: 1, current: false },
      ],
    });
    const stale = await ctx.staff.admin({ method: 'PATCH', url, payload: { version: 1, title: 'X', body } });
    expect(stale.statusCode).toBe(409);
    expect(stale.json()).toMatchObject({ code: 'CONFLICT', details: { currentVersion: 2 } });
    const audit = await ctx.auditOf(battery.id, 'notification_template.updated');
    expect(audit).toEqual([
      expect.objectContaining({
        actor: 'STAFF',
        staff_id: ctx.staffIds.admin,
        data: expect.objectContaining({
          code: 'battery_low',
          version: [1, 2],
          changes: { body: [expect.any(String), body] },
        }),
      }),
    ]);

    // Następna wysyłka renderuje bieżącą wersję.
    const rentalId = await endedRental(customers.anna.id);
    await app
      .get<Database>(DB)
      .transaction((tx) =>
        notifications().batteryLow(tx, { rentalId, userId: customers.anna.id, scooterNumber: 12, batteryPct: 13 }),
      );
    await sendAll();
    expect(await byKey(`battery_low:${rentalId}`)).toMatchObject({
      status: 'SENT',
      template_version: 2,
      body: 'Zostało 13% baterii w hulajnodze #0012. Zakończ przejazd w strefie.',
    });

    expect(
      (await ctx.staff.dispatcher({ method: 'POST', url: `${url}/restore`, payload: { version: 2, fromVersion: 1 } }))
        .statusCode,
    ).toBe(403);
    const restored = await ctx.staff.admin({
      method: 'POST',
      url: `${url}/restore`,
      payload: { version: 2, fromVersion: 1 },
    });
    expect(restored.statusCode).toBe(200);
    const after = restored.json<shared.NotificationTemplateDetails>();
    expect(after).toMatchObject({ version: 3, body: details.body, title: details.title });
    expect(after.versions.map((v) => v.version)).toEqual([3, 2, 1]);
    expect(await ctx.auditOf(battery.id, 'notification_template.restored')).toEqual([
      expect.objectContaining({ data: expect.objectContaining({ fromVersion: 1, version: [2, 3] }) }),
    ]);
    // Niezmieniona treść nie tworzy wersji.
    const same = await ctx.staff.admin({
      method: 'PATCH',
      url,
      payload: { version: 3, title: after.title, body: after.body },
    });
    expect(same.json<shared.NotificationTemplateDetails>().version).toBe(3);
  });

  it('kod SMS z szablonu login_code (kanał SMS) edytowanego w panelu', async () => {
    const template = (
      await ctx.staff.admin({ method: 'GET', url: '/admin/notification-templates', query: { code: 'login_code' } })
    ).json<shared.ListResponse<shared.NotificationTemplateListItem>>().items[0]!;
    expect(template).toMatchObject({ channel: 'SMS', title: null });
    const tooLong = await ctx.staff.admin({
      method: 'PATCH',
      url: `/admin/notification-templates/${template.id}`,
      payload: { version: template.version, title: null, body: `{code} ${'x'.repeat(160)}` },
    });
    expect(tooLong.json()).toMatchObject({ code: 'TEMPLATE_TOO_LONG', details: { max: 160 } });
    const withTitle = await ctx.staff.admin({
      method: 'PATCH',
      url: `/admin/notification-templates/${template.id}`,
      payload: { version: template.version, title: 'Kod', body: 'Kod {code}' },
    });
    expect(withTitle.json()).toMatchObject({ code: 'VALIDATION_FAILED', details: { field: 'title' } });
    // SMS bez kodu zablokowałby logowanie: parametr `code` jest wymagany w rejestrze (D z przeglądu iteracji 6).
    const withoutCode = await ctx.staff.admin({
      method: 'PATCH',
      url: `/admin/notification-templates/${template.id}`,
      payload: { version: template.version, title: null, body: 'Twój kod logowania jest w drodze.' },
    });
    expect(withoutCode.statusCode).toBe(422);
    expect(withoutCode.json()).toMatchObject({ code: 'TEMPLATE_MISSING_PARAM', details: { param: 'code' } });
    const preview = await ctx.staff.admin({
      method: 'POST',
      url: `/admin/notification-templates/${template.id}/preview`,
      payload: { title: null, body: 'Bez kodu', values: {} },
    });
    expect(preview.json<shared.NotificationTemplatePreviewResult>().issues).toEqual([
      expect.objectContaining({ code: 'TEMPLATE_MISSING_PARAM', param: 'code' }),
    ]);
    const saved = await ctx.staff.admin({
      method: 'PATCH',
      url: `/admin/notification-templates/${template.id}`,
      payload: { version: template.version, title: '', body: 'Twój kod: {code}. Ważny 5 minut.' },
    });
    expect(saved.statusCode).toBe(200);
    const phone = '+48500400600';
    expect((await app.inject({ method: 'POST', url: '/auth/otp', payload: { phone } })).statusCode).toBe(202);
    const text = app
      .get(LoggingSmsGateway)
      .sent.filter((m) => m.phone === phone)
      .at(-1)!.text;
    expect(text).toMatch(/^Twój kod: \d{6}\. Ważny 5 minut\.$/);
    const code = /(\d{6})/.exec(text)![1]!;
    expect((await app.inject({ method: 'POST', url: '/auth/otp/verify', payload: { phone, code } })).statusCode).toBe(
      200,
    );

    // Brak szablonu: treść renderuje się przed zapisem kodu, więc błąd nie zużywa limitu kodów klienta.
    const other = '+48500400601';
    await ctx.pool.query(`UPDATE notification_templates SET code = 'login_code_off' WHERE id = $1`, [template.id]);
    try {
      const missing = await app.inject({ method: 'POST', url: '/auth/otp', payload: { phone: other } });
      expect(missing.statusCode).toBe(503);
      expect(missing.json().code).toBe('TEMPLATE_MISSING');
      const issued = await ctx.pool.query(`SELECT count(*)::int AS n FROM otp_codes WHERE phone = $1`, [other]);
      expect(issued.rows[0]).toEqual({ n: 0 });
    } finally {
      await ctx.pool.query(`UPDATE notification_templates SET code = 'login_code' WHERE id = $1`, [template.id]);
    }
  });

  it('zgłoszenie: odpowiedź, AT_SERVICE i RESOLVED po naprawie dają ticket_status_changed z wersją', async () => {
    const created = await as('anna')({
      method: 'POST',
      url: '/tickets',
      payload: { scooterId: await ctx.idOf(5), categories: ['BRAKES'], description: 'Słabo hamuje' },
    });
    const ticket = created.json<shared.CustomerTicketView>();
    let details = (
      await ctx.staff.dispatcher({ method: 'GET', url: `/admin/tickets/${ticket.id}` })
    ).json<shared.TicketAdminDetails>();
    const replied = await ctx.staff.dispatcher({
      method: 'POST',
      url: `/admin/tickets/${ticket.id}/status`,
      payload: { version: details.version, status: 'IN_PROGRESS', reply: 'Sprawdzimy hamulce jeszcze dziś.' },
    });
    expect(replied.statusCode).toBe(201);
    details = replied.json<shared.TicketAdminDetails>();
    const statusRows = () => rows(`template_code = 'ticket_status_changed' AND ticket_id = $1`, [ticket.id]);
    expect(await statusRows()).toEqual([
      expect.objectContaining({
        dedupe_key: `ticket_status_changed:${ticket.id}:${details.version}`,
        payload: {
          params: {
            ticketNumber: shared.ticketLabel(ticket.number),
            status: 'IN_PROGRESS',
            reply: 'Sprawdzimy hamulce jeszcze dziś.',
          },
          path: `/zgloszenie/${ticket.id}`,
        },
      }),
    ]);

    const task = (
      await ctx.staff.dispatcher({
        method: 'POST',
        url: '/admin/service-tasks',
        payload: {
          scooterId: await ctx.idOf(5),
          ticketId: ticket.id,
          type: 'REPAIR',
          assigneeId: ctx.staffIds.technician,
        },
      })
    ).json<shared.ServiceTaskDetails>();
    const command = (action: string, payload: object) =>
      ctx.staff.technician({ method: 'POST', url: `/admin/service-tasks/${task.id}/${action}`, payload });
    const started = (await command('start', { version: task.version })).json<shared.ServiceTaskDetails>();
    expect((await command('complete', { version: started.version, note: 'Nowe klocki' })).statusCode).toBe(201);

    const all = await statusRows();
    expect(all.map((r) => r.payload.params.status)).toEqual(['IN_PROGRESS', 'AT_SERVICE', 'RESOLVED']);
    expect(new Set(all.map((r) => r.dedupe_key)).size).toBe(3);
    await sendAll();
    expect((await statusRows()).map((r) => r.body)).toEqual([
      `Zgłoszenie ${shared.ticketLabel(ticket.number)}: zajmujemy się nim. Sprawdzimy hamulce jeszcze dziś.`,
      `Zgłoszenie ${shared.ticketLabel(ticket.number)}: hulajnoga jest w serwisie. `,
      `Zgłoszenie ${shared.ticketLabel(ticket.number)}: rozwiązane. `,
    ]);
  });

  it('przejazd z portfela: battery_low przy progu LOW i ride_ended po rozliczeniu z paragonem', async () => {
    const rentalId = await ctx.ride(customers.anna.token, 1);
    const scooterId = await ctx.idOf(1);
    const telemetry = (batteryPct: number) =>
      app.get(RentalsService).onTelemetry([{ scooterId, recordedAt: new Date(), batteryPct, buffered: false }]);
    await telemetry(40);
    expect(await byKey(`battery_low:${rentalId}`)).toBeUndefined();
    await telemetry(15);
    expect(await byKey(`battery_low:${rentalId}`)).toBeUndefined();
    await telemetry(14);
    await telemetry(4);
    expect(await rows('dedupe_key = $1', [`battery_low:${rentalId}`])).toEqual([
      expect.objectContaining({
        rental_id: rentalId,
        payload: { params: { scooterNumber: '#0001', batteryPct: 14 }, path: '/przejazd' },
      }),
    ]);

    await ctx.pool.query(`UPDATE scooters SET battery_pct = 80 WHERE number = 1`);
    await ctx.endRide(customers.anna.token, 1);
    const rental = (await ctx.pool.query(`SELECT number, total_amount FROM rentals WHERE id = $1`, [rentalId]))
      .rows[0] as { number: string; total_amount: number };
    const notification = await byKey(`ride_ended:${rentalId}`);
    expect(notification).toMatchObject({
      rental_id: rentalId,
      payload: {
        params: {
          rideNumber: `R-${rental.number}`,
          minutes: 1,
          amount: shared.formatPln(rental.total_amount),
          hasReceipt: true,
          towingFee: shared.formatPln(0),
          hasTowingFee: false,
        },
        path: `/podsumowanie/${rentalId}`,
      },
    });
    await sendAll();
    expect((await byKey(`ride_ended:${rentalId}`))!.body).toBe(
      `Przejazd R-${rental.number} trwał 1 minutę. Koszt: ${shared.formatPln(rental.total_amount)}. Paragon w aplikacji.`,
    );
  });

  it('zdalne zakończenie poza strefą z opłatą za odholowanie: ride_ended pokazuje opłatę (hasTowingFee)', async () => {
    const rentalId = await ctx.ride(customers.bartek.token, 2);
    const ended = await ctx.staff.dispatcher({
      method: 'POST',
      url: `/admin/rentals/${rentalId}/end`,
      payload: { reason: 'SCOOTER_NOT_RESPONDING', collectTowingFee: true },
    });
    expect(ended.statusCode).toBeLessThan(300);
    const notification = await byKey(`ride_ended:${rentalId}`);
    expect(notification!.payload.params).toMatchObject({
      towingFee: shared.formatPln(2000),
      hasTowingFee: true,
      hasReceipt: true,
    });
    // Bartek nie ma tokenu: treść i tak jest wyrenderowana (SKIPPED), z opłatą z szablonu startowego.
    await sendAll();
    expect(await byKey(`ride_ended:${rentalId}`)).toMatchObject({
      status: 'SKIPPED',
      body: expect.stringContaining(`(odholowanie ${shared.formatPln(2000)})`),
    });
  });

  it('reservation_ending: zadanie 2 min przed końcem, tylko gdy rezerwacja trwa; preferencja przy wysyłce', async () => {
    const reserve = await as('celina')({
      method: 'POST',
      url: '/reservations',
      payload: { scooterId: await ctx.idOf(7) },
    });
    expect(reserve.statusCode).toBe(201);
    const rental = reserve.json<shared.RentalView>();
    const job = ctx.jobs().sent.find((j) => j.name === JOBS.reservationEnding && j.data.rentalId === rental.id)!;
    const expiresAt = (await ctx.pool.query(`SELECT reservation_expires_at FROM rentals WHERE id = $1`, [rental.id]))
      .rows[0].reservation_expires_at as Date;
    expect(job.startAfter!.getTime()).toBe(expiresAt.getTime() - 2 * 60_000);
    await runJobs(JOBS.reservationEnding);
    const queued = await byKey(`reservation_ending:${rental.id}`);
    expect(queued).toMatchObject({
      payload: { params: { scooterNumber: '#0007', minutesLeft: 10 }, path: '/przejazd' },
    });
    await sendAll();
    expect(await byKey(`reservation_ending:${rental.id}`)).toMatchObject({
      status: 'SENT',
      body: 'Rezerwacja hulajnogi #0007 wygasa za 10 minut. Zeskanuj kod QR, żeby ruszyć.',
    });

    // Anulowana rezerwacja: zadanie niczego nie wysyła; wyłączona preferencja daje SKIPPED.
    await as('celina')({ method: 'DELETE', url: '/reservations/current' });
    const again = (
      await as('celina')({ method: 'POST', url: '/reservations', payload: { scooterId: await ctx.idOf(9) } })
    ).json<shared.RentalView>();
    await as('celina')({ method: 'DELETE', url: '/reservations/current' });
    await runJobs(JOBS.reservationEnding);
    expect(await byKey(`reservation_ending:${again.id}`)).toBeUndefined();

    await as('celina')({
      method: 'PATCH',
      url: '/me/notifications',
      payload: { reservationEnd: false, receipts: true },
    });
    const third = (
      await as('celina')({ method: 'POST', url: '/reservations', payload: { scooterId: await ctx.idOf(9) } })
    ).json<shared.RentalView>();
    await runJobs(JOBS.reservationEnding);
    await sendAll();
    expect(await byKey(`reservation_ending:${third.id}`)).toMatchObject({
      status: 'SKIPPED',
      error: 'PREFERENCE_DISABLED',
    });
    await as('celina')({ method: 'DELETE', url: '/reservations/current' });
  });

  describe('przejazd kartą', () => {
    const fake = () => app.get<FakePaymentProvider>(PAYMENT_PROVIDER);
    /** Webhooki atrapy operatora i zadania płatności z kolejki, aż do ciszy (jak w testach płatności). */
    async function flushPayments(): Promise<void> {
      for (let round = 0; round < 10; round++) {
        const hooks = fake().takeOutbox();
        for (const hook of hooks) {
          const res = await app.inject({
            method: 'POST',
            url: '/payments/webhooks/stripe',
            headers: { 'content-type': 'application/json', 'stripe-signature': hook.signature },
            payload: hook.body,
          });
          expect(res.statusCode).toBe(200);
        }
        const jobs = await runJobs(JOBS.paymentsWebhook, JOBS.chargeRide);
        if (!hooks.length && !jobs) return;
      }
    }
    async function addCard(number: string): Promise<string> {
      const setup = (
        await as('darek')({ method: 'POST', url: '/me/payment-methods/setup' })
      ).json<shared.SetupIntentResponse>();
      const confirmed = await as('darek')({
        method: 'POST',
        url: '/payments/fake/setup-intents/confirm',
        payload: { clientSecret: setup.clientSecret, cardNumber: number, expMonth: 12, expYear: 2030, cvc: '123' },
      });
      expect(confirmed.json()).toMatchObject({ status: 'succeeded' });
      await flushPayments();
      const cards = (await as('darek')({ method: 'GET', url: '/me/payment-methods' })).json<
        shared.PaymentMethodView[]
      >();
      return cards.find((c) => c.last4 === number.slice(-4))!.id;
    }
    async function cardRide(number: number, paymentMethodId: string): Promise<string> {
      const start = await as('darek')({
        method: 'POST',
        url: '/rentals',
        payload: { scooterId: await ctx.idOf(number), paymentSource: 'CARD', paymentMethodId },
      });
      expect(start.statusCode).toBe(202);
      await ctx.ack(ctx.commands(number).at(-1)!);
      await ctx.pool.query(
        `UPDATE rental_events SET created_at = created_at - interval '3 minutes' WHERE rental_id = $1`,
        [start.json<shared.RentalView>().id],
      );
      await ctx.endRide(customers.darek.token, number);
      return start.json<shared.RentalView>().id;
    }

    it('udane obciążenie: ride_ended dopiero po paragonie; odmowa: payment_failed i bez ride_ended', async () => {
      const good = await addCard('4242424242424242');
      const paid = await cardRide(1, good);
      expect(await byKey(`ride_ended:${paid}`)).toBeUndefined();
      await flushPayments();
      expect(await byKey(`ride_ended:${paid}`)).toMatchObject({
        payload: { params: expect.objectContaining({ hasReceipt: true, hasTowingFee: false }) },
      });

      const declining = await addCard('4000000000000341');
      const unpaid = await cardRide(3, declining);
      await flushPayments();
      expect((await ctx.pool.query(`SELECT state::text FROM rentals WHERE id = $1`, [unpaid])).rows[0].state).toBe(
        'UNPAID',
      );
      expect(await byKey(`ride_ended:${unpaid}`)).toBeUndefined();
      const failed = await byKey(`payment_failed:${unpaid}`);
      expect(failed).toMatchObject({ rental_id: unpaid, payload: { path: `/zaleglosc/${unpaid}` } });
      await sendAll();
      expect(await byKey(`payment_failed:${unpaid}`)).toMatchObject({
        status: 'SENT',
        body: expect.stringMatching(/^Nie udało się pobrać \d+,\d{2}\s?zł za przejazd R-\d+\./),
      });
    });
  });

  it('przejęcie przed wysyłką: równoległa wysyłka i sweep nie wysyłają tego samego powiadomienia dwa razy', async () => {
    const rentalId = await endedRental(customers.anna.id);
    await app
      .get<Database>(DB)
      .transaction((tx) =>
        notifications().batteryLow(tx, { rentalId, userId: customers.anna.id, scooterNumber: 4, batteryPct: 11 }),
      );
    discardJobs();
    const { id } = (await byKey(`battery_low:${rentalId}`))!;
    const push = vi.spyOn(app.get<FakePushGateway>(PUSH_GATEWAY), 'send');
    // Zadanie `notification.send` i sweep naraz: jedno przejęcie, jeden push.
    await ctx.pool.query(`UPDATE notifications SET created_at = now() - interval '6 minutes' WHERE id = $1`, [id]);
    await Promise.all([notifications().send(Number(id)), ctx.jobs().run(JOBS.notificationsSweep)]);
    expect(push).toHaveBeenCalledTimes(1);
    expect(await byKey(`battery_low:${rentalId}`)).toMatchObject({ status: 'SENT' });

    // Przerwana wysyłka (przejęcie bez wyniku): sweep czeka 5 min od przejęcia, potem wysyła.
    const second = await endedRental(customers.anna.id);
    await app.get<Database>(DB).transaction((tx) =>
      notifications().batteryLow(tx, {
        rentalId: second,
        userId: customers.anna.id,
        scooterNumber: 4,
        batteryPct: 9,
      }),
    );
    discardJobs();
    await ctx.pool.query(
      `UPDATE notifications SET created_at = now() - interval '10 minutes', claimed_at = now() - interval '1 minute'
       WHERE dedupe_key = $1`,
      [`battery_low:${second}`],
    );
    await ctx.jobs().run(JOBS.notificationsSweep);
    expect(await byKey(`battery_low:${second}`)).toMatchObject({ status: 'QUEUED' });
    await ctx.pool.query(`UPDATE notifications SET claimed_at = now() - interval '6 minutes' WHERE dedupe_key = $1`, [
      `battery_low:${second}`,
    ]);
    await ctx.jobs().run(JOBS.notificationsSweep);
    expect(await byKey(`battery_low:${second}`)).toMatchObject({ status: 'SENT' });
    expect(push).toHaveBeenCalledTimes(2);
  });

  it('zadanie notifications.sweep wysyła powiadomienia zgubione w kolejce', async () => {
    const rentalId = await endedRental(customers.anna.id);
    await app
      .get<Database>(DB)
      .transaction((tx) =>
        notifications().batteryLow(tx, { rentalId, userId: customers.anna.id, scooterNumber: 4, batteryPct: 12 }),
      );
    discardJobs(); // zadanie `notification.send` zgubione
    await ctx.pool.query(`UPDATE notifications SET created_at = now() - interval '6 minutes' WHERE dedupe_key = $1`, [
      `battery_low:${rentalId}`,
    ]);
    await ctx.jobs().run(JOBS.notificationsSweep);
    expect(await byKey(`battery_low:${rentalId}`)).toMatchObject({ status: 'SENT' });
  });
});
