import 'reflect-metadata';
import { randomUUID } from 'node:crypto';
import * as core from '@hulajnogi/core';
import { runMigrations, seedDatabase, type PlacesFile } from '@hulajnogi/db';
import * as shared from '@hulajnogi/shared';
import type { NestFastifyApplication } from '@nestjs/platform-fastify';
import { Pool } from 'pg';
import { io, type Socket } from 'socket.io-client';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { LoggingSmsGateway } from '../src/auth/sms.gateway.js';
import { createApp } from '../src/bootstrap.js';
import { loadConfig } from '../src/config.js';
import { CommandsService } from '../src/fleet/commands.service.js';
import { JOBS, JobsService } from '../src/jobs/jobs.service.js';
import { MqttService } from '../src/mqtt/mqtt.service.js';
import { asStaff, staffToken, fundWallet } from './helpers.js';

const adminUrl = process.env.DATABASE_URL;
const dbName = `hulajnogi_rentals_api_${randomUUID().slice(0, 8)}`;

// Syntetyczne współrzędne testowe: dwie strefy parkowania, hulajnoga #2 stoi między nimi.
const places: PlacesFile = {
  city: 'Test',
  note: '',
  serviceArea: { code: 'AREA-TEST', name: 'Obszar testowy', centerPlace: 'P-01', radiusM: 5000 },
  places: [
    { code: 'P-01', name: 'Centrum', query: '', type: 'PARKING', radiusM: 100, capacity: 20, lat: 50.0, lon: 18.5 },
    { code: 'P-02', name: 'Północ', query: '', type: 'PARKING', radiusM: 100, capacity: 20, lat: 50.02, lon: 18.5 },
  ],
};

describe('wyliczenia przejazdu w kontrakcie API są zgodne z packages/core', () => {
  it.each([
    ['RENTAL_STATES', shared.RENTAL_STATES, core.RENTAL_STATES],
    ['OPEN_RENTAL_STATES', shared.OPEN_RENTAL_STATES, core.OPEN_RENTAL_STATES],
    ['UNAVAILABLE_REASONS', shared.UNAVAILABLE_REASONS, core.UNAVAILABLE_REASONS],
    ['REMOTE_END_REASONS', shared.REMOTE_END_REASONS, core.REMOTE_END_REASONS],
  ])('%s', (_name, fromShared, fromCore) => {
    expect([...fromShared]).toEqual([...fromCore]);
  });

  it('kod QR: adres strony z numerem albo sam numer (ADR 0041)', () => {
    expect(shared.parseScooterCode('https://przyklad.pl/h/0142')).toBe(142);
    expect(shared.parseScooterCode(shared.scooterCodeUrl('http://localhost:3000/', 7))).toBe(7);
    expect(shared.parseScooterCode(' #27 ')).toBe(27);
    expect(shared.parseScooterCode('0000')).toBeNull();
    expect(shared.parseScooterCode('https://inny.pl/x/0142')).toBeNull();
    expect(shared.parseScooterCode('12345')).toBeNull();
  });
});

