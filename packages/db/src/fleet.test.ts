/**
 * Testy integracyjne modułów Flota i Telemetria (iteracja 1) na prawdziwym PostGIS:
 * zgodność statusu floty w bazie i w core, wspólny mechanizm list, repozytoria.
 */
import { randomUUID } from 'node:crypto';
import { deriveFleetStatus, FLEET_STATUSES, SCOOTER_STATUSES, type TelemetryReading } from '@hulajnogi/core';
import {
  parseListQuery,
  scooterModelsResource,
  scootersResource,
  type ListQuery,
  type ResourceDefinition,
} from '@hulajnogi/shared';
import { Pool } from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createDb, type Database } from './client.js';
import { runMigrations } from './migrator.js';
import type { PlacesFile } from './places.js';
import { DrizzleCommandRepository } from './repositories/commands.repository.js';
import { DrizzleScooterRepository } from './repositories/fleet.repository.js';
import { DrizzleScooterModelRepository } from './repositories/scooter-models.repository.js';
import { DrizzleTelemetryRepository } from './repositories/telemetry.repository.js';
import { activeZonesGeoJson } from './repositories/zones.repository.js';
import { DEV_TARIFF, seedDatabase } from './seed.js';

const adminUrl = process.env.DATABASE_URL;
const dbName = `hulajnogi_fleet_${randomUUID().slice(0, 8)}`;

// Syntetyczne współrzędne testowe.
const places: PlacesFile = {
  city: 'Test',
  note: '',
  serviceArea: { code: 'AREA-TEST', name: 'Obszar testowy', centerPlace: 'P-01', radiusM: 3000 },
  places: [
    { code: 'P-01', name: 'Centrum', query: '', type: 'PARKING', radiusM: 400, capacity: 20, lat: 50.0, lon: 18.5 },
  ],
};

const parse = (def: ResourceDefinition, qs: string): ListQuery => {
  const result = parseListQuery(def, new URLSearchParams(qs));
  if (!result.ok) throw new Error(JSON.stringify(result.issues));
  return result.query;
};
const query = (qs: string) => parse(scootersResource, qs);
const modelQuery = (qs = '') => parse(scooterModelsResource, qs);

