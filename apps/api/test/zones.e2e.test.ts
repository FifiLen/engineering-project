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
import { PlaceSearch } from '../src/geo/place-search.js';
import { MqttService } from '../src/mqtt/mqtt.service.js';
import { TelemetryService } from '../src/telemetry/telemetry.service.js';
import { asStaff, staffToken, fundWallet } from './helpers.js';

const adminUrl = process.env.DATABASE_URL;
const dbName = `hulajnogi_zones_api_${randomUUID().slice(0, 8)}`;

// Syntetyczne współrzędne testowe na jednym południku: parkowanie, wolna jazda, zakaz, parkowanie.
const places: PlacesFile = {
  city: 'Test',
  note: '',
  serviceArea: { code: 'AREA-TEST', name: 'Obszar testowy', centerPlace: 'P-01', radiusM: 5000 },
  places: [
    { code: 'P-01', name: 'Centrum', query: '', type: 'PARKING', radiusM: 100, capacity: 20, lat: 50.0, lon: 18.5 },
    { code: 'S-01', name: 'Wolna', query: '', type: 'SLOW', radiusM: 200, speedLimitKmh: 10, lat: 50.01, lon: 18.5 },
    { code: 'Z-01', name: 'Park', query: '', type: 'NO_RIDE', radiusM: 150, lat: 50.02, lon: 18.5 },
    { code: 'P-02', name: 'Północ', query: '', type: 'PARKING', radiusM: 100, capacity: 20, lat: 50.03, lon: 18.5 },
  ],
};

/** Kwadrat 0,001° (około 70 × 110 m) z lewym dolnym rogiem w punkcie. */
const square = (lon: number, lat: number, size = 0.001): shared.ZonePolygon => ({
  type: 'Polygon',
  coordinates: [
    [
      [lon, lat],
      [lon + size, lat],
      [lon + size, lat + size],
      [lon, lat + size],
      [lon, lat],
    ],
  ],
});

describe('typy stref w kontrakcie API są zgodne z packages/core', () => {
  it('ZONE_TYPES', () => {
    expect([...shared.ZONE_TYPES]).toEqual([...core.ZONE_TYPES]);
  });
});