describe.skipIf(!adminUrl)('API: wypożyczenie', () => {
  let admin: Pool;
  let pool: Pool;
  let app: NestFastifyApplication;
  let socket: Socket;
  const updates: shared.RentalView[] = [];
  const customers: Record<'anna' | 'bartek', { id: string; token: string }> = {} as never;

  const idOf = async (number: number) =>
    (await pool.query<{ id: string }>('SELECT id FROM scooters WHERE number = $1', [number])).rows[0]!.id;
  const statusOf = async (number: number) =>
    (await pool.query<{ status: string }>('SELECT status FROM scooters WHERE number = $1', [number])).rows[0]!.status;
  const as =
    (who: keyof typeof customers) =>
    (options: { method: 'GET' | 'POST' | 'DELETE' | 'PATCH'; url: string; payload?: object }) =>
      app.inject({ ...options, headers: { authorization: `Bearer ${customers[who].token}` } });
  const mqtt = () => app.get(MqttService);
  const jobs = () => app.get(JobsService);
  const lastCommand = (number: number) =>
    mqtt()
      .published.filter((p) => p.topic === shared.topics.command(shared.scooterTopicId(number)))
      .at(-1)!.payload as shared.Command;
  const ack = (command: shared.Command, ok = true, reason?: string) =>
    app
      .get(CommandsService)
      .handleAck(
        Buffer.from(JSON.stringify({ commandId: command.commandId, ok, reason, ts: new Date().toISOString() })),
      );
  const current = async (who: keyof typeof customers) =>
    (await as(who)({ method: 'GET', url: '/rentals/current' })).json<{ rental: shared.RentalView | null }>().rental;

  /** Klient po kodzie SMS i rejestracji z akceptacją obowiązujących dokumentów. */
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
    const headers = { authorization: `Bearer ${session.accessToken}` };
    if (name) {
      const acceptedVersionIds = session.me.pendingDocuments.map((d) => d.versionId);
      await app.inject({
        method: 'POST',
        url: '/me/registration',
        headers,
        payload: { name, ageConfirmed: true, acceptedVersionIds },
      });
    }
    if (name) await fundWallet(pool, session.me.id);
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
      fleetSize: 4,
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
    // #1 w strefie P-01, #2 między strefami, #3 ze słabą baterią, #4 offline.
    await pool.query(
      `UPDATE scooters SET online = true, battery_pct = 80, position = ST_SetSRID(ST_MakePoint(18.5, 50.0), 4326) WHERE number = 1`,
    );
    await pool.query(
      `UPDATE scooters SET online = true, battery_pct = 80, position = ST_SetSRID(ST_MakePoint(18.5, 50.01), 4326) WHERE number = 2`,
    );
    await pool.query(
      `UPDATE scooters SET online = true, battery_pct = 5, position = ST_SetSRID(ST_MakePoint(18.5005, 50.0), 4326) WHERE number = 3`,
    );
    await pool.query(
      `UPDATE scooters SET online = false, battery_pct = 90, position = ST_SetSRID(ST_MakePoint(18.501, 50.0), 4326) WHERE number = 4`,
    );

    app = await createApp(
      loadConfig({
        NODE_ENV: 'test',
        DATABASE_URL: url.toString(),
        MQTT_ENABLED: 'false',
        JOBS_ENABLED: 'false',
        TELEMETRY_FLUSH_MS: '10000',
      }),
      { logger: false },
    );
    await app.listen({ port: 0, host: '127.0.0.1' });
    customers.anna = await register('+48500100200', 'Anna');
    customers.bartek = await register('+48500100300', 'Bartek');

    const address = app.getHttpServer().address() as { port: number };
    socket = io(`http://127.0.0.1:${address.port}`, {
      transports: ['websocket'],
      auth: { token: customers.anna.token },
    });
    socket.on('rental.updated', (rental: shared.RentalView) => updates.push(rental));
    await new Promise<void>((resolve) => socket.on('connect', () => resolve()));
  });

  afterAll(async () => {
    socket?.disconnect();
    await app?.close();
    await pool?.end();
    await admin?.query(`DROP DATABASE IF EXISTS ${dbName} WITH (FORCE)`);
    await admin?.end();
  });

  it('mapa pokazuje wolne hulajnogi online z baterią od progu cennika; numer podaje przyczynę niedostępności', async () => {
    const nearby = (
      await as('anna')({ method: 'GET', url: '/scooters/nearby?lat=50.0&lon=18.5' })
    ).json<shared.NearbyResponse>();
    expect(nearby.scooters.map((s) => s.number)).toEqual([1, 2]);
    expect(nearby.scooters[0]).toMatchObject({ variant: expect.stringMatching(/^(GRAFIT|BETON|KOBALT)$/) });
    expect(nearby).toMatchObject({ radiusM: 2000, tariff: { version: 1, freeReservationMinutes: 10 } });

    const low = (await as('anna')({ method: 'GET', url: '/scooters/by-number/3' })).json<shared.CustomerScooterView>();
    expect(low).toMatchObject({ number: 3, available: false, unavailableReason: 'LOW_BATTERY' });
    const offline = (
      await as('anna')({ method: 'GET', url: '/scooters/by-number/4' })
    ).json<shared.CustomerScooterView>();
    expect(offline.unavailableReason).toBe('OFFLINE');
    expect((await as('anna')({ method: 'GET', url: '/scooters/by-number/999' })).statusCode).toBe(404);
  });

  it('klient bez rejestracji nie zarezerwuje hulajnogi', async () => {
    const guest = await register('+48500100400', '');
    const res = await app.inject({
      method: 'POST',
      url: '/reservations',
      headers: { authorization: `Bearer ${guest.token}` },
      payload: { scooterId: await idOf(1) },
    });
    expect(res.statusCode).toBe(403);
    expect(res.json()).toMatchObject({ code: 'CONSENT_REQUIRED' });
  });

  it('rezerwacja: powtórzenie zwraca tę samą, cudza hulajnoga jest zajęta, anulowanie ją zwalnia', async () => {
    const scooterId = await idOf(1);
    const first = await as('anna')({ method: 'POST', url: '/reservations', payload: { scooterId } });
    expect(first.statusCode).toBe(201);
    const rental = first.json<shared.RentalView>();
    expect(rental).toMatchObject({ state: 'RESERVED', scooter: { number: 1 }, price: { total: 0 } });
    expect(new Date(rental.reservationExpiresAt!).getTime() - new Date(rental.reservedAt!).getTime()).toBe(10 * 60_000);
    // Wygaśnięcie i przypomnienie 2 min przed końcem (`reservation_ending`, ADR 0058).
    expect(
      jobs()
        .sent.filter((j) => j.data.rentalId === rental.id)
        .map((j) => j.name),
    ).toEqual([JOBS.reservationExpire, JOBS.reservationEnding]);
    expect(await statusOf(1)).toBe('RESERVED');

    const again = await as('anna')({ method: 'POST', url: '/reservations', payload: { scooterId } });
    expect(again.statusCode).toBe(200);
    expect(again.json().id).toBe(rental.id);

    const taken = await as('bartek')({ method: 'POST', url: '/reservations', payload: { scooterId } });
    expect(taken.json()).toMatchObject({
      code: 'SCOOTER_UNAVAILABLE',
      details: { reason: 'RESERVED', scooterNumber: 1 },
    });
    expect((await as('bartek')({ method: 'GET', url: '/scooters/by-number/1' })).json().unavailableReason).toBe(
      'RESERVED',
    );
    expect((await as('anna')({ method: 'GET', url: '/scooters/by-number/1' })).json()).toMatchObject({
      available: true,
      reservedByMe: true,
    });
    expect((await as('anna')({ method: 'POST', url: `/scooters/${scooterId}/ring` })).statusCode).toBe(202);
    expect((await as('bartek')({ method: 'POST', url: `/scooters/${scooterId}/ring` })).json().code).toBe(
      'RING_NOT_ALLOWED',
    );

    const cancelled = await as('anna')({ method: 'DELETE', url: '/reservations/current' });
    expect(cancelled.json()).toMatchObject({ state: 'EXPIRED' });
    expect(await statusOf(1)).toBe('AVAILABLE');
    await expect.poll(() => updates.some((u) => u.id === rental.id && u.state === 'EXPIRED')).toBe(true);
  });

  it('rezerwacja wygasa w zadaniu pg-boss, a zadanie zabezpieczające wyłapuje zgubione', async () => {
    const scooterId = await idOf(1);
    const rental = (
      await as('anna')({ method: 'POST', url: '/reservations', payload: { scooterId } })
    ).json<shared.RentalView>();
    // Zadanie uruchomione przed terminem nic nie zmienia.
    await jobs().run(JOBS.reservationExpire, { rentalId: rental.id });
    expect((await current('anna'))?.state).toBe('RESERVED');

    await pool.query(`UPDATE rentals SET reservation_expires_at = now() - interval '1 second' WHERE id = $1`, [
      rental.id,
    ]);
    await jobs().run(JOBS.expireSweep);
    expect(await current('anna')).toBeNull();
    const events = await pool.query(
      `SELECT data->>'reason' AS reason FROM rental_events WHERE rental_id = $1 AND to_state = 'EXPIRED'`,
      [rental.id],
    );
    expect(events.rows).toEqual([{ reason: 'reservation_timeout' }]);
    expect(await statusOf(1)).toBe('AVAILABLE');
  });

  let rideId: string;

  it('start po skanie odblokowuje hulajnogę komendą z terminem; ponowione żądanie zwraca ten sam przejazd', async () => {
    const scooterId = await idOf(2);
    const res = await as('anna')({ method: 'POST', url: '/rentals', payload: { scooterId } });
    expect(res.statusCode).toBe(202);
    const rental = res.json<shared.RentalView>();
    rideId = rental.id;
    expect(rental).toMatchObject({ state: 'UNLOCKING', settlement: { state: 'NONE', source: 'WALLET' } });
    const unlock = lastCommand(2);
    expect(unlock).toMatchObject({ cmd: 'unlock' });
    expect(new Date(unlock.expiresAt!).getTime() - new Date(unlock.issuedAt).getTime()).toBe(10_000);
    expect(jobs().sent.at(-1)).toMatchObject({ name: JOBS.commandAckTimeout, data: { commandId: unlock.commandId } });

    const again = await as('anna')({ method: 'POST', url: '/rentals', payload: { scooterId } });
    expect(again.statusCode).toBe(200);
    expect(again.json().id).toBe(rideId);
    const other = await as('anna')({ method: 'POST', url: '/rentals', payload: { scooterId: await idOf(1) } });
    expect(other.json()).toMatchObject({ code: 'RENTAL_ALREADY_OPEN' });
    expect((await as('anna')({ method: 'DELETE', url: '/me' })).json()).toMatchObject({ code: 'USER_HAS_OPEN_RENTAL' });

    await ack(unlock);
    const active = await current('anna');
    expect(active).toMatchObject({ state: 'ACTIVE', pendingCommand: null, price: { unlockFee: 300, rideMinutes: 1 } });
    expect(active!.startedAt).not.toBeNull();
    await expect.poll(() => updates.some((u) => u.id === rideId && u.state === 'ACTIVE')).toBe(true);
  });

  it('pauza i wznowienie zmieniają stan dopiero po potwierdzeniu; druga komenda w toku jest odrzucana', async () => {
    const pausing = (await as('anna')({ method: 'POST', url: '/rentals/current/pause' })).json<shared.RentalView>();
    expect(pausing).toMatchObject({ state: 'ACTIVE', pendingCommand: 'LOCK' });
    expect((await as('anna')({ method: 'POST', url: '/rentals/current/pause' })).json().code).toBe(
      'RENTAL_COMMAND_PENDING',
    );
    await ack(lastCommand(2));
    expect((await current('anna'))?.state).toBe('PAUSED');

    await as('anna')({ method: 'POST', url: '/rentals/current/resume' });
    // Hulajnoga nie odpowiada: przejazd zostaje w pauzie z komunikatem.
    await jobs().run(JOBS.commandAckTimeout, { commandId: lastCommand(2).commandId });
    expect(await current('anna')).toMatchObject({ state: 'PAUSED', notice: 'RESUME_FAILED', pendingCommand: null });

    await as('anna')({ method: 'POST', url: '/rentals/current/resume' });
    await ack(lastCommand(2));
    expect(await current('anna')).toMatchObject({ state: 'ACTIVE', notice: null });
  });

  it('zakończenie poza strefą parkowania podaje najbliższą strefę', async () => {
    const res = await as('anna')({ method: 'POST', url: '/rentals/current/end' });
    expect(res.statusCode).toBe(422);
    expect(res.json()).toMatchObject({
      code: 'OUTSIDE_PARKING',
      details: { nearestParking: { code: expect.stringMatching(/^P-0[12]$/) } },
    });
  });

  it('nieudana blokada przywraca jazdę, a potwierdzona kończy przejazd z kwotą z cennika', async () => {
    await pool.query(`UPDATE scooters SET position = ST_SetSRID(ST_MakePoint(18.5, 50.0), 4326) WHERE number = 2`);
    const ending = (await as('anna')({ method: 'POST', url: '/rentals/current/end' })).json<shared.RentalView>();
    expect(ending).toMatchObject({ state: 'ENDING', pendingCommand: 'LOCK' });
    expect(ending.billedUntil).not.toBeNull();
    await jobs().run(JOBS.commandAckTimeout, { commandId: lastCommand(2).commandId });
    expect(await current('anna')).toMatchObject({ state: 'ACTIVE', notice: 'LOCK_FAILED', billedUntil: null });

    // Pauza trwała 2 min, jazda 5 min (cofamy oś czasu przejazdu).
    await pool.query(`UPDATE rental_events SET created_at = created_at - interval '7 minutes' WHERE rental_id = $1`, [
      rideId,
    ]);
    await pool.query(
      `UPDATE rental_events SET created_at = created_at + interval '5 minutes'
       WHERE rental_id = $1 AND type = 'STATE_CHANGED' AND to_state = 'PAUSED'`,
      [rideId],
    );
    await as('anna')({ method: 'POST', url: '/rentals/current/end' });
    await ack(lastCommand(2));
    const ended = (await as('anna')({ method: 'GET', url: `/rentals/${rideId}` })).json<shared.RentalView>();
    expect(ended).toMatchObject({ state: 'ENDED', endZone: { code: 'P-01' }, pendingCommand: null });
    expect(ended).toMatchObject({ route: [], speedKmh: null });
    const zone = await pool.query(
      `SELECT z.code FROM rental_events e JOIN zones z ON z.id = e.zone_id WHERE e.rental_id = $1 AND e.type::text = 'END_REQUESTED'`,
      [rideId],
    );
    expect(zone.rows.map((r) => r.code)).toEqual(['P-01', 'P-01']);
    const expected = core.priceRental(
      { unlockFee: 300, minuteRate: 80, pauseMinuteRate: 30 },
      {
        rideSeconds: ended.rideSeconds,
        pauseSeconds: ended.pauseSeconds,
        startedAt: new Date(ended.startedAt!),
      },
    );
    expect(ended.price).toEqual(expected);
    expect(ended.rideSeconds).toBeGreaterThanOrEqual(5 * 60);
    expect(ended.pauseSeconds).toBeGreaterThanOrEqual(2 * 60 - 1);
    const stored = await pool.query(`SELECT total_amount, ride_seconds FROM rentals WHERE id = $1`, [rideId]);
    expect(stored.rows[0]).toEqual({ total_amount: String(ended.price.total), ride_seconds: ended.rideSeconds });
    expect(await statusOf(2)).toBe('AVAILABLE');

    const history = (await as('anna')({ method: 'GET', url: '/rentals' })).json<shared.RentalHistoryItem[]>();
    expect(history.map((h) => h.id)).toEqual([rideId]);
    const profile = (await as('anna')({ method: 'GET', url: '/me/profile' })).json<shared.ProfileSummary>();
    expect(profile).toMatchObject({
      stats: { ridesCount: 1 },
      balance: 10_000 - ended.price.total,
      notifications: { reservationEnd: true, receipts: true },
    });
  });

  it('brak potwierdzenia odblokowania kończy się UNLOCK_FAILED, a spóźnione odblokowanie jest kompensowane blokadą', async () => {
    const rental = (
      await as('bartek')({ method: 'POST', url: '/rentals', payload: { scooterId: await idOf(1) } })
    ).json<shared.RentalView>();
    const unlock = lastCommand(1);
    await jobs().run(JOBS.commandAckTimeout, { commandId: unlock.commandId });
    const failed = (await as('bartek')({ method: 'GET', url: `/rentals/${rental.id}` })).json<shared.RentalView>();
    expect(failed).toMatchObject({ state: 'UNLOCK_FAILED', price: { total: 0 } });
    expect(await statusOf(1)).toBe('AVAILABLE');

    await ack(unlock);
    expect(lastCommand(1)).toMatchObject({ cmd: 'lock' });
    const events = await pool.query(`SELECT type::text FROM rental_events WHERE rental_id = $1 ORDER BY id`, [
      rental.id,
    ]);
    expect(events.rows.map((r) => r.type)).toContain('LATE_UNLOCK_LOCKED');
  });

  it('panel: lista z licznikami, szczegóły z osią czasu i zdalne zakończenie z wpisem w dzienniku audytu', async () => {
    const dispatcher = asStaff(
      app,
      staffToken(app, (await pool.query(`SELECT id FROM staff WHERE email = 'd@test.local'`)).rows[0].id),
    );
    const service = asStaff(
      app,
      staffToken(app, (await pool.query(`SELECT id FROM staff WHERE email = 's@test.local'`)).rows[0].id),
    );

    const rental = (
      await as('bartek')({ method: 'POST', url: '/rentals', payload: { scooterId: await idOf(1) } })
    ).json<shared.RentalView>();
    await ack(lastCommand(1));

    const list = (await dispatcher({ method: 'GET', url: '/admin/rentals?facets=state,hasProblem' })).json<
      shared.ListResponse<shared.RentalListItem>
    >();
    expect(list.items[0]).toMatchObject({ id: rental.id, state: 'ACTIVE', scooterNumber: 1, userName: 'Bartek' });
    expect(list.facets.state).toMatchObject({ ACTIVE: 1, ENDED: 1, EXPIRED: 2, UNLOCK_FAILED: 1 });
    expect(list.facets.hasProblem).toMatchObject({ true: 1 });
    expect((await service({ method: 'GET', url: '/admin/rentals' })).statusCode).toBe(403);

    expect(
      (
        await service({
          method: 'POST',
          url: `/admin/rentals/${rental.id}/end`,
          payload: { reason: 'CUSTOMER_REQUEST' },
        })
      ).statusCode,
    ).toBe(403);
    const noNote = await dispatcher({
      method: 'POST',
      url: `/admin/rentals/${rental.id}/end`,
      payload: { reason: 'OTHER' },
    });
    expect(noNote.json().code).toBe('VALIDATION_FAILED');
    const ended = (
      await dispatcher({
        method: 'POST',
        url: `/admin/rentals/${rental.id}/end`,
        payload: { reason: 'SCOOTER_NOT_RESPONDING', note: 'Telefon od klienta' },
      })
    ).json<shared.RentalAdminDetails>();
    expect(ended).toMatchObject({
      state: 'ENDED',
      settlement: { state: 'WALLET_PAID', source: 'WALLET', paidAmount: ended.price.total },
      price: { unlockFee: 300 },
    });
    expect(ended.settlement.receiptNumber).toMatch(/^PAR\//);
    expect(ended.timeline.map((e) => `${e.kind}:${e.type}`)).toEqual([
      'EVENT:STATE_CHANGED',
      'COMMAND:UNLOCK',
      'EVENT:STATE_CHANGED',
      'EVENT:ENDED_REMOTELY',
      'EVENT:STATE_CHANGED',
      'COMMAND:LOCK',
    ]);
    expect(lastCommand(1)).toMatchObject({ cmd: 'lock' });
    const audit = await pool.query(`SELECT action, data->>'reason' AS reason FROM audit_log WHERE entity_id = $1`, [
      rental.id,
    ]);
    expect(audit.rows).toEqual([{ action: 'rental.ended_remotely', reason: 'SCOOTER_NOT_RESPONDING' }]);
    const view = (await as('bartek')({ method: 'GET', url: `/rentals/${rental.id}` })).json<shared.RentalView>();
    expect(view).toMatchObject({ state: 'ENDED', notice: 'ENDED_REMOTELY' });
    expect(
      (
        await dispatcher({
          method: 'POST',
          url: `/admin/rentals/${rental.id}/end`,
          payload: { reason: 'CUSTOMER_REQUEST' },
        })
      ).json().code,
    ).toBe('INVALID_RENTAL_TRANSITION');
  });

  it('utrata łączności w trakcie jazdy trafia na oś czasu', async () => {
    const rental = (
      await as('bartek')({ method: 'POST', url: '/rentals', payload: { scooterId: await idOf(1) } })
    ).json<shared.RentalView>();
    await ack(lastCommand(1));
    mqtt().dispatch(shared.topics.status('0001'), Buffer.from(JSON.stringify({ online: false })));
    await expect
      .poll(
        async () =>
          (
            await pool.query(
              `SELECT count(*)::int AS n FROM rental_events WHERE rental_id = $1 AND type = 'CONNECTION_LOST'`,
              [rental.id],
            )
          ).rows[0].n,
      )
      .toBe(1);
    const item = (
      await app.inject({
        method: 'GET',
        url: `/admin/rentals/${rental.id}`,
        headers: {
          authorization: `Bearer ${staffToken(app, (await pool.query(`SELECT id FROM staff WHERE email = 'd@test.local'`)).rows[0].id)}`,
        },
      })
    ).json();
    expect(item.hasProblem).toBe(true);
  });

  it('ustawienia powiadomień i usunięcie konta po zakończeniu przejazdów', async () => {
    const prefs = await as('anna')({
      method: 'PATCH',
      url: '/me/notifications',
      payload: { reservationEnd: false, receipts: true },
    });
    expect(prefs.json()).toEqual({ reservationEnd: false, receipts: true });
    // Saldo różne od 0 blokuje usunięcie (pytanie 9); zwrot salda robi operator, tu korekta do zera.
    const blocked = await as('anna')({ method: 'DELETE', url: '/me' });
    expect(blocked.json()).toMatchObject({ code: 'WALLET_BALANCE_NOT_ZERO' });
    const balance = Number((await pool.query(`SELECT fn_wallet_balance($1) AS b`, [customers.anna.id])).rows[0].b);
    await fundWallet(pool, customers.anna.id, -balance);
    expect((await as('anna')({ method: 'DELETE', url: '/me' })).statusCode).toBe(204);
    const user = await pool.query(`SELECT status, phone FROM users WHERE id = $1`, [customers.anna.id]);
    expect(user.rows[0]).toEqual({ status: 'DELETED', phone: null });
    const kept = await pool.query(`SELECT count(*)::int AS n FROM rentals WHERE user_id = $1`, [customers.anna.id]);
    expect(kept.rows[0].n).toBeGreaterThan(0);
  });
});
