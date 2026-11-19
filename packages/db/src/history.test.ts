/**
 * Test generatora danych historycznych (ADR 0075) na prawdziwym PostgreSQL: dwie świeże bazy po migracjach i danych
 * startowych, generator na 3 dobach, kontrola spójności, determinizm (to samo ziarno daje te same sumy) i blokady
 * (produkcja, baza z przejazdami). Bazy powstają na serwerze z DATABASE_URL i znikają na końcu.
 */
import { randomUUID } from 'node:crypto';
import { Pool } from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { checkHistory, historyFingerprint } from './history/checks.js';
import {
  generateHistory,
  HISTORY_PHONE_PREFIX,
  HistoryRefusedError,
  type HistoryOptions,
} from './history/generator.js';
import { runMigrations } from './migrator.js';
import type { PlacesFile } from './places.js';
import { seedDatabase } from './seed.js';

const adminUrl = process.env.DATABASE_URL;
const suffix = randomUUID().slice(0, 8);
const names = [`hulajnogi_history_${suffix}_a`, `hulajnogi_history_${suffix}_b`];

// Syntetyczne współrzędne testowe (nie są to prawdziwe miejsca w Rybniku).
const places: PlacesFile = {
  city: 'Test',
  note: '',
  serviceArea: { code: 'AREA-TEST', name: 'Obszar testowy', centerPlace: 'P-01', radiusM: 3000 },
  places: [
    { code: 'P-01', name: 'Centrum', query: '', type: 'PARKING', radiusM: 50, capacity: 20, lat: 50.0, lon: 18.5 },
    { code: 'P-02', name: 'Północ', query: '', type: 'PARKING', radiusM: 50, capacity: 20, lat: 50.01, lon: 18.5 },
    { code: 'P-03', name: 'Wschód', query: '', type: 'PARKING', radiusM: 50, capacity: 20, lat: 50.004, lon: 18.512 },
    {
      code: 'S-01',
      name: 'Wolna strefa',
      query: '',
      type: 'SLOW',
      radiusM: 200,
      speedLimitKmh: 10,
      lat: 50.0,
      lon: 18.5,
    },
    { code: 'Z-01', name: 'Park', query: '', type: 'NO_RIDE', radiusM: 70, lat: 50.006, lon: 18.505 },
  ],
};

const OPTIONS: HistoryOptions = { days: 3, ridesPerDay: 80, seed: 7 };