describe.skipIf(!adminUrl)('flota i telemetria w bazie', () => {
  let admin: Pool;
  let pool: Pool;
  let db: Database;
  let fleet: DrizzleScooterRepository;
  let models: DrizzleScooterModelRepository;
  let telemetry: DrizzleTelemetryRepository;
  let commands: DrizzleCommandRepository;
  const idOf = async (number: number) =>
    (await pool.query<{ id: string }>('SELECT id FROM scooters WHERE number = $1', [number])).rows[0]!.id;

  beforeAll(async () => {
    admin = new Pool({ connectionString: adminUrl });
    await admin.query(`CREATE DATABASE ${dbName}`);
    const url = new URL(adminUrl!);
    url.pathname = `/${dbName}`;
    pool = new Pool({ connectionString: url.toString() });
    await runMigrations(pool);
    await seedDatabase(pool, { places, fleetSize: 6, admin: { email: 'a@test.local', name: 'A', passwordHash: 'x' } });
    // Stan floty do testów list: 1–3 online z różną baterią, 4 w serwisie, 5 offline, 6 wycofana.
    await pool.query(`UPDATE scooters SET online = true, battery_pct = CASE number WHEN 1 THEN 90 WHEN 2 THEN 10 ELSE 50 END
                      WHERE number <= 3`);
    await pool.query(`UPDATE scooters SET status = 'MAINTENANCE', online = true WHERE number = 4`);
    await pool.query(`UPDATE scooters SET status = 'RETIRED' WHERE number = 6`);
    db = createDb(pool);
    fleet = new DrizzleScooterRepository(db);
    models = new DrizzleScooterModelRepository(db);
    telemetry = new DrizzleTelemetryRepository(db);
    commands = new DrizzleCommandRepository(db);
  });

  afterAll(async () => {
    await pool?.end();
    await admin?.query(`DROP DATABASE IF EXISTS ${dbName} WITH (FORCE)`);
    await admin?.end();
  });

  it('fn_fleet_status liczy status floty tak samo jak packages/core', async () => {
    const cases = SCOOTER_STATUSES.flatMap((status) =>
      [true, false].flatMap((online) => [null, 5, 15, 80].map((batteryPct) => ({ status, online, batteryPct }))),
    );
    const { rows } = await pool.query<{ i: number; result: string }>(
      `SELECT i, fn_fleet_status(c.status::scooter_status, c.online, c.battery::smallint, 15::smallint) AS result
       FROM jsonb_to_recordset($1::jsonb) AS c(i int, status text, online boolean, battery int)`,
      [JSON.stringify(cases.map((c, i) => ({ i, status: c.status, online: c.online, battery: c.batteryPct })))],
    );
    for (const row of rows) expect(row.result).toBe(deriveFleetStatus(cases[row.i]!, 15));
    expect(new Set(rows.map((r) => r.result))).toEqual(new Set(FLEET_STATUSES));
  });

  it('próg niskiej baterii pochodzi z obowiązującego cennika', async () => {
    expect(await fleet.lowBatteryThreshold()).toBe(DEV_TARIFF.minBatteryPct);
  });

  it('lista floty: status floty, liczniki szybkich filtrów i sortowanie domyślne', async () => {
    const page = await fleet.list(query('facets=fleetStatus'));
    expect(page.total).toBe(6);
    expect(page.items.map((s) => [s.number, s.fleetStatus])).toEqual([
      [1, 'AVAILABLE'],
      [2, 'LOW_BATTERY'],
      [3, 'AVAILABLE'],
      [4, 'MAINTENANCE'],
      [5, 'OFFLINE'],
      [6, 'RETIRED'],
    ]);
    expect(page.facets.fleetStatus).toEqual({ AVAILABLE: 2, LOW_BATTERY: 1, MAINTENANCE: 1, OFFLINE: 1, RETIRED: 1 });
  });

  it('lista floty: filtr statusu nie zmienia jego liczników, a inne filtry tak', async () => {
    const page = await fleet.list(query('fleetStatus=AVAILABLE&facets=fleetStatus'));
    expect(page.items.map((s) => s.number)).toEqual([1, 3]);
    expect(page.facets.fleetStatus!.OFFLINE).toBe(1);
    const filtered = await fleet.list(query('fleetStatus=AVAILABLE&batteryPct.gte=60&facets=fleetStatus'));
    expect(filtered.items.map((s) => s.number)).toEqual([1]);
    expect(filtered.facets.fleetStatus!.AVAILABLE).toBe(1);
    expect(filtered.facets.fleetStatus!.LOW_BATTERY).toBeUndefined();
  });

  it('lista floty: wyszukiwanie po numerze i numerze seryjnym, sortowanie, strony', async () => {
    expect((await fleet.list(query('q=%230002'))).items.map((s) => s.number)).toEqual([2]);
    expect((await fleet.list(query('q=sc-26-0005'))).items.map((s) => s.number)).toEqual([5]);
    const sorted = await fleet.list(query('sort=-batteryPct&pageSize=2&page=1&fleetStatus=AVAILABLE,LOW_BATTERY'));
    expect(sorted.items.map((s) => s.batteryPct)).toEqual([90, 50]);
    expect(sorted.total).toBe(3);
    const second = await fleet.list(query('sort=-batteryPct&pageSize=2&page=2&fleetStatus=AVAILABLE,LOW_BATTERY'));
    expect(second.items.map((s) => s.batteryPct)).toEqual([10]);
  });

  it('wyszukiwanie z symbolami LIKE nie jest wzorcem', async () => {
    expect((await fleet.list(query('q=%25'))).total).toBe(0);
  });

  it('hulajnoga: unikalny numer zgłaszany jako błąd pola, edycja z blokadą optymistyczną', async () => {
    const base = await models.list(modelQuery());
    const modelId = base.items[0]!.id;
    await expect(
      fleet.create({
        number: 1,
        serialNumber: 'NEW-1',
        variant: 'GRAFIT',
        modelId,
        status: 'MAINTENANCE',
        firmware: null,
      }),
    ).rejects.toMatchObject({ code: 'ALREADY_EXISTS', details: { field: 'number' } });
    const id = await idOf(3);
    const state = (await fleet.findState(id))!;
    expect(state).toMatchObject({ number: 3, version: 1, hasOpenRental: false });
    expect(await fleet.update(id, 1, { status: 'MAINTENANCE' })).toBe(true);
    expect(await fleet.update(id, 1, { status: 'AVAILABLE' })).toBe(false);
    expect((await fleet.details(id))!).toMatchObject({ status: 'MAINTENANCE', version: 2, modelCode: 'BASE' });
  });

  it('modele: lista z liczbą hulajnóg, tworzenie, edycja i usunięcie', async () => {
    const created = await models.create({
      code: 'X-200',
      name: 'Model X',
      manufacturer: 'Test',
      maxSpeedKmh: 20,
      batteryWh: 500,
      rangeKm: 45,
      weightKg: 17.5,
      description: null,
      active: true,
    });
    const details = (await models.details(created.id))!;
    expect(details).toMatchObject({ code: 'X-200', weightKg: 17.5, scootersTotal: 0, version: 1 });
    expect(await models.update(created.id, 1, { weightKg: 18.2, active: false })).toBe(true);
    expect((await models.details(created.id))!).toMatchObject({ weightKg: 18.2, active: false, version: 2 });
    await expect(models.create({ ...details, code: 'BASE', description: null })).rejects.toMatchObject({
      code: 'ALREADY_EXISTS',
    });
    const page = await models.list(modelQuery('facets=active&sort=-scootersTotal'));
    expect(page.items[0]).toMatchObject({ code: 'BASE', scootersTotal: 6, scootersActive: 5 });
    expect(page.facets.active).toEqual({ true: 1, false: 1 });
    await models.delete(created.id);
    expect(await models.findState(created.id)).toBeNull();
  });

  it('telemetria: zapis idempotentny, stan bieżący tylko z nowszych odczytów, przebieg', async () => {
    await telemetry.ensurePartitions(new Date('2026-11-16T00:00:00Z'), 2);
    const [target] = await telemetry.findTargets([1]);
    const reading = (iso: string, lon: number): TelemetryReading => ({
      recordedAt: new Date(iso),
      position: { lat: 50.0, lon },
      batteryPct: 77,
      speedKmh: 12,
      locked: false,
      buffered: false,
    });
    const first = reading('2026-11-16T10:00:00Z', 18.5);
    const second = reading('2026-11-16T10:00:05Z', 18.5005);
    await telemetry.save(
      [{ scooterId: target!.id, reading: first }],
      [{ scooterId: target!.id, reading: first, odometerIncrementM: 0 }],
    );
    await telemetry.save(
      [
        { scooterId: target!.id, reading: first },
        { scooterId: target!.id, reading: second },
      ],
      [{ scooterId: target!.id, reading: second, odometerIncrementM: 36 }],
    );
    // Starszy odczyt nie cofa stanu bieżącego, nawet gdy repozytorium dostanie go jako bieżący.
    await telemetry.save([], [{ scooterId: target!.id, reading: first, odometerIncrementM: 0 }]);
    const { rows } = await pool.query(
      `SELECT count(*)::int AS points, (SELECT tableoid::regclass::text FROM telemetry LIMIT 1) AS part FROM telemetry`,
    );
    expect(rows[0]).toEqual({ points: 2, part: 'telemetry_20261116' });
    const [after] = await telemetry.findTargets([1]);
    expect(after).toMatchObject({ batteryPct: 77, lastSeenAt: second.recordedAt, position: { lat: 50, lon: 18.5005 } });
    const { rows: odo } = await pool.query('SELECT odometer_m, version FROM scooters WHERE number = 1');
    expect(odo[0]).toEqual({ odometer_m: '36', version: 1 });
  });

  it('telemetria: zmiana łączności i oprogramowania', async () => {
    expect(await telemetry.setConnection(5, true, 'v2.5.0')).toMatchObject({ number: 5, online: true });
    expect(await telemetry.setConnection(5, false, null)).toMatchObject({ online: false });
    const { rows } = await pool.query('SELECT firmware FROM scooters WHERE number = 5');
    expect(rows[0].firmware).toBe('v2.5.0');
    expect(await telemetry.setConnection(9999, true, null)).toBeNull();
  });

  it('komendy: potwierdzenie raz, przekroczenie czasu tylko dla komend bez odpowiedzi', async () => {
    const scooterId = await idOf(1);
    const ring = await commands.create(scooterId, 'RING', {});
    const lock = await commands.create(scooterId, 'LOCK', {});
    expect(ring.status).toBe('SENT');
    expect((await commands.complete(ring.id, 'ACKED', new Date()))!.status).toBe('ACKED');
    expect(await commands.complete(ring.id, 'REJECTED', new Date())).toBeNull();
    const expired = await commands.expirePending(new Date(Date.now() + 60_000));
    expect(expired.map((c) => c.id)).toEqual([lock.id]);
    const recent = await commands.recentForScooter(scooterId, 5);
    expect(recent.map((c) => [c.type, c.status, c.scooterNumber])).toEqual([
      ['LOCK', 'TIMEOUT', 1],
      ['RING', 'ACKED', 1],
    ]);
  });

  it('strefy jako GeoJSON: obszar działania pierwszy, wielokąty w WGS 84', async () => {
    const zones = await activeZonesGeoJson(db);
    expect(zones.features.map((f) => f.properties.code)).toEqual(['AREA-TEST', 'P-01']);
    const [lon, lat] = zones.features[1]!.geometry.coordinates[0]![0]![0]!;
    expect(lat).toBeCloseTo(50.0, 1);
    expect(lon).toBeCloseTo(18.5, 1);
  });

  it('mapa floty pomija wycofane hulajnogi', async () => {
    const map = await fleet.mapSnapshot();
    expect(map.map((s) => s.number)).toEqual([1, 2, 3, 4, 5]);
    expect(map[0]).toMatchObject({ number: 1, fleetStatus: 'AVAILABLE', lat: 50 });
  });
});
