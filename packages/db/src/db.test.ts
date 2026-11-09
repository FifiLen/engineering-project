/**
 * Testy integracyjne na prawdziwym PostgreSQL z PostGIS. Każde uruchomienie tworzy
 * tymczasową bazę i usuwa ją na końcu. Wymagają DATABASE_URL (w CI: kontener postgis).
 */
import { randomUUID } from 'node:crypto';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Pool } from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { runMigrations } from './migrator.js';
import type { PlacesFile } from './places.js';
import { seedDatabase } from './seed.js';

const adminUrl = process.env.DATABASE_URL;
const dbName = `hulajnogi_test_${randomUUID().slice(0, 8)}`;

// Syntetyczne współrzędne testowe (nie są to prawdziwe miejsca w Rybniku).
const places: PlacesFile = {
  city: 'Test',
  note: '',
  serviceArea: { code: 'AREA-TEST', name: 'Obszar testowy', centerPlace: 'P-01', radiusM: 3000 },
  places: [
    { code: 'P-01', name: 'Centrum', query: '', type: 'PARKING', radiusM: 50, capacity: 20, lat: 50.0, lon: 18.5 },
    { code: 'P-02', name: 'Północ', query: '', type: 'PARKING', radiusM: 50, capacity: 20, lat: 50.01, lon: 18.5 },
    { code: 'S-01', name: 'Wolna strefa', query: '', type: 'SLOW', radiusM: 200, speedLimitKmh: 10, lat: 50.0, lon: 18.5 },
  ],
};

describe.skipIf(!adminUrl)('baza danych', () => {
  let admin: Pool;
  let pool: Pool;

  beforeAll(async () => {
    admin = new Pool({ connectionString: adminUrl });
    await admin.query(`CREATE DATABASE ${dbName}`);
    const url = new URL(adminUrl!);
    url.pathname = `/${dbName}`;
    pool = new Pool({ connectionString: url.toString() });
    pool.on('error', () => undefined);
  });

  afterAll(async () => {
    await pool?.end();
    await admin?.query(`DROP DATABASE IF EXISTS ${dbName} WITH (FORCE)`);
    await admin?.end();
  });

  it('wykonuje migracje, a ponowne uruchomienie niczego nie zmienia', async () => {
    const first = await runMigrations(pool);
    expect(first.applied).toContain('0001_init.sql');
    const second = await runMigrations(pool);
    expect(second.applied).toEqual([]);
  });

  it('odrzuca zmienioną treść wykonanej migracji', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'mig-'));
    writeFileSync(join(dir, '0001_init.sql'), 'SELECT 1;');
    await expect(runMigrations(pool, dir)).rejects.toThrow(/została zmieniona/);
  });

  it('zakłada dane startowe idempotentnie', async () => {
    const options = { places, fleetSize: 12, admin: { email: 'a@test.local', name: 'A', passwordHash: 'x' } };
    const first = await seedDatabase(pool, options);
    expect(first).toEqual({ zones: 4, scootersCreated: 12, scootersTotal: 12 });
    const second = await seedDatabase(pool, options);
    expect(second).toEqual({ zones: 4, scootersCreated: 0, scootersTotal: 12 });
  });

  it('znajduje strefy dla punktu w centrum (ST_Contains)', async () => {
    const { rows } = await pool.query<{ code: string; type: string }>(
      `SELECT code, type FROM zones
       WHERE active AND ST_Contains(geom, ST_SetSRID(ST_MakePoint($1, $2), 4326))
       ORDER BY code`,
      [18.5, 50.0],
    );
    expect(rows.map((r) => r.code)).toEqual(['AREA-TEST', 'P-01', 'S-01']);
  });

  it('wszystkie hulajnogi stoją w obszarze działania', async () => {
    const { rows } = await pool.query<{ outside: string }>(
      `SELECT count(*) AS outside FROM scooters s
       WHERE NOT EXISTS (SELECT 1 FROM zones z WHERE z.type = 'SERVICE_AREA' AND ST_Contains(z.geom, s.position))`,
    );
    expect(Number(rows[0]!.outside)).toBe(0);
  });

  it('nie pozwala na dwa otwarte przejazdy tej samej hulajnogi', async () => {
    const user = await pool.query<{ id: string }>(`INSERT INTO users (phone) VALUES ('+48500000001') RETURNING id`);
    const other = await pool.query<{ id: string }>(`INSERT INTO users (phone) VALUES ('+48500000002') RETURNING id`);
    const insert = (userId: string) =>
      pool.query(
        `INSERT INTO rentals (user_id, scooter_id, tariff_id, state)
         SELECT $1, (SELECT id FROM scooters WHERE number = 1), (SELECT id FROM tariffs WHERE version = 1), 'UNLOCKING'`,
        [userId],
      );
    await insert(user.rows[0]!.id);
    await expect(insert(other.rows[0]!.id)).rejects.toThrow(/rentals_one_open_per_scooter/);
  });
});