describe.skipIf(!adminUrl)('API: strefy', () => {
  let admin: Pool;
  let pool: Pool;
  let app: NestFastifyApplication;
  let customer: { id: string; token: string };
  let asAdmin: ReturnType<typeof asStaff>;
  let asDispatcher: ReturnType<typeof asStaff>;
  let clock = Date.now() - 60_000;

  const idOf = async (number: number) =>
    (await pool.query<{ id: string }>('SELECT id FROM scooters WHERE number = $1', [number])).rows[0]!.id;
  const asCustomer = (options: { method: 'GET' | 'POST' | 'DELETE'; url: string; payload?: object }) =>
    app.inject({ ...options, headers: { authorization: `Bearer ${customer.token}` } });
  const published = (number: number) =>
    app
      .get(MqttService)
      .published.filter((p) => p.topic === shared.topics.command(shared.scooterTopicId(number)))
      .map((p) => p.payload as shared.Command);
  const ack = (command: shared.Command, ok = true) =>
    app
      .get(CommandsService)
      .handleAck(Buffer.from(JSON.stringify({ commandId: command.commandId, ok, ts: new Date().toISOString() })));
  /** Odczyt telemetrii hulajnogi #1 i zapis partii (okno zapisu w teście jest ręczne). */
  const ride = async (lat: number, options: { buffered?: boolean } = {}) => {
    clock += 5000;
    app.get(TelemetryService).accept(1, {
      ts: new Date(clock).toISOString(),
      lat,
      lon: 18.5,
      bat: 80,
      v: 12,
      locked: false,
      buffered: options.buffered ?? false,
    });
    await app.get(TelemetryService).flush();
  };
  const current = async () =>
    (await asCustomer({ method: 'GET', url: '/rentals/current' })).json<{ rental: shared.RentalView }>().rental;
  const zoneId = async (code: string) =>
    (await pool.query<{ id: string }>('SELECT id FROM zones WHERE code = $1', [code])).rows[0]!.id;

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
      fleetSize: 2,
      admin: { email: 'a@test.local', name: 'A', passwordHash: 'x' },
      staff: [{ email: 'd@test.local', name: 'D', role: 'Dyspozytor', passwordHash: 'x' }],
      documents: [
        { slug: 'regulamin', name: 'Regulamin', consentType: 'TERMS', title: 'Regulamin', bodyMd: 'Treść' },
        { slug: 'polityka-prywatnosci', name: 'Polityka', consentType: 'PRIVACY', title: 'Polityka', bodyMd: 'Treść' },
      ],
    });
    // #1 w strefie P-01, #2 w strefie zakazu Z-01.
    await pool.query(
      `UPDATE scooters SET online = true, battery_pct = 80, position = ST_SetSRID(ST_MakePoint(18.5, 50.0), 4326) WHERE number = 1`,
    );
    await pool.query(
      `UPDATE scooters SET online = true, battery_pct = 80, position = ST_SetSRID(ST_MakePoint(18.5, 50.02), 4326) WHERE number = 2`,
    );
    app = await createApp(
      loadConfig({
        NODE_ENV: 'test',
        DATABASE_URL: url.toString(),
        MQTT_ENABLED: 'false',
        JOBS_ENABLED: 'false',
        TELEMETRY_FLUSH_MS: '10000',
        // Port bez usługi: trasy wracają jako linia prosta niezależnie od lokalnego OSRM.
        OSRM_URL: 'http://127.0.0.1:9',
        OSRM_FOOT_URL: 'http://127.0.0.1:9',
      }),
      { logger: false },
    );
    await app.init();
    customer = await register('+48500200100', 'Celina');
    const staffId = async (email: string) =>
      (await pool.query<{ id: string }>('SELECT id FROM staff WHERE email = $1', [email])).rows[0]!.id;
    asAdmin = asStaff(app, staffToken(app, await staffId('a@test.local')));
    asDispatcher = asStaff(app, staffToken(app, await staffId('d@test.local')));
  }, 30_000);

  afterAll(async () => {
    await app?.close();
    await pool?.end();
    await admin?.query(`DROP DATABASE IF EXISTS ${dbName} WITH (FORCE)`);
    await admin?.end();
  });

  it('panel: lista stref z licznikami typu, szczegóły z wielokątem; publiczne GET /zones z ETag i punktem anchor', async () => {
    const list = (await asAdmin({ method: 'GET', url: '/admin/zones?facets=type&type=PARKING' })).json<
      shared.ListResponse<shared.ZoneListItem>
    >();
    expect(list.items.map((z) => z.code)).toEqual(['P-01', 'P-02']);
    expect(list.facets?.type).toMatchObject({ PARKING: 2, SLOW: 1, NO_RIDE: 1, SERVICE_AREA: 1 });
    expect(list.items[0]).toMatchObject({ points: 16, used: false, active: true, scootersInside: 1 });

    const details = (
      await asAdmin({ method: 'GET', url: `/admin/zones/${await zoneId('S-01')}` })
    ).json<shared.ZoneDetails>();
    expect(details).toMatchObject({ code: 'S-01', type: 'SLOW', speedLimitKmh: 10, rentals: [] });
    expect(details.polygon?.coordinates[0]).toHaveLength(17);

    const zones = await app.inject({ method: 'GET', url: '/zones' });
    const body = zones.json<{
      features: Array<{ properties: { code: string; anchor: [number, number]; visibleInApp: boolean } }>;
    }>();
    expect(body.features.find((f) => f.properties.code === 'Z-01')?.properties).toMatchObject({ visibleInApp: true });
    expect(body.features.find((f) => f.properties.code === 'P-02')?.properties.anchor[1]).toBeCloseTo(50.03, 3);
    const etag = zones.headers.etag as string;
    expect((await app.inject({ method: 'GET', url: '/zones', headers: { 'if-none-match': etag } })).statusCode).toBe(
      304,
    );
  });

  it('panel: reguły geometrii, wersja rekordu, niezmienny typ, uprawnienia i usunięcie nieużytej strefy', async () => {
    const draft = { code: 'p-03', name: 'Kampus', type: 'PARKING', capacity: 15, polygon: square(18.51, 50.0) };
    const outside = await asAdmin({
      method: 'POST',
      url: '/admin/zones',
      payload: { ...draft, polygon: square(18.7, 50.2) },
    });
    expect(outside.statusCode).toBe(422);
    expect(outside.json()).toMatchObject({ code: 'ZONE_OUTSIDE_SERVICE_AREA' });
    const overlap = await asAdmin({
      method: 'POST',
      url: '/admin/zones',
      payload: { ...draft, polygon: square(18.4995, 49.9995) },
    });
    expect(overlap.statusCode).toBe(422);
    expect(overlap.json()).toMatchObject({ code: 'ZONE_OVERLAP', details: { zoneCode: 'P-01' } });
    const slow = await asAdmin({
      method: 'POST',
      url: '/admin/zones',
      payload: { ...draft, type: 'SLOW', speedLimitKmh: 30, capacity: null },
    });
    expect(slow.json()).toMatchObject({ code: 'VALIDATION_FAILED', details: { fields: ['speedLimitKmh'] } });
    expect((await asDispatcher({ method: 'POST', url: '/admin/zones', payload: draft })).statusCode).toBe(403);

    const created = await asAdmin({ method: 'POST', url: '/admin/zones', payload: draft });
    expect(created.statusCode).toBe(201);
    const duplicate = await asAdmin({
      method: 'POST',
      url: '/admin/zones',
      payload: { ...draft, polygon: square(18.52, 50.0) },
    });
    expect(duplicate.statusCode).toBe(409);
    expect(duplicate.json()).toMatchObject({ code: 'ALREADY_EXISTS', details: { field: 'code' } });
    const zone = created.json<shared.ZoneDetails>();
    expect(zone).toMatchObject({ code: 'P-03', version: 1, used: false, updatedByName: 'A' });

    const changed = await asAdmin({
      method: 'PATCH',
      url: `/admin/zones/${zone.id}`,
      payload: { ...draft, name: 'Kampus Północ', version: 1 },
    });
    expect(changed.json()).toMatchObject({ name: 'Kampus Północ', version: 2 });
    const stale = await asAdmin({ method: 'PATCH', url: `/admin/zones/${zone.id}`, payload: { ...draft, version: 1 } });
    expect(stale.statusCode).toBe(409);
    expect(stale.json()).toMatchObject({ code: 'CONFLICT' });
    const retype = await asAdmin({
      method: 'PATCH',
      url: `/admin/zones/${zone.id}`,
      payload: { ...draft, type: 'NO_RIDE', capacity: null, version: 2 },
    });
    expect(retype.json()).toMatchObject({ code: 'ZONE_TYPE_IMMUTABLE' });

    const audit = await pool.query<{ action: string }>(
      `SELECT action FROM audit_log WHERE entity_id = $1 ORDER BY created_at, id`,
      [zone.id],
    );
    expect(audit.rows.map((r) => r.action)).toEqual(['zone.created', 'zone.updated']);
    const area = await zoneId('AREA-TEST');
    const areaVersion = (await asAdmin({ method: 'GET', url: `/admin/zones/${area}` })).json<shared.ZoneDetails>()
      .version;
    expect(
      (
        await asAdmin({ method: 'POST', url: `/admin/zones/${area}/deactivate`, payload: { version: areaVersion } })
      ).json(),
    ).toMatchObject({ code: 'SERVICE_AREA_REQUIRED' });

    expect((await asAdmin({ method: 'DELETE', url: `/admin/zones/${zone.id}?version=2` })).statusCode).toBe(204);
  });

  it('hulajnoga w strefie zakazu jest niedostępna (OUT_OF_AREA) i nie ma jej na mapie', async () => {
    const nearby = (
      await asCustomer({ method: 'GET', url: '/scooters/nearby?lat=50.01&lon=18.5' })
    ).json<shared.NearbyResponse>();
    expect(nearby.scooters.map((s) => s.number)).toEqual([1]);
    const scooter = (
      await asCustomer({ method: 'GET', url: '/scooters/by-number/2' })
    ).json<shared.CustomerScooterView>();
    expect(scooter).toMatchObject({ available: false, unavailableReason: 'OUT_OF_AREA' });
    const start = await asCustomer({ method: 'POST', url: '/rentals', payload: { scooterId: await idOf(2) } });
    expect(start.json()).toMatchObject({ code: 'SCOOTER_UNAVAILABLE', details: { reason: 'OUT_OF_AREA' } });
  });

  it('przejazd przez strefy: zdarzenia na osi czasu, limit i zatrzymanie z uzgadnianiem komend (ADR 0043, 0044)', async () => {
    await asCustomer({ method: 'POST', url: '/rentals', payload: { scooterId: await idOf(1) } });
    await ack(published(1).at(-1)!);
    const before = published(1).length;

    // Pierwszy odczyt ustawia stan bez zdarzeń; wjazd do wolnej jazdy daje limit 10 km/h.
    await ride(50.0);
    expect(published(1)).toHaveLength(before);
    await ride(50.01);
    const limit = published(1).at(-1)!;
    expect(limit).toMatchObject({ cmd: 'speed_limit', params: { kmh: 10 } });
    expect((await current()).zoneControl).toEqual({ stopped: false, speedLimitKmh: 10 });
    expect((await current()).zones.map((z) => z.code)).toEqual(['S-01', 'AREA-TEST']);

    // Komenda strefy w toku nie blokuje pauzy; po blokadzie (lock kasuje limit) wznowienie ponawia limit.
    const pause = await asCustomer({ method: 'POST', url: '/rentals/current/pause' });
    expect(pause.statusCode).toBe(202);
    await ack(limit);
    await ack(published(1).at(-1)!);
    expect((await current()).state).toBe('PAUSED');
    await asCustomer({ method: 'POST', url: '/rentals/current/resume' });
    await ack(published(1).at(-1)!);
    expect((await current()).state).toBe('ACTIVE');
    const again = published(1).at(-1)!;
    expect(again).toMatchObject({ cmd: 'speed_limit', params: { kmh: 10 } });

    // Nieudana komenda: następny odczyt ją ponawia.
    await app.get(CommandsService).timeout(again.commandId);
    await ride(50.01);
    const retry = published(1).at(-1)!;
    expect(retry).toMatchObject({ cmd: 'speed_limit', params: { kmh: 10 } });
    expect(retry.commandId).not.toBe(again.commandId);
    await ack(retry);

    // Strefa zakazu: zatrzymanie i zdjęcie limitu; zakończenie odrzucone.
    await ride(50.02);
    const [stop, unlimit] = published(1).slice(-2);
    expect(stop).toMatchObject({ cmd: 'stop_gradually' });
    expect(unlimit).toMatchObject({ cmd: 'speed_limit' });
    expect(unlimit!.params?.kmh).toBeUndefined();
    await ack(stop!);
    await ack(unlimit!);
    expect((await current()).zoneControl).toEqual({ stopped: true, speedLimitKmh: null });
    const end = await asCustomer({ method: 'POST', url: '/rentals/current/end' });
    expect(end.statusCode).toBe(422);
    expect(end.json()).toMatchObject({ code: 'OUTSIDE_PARKING' });

    // Punkt z bufora zmienia stan i oś czasu, ale nie wysyła komendy; bieżący odczyt przywraca napęd.
    const count = published(1).length;
    await ride(50.03, { buffered: true });
    await ride(50.03, { buffered: true });
    expect(published(1)).toHaveLength(count);
    await ride(50.03);
    expect(published(1).at(-1)).toMatchObject({ cmd: 'release_stop' });
    await ack(published(1).at(-1)!);

    const rental = await current();
    const details = (await asAdmin({ method: 'GET', url: `/admin/rentals/${rental.id}` })).json<{
      timeline: shared.RentalTimelineEntry[];
    }>();
    const zoneEvents = details.timeline
      .filter((e) => e.type === 'ZONE_ENTERED' || e.type === 'ZONE_EXITED')
      .map((e) => `${e.type}:${e.zoneCode}`);
    // Strefa startowa nie daje wjazdu, ale wyjazd z niej jest zdarzeniem.
    expect(zoneEvents).toEqual([
      'ZONE_EXITED:P-01',
      'ZONE_ENTERED:S-01',
      'ZONE_EXITED:S-01',
      'ZONE_ENTERED:Z-01',
      'ZONE_EXITED:Z-01',
      'ZONE_ENTERED:P-02',
    ]);
    expect(
      details.timeline.filter((e) => e.kind === 'COMMAND' && e.type === 'SPEED_LIMIT').length,
    ).toBeGreaterThanOrEqual(4);
  });

  it('zmiana limitu w panelu działa w trwającym przejeździe; koniec przejazdu kończy śledzenie stref', async () => {
    await ride(50.01);
    await ride(50.01);
    const limit = published(1).at(-1)!;
    expect(limit).toMatchObject({ cmd: 'speed_limit', params: { kmh: 10 } });
    await ack(limit);

    const s01 = await zoneId('S-01');
    const zone = (await asAdmin({ method: 'GET', url: `/admin/zones/${s01}` })).json<shared.ZoneDetails>();
    expect(zone.rentals.map((r) => r.scooterNumber)).toEqual([1]);
    const impact = await asAdmin({ method: 'POST', url: `/admin/zones/${s01}/impact`, payload: { polygon: null } });
    expect(impact.json<shared.ZoneImpactRental[]>()).toHaveLength(1);
    await asAdmin({
      method: 'PATCH',
      url: `/admin/zones/${s01}`,
      payload: {
        code: 'S-01',
        name: 'Wolna',
        type: 'SLOW',
        speedLimitKmh: 8,
        capacity: null,
        visibleInApp: true,
        polygon: zone.polygon,
        version: zone.version,
      },
    });
    expect(published(1).at(-1)).toMatchObject({ cmd: 'speed_limit', params: { kmh: 8 } });
    await ack(published(1).at(-1)!);

    // Dojazd do P-02 i zakończenie: stan stref przejazdu znika.
    await ride(50.03);
    await ride(50.03);
    await ride(50.03);
    await asCustomer({ method: 'POST', url: '/rentals/current/end' });
    await ack(published(1).at(-1)!);
    const left = await pool.query(`SELECT 1 FROM scooter_zone_control UNION ALL SELECT 1 FROM scooter_zone_presence`);
    expect(left.rowCount).toBe(0);
    expect((await asAdmin({ method: 'GET', url: `/admin/zones/${await zoneId('P-02')}` })).json()).toMatchObject({
      used: true,
      endedRentals: 1,
    });
  });

  it('trasy bez OSRM to linia prosta; wyszukiwanie przez Photon z pamięcią podręczną i błędem 503', async () => {
    const parking = (
      await asCustomer({ method: 'GET', url: '/zones/nearest-parking?lat=50.005&lon=18.5' })
    ).json<shared.NearestParkingRoute>();
    expect(parking.zone.code).toBe('P-01');
    expect(parking.route).toMatchObject({ approximate: true, durationSec: null, profile: 'bike' });
    expect(parking.route.distanceM).toBeGreaterThan(400);
    expect(parking.route.distanceM).toBeLessThan(470);

    const walk = (
      await asCustomer({ method: 'GET', url: `/scooters/${await idOf(1)}/walk?lat=50.031&lon=18.5` })
    ).json<shared.RouteView>();
    expect(walk).toMatchObject({ profile: 'foot', approximate: true });
    expect(
      (await asCustomer({ method: 'GET', url: `/scooters/${await idOf(2)}/walk?lat=50.02&lon=18.5` })).statusCode,
    ).toBe(404);

    const search = app.get(PlaceSearch) as unknown as { fetch: (q: string) => Promise<unknown[]> };
    let calls = 0;
    search.fetch = () => {
      calls++;
      return Promise.resolve([{ id: 'W1', name: 'Rynek', description: 'Rybnik', lat: 50.0, lon: 18.5 }]);
    };
    const first = await asCustomer({ method: 'GET', url: '/places/search?q=Rynek&lat=50.01&lon=18.5' });
    expect(first.json<shared.PlaceSearchResponse>().places[0]).toMatchObject({ name: 'Rynek', distanceM: 1112 });
    await asCustomer({ method: 'GET', url: '/places/search?q=%20rynek' });
    expect(calls).toBe(1);
    search.fetch = () => Promise.reject(new core.DomainError('PLACES_UNAVAILABLE'));
    const down = await asCustomer({ method: 'GET', url: '/places/search?q=Dworzec' });
    expect(down.statusCode).toBe(503);
    expect(down.json()).toMatchObject({ code: 'PLACES_UNAVAILABLE' });

    const destination = (
      await asCustomer({ method: 'GET', url: '/places/destination?lat=50.0&lon=18.5&toLat=50.01&toLon=18.5' })
    ).json<shared.DestinationView>();
    expect(destination).toMatchObject({ speedLimitKmh: 8, insideServiceArea: true, parking: { code: 'P-01' } });
  });
});