describe.skipIf(!adminUrl)('generator danych historycznych (ADR 0075)', () => {
  let admin: Pool;
  const pools: Pool[] = [];

  beforeAll(async () => {
    admin = new Pool({ connectionString: adminUrl });
    for (const name of names) {
      await admin.query(`CREATE DATABASE ${name}`);
      const url = new URL(adminUrl!);
      url.pathname = `/${name}`;
      const pool = new Pool({ connectionString: url.toString() });
      pool.on('error', () => undefined);
      pools.push(pool);
      await runMigrations(pool);
      await seedDatabase(pool, {
        places,
        fleetSize: 14,
        sampleRentals: 0,
        sampleOperations: true,
        admin: { email: 'a@test.local', name: 'Piotr Mazur', passwordHash: 'x' },
        staff: [
          { email: 'd@test.local', name: 'Marta Wiśniewska', role: 'Dyspozytor', passwordHash: 'x' },
          { email: 's@test.local', name: 'Tomasz Nowak', role: 'Serwisant', passwordHash: 'x' },
        ],
        documents: [
          { slug: 'regulamin', name: 'Regulamin', consentType: 'TERMS', title: 'Regulamin', bodyMd: 'Treść.' },
          { slug: 'polityka', name: 'Polityka', consentType: 'PRIVACY', title: 'Polityka', bodyMd: 'Treść.' },
        ],
      });
    }
  }, 120_000);

  afterAll(async () => {
    for (const pool of pools) await pool.end();
    for (const name of names) await admin?.query(`DROP DATABASE IF EXISTS ${name} WITH (FORCE)`);
    await admin?.end();
  });

  it('generuje 3 doby historii, która przechodzi kontrolę spójności', async () => {
    const pool = pools[0]!;
    const summary = await generateHistory(pool, OPTIONS);
    expect(summary.days).toBe(3);
    expect(summary.tariff?.version).toBe(1);
    expect(summary.tariff?.validFrom.getTime()).toBe(summary.windowFrom.getTime());
    expect(summary.rows.rentals).toBeGreaterThan(100);
    expect(summary.rows.receipts).toBeGreaterThan(100);
    expect(summary.rows.scooter_status_history).toBeGreaterThan(summary.rows.rentals!);

    const failed = (await checkHistory(pool)).filter((c) => c.violations > 0);
    expect(failed).toEqual([]);

    const { rows } = await pool.query<Record<string, number>>(
      `
      SELECT (SELECT count(*)::int FROM users WHERE phone LIKE '${HISTORY_PHONE_PREFIX}%') AS customers,
             (SELECT count(*)::int FROM users WHERE phone LIKE '${HISTORY_PHONE_PREFIX}%' AND created_at >= $1) AS registered_in_window,
             (SELECT count(*)::int FROM consents c JOIN users u ON u.id = c.user_id
               WHERE u.phone LIKE '${HISTORY_PHONE_PREFIX}%' AND c.type = 'TERMS' AND c.page_version_id IS NOT NULL) AS terms,
             (SELECT count(*)::int FROM rentals WHERE started_at < $1 OR ended_at >= $2) AS outside_window,
             (SELECT count(*)::int FROM rentals r WHERE r.tariff_id <> (SELECT id FROM tariffs WHERE version = 1)) AS other_tariff,
             (SELECT count(*)::int FROM rental_events WHERE type = 'ZONE_ENTERED') AS zone_entries,
             (SELECT count(*)::int FROM scooter_status_history WHERE valid_to <= $2) AS closed_intervals,
             (SELECT count(*)::int FROM v_tariff_versions WHERE state = 'CURRENT' AND version = 1) AS current_tariff`,
      [summary.windowFrom, summary.windowTo],
    );
    const r = rows[0]!;
    expect(r.customers).toBeGreaterThan(0);
    expect(r.registered_in_window).toBeGreaterThan(0);
    expect(r.terms).toBe(r.customers);
    expect(r.outside_window).toBe(0);
    expect(r.other_tariff).toBe(0);
    expect(r.zone_entries).toBeGreaterThan(0);
    expect(r.closed_intervals).toBeGreaterThan(0);
    expect(r.current_tariff).toBe(1);

    // Raporty widzą dane generatora: przychód z paragonów i wykorzystanie z historii stanów.
    const revenue = await pool.query<{ gross: string }>(
      'SELECT COALESCE(sum(gross), 0) AS gross FROM fn_report_revenue_sales_series($1, $2, $3)',
      [summary.windowFrom, summary.windowTo, 'day'],
    );
    expect(Number(revenue.rows[0]!.gross)).toBeGreaterThan(0);
    const usage = await pool.query<{ in_ride: string }>(
      'SELECT sum(in_ride_seconds) AS in_ride FROM fn_report_fleet_usage_by_scooter($1, $2)',
      [summary.windowFrom, summary.windowTo],
    );
    expect(Number(usage.rows[0]!.in_ride)).toBeGreaterThan(0);
  }, 120_000);

  it('to samo ziarno daje te same dane na drugiej świeżej bazie', async () => {
    await generateHistory(pools[1]!, OPTIONS);
    expect(await historyFingerprint(pools[1]!)).toEqual(await historyFingerprint(pools[0]!));
  }, 120_000);

  it('odmawia w produkcji i na bazie z przejazdami', async () => {
    await expect(generateHistory(pools[1]!, { ...OPTIONS, nodeEnv: 'production' })).rejects.toThrow(
      HistoryRefusedError,
    );
    await expect(generateHistory(pools[0]!, OPTIONS)).rejects.toThrow(/generatora historii/);
    // Odmowa niczego nie zmienia.
    expect((await checkHistory(pools[0]!)).filter((c) => c.violations > 0)).toEqual([]);
  });
});
