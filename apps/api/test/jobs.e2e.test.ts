import 'reflect-metadata';
import { randomUUID } from 'node:crypto';
import { runMigrations, seedDatabase, type PlacesFile } from '@hulajnogi/db';
import type { NestFastifyApplication } from '@nestjs/platform-fastify';
import { Pool } from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createApp } from '../src/bootstrap.js';
import { loadConfig } from '../src/config.js';
import { RentalsService } from '../src/rentals/rentals.service.js';

const adminUrl = process.env.DATABASE_URL;
const dbName = `hulajnogi_jobs_api_${randomUUID().slice(0, 8)}`;

const places: PlacesFile = {
  city: 'Test',
  note: '',
  serviceArea: { code: 'AREA-TEST', name: 'Obszar testowy', centerPlace: 'P-01', radiusM: 3000 },
  places: [{ code: 'P-01', name: 'Centrum', query: '', type: 'PARKING', radiusM: 100, capacity: 20, lat: 50.0, lon: 18.5 }],
};

/**
 * Kolejka pg-boss na prawdziwej bazie (ADR 0037): zadanie limitu potwierdzenia powstaje w transakcji startu
 * i samo przestawia przejazd w UNLOCK_FAILED, gdy hulajnoga nie odpowie. Pozostałe testy API wyłączają kolejkę.
 */
describe.skipIf(!adminUrl)('API: zadania w tle (pg-boss)', () => {
  let admin: Pool;
  let pool: Pool;
  let app: NestFastifyApplication;

  beforeAll(async () => {
    admin = new Pool({ connectionString: adminUrl });
    await admin.query(`CREATE DATABASE ${dbName}`);
    const url = new URL(adminUrl!);
    url.pathname = `/${dbName}`;
    pool = new Pool({ connectionString: url.toString() });
    pool.on('error', () => undefined);
    await runMigrations(pool);
    await seedDatabase(pool, { places, fleetSize: 1, admin: { email: 'a@test.local', name: 'A', passwordHash: 'x' } });
    await pool.query(`UPDATE scooters SET online = true, battery_pct = 80, position = ST_SetSRID(ST_MakePoint(18.5, 50.0), 4326)`);
    app = await createApp(loadConfig({ NODE_ENV: 'test', DATABASE_URL: url.toString(), MQTT_ENABLED: 'false' }), { logger: false });
    await app.init();
  }, 30_000);

  afterAll(async () => {
    await app?.close();
    await pool?.end();
    await admin?.query(`DROP DATABASE IF EXISTS ${dbName} WITH (FORCE)`);
    await admin?.end();
  });

  it('kolejka ma własny schemat i harmonogram zadań cyklicznych', async () => {
    const schedules = await pool.query<{ name: string }>(`SELECT name FROM pgboss.schedule ORDER BY name`);
    expect(schedules.rows.map((r) => r.name)).toEqual([
      'auth.purge',
      'commands.timeout-sweep',
      'rentals.expire-sweep',
      'telemetry.partitions',
      'telemetry.purge',
    ]);
  });

  it('bez potwierdzenia odblokowania zadanie pg-boss kończy przejazd jako UNLOCK_FAILED', async () => {
    // Klient z akceptacją dokumentów nie jest tu potrzebny: zaczynamy przejazd przez serwis z pominięciem warunków klienta.
    const user = await pool.query<{ id: string }>(`INSERT INTO users (phone, name) VALUES ('+48500900900', 'Ewa') RETURNING id`);
    const userId = user.rows[0]!.id;
    const service = app.get(RentalsService) as unknown as { ensureCustomerCanRent: () => Promise<void> };
    service.ensureCustomerCanRent = () => Promise.resolve();
    const scooterId = (await pool.query<{ id: string }>(`SELECT id FROM scooters LIMIT 1`)).rows[0]!.id;

    const { rental } = await app.get(RentalsService).start(userId, scooterId);
    const jobs = await pool.query(`SELECT name, state FROM pgboss.job WHERE name = 'command.ack-timeout'`);
    expect(jobs.rows).toEqual([{ name: 'command.ack-timeout', state: 'created' }]);

    await expect
      .poll(async () => (await pool.query(`SELECT state FROM rentals WHERE id = $1`, [rental.id])).rows[0].state, { timeout: 20_000, interval: 500 })
      .toBe('UNLOCK_FAILED');
    const command = await pool.query(`SELECT status FROM scooter_commands WHERE rental_id = $1`, [rental.id]);
    expect(command.rows).toEqual([{ status: 'TIMEOUT' }]);
  }, 30_000);
});
