import 'reflect-metadata';
import { randomUUID } from 'node:crypto';
import * as core from '@hulajnogi/core';
import { runMigrations, seedDatabase, type PlacesFile } from '@hulajnogi/db';
import * as shared from '@hulajnogi/shared';
import type { NestFastifyApplication } from '@nestjs/platform-fastify';
import { Pool } from 'pg';
import { io, type Socket } from 'socket.io-client';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createApp } from '../src/bootstrap.js';
import { loadConfig } from '../src/config.js';
import { CommandsService } from '../src/fleet/commands.service.js';
import { MqttService } from '../src/mqtt/mqtt.service.js';
import { TelemetryService } from '../src/telemetry/telemetry.service.js';

const adminUrl = process.env.DATABASE_URL;
const dbName = `hulajnogi_fleet_api_${randomUUID().slice(0, 8)}`;

// Syntetyczne współrzędne testowe.
const places: PlacesFile = {
  city: 'Test',
  note: '',
  serviceArea: { code: 'AREA-TEST', name: 'Obszar testowy', centerPlace: 'P-01', radiusM: 3000 },
  places: [
    { code: 'P-01', name: 'Centrum', query: '', type: 'PARKING', radiusM: 400, capacity: 20, lat: 50.0, lon: 18.5 },
  ],
};

describe('wyliczenia w kontrakcie API są zgodne z packages/core', () => {
  it.each([
    ['FLEET_STATUSES', shared.FLEET_STATUSES, core.FLEET_STATUSES],
    ['SCOOTER_STATUSES', shared.SCOOTER_STATUSES, core.SCOOTER_STATUSES],
    ['OPERATOR_STATUSES', shared.OPERATOR_STATUSES, core.OPERATOR_STATUSES],
    ['SCOOTER_VARIANTS', shared.SCOOTER_VARIANTS, core.SCOOTER_VARIANTS],
    ['PANEL_COMMANDS', shared.PANEL_COMMANDS, core.PANEL_COMMANDS],
    ['COMMAND_STATUSES', shared.COMMAND_STATUSES, core.COMMAND_STATUSES],
  ])('%s', (_name, fromShared, fromCore) => {
    expect([...fromShared]).toEqual([...fromCore]);
  });

  it('komendy panelu mają nazwy z kontraktu MQTT', () => {
    for (const cmd of shared.PANEL_COMMANDS) expect(shared.commandNames).toContain(cmd.toLowerCase());
  });
});

