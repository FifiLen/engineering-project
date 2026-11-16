import 'reflect-metadata';
import { randomUUID } from 'node:crypto';
import { runMigrations, seedDatabase, type PlacesFile } from '@hulajnogi/db';
import type { NestFastifyApplication } from '@nestjs/platform-fastify';
import { Pool } from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createApp } from '../src/bootstrap.js';
import { loadConfig } from '../src/config.js';

const adminUrl = process.env.DATABASE_URL;
const dbName = `hulajnogi_api_${randomUUID().slice(0, 8)}`;

// Syntetyczne współrzędne testowe.
const places: PlacesFile = {
  city: 'Test',
  note: '',
  serviceArea: { code: 'AREA-TEST', name: 'Obszar testowy', centerPlace: 'P-01', radiusM: 3000 },
  places: [
    { code: 'P-01', name: 'Centrum', query: '', type: 'PARKING', radiusM: 50, capacity: 20, lat: 50.0, lon: 18.5 },
    { code: 'S-01', name: 'Wolna strefa', query: '', type: 'SLOW', radiusM: 200, speedLimitKmh: 10, lat: 50.0, lon: 18.5 },
  ],
};

describe.skipIf(!adminUrl)('API', () => {
  let admin: Pool;
  let app: NestFastifyApplication;

  beforeAll(async () => {
    admin = new Pool({ connectionString: adminUrl });
    await admin.query(`CREATE DATABASE ${dbName}`);
    const url = new URL(adminUrl!);
    url.pathname = `/${dbName}`;
    const pool = new Pool({ connectionString: url.toString() });
    await runMigrations(pool);
    await seedDatabase(pool, { places, fleetSize: 3, admin: { email: 'a@test.local', name: 'A', passwordHash: 'x' } });
    await pool.end();

    app = await createApp(loadConfig({ NODE_ENV: 'test', DATABASE_URL: url.toString(), MQTT_ENABLED: 'false' }), { logger: false });
    await app.init();
    await app.getHttpAdapter().getInstance().ready();
  });

  afterAll(async () => {
    await app?.close();
    await admin?.query(`DROP DATABASE IF EXISTS ${dbName} WITH (FORCE)`);
    await admin?.end();
  });

  it('GET /health zwraca stan bazy i wersję PostGIS', async () => {
    const res = await app.inject({ method: 'GET', url: '/health' });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({ status: 'ok', database: 'ok' });
    expect(res.json().postgis).toMatch(/^3\./);
  });

  it('GET /zones/lookup w centrum zwraca strefę wolnej jazdy i parkowania', async () => {
    const res = await app.inject({ method: 'GET', url: '/zones/lookup?lat=50&lon=18.5' });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.insideServiceArea).toBe(true);
    expect(body.canPark).toBe(true);
    expect(body.zones.map((z: { code: string }) => z.code)).toEqual(['S-01', 'P-01', 'AREA-TEST']);
    expect(body.zones[0].speedLimitKmh).toBe(10);
  });

  it('GET /zones/lookup poza obszarem zwraca pustą listę', async () => {
    const res = await app.inject({ method: 'GET', url: '/zones/lookup?lat=52.2&lon=21.0' });
    expect(res.json()).toMatchObject({ insideServiceArea: false, canPark: false, zones: [] });
  });

  it('GET /zones/lookup z błędnymi parametrami zwraca VALIDATION_ERROR', async () => {
    const res = await app.inject({ method: 'GET', url: '/zones/lookup?lat=abc&lon=200' });
    expect(res.statusCode).toBe(400);
    expect(res.json().code).toBe('VALIDATION_ERROR');
    expect(res.json().details.length).toBe(2);
  });

  it('nieznany adres zwraca błąd w jednolitym formacie', async () => {
    const res = await app.inject({ method: 'GET', url: '/nie-ma' });
    expect(res.statusCode).toBe(404);
    expect(res.json().code).toBe('NOT_FOUND');
  });

  it('udostępnia specyfikację OpenAPI', async () => {
    const res = await app.inject({ method: 'GET', url: '/docs-json' });
    expect(res.statusCode).toBe(200);
    expect(Object.keys(res.json().paths)).toEqual(expect.arrayContaining(['/health', '/zones/lookup']));
  });
});