describe.skipIf(!adminUrl)('API: flota, telemetria, komendy', () => {
  let admin: Pool;
  let pool: Pool;
  let app: NestFastifyApplication;
  let socket: Socket;
  const received: shared.FleetMapScooter[][] = [];
  const commandEvents: shared.CommandView[] = [];
  const idOf = async (number: number) =>
    (await pool.query<{ id: string }>('SELECT id FROM scooters WHERE number = $1', [number])).rows[0]!.id;
  const mqtt = () => app.get(MqttService);
  const send = (topic: string, payload: unknown) => mqtt().dispatch(topic, Buffer.from(JSON.stringify(payload)));

  beforeAll(async () => {
    admin = new Pool({ connectionString: adminUrl });
    await admin.query(`CREATE DATABASE ${dbName}`);
    const url = new URL(adminUrl!);
    url.pathname = `/${dbName}`;
    pool = new Pool({ connectionString: url.toString() });
    await runMigrations(pool);
    await seedDatabase(pool, { places, fleetSize: 4, admin: { email: 'a@test.local', name: 'A', passwordHash: 'x' } });

    app = await createApp(
      loadConfig({
        NODE_ENV: 'test',
        DATABASE_URL: url.toString(),
        MQTT_ENABLED: 'false',
        TELEMETRY_FLUSH_MS: '10000',
      }),
      { logger: false },
    );
    await app.listen({ port: 0, host: '127.0.0.1' });
    socket = io(await app.getUrl(), { transports: ['websocket'] });
    socket.on('fleet.updates', (u: shared.FleetMapScooter[]) => received.push(u));
    socket.on('fleet.command', (c: shared.CommandView) => commandEvents.push(c));
    await socket.emitWithAck('fleet.subscribe');
  });

  afterAll(async () => {
    socket?.disconnect();
    await app?.close();
    await pool?.end();
    await admin?.query(`DROP DATABASE IF EXISTS ${dbName} WITH (FORCE)`);
    await admin?.end();
  });

  it('GET /admin/scooters zwraca stronę listy z licznikami statusu floty', async () => {
    const res = await app.inject({ method: 'GET', url: '/admin/scooters?facets=fleetStatus&sort=-number&pageSize=2' });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body).toMatchObject({ page: 1, pageSize: 2, total: 4, facets: { fleetStatus: { OFFLINE: 4 } } });
    expect(body.items.map((s: shared.ScooterListItem) => s.number)).toEqual([4, 3]);
    expect(Object.keys(body.items[0]).sort()).toEqual(Object.keys(shared.scootersResource.fields).sort());
  });

  it('nieznany filtr i pole spoza białej listy kończą się VALIDATION_ERROR', async () => {
    const res = await app.inject({ method: 'GET', url: '/admin/scooters?position=1&sort=passwordHash' });
    expect(res.statusCode).toBe(400);
    expect(res.json()).toMatchObject({ code: 'VALIDATION_ERROR' });
    expect(res.json().details.map((i: shared.ListIssue) => i.code)).toEqual(['UNKNOWN_PARAM', 'UNKNOWN_SORT']);
  });

  it('model i hulajnoga: tworzenie, unikalność, konflikt wersji, wycofanie i archiwizacja', async () => {
    const model = await app.inject({
      method: 'POST',
      url: '/admin/scooter-models',
      payload: { code: 'T-1', name: 'Testowy', rangeKm: 40 },
    });
    expect(model.statusCode).toBe(201);
    expect(model.json()).toMatchObject({ code: 'T-1', active: true, version: 1, scootersTotal: 0 });
    const modelId = model.json().id;

    const scooter = await app.inject({
      method: 'POST',
      url: '/admin/scooters',
      payload: { number: 77, serialNumber: 'SC-TEST-77', variant: 'KOBALT', modelId },
    });
    expect(scooter.statusCode).toBe(201);
    expect(scooter.json()).toMatchObject({ number: 77, status: 'MAINTENANCE', fleetStatus: 'MAINTENANCE', version: 1 });
    const id = scooter.json().id;

    const duplicate = await app.inject({
      method: 'POST',
      url: '/admin/scooters',
      payload: { number: 77, serialNumber: 'SC-OTHER', variant: 'KOBALT', modelId },
    });
    expect(duplicate.statusCode).toBe(409);
    expect(duplicate.json()).toMatchObject({ code: 'ALREADY_EXISTS', details: { field: 'number' } });

    const edited = await app.inject({
      method: 'PATCH',
      url: `/admin/scooters/${id}`,
      payload: { version: 1, status: 'AVAILABLE' },
    });
    expect(edited.json()).toMatchObject({ status: 'AVAILABLE', version: 2 });
    const stale = await app.inject({
      method: 'PATCH',
      url: `/admin/scooters/${id}`,
      payload: { version: 1, variant: 'BETON' },
    });
    expect(stale.statusCode).toBe(409);
    expect(stale.json()).toMatchObject({ code: 'CONFLICT', details: { currentVersion: 2 } });
    const rental = await app.inject({
      method: 'PATCH',
      url: `/admin/scooters/${id}`,
      payload: { version: 2, status: 'IN_USE' },
    });
    expect(rental.statusCode).toBe(400);

    const modelRemoval = await app.inject({ method: 'DELETE', url: `/admin/scooter-models/${modelId}?version=1` });
    expect(modelRemoval.json()).toEqual({ outcome: 'ARCHIVED' });
    const inactive = await app.inject({
      method: 'POST',
      url: '/admin/scooters',
      payload: { number: 78, serialNumber: 'SC-TEST-78', variant: 'KOBALT', modelId },
    });
    expect(inactive.json()).toMatchObject({ code: 'MODEL_INACTIVE' });

    const retired = await app.inject({ method: 'DELETE', url: `/admin/scooters/${id}?version=2` });
    expect(retired.json()).toEqual({ outcome: 'RETIRED' });
    expect((await app.inject({ method: 'GET', url: `/admin/scooters/${id}` })).json()).toMatchObject({
      status: 'RETIRED',
      version: 3,
    });

    const missing = await app.inject({ method: 'GET', url: `/admin/scooters/${randomUUID()}` });
    expect(missing.statusCode).toBe(404);
    expect(missing.json().code).toBe('NOT_FOUND');
  });

  it('status i telemetria z MQTT zmieniają stan hulajnogi i trafiają do panelu przez Socket.IO', async () => {
    send('scooters/0001/status', { online: true, firmware: 'v2.5.0' });
    const ts = new Date().toISOString();
    send('scooters/0001/telemetry', { ts, lat: 50.0005, lon: 18.5005, bat: 64, v: 0, locked: true });
    send('scooters/0001/telemetry', { ts, lat: 'zła', lon: 18.5, bat: 64, v: 0, locked: true });
    send('scooters/9998/telemetry', { ts, lat: 50, lon: 18.5, bat: 64, v: 0, locked: true });
    await app.get(TelemetryService).flush();

    // Zdarzenie statusu może przyjść po telemetrii (osobne zapytania); panel scala zmiany po lastSeenAt.
    const fromTelemetry = () => received.flat().find((u) => u.number === 1 && u.batteryPct === 64);
    await expect.poll(fromTelemetry).toBeDefined();
    expect(fromTelemetry()).toMatchObject({
      lat: 50.0005,
      lon: 18.5005,
      fleetStatus: 'AVAILABLE',
      online: true,
      locked: true,
    });

    const details = (await app.inject({ method: 'GET', url: `/admin/scooters/${await idOf(1)}` })).json();
    expect(details).toMatchObject({
      batteryPct: 64,
      firmware: 'v2.5.0',
      online: true,
      parkingZoneCode: 'P-01',
      fleetStatus: 'AVAILABLE',
    });
    const map = (await app.inject({ method: 'GET', url: '/admin/fleet/map' })).json() as shared.FleetMapScooter[];
    expect(map.find((s) => s.number === 1)).toMatchObject({ lat: 50.0005, fleetStatus: 'AVAILABLE' });
    expect(map.find((s) => s.number === 77)).toBeUndefined();
  });

  it('komenda z panelu: publikacja w MQTT, potwierdzenie, odrzucenie reguł i przekroczenie czasu', async () => {
    const id = await idOf(1);
    const ring = await app.inject({ method: 'POST', url: `/admin/scooters/${id}/commands`, payload: { type: 'RING' } });
    expect(ring.statusCode).toBe(202);
    expect(ring.json()).toMatchObject({ type: 'RING', status: 'SENT', scooterNumber: 1 });
    const published = mqtt().published.at(-1)!;
    expect(published.topic).toBe('scooters/0001/cmd');
    expect(shared.commandSchema.parse(published.payload)).toMatchObject({ commandId: ring.json().id, cmd: 'ring' });

    await app
      .get(CommandsService)
      .handleAck(Buffer.from(JSON.stringify({ commandId: ring.json().id, ok: true, ts: new Date().toISOString() })));
    await expect.poll(() => commandEvents.some((c) => c.id === ring.json().id && c.status === 'ACKED')).toBe(true);

    const unlock = await app.inject({
      method: 'POST',
      url: `/admin/scooters/${id}/commands`,
      payload: { type: 'UNLOCK' },
    });
    expect(unlock.json()).toMatchObject({ code: 'UNLOCK_REQUIRES_MAINTENANCE' });
    const offline = await app.inject({
      method: 'POST',
      url: `/admin/scooters/${await idOf(2)}/commands`,
      payload: { type: 'RING' },
    });
    expect(offline.json()).toMatchObject({ code: 'SCOOTER_OFFLINE' });

    const lock = await app.inject({ method: 'POST', url: `/admin/scooters/${id}/commands`, payload: { type: 'LOCK' } });
    await app.get(CommandsService).expirePending(new Date(Date.now() + 11_000));
    const recent = (
      await app.inject({ method: 'GET', url: `/admin/scooters/${id}/commands` })
    ).json() as shared.CommandView[];
    expect(recent.map((c) => [c.id, c.status])).toEqual([
      [lock.json().id, 'TIMEOUT'],
      [ring.json().id, 'ACKED'],
    ]);
  });

  it('GET /zones zwraca aktywne strefy jako GeoJSON', async () => {
    const res = await app.inject({ method: 'GET', url: '/zones' });
    expect(res.json()).toMatchObject({ type: 'FeatureCollection' });
    expect(res.json().features.map((f: { properties: { code: string } }) => f.properties.code)).toEqual([
      'AREA-TEST',
      'P-01',
    ]);
  });

  it('CORS dopuszcza panel z localhost', async () => {
    const res = await app.inject({
      method: 'OPTIONS',
      url: '/admin/scooters',
      headers: { origin: 'http://localhost:3002', 'access-control-request-method': 'PATCH' },
    });
    expect(res.headers['access-control-allow-origin']).toBe('http://localhost:3002');
  });
});
