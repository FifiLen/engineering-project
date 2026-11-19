/**
 * Testy integracyjne na prawdziwym PostgreSQL z PostGIS. Każde uruchomienie tworzy
 * tymczasową bazę i usuwa ją na końcu. Wymagają DATABASE_URL (w CI: kontener postgis).
 */
import { randomUUID } from 'node:crypto';
import { copyFileSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  OPEN_RENTAL_STATES,
  PERMISSIONS,
  priceRental,
  RENTAL_STATES,
  RentalStateMachine,
  RETURN_BLOCKERS,
  type RentalState,
} from '@hulajnogi/core';
import { Pool } from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createDb } from './client.js';
import { migrationsDir, runMigrations } from './migrator.js';
import type { PlacesFile } from './places.js';
import { DrizzleZoneRepository } from './repositories/zones.repository.js';
import { rethrowDatabaseRule } from './repositories/errors.js';
import { DEV_NOTIFICATION_TEMPLATES, DEV_SPARE_PARTS, DEV_TARIFF, seedDatabase } from './seed.js';

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
    // Najpierw sama migracja 0001 z danymi w starym kształcie, żeby sprawdzić przeniesienie danych w 0002.
    const dir = mkdtempSync(join(tmpdir(), 'mig-'));
    copyFileSync(join(migrationsDir, '0001_init.sql'), join(dir, '0001_init.sql'));
    expect((await runMigrations(pool, dir)).applied).toEqual(['0001_init.sql']);
    await pool.query(
      `INSERT INTO staff (email, name, role, password_hash) VALUES
         ('admin@old.local', 'A', 'ADMIN', 'x'), ('disp@old.local', 'D', 'DISPATCHER', 'x'), ('serv@old.local', 'S', 'SERVICE', 'x')`,
    );
    await pool.query(`INSERT INTO scooters (number, serial_number, variant) VALUES (900, 'OLD-900', 'GRAFIT')`);

    const first = await runMigrations(pool);
    expect(first.applied).toEqual([
      '0002_admin_modules.sql',
      '0003_fleet_lists.sql',
      '0004_accounts_access.sql',
      '0005_rentals.sql',
      '0006_zones.sql',
      '0007_payments.sql',
      '0008_operations.sql',
      '0009_operations_fixes.sql',
      '0010_towing_fee_outside_vat.sql',
      '0011_content_documents.sql',
      '0012_iteration7_fixes.sql',
      '0013_reports.sql',
    ]);
    const second = await runMigrations(pool);
    expect(second.applied).toEqual([]);

    // Szablony wszystkich kodów z rejestru po samym `db:migrate` (0009): te same treści co dane startowe, wersja 1.
    const templates = await pool.query(
      `SELECT t.code, t.channel::text AS channel, t.title, t.body, t.description, t.version,
              (SELECT count(*)::int FROM notification_template_versions v WHERE v.template_id = t.id) AS versions
       FROM notification_templates t ORDER BY t.code`,
    );
    expect(templates.rows).toEqual(
      [...DEV_NOTIFICATION_TEMPLATES]
        .sort((a, b) => a.code.localeCompare(b.code))
        .map((t) => ({ ...t, version: 1, versions: 1 })),
    );

    const roles = await pool.query<{ email: string; roles: string[] }>(
      `SELECT email, roles FROM v_staff_overview WHERE email LIKE '%@old.local' ORDER BY email`,
    );
    expect(roles.rows).toEqual([
      { email: 'admin@old.local', roles: ['Administrator'] },
      { email: 'disp@old.local', roles: ['Dyspozytor'] },
      { email: 'serv@old.local', roles: ['Serwisant'] },
    ]);
    const model = await pool.query<{ code: string }>(
      `SELECT m.code FROM scooters s JOIN scooter_models m ON m.id = s.model_id WHERE s.number = 900`,
    );
    expect(model.rows).toEqual([{ code: 'BASE' }]);

    await pool.query(`DELETE FROM scooters WHERE number = 900`);
    // W jednej transakcji: po usunięciu samych ról zostaliby aktywni operatorzy bez roles.manage (0004).
    await pool.query(
      `DELETE FROM staff_roles WHERE staff_id IN (SELECT id FROM staff WHERE email LIKE '%@old.local');
       DELETE FROM staff WHERE email LIKE '%@old.local'`,
    );
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

  it('ma co najmniej 30 tabel oraz widoki, funkcje i procedury (wymaganie 8)', async () => {
    const { rows } = await pool.query<{ tables: number; views: number; functions: number; procedures: number }>(
      `SELECT
         (SELECT count(*)::int FROM pg_class c
           WHERE c.relnamespace = 'public'::regnamespace AND c.relkind IN ('r', 'p') AND NOT c.relispartition
             AND c.relname NOT IN ('spatial_ref_sys', 'schema_migrations')) AS tables,
         (SELECT count(*)::int FROM pg_views WHERE schemaname = 'public' AND viewname LIKE 'v\\_%') AS views,
         (SELECT count(*)::int FROM pg_proc WHERE pronamespace = 'public'::regnamespace
           AND prokind = 'f' AND proname LIKE 'fn\\_%') AS functions,
         (SELECT count(*)::int FROM pg_proc WHERE pronamespace = 'public'::regnamespace
           AND prokind = 'p' AND proname LIKE 'sp\\_%') AS procedures`,
    );
    expect(rows[0]).toEqual({ tables: 58, views: 79, functions: 58, procedures: 24 });
  });

  it('fn_zones_at_point zwraca strefy od najbardziej restrykcyjnej', async () => {
    const { rows } = await pool.query<{ code: string }>(`SELECT code FROM fn_zones_at_point(18.5, 50.0)`);
    expect(rows.map((r) => r.code)).toEqual(['S-01', 'P-01', 'AREA-TEST']);
  });

  it('fn_nearest_scooters zwraca dostępne hulajnogi w promieniu, od najbliższej, z progiem baterii', async () => {
    const { rows } = await pool.query<{ number: number; battery_pct: number; distance_m: number }>(
      `SELECT number, battery_pct, distance_m FROM fn_nearest_scooters(18.5, 50.0, 2000, 50, 30)`,
    );
    expect(rows.length).toBeGreaterThan(0);
    const distances = rows.map((r) => r.distance_m);
    expect(distances).toEqual([...distances].sort((a, b) => a - b));
    expect(rows.every((r) => r.battery_pct >= 30 && r.distance_m <= 2000)).toBe(true);
  });

  it('sp_expire_reservations wygasza przeterminowane rezerwacje i zwalnia hulajnogi', async () => {
    const user = await pool.query<{ id: string }>(`INSERT INTO users (phone) VALUES ('+48500000010') RETURNING id`);
    await pool.query(`UPDATE scooters SET status = 'RESERVED' WHERE number = 2`);
    const rental = await pool.query<{ id: string }>(
      `INSERT INTO rentals (user_id, scooter_id, tariff_id, state, reserved_at, reservation_expires_at)
       SELECT $1, (SELECT id FROM scooters WHERE number = 2), (SELECT id FROM tariffs WHERE version = 1),
              'RESERVED', now() - interval '20 minutes', now() - interval '10 minutes'
       RETURNING id`,
      [user.rows[0]!.id],
    );
    const call = await pool.query<{ expired_count: number }>(`CALL sp_expire_reservations(NULL)`);
    expect(call.rows[0]!.expired_count).toBe(1);

    const state = await pool.query(
      `SELECT r.state, s.status, (SELECT count(*)::int FROM rental_events e WHERE e.rental_id = r.id AND e.to_state = 'EXPIRED') AS events
       FROM rentals r JOIN scooters s ON s.id = r.scooter_id WHERE r.id = $1`,
      [rental.rows[0]!.id],
    );
    expect(state.rows[0]).toEqual({ state: 'EXPIRED', status: 'AVAILABLE', events: 1 });
    expect((await pool.query(`CALL sp_expire_reservations(NULL)`)).rows[0].expired_count).toBe(0);
  });

  it('v_wallet_balances wykrywa rozjazd salda z księgą, a sp_rebuild_wallet_balances go naprawia', async () => {
    const user = await pool.query<{ id: string }>(`INSERT INTO users (phone) VALUES ('+48500000011') RETURNING id`);
    const userId = user.rows[0]!.id;
    // Portfel zakłada wyzwalacz przy rejestracji (0005); tu psujemy pamięć podręczną salda.
    await pool.query(`UPDATE wallets SET balance = 500 WHERE user_id = $1`, [userId]);
    await pool.query(
      `INSERT INTO wallet_ledger (user_id, type, amount, balance_after) VALUES ($1, 'TOPUP', 2000, 2000), ($1, 'ADJUSTMENT', -300, 1700)`,
      [userId],
    );
    const before = await pool.query(
      `SELECT cached_balance, ledger_balance, out_of_sync FROM v_wallet_balances WHERE user_id = $1`,
      [userId],
    );
    expect(before.rows[0]).toEqual({ cached_balance: '500', ledger_balance: '1700', out_of_sync: true });

    const fixed = await pool.query<{ fixed_count: number }>(`CALL sp_rebuild_wallet_balances(NULL)`);
    expect(fixed.rows[0]!.fixed_count).toBe(1);
    const after = await pool.query(
      `SELECT fn_wallet_balance($1) AS balance, (SELECT out_of_sync FROM v_wallet_balances WHERE user_id = $1)`,
      [userId],
    );
    expect(after.rows[0]).toEqual({ balance: '1700', out_of_sync: false });
  });

  it('sp_anonymize_user odmawia przy otwartym przejeździe i usuwa dane osobowe', async () => {
    const busy = await pool.query<{ id: string }>(
      `SELECT user_id AS id FROM rentals WHERE state = 'UNLOCKING' LIMIT 1`,
    );
    await expect(pool.query(`CALL sp_anonymize_user($1)`, [busy.rows[0]!.id])).rejects.toThrow(/USER_HAS_OPEN_RENTAL/);

    const user = await pool.query<{ id: string }>(
      `INSERT INTO users (phone, email, name) VALUES ('+48500000012', 'u12@test.local', 'Jan') RETURNING id`,
    );
    const userId = user.rows[0]!.id;
    await pool.query(
      `INSERT INTO sessions (user_id, refresh_token_hash, expires_at) VALUES ($1, 'h12', now() + interval '1 day')`,
      [userId],
    );
    await pool.query(`CALL sp_anonymize_user($1)`, [userId]);
    const after = await pool.query(
      `SELECT phone, email, name, status, (SELECT revoked_at IS NOT NULL FROM sessions WHERE user_id = u.id) AS revoked
       FROM users u WHERE id = $1`,
      [userId],
    );
    expect(after.rows[0]).toEqual({ phone: null, email: null, name: null, status: 'DELETED', revoked: true });
    await expect(pool.query(`CALL sp_anonymize_user($1)`, [userId])).rejects.toThrow(/USER_NOT_FOUND/);
  });

  it('uprawnienia operatora wynikają z ról i znikają po dezaktywacji', async () => {
    const admin = await pool.query<{ ok: boolean }>(
      `SELECT fn_staff_has_permission(id, 'roles.manage') AS ok FROM staff WHERE email = 'a@test.local'`,
    );
    expect(admin.rows[0]!.ok).toBe(true);

    const staff = await pool.query<{ id: string }>(
      `INSERT INTO staff (email, name, password_hash) VALUES ('d@test.local', 'D', 'x') RETURNING id`,
    );
    const staffId = staff.rows[0]!.id;
    await pool.query(`INSERT INTO staff_roles (staff_id, role_id) SELECT $1, id FROM roles WHERE name = 'Dyspozytor'`, [
      staffId,
    ]);
    const check = (code: string) =>
      pool
        .query<{ ok: boolean }>(`SELECT fn_staff_has_permission($1, $2) AS ok`, [staffId, code])
        .then((r) => r.rows[0]!.ok);
    expect(await check('rentals.manage')).toBe(true);
    expect(await check('roles.manage')).toBe(false);

    await pool.query(`UPDATE staff SET active = false WHERE id = $1`, [staffId]);
    expect(await check('rentals.manage')).toBe(false);
    await expect(pool.query(`DELETE FROM roles WHERE name = 'Dyspozytor'`)).rejects.toThrow(/staff_roles_role_id_fkey/);
  });

  it('sp_ensure_telemetry_partitions przenosi dane z partycji domyślnej i jest idempotentna', async () => {
    const rental = await pool.query<{ id: string; scooter_id: string }>(
      `SELECT id, scooter_id FROM rentals WHERE state = 'UNLOCKING' LIMIT 1`,
    );
    const { id: rentalId, scooter_id: scooterId } = rental.rows[0]!;
    // Trzy punkty co ok. 111 m na północ (0,001° szerokości).
    await pool.query(
      `INSERT INTO telemetry (scooter_id, recorded_at, position, battery_pct, speed_kmh, rental_id)
       SELECT $1, now() - make_interval(secs => 30 - i * 10), ST_SetSRID(ST_MakePoint(18.5, 50.0 + i * 0.001), 4326), 80, 12, $2
       FROM generate_series(0, 2) AS i`,
      [scooterId, rentalId],
    );
    const today = `(now() AT TIME ZONE 'UTC')::date`;
    const created = await pool.query<{ created_count: number }>(
      `CALL sp_ensure_telemetry_partitions(${today}, 2, NULL)`,
    );
    expect(created.rows[0]!.created_count).toBe(2);
    const again = await pool.query<{ created_count: number }>(`CALL sp_ensure_telemetry_partitions(${today}, 2, NULL)`);
    expect(again.rows[0]!.created_count).toBe(0);

    const parts = await pool.query<{ part: string; n: number }>(
      `SELECT tableoid::regclass::text AS part, count(*)::int AS n FROM telemetry WHERE rental_id = $1 GROUP BY 1`,
      [rentalId],
    );
    expect(parts.rows).toHaveLength(1);
    expect(parts.rows[0]!.part).toMatch(/^telemetry_\d{8}$/);
    const distance = await pool.query<{ m: number }>(`SELECT fn_rental_distance_m($1) AS m`, [rentalId]);
    expect(distance.rows[0]!.m).toBeGreaterThan(215);
    expect(distance.rows[0]!.m).toBeLessThan(230);
  });

  it('zmiana treści zwiększa licznik, a dokument ma najwyżej jedną obowiązującą wersję', async () => {
    const revision = () =>
      pool.query<{ r: string }>(`SELECT fn_content_revision() AS r`).then((r) => Number(r.rows[0]!.r));
    const before = await revision();
    const page = await pool.query<{ id: string }>(
      `INSERT INTO content_pages (slug, name, consent_type) VALUES ('regulamin', 'Regulamin', 'TERMS') RETURNING id`,
    );
    const pageId = page.rows[0]!.id;
    await pool.query(
      `INSERT INTO content_page_versions (page_id, version_no, title, body_md, status, published_at)
       VALUES ($1, 1, 'Regulamin', 'Treść', 'PUBLISHED', now())`,
      [pageId],
    );
    expect(await revision()).toBeGreaterThan(before);
    await expect(
      pool.query(
        `INSERT INTO content_page_versions (page_id, version_no, title, body_md, status, published_at)
         VALUES ($1, 2, 'Regulamin', 'Nowa treść', 'PUBLISHED', now())`,
        [pageId],
      ),
    ).rejects.toThrow(/content_page_versions_one_published/);
    const current = await pool.query(`SELECT slug, version_no FROM v_current_documents`);
    expect(current.rows).toEqual([{ slug: 'regulamin', version_no: 1 }]);
  });

  it('hulajnoga ma najwyżej jedno otwarte zadanie serwisowe danego rodzaju', async () => {
    const insert = () =>
      pool.query(
        `INSERT INTO service_tasks (scooter_id, type) SELECT id, 'BATTERY_SWAP' FROM scooters WHERE number = 3`,
      );
    await insert();
    await expect(insert()).rejects.toThrow(/service_tasks_one_open_per_type/);
    const fleet = await pool.query(`SELECT open_service_tasks FROM v_fleet_status WHERE number = 3`);
    expect(fleet.rows[0]).toEqual({ open_service_tasks: '1' });
  });

  it('katalog uprawnień w bazie zgadza się z katalogiem w packages/core', async () => {
    const { rows } = await pool.query<{ code: string }>(`SELECT code FROM permissions ORDER BY code`);
    expect(rows.map((r) => r.code)).toEqual([...PERMISSIONS].sort());
  });

  it('typ rental_state i indeksy jednego otwartego przejazdu zgadzają się z maszyną stanów', async () => {
    const states = await pool.query<{ s: string }>(`SELECT unnest(enum_range(NULL::rental_state))::text AS s`);
    expect(states.rows.map((r) => r.s)).toEqual([...RENTAL_STATES]);

    const { rows } = await pool.query<{ indexdef: string }>(
      `SELECT indexdef FROM pg_indexes WHERE indexname IN ('rentals_one_open_per_scooter', 'rentals_one_open_per_user')`,
    );
    expect(rows).toHaveLength(2);
    for (const { indexdef } of rows) {
      const inIndex = RENTAL_STATES.filter((state) => indexdef.includes(`'${state}'`));
      expect(inIndex).toEqual([...OPEN_RENTAL_STATES]);
    }
  });

  it('każde przejście stanu zapisane w bazie (także przez procedury) jest dozwolone w core', async () => {
    const { rows } = await pool.query<{ from_state: RentalState; to_state: RentalState }>(
      `SELECT DISTINCT from_state::text, to_state::text FROM rental_events WHERE type = 'STATE_CHANGED'`,
    );
    expect(rows.length).toBeGreaterThan(0);
    for (const { from_state, to_state } of rows) expect(RentalStateMachine.isAllowed(from_state, to_state)).toBe(true);
  });

  it('DrizzleZoneRepository zwraca strefy w punkcie przez fn_zones_at_point', async () => {
    const zones = await new DrizzleZoneRepository(createDb(pool)).findAt({ lat: 50.0, lon: 18.5 });
    expect(zones.map((z) => z.code)).toEqual(['S-01', 'P-01', 'AREA-TEST']);
    expect(zones[0]).toMatchObject({ type: 'SLOW', speedLimitKmh: 10 });
    expect(await new DrizzleZoneRepository(createDb(pool)).findAt({ lat: 52.2, lon: 21.0 })).toEqual([]);
  });

  it('nie pozwala zostawić aktywnych operatorów bez uprawnienia roles.manage (0004)', async () => {
    const adminId = await pool
      .query<{ id: string }>(`SELECT id FROM staff WHERE email = 'a@test.local'`)
      .then((r) => r.rows[0]!.id);
    await expect(
      pool.query(
        `DELETE FROM role_permissions WHERE permission_code = 'roles.manage'
           AND role_id = (SELECT id FROM roles WHERE name = 'Administrator')`,
      ),
    ).rejects.toThrow(/LAST_ROLE_MANAGER/);
    await expect(pool.query(`UPDATE staff SET active = false WHERE id = $1`, [adminId])).rejects.toThrow(
      /LAST_ROLE_MANAGER/,
    );
    await expect(pool.query(`DELETE FROM staff_roles WHERE staff_id = $1`, [adminId])).rejects.toThrow(
      /LAST_ROLE_MANAGER/,
    );

    // Wyzwalacz jest odroczony: w jednej transakcji można najpierw nadać rolę następcy, a potem odebrać własną.
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      await client.query(`DELETE FROM staff_roles WHERE staff_id = $1`, [adminId]);
      const next = await client.query<{ id: string }>(
        `INSERT INTO staff (email, name, password_hash) VALUES ('next@test.local', 'N', 'x') RETURNING id`,
      );
      await client.query(
        `INSERT INTO staff_roles (staff_id, role_id) SELECT $1, id FROM roles WHERE name = 'Administrator'`,
        [next.rows[0]!.id],
      );
      await client.query('ROLLBACK');
    } finally {
      client.release();
    }
    const managers = await pool.query(
      `SELECT staff_id FROM v_staff_permissions WHERE permission_code = 'roles.manage'`,
    );
    expect(managers.rows).toEqual([{ staff_id: adminId }]);
  });

  it('zaproszony operator nie ma hasła, ma jedno otwarte zaproszenie i status w v_staff_overview', async () => {
    const staff = await pool.query<{ id: string }>(
      `INSERT INTO staff (email, name) VALUES ('invited@test.local', 'I') RETURNING id`,
    );
    const staffId = staff.rows[0]!.id;
    const invite = (hash: string) =>
      pool.query(
        `INSERT INTO staff_invitations (staff_id, token_hash, expires_at) VALUES ($1, $2, now() + interval '72 hours')`,
        [staffId, hash],
      );
    await invite('h1');
    await expect(invite('h2')).rejects.toThrow(/staff_invitations_one_open/);

    const overview = () =>
      pool
        .query(
          `SELECT status, totp_enabled, invitation_expires_at IS NOT NULL AS invited FROM v_staff_overview WHERE id = $1`,
          [staffId],
        )
        .then((r) => r.rows[0]);
    expect(await overview()).toEqual({ status: 'INVITED', totp_enabled: false, invited: true });

    await pool.query(`UPDATE staff_invitations SET accepted_at = now() WHERE staff_id = $1`, [staffId]);
    await pool.query(
      `UPDATE staff SET password_hash = 'x', totp_secret_enc = 'enc', totp_confirmed_at = now() WHERE id = $1`,
      [staffId],
    );
    expect(await overview()).toEqual({ status: 'ACTIVE', totp_enabled: true, invited: false });
    await expect(pool.query(`UPDATE staff SET totp_secret_enc = NULL WHERE id = $1`, [staffId])).rejects.toThrow(
      /staff_totp_confirmed_has_secret/,
    );
  });

  it('sesje: zastąpiony token jest unieważniony, procedury wylogowują ze wszystkich urządzeń', async () => {
    const user = await pool.query<{ id: string }>(`INSERT INTO users (phone) VALUES ('+48500000004') RETURNING id`);
    const userId = user.rows[0]!.id;
    const first = await pool.query<{ id: string; family_id: string }>(
      `INSERT INTO sessions (user_id, refresh_token_hash, expires_at) VALUES ($1, 's1', now() + interval '30 days')
       RETURNING id, family_id`,
      [userId],
    );
    const { id: firstId, family_id: familyId } = first.rows[0]!;
    const second = await pool.query<{ id: string }>(
      `INSERT INTO sessions (user_id, family_id, refresh_token_hash, expires_at)
       VALUES ($1, $2, 's2', now() + interval '30 days') RETURNING id`,
      [userId, familyId],
    );
    await expect(
      pool.query(`UPDATE sessions SET replaced_by = $1 WHERE id = $2`, [second.rows[0]!.id, firstId]),
    ).rejects.toThrow(/sessions_replaced_is_revoked/);
    await pool.query(`UPDATE sessions SET replaced_by = $1, revoked_at = now() WHERE id = $2`, [
      second.rows[0]!.id,
      firstId,
    ]);

    const active = () =>
      pool
        .query<{ n: string }>(`SELECT active_sessions AS n FROM v_user_activity WHERE id = $1`, [userId])
        .then((r) => Number(r.rows[0]!.n));
    expect(await active()).toBe(1);
    const revoked = await pool.query<{ revoked_count: number }>(`CALL sp_revoke_user_sessions($1, NULL)`, [userId]);
    expect(revoked.rows[0]!.revoked_count).toBe(1);
    expect(await active()).toBe(0);

    const staffId = await pool
      .query<{ id: string }>(`SELECT id FROM staff WHERE email = 'a@test.local'`)
      .then((r) => r.rows[0]!.id);
    await pool.query(
      `INSERT INTO staff_sessions (staff_id, refresh_token_hash, expires_at) VALUES ($1, 'p1', now() + interval '12 hours')`,
      [staffId],
    );
    const staffActive = await pool.query(`SELECT active_sessions FROM v_staff_overview WHERE id = $1`, [staffId]);
    expect(staffActive.rows[0]).toEqual({ active_sessions: '1' });
    const staffRevoked = await pool.query<{ revoked_count: number }>(`CALL sp_revoke_staff_sessions($1, NULL)`, [
      staffId,
    ]);
    expect(staffRevoked.rows[0]!.revoked_count).toBe(1);
  });

  it('blokada klienta wymaga daty i powodu', async () => {
    const user = await pool.query<{ id: string }>(`INSERT INTO users (phone) VALUES ('+48500000005') RETURNING id`);
    const userId = user.rows[0]!.id;
    await expect(pool.query(`UPDATE users SET status = 'BLOCKED' WHERE id = $1`, [userId])).rejects.toThrow(
      /users_block_consistent/,
    );
    await pool.query(
      `UPDATE users SET status = 'BLOCKED', blocked_at = now(), blocked_reason = 'UNPAID_BALANCE' WHERE id = $1`,
      [userId],
    );
    const row = await pool.query(`SELECT status, blocked_reason FROM v_user_activity WHERE id = $1`, [userId]);
    expect(row.rows[0]).toEqual({ status: 'BLOCKED', blocked_reason: 'UNPAID_BALANCE' });
    await expect(
      pool.query(`UPDATE users SET status = 'ACTIVE', blocked_reason = NULL WHERE id = $1`, [userId]),
    ).rejects.toThrow(/users_block_consistent/);
  });

  it('po publikacji nowej wersji dokumentu klient ma ją do akceptacji (fn_user_pending_documents)', async () => {
    const page = await pool.query<{ id: string }>(
      `INSERT INTO content_pages (slug, name, consent_type) VALUES ('polityka-prywatnosci', 'Polityka', 'PRIVACY') RETURNING id`,
    );
    const pageId = page.rows[0]!.id;
    const publish = async (no: number, summary: string | null) => {
      await pool.query(
        `UPDATE content_page_versions SET status = 'ARCHIVED' WHERE page_id = $1 AND status = 'PUBLISHED'`,
        [pageId],
      );
      const v = await pool.query<{ id: string }>(
        `INSERT INTO content_page_versions (page_id, version_no, title, body_md, change_summary, status, published_at)
         VALUES ($1, $2, 'Polityka prywatności', 'Treść', $3, 'PUBLISHED', now()) RETURNING id`,
        [pageId, no, summary],
      );
      return v.rows[0]!.id;
    };
    const v1 = await publish(1, null);
    const user = await pool.query<{ id: string }>(`INSERT INTO users (phone) VALUES ('+48500000006') RETURNING id`);
    const userId = user.rows[0]!.id;
    const consent = () =>
      pool.query(
        `INSERT INTO consents (user_id, type, document_version, page_version_id) VALUES ($1, 'PRIVACY', '1', $2)`,
        [userId, v1],
      );
    await consent();
    await expect(consent()).rejects.toThrow(/consents_one_active_per_version/);

    const pending = () =>
      pool
        .query(`SELECT consent_type, version_no, change_summary FROM fn_user_pending_documents($1)`, [userId])
        .then((r) => r.rows.filter((d) => d.consent_type === 'PRIVACY'));
    expect(await pending()).toEqual([]);

    await publish(2, 'Nowy odbiorca danych');
    expect(await pending()).toEqual([
      { consent_type: 'PRIVACY', version_no: 2, change_summary: 'Nowy odbiorca danych' },
    ]);
    const view = await pool.query(
      `SELECT version_no, current_version_no, is_current FROM v_user_consents WHERE user_id = $1 AND type = 'PRIVACY'`,
      [userId],
    );
    expect(view.rows).toEqual([{ version_no: 1, current_version_no: 2, is_current: false }]);
  });

  it('v_roles_overview liczy uprawnienia i aktywnych operatorów, v_audit_log dołącza autora', async () => {
    const roles = await pool.query<{ name: string; permissions_count: string }>(
      `SELECT name, permissions_count FROM v_roles_overview WHERE name = 'Administrator'`,
    );
    expect(Number(roles.rows[0]!.permissions_count)).toBe(PERMISSIONS.length);

    await pool.query(
      `INSERT INTO audit_log (staff_id, action, entity_type, entity_id, data)
       SELECT id, 'scooter.updated', 'scooter', gen_random_uuid(), '{"changes": {"firmware": ["v1", "v2"]}}'
       FROM staff WHERE email = 'a@test.local'`,
    );
    const audit = await pool.query(`SELECT staff_email, action FROM v_audit_log ORDER BY id DESC LIMIT 1`);
    expect(audit.rows[0]).toEqual({ staff_email: 'a@test.local', action: 'scooter.updated' });
  });

  it('portfel powstaje razem z klientem, a usunięcie konta blokuje saldo różne od 0 (0005)', async () => {
    const user = await pool.query<{ id: string }>(`INSERT INTO users (phone) VALUES ('+48500000020') RETURNING id`);
    const userId = user.rows[0]!.id;
    const wallet = await pool.query(`SELECT balance FROM wallets WHERE user_id = $1`, [userId]);
    expect(wallet.rows).toEqual([{ balance: '0' }]);
    const missing = await pool.query(
      `SELECT count(*)::int AS n FROM users u WHERE NOT EXISTS (SELECT 1 FROM wallets w WHERE w.user_id = u.id)`,
    );
    expect(missing.rows[0]).toEqual({ n: 0 });

    await pool.query(
      `INSERT INTO wallet_ledger (user_id, type, amount, balance_after) VALUES ($1, 'TOPUP', 500, 500)`,
      [userId],
    );
    await expect(pool.query(`CALL sp_anonymize_user($1)`, [userId])).rejects.toThrow(/WALLET_BALANCE_NOT_ZERO/);
    await pool.query(
      `INSERT INTO wallet_ledger (user_id, type, amount, balance_after) VALUES ($1, 'REFUND', -500, 0)`,
      [userId],
    );
    await pool.query(`CALL sp_anonymize_user($1)`, [userId]);
    const after = await pool.query(`SELECT status FROM users WHERE id = $1`, [userId]);
    expect(after.rows[0]).toEqual({ status: 'DELETED' });
  });

  it('przejazd ma najwyżej jedną komendę w toku, a oś czasu łączy zdarzenia z komendami (0005)', async () => {
    const user = await pool.query<{ id: string }>(
      `INSERT INTO users (phone, name) VALUES ('+48500000021', 'Ola') RETURNING id`,
    );
    const rental = await pool.query<{ id: string; scooter_id: string }>(
      `INSERT INTO rentals (user_id, scooter_id, tariff_id, state, started_at)
       SELECT $1, (SELECT id FROM scooters WHERE number = 5), (SELECT id FROM tariffs WHERE version = 1),
              'ACTIVE', now() - interval '90 seconds'
       RETURNING id, scooter_id`,
      [user.rows[0]!.id],
    );
    const { id: rentalId, scooter_id: scooterId } = rental.rows[0]!;
    // Hulajnoga offline sama w sobie oznacza problem otwartego przejazdu.
    await pool.query(`UPDATE scooters SET online = true WHERE id = $1`, [scooterId]);
    await pool.query(
      `INSERT INTO rental_events (rental_id, type, from_state, to_state, created_at)
       VALUES ($1, 'STATE_CHANGED', 'UNLOCKING', 'ACTIVE', now() - interval '90 seconds')`,
      [rentalId],
    );
    const command = (type: string) =>
      pool.query(
        `INSERT INTO scooter_commands (scooter_id, rental_id, type, expires_at) VALUES ($1, $2, $3, now() + interval '10 seconds')`,
        [scooterId, rentalId, type],
      );
    await command('LOCK');
    await expect(command('UNLOCK')).rejects.toThrow(/scooter_commands_one_pending_per_rental/);

    const pending = await pool.query(
      `SELECT pending_command, has_problem, elapsed_seconds >= 90 AS elapsed FROM v_rental_details WHERE id = $1`,
      [rentalId],
    );
    expect(pending.rows[0]).toEqual({ pending_command: 'LOCK', has_problem: false, elapsed: true });

    await pool.query(`UPDATE scooter_commands SET status = 'TIMEOUT' WHERE rental_id = $1`, [rentalId]);
    await pool.query(`INSERT INTO rental_events (rental_id, type, data) VALUES ($1, 'PAUSE_FAILED', '{}')`, [rentalId]);
    const problem = await pool.query(`SELECT pending_command, has_problem FROM v_rental_details WHERE id = $1`, [
      rentalId,
    ]);
    expect(problem.rows[0]).toEqual({ pending_command: null, has_problem: true });

    const timeline = await pool.query<{ kind: string; type: string }>(
      `SELECT kind, type FROM v_rental_timeline WHERE rental_id = $1 ORDER BY at, kind`,
      [rentalId],
    );
    expect(timeline.rows).toEqual([
      { kind: 'EVENT', type: 'STATE_CHANGED' },
      { kind: 'COMMAND', type: 'LOCK' },
      { kind: 'EVENT', type: 'PAUSE_FAILED' },
    ]);
  });

  it('historia i statystyki klienta obejmują tylko przejazdy, które się odbyły; trasa z telemetrii (0005)', async () => {
    const user = await pool.query<{ id: string }>(`INSERT INTO users (phone) VALUES ('+48500000022') RETURNING id`);
    const userId = user.rows[0]!.id;
    const insert = (state: string, scooter: number, ride: number, distance: number) =>
      pool.query<{ id: string }>(
        `INSERT INTO rentals (user_id, scooter_id, tariff_id, state, started_at, ended_at, ride_seconds, pause_seconds, distance_m, total_amount,
                              reserved_at, reservation_expires_at)
         SELECT $1, (SELECT id FROM scooters WHERE number = $2), (SELECT id FROM tariffs WHERE version = 1), $3::rental_state,
                now() - interval '1 hour', now() - interval '50 minutes', $4, 60, $5, 1000, now(), now()
         RETURNING id`,
        [userId, scooter, state, ride, distance],
      );
    const ended = await insert('ENDED', 6, 600, 2000);
    await insert('ENDED', 7, 300, 1000);
    await insert('EXPIRED', 8, 0, 0);
    const history = await pool.query(
      `SELECT scooter_number FROM v_user_rental_history WHERE user_id = $1 ORDER BY scooter_number`,
      [userId],
    );
    expect(history.rows).toEqual([{ scooter_number: 6 }, { scooter_number: 7 }]);
    const stats = await pool.query(
      `SELECT rides_count, distance_m, travel_seconds FROM v_user_ride_stats WHERE user_id = $1`,
      [userId],
    );
    expect(stats.rows[0]).toEqual({ rides_count: 2, distance_m: '3000', travel_seconds: '1020' });

    const rentalId = ended.rows[0]!.id;
    const route = () =>
      pool.query(`SELECT ST_NPoints(fn_rental_route($1)) AS points`, [rentalId]).then((r) => r.rows[0].points);
    expect(await route()).toBeNull();
    await pool.query(
      `INSERT INTO telemetry (scooter_id, recorded_at, position, battery_pct, speed_kmh, rental_id)
       SELECT (SELECT id FROM scooters WHERE number = 6), now() - make_interval(secs => g), ST_SetSRID(ST_MakePoint(18.5 + g / 10000.0, 50.0), 4326), 80, 15, $1
       FROM generate_series(1, 3) g`,
      [rentalId],
    );
    expect(await route()).toBe(3);
  });

  it('dane startowe mają przykładowe przejazdy z osią czasu dozwoloną w core i kwotą z wyceny, idempotentnie', async () => {
    const seed = (n: number) =>
      seedDatabase(pool, {
        places,
        fleetSize: 10,
        admin: { email: 'a@test.local', name: 'A', passwordHash: 'x' },
        sampleRentals: n,
      });
    await seed(4);
    await seed(4);
    const rentals = await pool.query<{
      total_amount: string;
      ride_seconds: number;
      pause_seconds: number;
      events: number;
      commands: number;
    }>(
      `SELECT r.total_amount, r.ride_seconds, r.pause_seconds,
              (SELECT count(*)::int FROM rental_events e WHERE e.rental_id = r.id) AS events,
              (SELECT count(*)::int FROM scooter_commands c WHERE c.rental_id = r.id AND c.status = 'ACKED') AS commands
       FROM rentals r JOIN users u ON u.id = r.user_id WHERE u.phone LIKE '+485000001%'`,
    );
    expect(rentals.rows).toHaveLength(4);
    for (const r of rentals.rows) {
      expect(Number(r.total_amount)).toBe(
        priceRental(
          { unlockFee: 300, minuteRate: 80, pauseMinuteRate: 30 },
          { rideSeconds: r.ride_seconds, pauseSeconds: r.pause_seconds, startedAt: new Date() },
        ).total,
      );
      expect(r.commands).toBe(2);
      expect(r.events).toBeGreaterThanOrEqual(5);
    }
  });

  it('sp_purge_expired_sessions usuwa rodziny sesji bez ważnego tokenu i stare zaproszenia (0005)', async () => {
    const user = await pool.query<{ id: string }>(`INSERT INTO users (phone) VALUES ('+48500000023') RETURNING id`);
    const userId = user.rows[0]!.id;
    const old = await pool.query<{ id: string; family_id: string }>(
      `INSERT INTO sessions (user_id, refresh_token_hash, expires_at, revoked_at)
       VALUES ($1, 'p1', now() - interval '40 days', now() - interval '45 days') RETURNING id, family_id`,
      [userId],
    );
    const successor = await pool.query<{ id: string }>(
      `INSERT INTO sessions (user_id, family_id, refresh_token_hash, expires_at) VALUES ($1, $2, 'p2', now() - interval '35 days') RETURNING id`,
      [userId, old.rows[0]!.family_id],
    );
    await pool.query(`UPDATE sessions SET replaced_by = $1 WHERE id = $2`, [successor.rows[0]!.id, old.rows[0]!.id]);
    // Rodzina z jednym wciąż ważnym tokenem zostaje w całości.
    const live = await pool.query<{ family_id: string }>(
      `INSERT INTO sessions (user_id, refresh_token_hash, expires_at) VALUES ($1, 'p3', now() - interval '40 days') RETURNING family_id`,
      [userId],
    );
    await pool.query(
      `INSERT INTO sessions (user_id, family_id, refresh_token_hash, expires_at) VALUES ($1, $2, 'p4', now() + interval '1 day')`,
      [userId, live.rows[0]!.family_id],
    );
    const staff = await pool.query<{ id: string }>(
      `INSERT INTO staff (email, name) VALUES ('purge@test.local', 'P') RETURNING id`,
    );
    await pool.query(
      `INSERT INTO staff_invitations (staff_id, token_hash, expires_at, created_at)
       VALUES ($1, 'i1', now() - interval '31 days', now() - interval '40 days')`,
      [staff.rows[0]!.id],
    );

    const call = await pool.query<{ deleted_count: number }>(`CALL sp_purge_expired_sessions(30, NULL)`);
    expect(call.rows[0]!.deleted_count).toBe(3);
    const left = await pool.query(`SELECT refresh_token_hash FROM sessions WHERE user_id = $1 ORDER BY 1`, [userId]);
    expect(left.rows).toEqual([{ refresh_token_hash: 'p3' }, { refresh_token_hash: 'p4' }]);
    expect((await pool.query(`CALL sp_purge_expired_sessions(30, NULL)`)).rows[0].deleted_count).toBe(0);
  });

  // --- 0006: strefy ------------------------------------------------------------------------------

  /** Kwadrat o boku `size` stopni z lewym dolnym rogiem w (lon, lat); syntetyczne współrzędne testowe. */
  const square = (lon: number, lat: number, size: number) =>
    `ST_Multi(ST_GeomFromText('POLYGON((${lon} ${lat}, ${lon + size} ${lat}, ${lon + size} ${lat + size}, ${lon} ${lat + size}, ${lon} ${lat}))', 4326))`;
  const domainCode = async (query: Promise<unknown>) => {
    try {
      await query;
    } catch (error) {
      try {
        rethrowDatabaseRule(error);
      } catch (mapped) {
        return { code: (mapped as { code?: string }).code, details: (mapped as { details?: unknown }).details };
      }
    }
    return null;
  };

  it('strefy: obszar działania, nakładanie parkowania i niezmienny typ pilnuje baza (0006)', async () => {
    // Poza obszarem działania (promień 3 km od 50.0, 18.5).
    expect(
      await domainCode(
        pool.query(
          `INSERT INTO zones (code, name, type, geom) VALUES ('P-90', 'Daleko', 'PARKING', ${square(18.6, 50.1, 0.001)})`,
        ),
      ),
    ).toEqual({ code: 'ZONE_OUTSIDE_SERVICE_AREA', details: undefined });
    // Część wspólna z P-01 (okrąg 50 m w 50.0, 18.5).
    expect(
      await domainCode(
        pool.query(
          `INSERT INTO zones (code, name, type, geom) VALUES ('P-91', 'Obok', 'PARKING', ${square(18.4999, 49.9999, 0.001)})`,
        ),
      ),
    ).toEqual({ code: 'ZONE_OVERLAP', details: { zoneCode: 'P-01' } });
    // Strefa zakazu może nachodzić na parkowanie (D3), limit tylko w wolnej jeździe.
    await pool.query(
      `INSERT INTO zones (code, name, type, geom) VALUES ('Z-90', 'Zakaz', 'NO_RIDE', ${square(18.4999, 49.9999, 0.001)})`,
    );
    expect(await domainCode(pool.query(`UPDATE zones SET speed_limit_kmh = 10 WHERE code = 'Z-90'`))).toEqual({
      code: 'VALIDATION_FAILED',
      details: undefined,
    });
    expect(await domainCode(pool.query(`UPDATE zones SET type = 'PARKING' WHERE code = 'Z-90'`))).toEqual({
      code: 'ZONE_TYPE_IMMUTABLE',
      details: undefined,
    });
    // Obszar działania: nie zniknie i nie odsłoni aktywnych stref.
    expect(await domainCode(pool.query(`UPDATE zones SET active = false WHERE type = 'SERVICE_AREA'`))).toEqual({
      code: 'SERVICE_AREA_REQUIRED',
      details: undefined,
    });
    expect(
      await domainCode(pool.query(`UPDATE zones SET geom = ${square(18.6, 50.1, 0.01)} WHERE type = 'SERVICE_AREA'`)),
    ).toEqual({ code: 'ZONE_OUTSIDE_SERVICE_AREA', details: { zoneCode: 'P-01' } });
    // Samoprzecięcie odrzuca CHECK z 0001.
    expect(
      await domainCode(
        pool.query(
          `INSERT INTO zones (code, name, type, geom) VALUES ('Z-92', 'Kokardka', 'NO_RIDE',
             ST_Multi(ST_GeomFromText('POLYGON((18.5 50.0, 18.501 50.001, 18.501 50.0, 18.5 50.001, 18.5 50.0))', 4326)))`,
        ),
      ),
    ).toEqual({ code: 'ZONE_INVALID_GEOMETRY', details: undefined });
    await pool.query(`DELETE FROM zones WHERE code = 'Z-90'`);
  });

  it('hulajnoga w strefie zakazu jest niedostępna; strefy w promieniu i najbliższe parkowanie (0006)', async () => {
    const scooter = await pool.query<{ id: string; lon: number; lat: number }>(
      `SELECT id, ST_X(position) AS lon, ST_Y(position) AS lat FROM fn_nearest_scooters(18.5, 50.0, 3000, 1, 0) n
       JOIN scooters s USING (id)`,
    );
    const { id, lon, lat } = scooter.rows[0]!;
    await pool.query(
      `INSERT INTO zones (code, name, type, geom) VALUES ('Z-91', 'Zakaz', 'NO_RIDE', ${square(lon - 0.0005, lat - 0.0005, 0.001)})`,
    );
    const nearby = await pool.query<{ id: string }>(`SELECT id FROM fn_nearest_scooters(18.5, 50.0, 3000, 100, 0)`);
    expect(nearby.rows.map((r) => r.id)).not.toContain(id);
    const near = await new DrizzleZoneRepository(createDb(pool)).near({ lat, lon }, 10);
    expect(near.filter((n) => n.inside).map((n) => n.zone.code)).toContain('Z-91');
    await pool.query(`DELETE FROM zones WHERE code = 'Z-91'`);

    const parking = await new DrizzleZoneRepository(createDb(pool)).nearestParking({ lat: 50.016, lon: 18.5 });
    expect(parking?.code).toBe('P-02');
    // Odległość do granicy strefy (okrąg 50 m w 50.01, 18.5), nie do środka: około 667 − 50 m.
    expect(parking!.distanceM).toBeGreaterThan(600);
    expect(parking!.distanceM).toBeLessThan(630);
    expect(parking!.target[1]).toBeGreaterThan(50.0103);
  });

  it('komendy stref nie blokują pauzy, a usunięcie i lista stref uwzględniają użycie (0006)', async () => {
    const user = await pool.query<{ id: string }>(
      `INSERT INTO users (phone, name) VALUES ('+48500000060', 'Zoe') RETURNING id`,
    );
    const rental = await pool.query<{ id: string; scooter_id: string }>(
      `INSERT INTO rentals (user_id, scooter_id, tariff_id, state, started_at)
       SELECT $1, (SELECT id FROM scooters WHERE number = 7), (SELECT id FROM tariffs WHERE version = 1), 'ACTIVE', now()
       RETURNING id, scooter_id`,
      [user.rows[0]!.id],
    );
    const { id: rentalId, scooter_id: scooterId } = rental.rows[0]!;
    const command = (type: string) =>
      pool.query(`INSERT INTO scooter_commands (scooter_id, rental_id, type) VALUES ($1, $2, $3)`, [
        scooterId,
        rentalId,
        type,
      ]);
    await command('SPEED_LIMIT');
    await command('STOP_GRADUALLY');
    await command('LOCK');
    const details = await pool.query(`SELECT pending_command FROM v_rental_details WHERE id = $1`, [rentalId]);
    expect(details.rows[0]).toEqual({ pending_command: 'LOCK' });

    await pool.query(
      `INSERT INTO zones (code, name, type, geom) VALUES ('Z-93', 'Nowa', 'NO_RIDE', ${square(18.51, 50.01, 0.001)})`,
    );
    const zone = await pool.query<{ id: string; points: number; used: boolean; area_m2: number }>(
      `SELECT id, points, used, area_m2 FROM v_zone_list WHERE code = 'Z-93'`,
    );
    expect(zone.rows[0]).toMatchObject({ points: 4, used: false });
    expect(Number(zone.rows[0]!.area_m2)).toBeGreaterThan(7_000);
    // Przejazd w strefie (stan z wykrywania) blokuje usunięcie i trafia do ostrzeżenia przed zmianą.
    await pool.query(
      `INSERT INTO scooter_zone_presence (scooter_id, zone_id, rental_id, entered_at) VALUES ($1, $2, $3, now())`,
      [scooterId, zone.rows[0]!.id, rentalId],
    );
    const impact = await new DrizzleZoneRepository(createDb(pool)).impact(zone.rows[0]!.id, null);
    expect(impact.map((r) => r.rentalId)).toEqual([rentalId]);
    expect(await domainCode(pool.query(`CALL sp_delete_zone($1)`, [zone.rows[0]!.id]))).toEqual({
      code: 'ZONE_IN_USE',
      details: undefined,
    });
    await pool.query(`DELETE FROM scooter_zone_presence WHERE rental_id = $1`, [rentalId]);
    await pool.query(`CALL sp_delete_zone($1)`, [zone.rows[0]!.id]);
    expect((await pool.query(`SELECT 1 FROM zones WHERE code = 'Z-93'`)).rowCount).toBe(0);
    await pool.query(`UPDATE rentals SET state = 'ENDED', ended_at = now() WHERE id = $1`, [rentalId]);
  });

  // --- 0007: płatności ---------------------------------------------------------------------------

  it('dane startowe rozliczają przykładowe przejazdy z portfela z paragonem (0007)', async () => {
    const rows = await pool.query<{ settlement: string; receipt: string | null; paid: string; total_amount: string }>(
      `SELECT fn_rental_settlement(r.id) AS settlement, fn_rental_paid_amount(r.id) AS paid, r.total_amount,
              (SELECT number FROM receipts WHERE rental_id = r.id AND kind = 'SALE') AS receipt
       FROM rentals r JOIN users u ON u.id = r.user_id WHERE u.phone LIKE '+485000001%'`,
    );
    expect(rows.rows).toHaveLength(4);
    for (const r of rows.rows) {
      expect(r.settlement).toBe('WALLET_PAID');
      expect(r.paid).toBe(r.total_amount);
      expect(r.receipt).toMatch(/^PAR\/\d{4}\/\d{6}$/);
    }
    const sync = await pool.query(
      `SELECT count(*)::int AS n FROM v_wallet_balances b JOIN users u ON u.id = b.user_id
       WHERE u.phone LIKE '+485000001%' AND (b.out_of_sync OR b.ledger_balance <= 0)`,
    );
    expect(sync.rows[0]).toEqual({ n: 0 });
    const receipt = await pool.query(
      `SELECT l.total_amount, l.vat_amount, l.net_amount, l.vat_rate, (SELECT sum(amount) FROM receipt_items i WHERE i.receipt_id = l.id) AS items
       FROM v_receipt_list l JOIN users u ON u.id = l.user_id WHERE u.phone LIKE '+485000001%' LIMIT 1`,
    );
    const r = receipt.rows[0]!;
    expect(r.items).toBe(r.total_amount);
    expect(Number(r.vat_amount)).toBe(Math.round((Number(r.total_amount) * 23) / 123));
    expect(Number(r.net_amount) + Number(r.vat_amount)).toBe(Number(r.total_amount));
  });

  it('księga: zapis przez sp_wallet_post z saldem po operacji, tylko dopisywanie (0007)', async () => {
    const user = await pool.query<{ id: string }>(`INSERT INTO users (phone) VALUES ('+48500000070') RETURNING id`);
    const userId = user.rows[0]!.id;
    const post = (type: string, amount: number) =>
      pool.query<{ entry_id: string; balance_after: string }>(
        `CALL sp_wallet_post($1, $2::ledger_entry_type, $3, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL)`,
        [userId, type, amount],
      );
    expect((await post('TOPUP', 5000)).rows[0]!.balance_after).toBe('5000');
    expect((await post('RIDE_CHARGE', -6200)).rows[0]!.balance_after).toBe('-1200');
    const wallet = await pool.query(`SELECT balance FROM wallets WHERE user_id = $1`, [userId]);
    expect(wallet.rows[0]).toEqual({ balance: '-1200' });
    expect(
      await domainCode(
        pool.query(`INSERT INTO wallet_ledger (user_id, type, amount, balance_after) VALUES ($1, 'TOPUP', 100, 999)`, [
          userId,
        ]),
      ),
    ).toEqual({ code: 'LEDGER_BALANCE_MISMATCH', details: undefined });
    expect(await domainCode(pool.query(`UPDATE wallet_ledger SET amount = 1 WHERE user_id = $1`, [userId]))).toEqual({
      code: 'LEDGER_APPEND_ONLY',
      details: undefined,
    });
    expect(await domainCode(pool.query(`DELETE FROM wallet_ledger WHERE user_id = $1`, [userId]))).toEqual({
      code: 'LEDGER_APPEND_ONLY',
      details: undefined,
    });
    // Nowy typ z 0007 działa po zatwierdzeniu migracji.
    expect((await post('PAYOUT', 1200)).rows[0]!.balance_after).toBe('0');
  });

  it('przejazd: jedno obciążenie, jedna płatność w toku, zwroty do kwoty zapłaty, paragon i korekta (0007)', async () => {
    const user = await pool.query<{ id: string }>(
      `INSERT INTO users (phone, name) VALUES ('+48500000071', 'Ola') RETURNING id`,
    );
    const userId = user.rows[0]!.id;
    const newRental = async (scooter: number) =>
      (
        await pool.query<{ id: string }>(
          `INSERT INTO rentals (user_id, scooter_id, tariff_id, state, started_at, ended_at, total_amount)
           SELECT $1, (SELECT id FROM scooters WHERE number = $2), (SELECT id FROM tariffs WHERE version = 1), 'ENDED',
                  now() - interval '10 minutes', now(), 1260
           RETURNING id`,
          [userId, scooter],
        )
      ).rows[0]!.id;
    const wallet = await newRental(8);
    const settlement = async (id: string) =>
      (await pool.query(`SELECT fn_rental_settlement($1) AS s`, [id])).rows[0]!.s as string;
    expect(await settlement(wallet)).toBe('NONE');
    const charge = () =>
      pool.query(`CALL sp_wallet_post($1, 'RIDE_CHARGE', -1260, $2, NULL, NULL, NULL, NULL, NULL, NULL, NULL)`, [
        userId,
        wallet,
      ]);
    await charge();
    expect(await domainCode(charge())).toEqual({ code: 'RENTAL_ALREADY_CHARGED', details: undefined });
    expect(await settlement(wallet)).toBe('WALLET_PAID');

    const items = JSON.stringify([
      { description: 'UNLOCK', quantity: 1, unitPrice: 300, vatRate: 23, amount: 300 },
      { description: 'RIDE_MINUTES', quantity: 12, unitPrice: 80, vatRate: 23, amount: 960 },
    ]);
    const sale = await pool.query<{ receipt_id: string; receipt_number: string }>(
      `CALL sp_issue_receipt($1, 'SALE', $2, NULL, NULL, NULL, 'WALLET', '{}'::jsonb, $3::jsonb, NULL, NULL)`,
      [userId, wallet, items],
    );
    const saleId = sale.rows[0]!.receipt_id;
    const header = await pool.query(`SELECT total_amount, buyer_name, buyer_phone FROM receipts WHERE id = $1`, [
      saleId,
    ]);
    expect(header.rows[0]).toEqual({ total_amount: '1260', buyer_name: 'Ola', buyer_phone: '+48500000071' });

    const refund = (amount: number, status = 'SUCCEEDED') =>
      pool.query<{ refund_id: string }>(
        `CALL sp_record_refund($1, $2, NULL, 'WALLET', $3, 'SCOOTER_FAILURE', NULL, NULL, $4::refund_status, NULL)`,
        [userId, wallet, amount, status],
      );
    const first = (await refund(500)).rows[0]!.refund_id;
    expect(await domainCode(refund(761))).toEqual({ code: 'REFUND_EXCEEDS_PAYMENT', details: { remaining: 760 } });
    const correction = (amount: number) =>
      pool.query(
        `CALL sp_issue_receipt($1, 'CORRECTION', $2, NULL, $3, $4, 'WALLET', '{}'::jsonb, $5::jsonb, NULL, NULL)`,
        [
          userId,
          wallet,
          first,
          saleId,
          JSON.stringify([{ description: 'REFUND', quantity: 1, unitPrice: -amount, vatRate: 23, amount: -amount }]),
        ],
      );
    await correction(500);
    const list = await pool.query(`SELECT corrections, vat_amount FROM v_receipt_list WHERE id = $1`, [saleId]);
    expect(list.rows[0]).toEqual({ corrections: 1, vat_amount: '236' });
    await expect(correction(761)).rejects.toThrow(/RECEIPT_CORRECTION_EXCEEDS|receipts_refund_id_key/);
    const details = await pool.query(
      `SELECT settlement, paid_amount, refunded_amount, receipt_number IS NOT NULL AS has_receipt FROM v_rental_details WHERE id = $1`,
      [wallet],
    );
    expect(details.rows[0]).toEqual({
      settlement: 'WALLET_PAID',
      paid_amount: '1260',
      refunded_amount: '500',
      has_receipt: true,
    });

    // Karta: jedna płatność w toku, odmowa daje FAILED i przejazd UNPAID w widoku zaległości.
    const card = await pool.query<{ id: string }>(
      `INSERT INTO payment_methods (user_id, provider_ref, brand, last4, exp_month, exp_year, is_default)
       VALUES ($1, 'pm_test_71', 'visa', '4242', 12, 2030, true) RETURNING id`,
      [userId],
    );
    const ride = await newRental(9);
    await pool.query(`UPDATE rentals SET payment_source = 'CARD', payment_method_id = $2 WHERE id = $1`, [
      ride,
      card.rows[0]!.id,
    ]);
    const pay = (status = 'PENDING') =>
      pool.query(
        `INSERT INTO payments (user_id, purpose, rental_id, method, payment_method_id, amount, status, idempotency_key)
         VALUES ($1, 'RIDE', $2, 'CARD', $3, 1260, $4::payment_status, gen_random_uuid()::text)`,
        [userId, ride, card.rows[0]!.id, status],
      );
    await pay();
    expect(await settlement(ride)).toBe('CARD_PENDING');
    expect(await domainCode(pay())).toEqual({ code: 'PAYMENT_IN_PROGRESS', details: undefined });
    await pool.query(
      `UPDATE payments SET status = 'FAILED', failure_code = 'card_declined' WHERE rental_id = $1 AND status = 'PENDING'`,
      [ride],
    );
    await pool.query(`UPDATE rentals SET state = 'UNPAID' WHERE id = $1`, [ride]);
    expect(await settlement(ride)).toBe('FAILED');
    const unpaid = await pool.query(
      `SELECT number IS NOT NULL AS ok, failure_code, failed_attempts, payment_pending, card_last4 FROM v_unpaid_rentals WHERE rental_id = $1`,
      [ride],
    );
    expect(unpaid.rows[0]).toEqual({
      ok: true,
      failure_code: 'card_declined',
      failed_attempts: 1,
      payment_pending: false,
      card_last4: '4242',
    });
    await pay('SUCCEEDED');
    expect(await settlement(ride)).toBe('CARD_PAID');
    const activity = await pool.query(`SELECT rides, unpaid_rentals FROM v_user_activity WHERE id = $1`, [userId]);
    expect(activity.rows[0]).toEqual({ rides: '2', unpaid_rentals: '1' });
  });

  it('cennik: wersje nieedytowalne, jedna zaplanowana, usunięcie tylko nieużytej przed datą (0007)', async () => {
    const insert = (validFrom: string) =>
      pool.query<{ id: string }>(
        `INSERT INTO tariffs (version, unlock_fee, minute_rate, pause_minute_rate, out_of_zone_fee, free_reservation_minutes,
                              min_wallet_balance, min_battery_pct, min_user_age, valid_from)
         SELECT max(version) + 1, 300, 90, 30, 2000, 10, 1000, 15, 18, ${validFrom} FROM tariffs RETURNING id`,
      );
    expect(await domainCode(pool.query(`UPDATE tariffs SET minute_rate = 1 WHERE version = 1`))).toEqual({
      code: 'TARIFF_IMMUTABLE',
      details: undefined,
    });
    const scheduled = (await insert(`now() + interval '1 day'`)).rows[0]!.id;
    expect(await domainCode(insert(`now() + interval '2 days'`))).toEqual({
      code: 'TARIFF_ALREADY_SCHEDULED',
      details: undefined,
    });
    expect(await domainCode(insert('now()'))).toEqual({ code: 'TARIFF_ALREADY_SCHEDULED', details: undefined });
    const states = await pool.query(
      `SELECT version, state, valid_to IS NOT NULL AS ends FROM v_tariff_versions ORDER BY version`,
    );
    expect(states.rows.at(-1)).toMatchObject({ state: 'SCHEDULED', ends: false });
    expect(states.rows.at(-2)).toMatchObject({ state: 'CURRENT', ends: true });
    await pool.query(`CALL sp_delete_scheduled_tariff($1)`, [scheduled]);
    const current = await pool.query<{ id: string }>(`SELECT id FROM tariffs WHERE version = 1`);
    expect(await domainCode(pool.query(`CALL sp_delete_scheduled_tariff($1)`, [current.rows[0]!.id]))).toEqual({
      code: 'TARIFF_NOT_SCHEDULED',
      details: undefined,
    });
    expect(await domainCode(pool.query(`CALL sp_delete_scheduled_tariff($1)`, [randomUUID()]))).toEqual({
      code: 'NOT_FOUND',
      details: { entity: 'tariff' },
    });
  });

  it('VAT „w stu” w bazie zgadza się z regułą w core (0007)', async () => {
    const { rows } = await pool.query(
      `SELECT fn_vat_from_gross(1000, 23) AS a, fn_vat_from_gross(3, 20) AS b, fn_vat_from_gross(-3, 20) AS c, fn_vat_from_gross(1080, 8) AS d`,
    );
    expect(rows[0]).toEqual({ a: '187', b: '1', c: '-1', d: '80' });
  });
  // --- 0008: operacje i serwis -----------------------------------------------------------------------

  /** Hulajnoga tylko dla testu (numery 800+), żeby reguły serwisu nie zależały od wcześniejszych testów. */
  const testScooter = async (number: number, values: { online?: boolean; battery?: number; status?: string } = {}) =>
    (
      await pool.query<{ id: string }>(
        `INSERT INTO scooters (number, serial_number, variant, model_id, status, online, battery_pct, position)
         VALUES ($1::int, 'TEST-' || $1::text, 'GRAFIT', (SELECT id FROM scooter_models WHERE code = 'BASE'), $2::scooter_status, $3, $4,
                 ST_SetSRID(ST_MakePoint(18.5, 50.0), 4326))
         RETURNING id`,
        [number, values.status ?? 'AVAILABLE', values.online ?? true, values.battery ?? 80],
      )
    ).rows[0]!.id;
  const staffId = async () =>
    (await pool.query<{ id: string }>(`SELECT id FROM staff WHERE email = 'a@test.local'`)).rows[0]!.id;

  it('dane startowe: części ze stanem z przyjęcia, szablony z wersją 1 i przykładowy obieg serwisowy, idempotentnie (0008)', async () => {
    const seed = () =>
      seedDatabase(pool, {
        places,
        fleetSize: 10,
        admin: { email: 'a@test.local', name: 'A', passwordHash: 'x' },
        sampleOperations: true,
      });
    await seed();
    await seed();
    const parts = await pool.query<{ sku: string; stock_qty: number; moved: number }>(
      `SELECT p.sku, p.stock_qty, (SELECT sum(m.delta)::int FROM spare_part_movements m WHERE m.part_id = p.id) AS moved
       FROM spare_parts p ORDER BY p.sku`,
    );
    expect(parts.rows.map((r) => r.sku)).toEqual(DEV_SPARE_PARTS.map((p) => p.sku).sort());
    for (const part of parts.rows) expect(part.moved).toBe(part.stock_qty);
    // Rozwiązane zgłoszenie zużyło po jednej sztuce klocków i linki.
    expect(parts.rows.find((r) => r.sku === 'BRK-PAD-R')!.stock_qty).toBe(11);

    const templates = await pool.query<{ code: string; channel: string; versions: number; body: string }>(
      `SELECT code, channel, versions, body FROM v_notification_templates ORDER BY code`,
    );
    expect(templates.rows).toHaveLength(DEV_NOTIFICATION_TEMPLATES.length);
    for (const t of templates.rows) {
      expect(t.versions).toBe(1);
      expect(t.body.length).toBeLessThanOrEqual(t.channel === 'SMS' ? 160 : 240);
    }

    const tickets = await pool.query<{ status: string; source: string; scooter_status: string; open_tasks: number }>(
      `SELECT status, source, scooter_status, open_tasks FROM v_ticket_list ORDER BY number`,
    );
    expect(tickets.rows).toEqual([
      { status: 'NEW', source: 'USER', scooter_status: 'MAINTENANCE', open_tasks: 0 },
      { status: 'AT_SERVICE', source: 'USER', scooter_status: 'MAINTENANCE', open_tasks: 1 },
      { status: 'AT_SERVICE', source: 'AUTO', scooter_status: 'MAINTENANCE', open_tasks: 1 },
      { status: 'RESOLVED', source: 'USER', scooter_status: 'AVAILABLE', open_tasks: 0 },
    ]);
    const tasks = await pool.query<{ type: string; status: string; parts_cost: string }>(
      `SELECT type, status, parts_cost FROM v_service_task_list WHERE scooter_id IN (SELECT scooter_id FROM tickets) ORDER BY number`,
    );
    expect(tasks.rows).toEqual([
      { type: 'REPAIR', status: 'OPEN', parts_cost: '0' },
      { type: 'INSPECTION', status: 'OPEN', parts_cost: '0' },
      { type: 'BATTERY_SWAP', status: 'OPEN', parts_cost: '0' },
      { type: 'REPAIR', status: 'DONE', parts_cost: '3650' },
    ]);
    const system = await pool.query(
      `SELECT count(*)::int AS n FROM v_audit_log WHERE actor = 'SYSTEM' AND staff_name IS NULL`,
    );
    expect(system.rows[0]!.n).toBeGreaterThanOrEqual(3);
  });

  it('zadania: przejścia pilnuje wyzwalacz, zakończenie wymaga notatki, anulowanie powodu, przewiezienie celu (0008)', async () => {
    const scooter = await testScooter(801);
    const admin = await staffId();
    expect(
      await domainCode(
        pool.query(`INSERT INTO service_tasks (scooter_id, type, status) VALUES ($1, 'REPAIR', 'DONE')`, [scooter]),
      ),
    ).toEqual({ code: 'INVALID_TASK_TRANSITION', details: { from: null, to: 'DONE' } });
    const task = (
      await pool.query<{ id: string }>(
        `INSERT INTO service_tasks (scooter_id, type) VALUES ($1, 'REPAIR') RETURNING id`,
        [scooter],
      )
    ).rows[0]!.id;
    const setStatus = (status: string, extra = '') =>
      pool.query(`UPDATE service_tasks SET status = $2::service_task_status ${extra} WHERE id = $1`, [task, status]);
    expect(await domainCode(setStatus('DONE'))).toEqual({
      code: 'INVALID_TASK_TRANSITION',
      details: { from: 'OPEN', to: 'DONE' },
    });
    // W toku wymaga wykonawcy (CHECK z 0002), data rozpoczęcia ustawia się sama.
    await expect(setStatus('IN_PROGRESS')).rejects.toThrow(/service_tasks_check/);
    await setStatus('IN_PROGRESS', `, assignee_id = '${admin}'`);
    expect(await domainCode(setStatus('DONE'))).toEqual({ code: 'TASK_RESULT_NOTE_REQUIRED', details: undefined });
    expect(await domainCode(setStatus('DONE', `, result_note = '  '`))).toEqual({
      code: 'TASK_RESULT_NOTE_REQUIRED',
      details: undefined,
    });
    await setStatus('DONE', `, result_note = 'Wymieniono lampę.'`);
    const done = await pool.query(
      `SELECT started_at IS NOT NULL AS started, completed_at IS NOT NULL AS completed FROM service_tasks WHERE id = $1`,
      [task],
    );
    expect(done.rows[0]).toEqual({ started: true, completed: true });
    expect(await domainCode(setStatus('CANCELLED', `, cancel_reason = 'x'`))).toEqual({
      code: 'INVALID_TASK_TRANSITION',
      details: { from: 'DONE', to: 'CANCELLED' },
    });

    const other = (
      await pool.query<{ id: string }>(
        `INSERT INTO service_tasks (scooter_id, type) VALUES ($1, 'INSPECTION') RETURNING id`,
        [scooter],
      )
    ).rows[0]!.id;
    expect(
      await domainCode(pool.query(`UPDATE service_tasks SET status = 'CANCELLED' WHERE id = $1`, [other])),
    ).toEqual({
      code: 'TASK_CANCEL_REASON_REQUIRED',
      details: undefined,
    });
    await pool.query(
      `UPDATE service_tasks SET status = 'CANCELLED', cancel_reason = 'Duplikat', cancelled_by = $2 WHERE id = $1`,
      [other, admin],
    );

    // Przewiezienie ma dokładnie jeden cel; inne rodzaje nie mają celu.
    expect(
      await domainCode(pool.query(`INSERT INTO service_tasks (scooter_id, type) VALUES ($1, 'RELOCATION')`, [scooter])),
    ).toEqual({ code: 'VALIDATION_FAILED', details: undefined });
    await pool.query(
      `INSERT INTO service_tasks (scooter_id, type, target_point) VALUES ($1, 'RELOCATION', ST_SetSRID(ST_MakePoint(18.5, 50.0), 4326))`,
      [scooter],
    );
    const list = await pool.query(
      `SELECT type, target_lat, target_lon FROM v_service_task_list WHERE scooter_id = $1 AND type = 'RELOCATION'`,
      [scooter],
    );
    expect(list.rows[0]).toEqual({ type: 'RELOCATION', target_lat: 50, target_lon: 18.5 });
  });

  it('części: użycie zmniejsza stan, ponowne dodanie zwiększa ilość, zwrot i anulowanie oddają części, stan nie spada poniżej zera (0008)', async () => {
    const scooter = await testScooter(802);
    const admin = await staffId();
    const part = (
      await pool.query<{ id: string }>(
        `INSERT INTO spare_parts (sku, name, unit_cost, stock_qty) VALUES ('TEST-802', 'Część testowa', 1000, 0) RETURNING id`,
      )
    ).rows[0]!.id;
    const receive = await pool.query(`CALL sp_part_receive($1, 3, 1200, 'FV/1', $2, NULL, NULL)`, [part, admin]);
    expect(receive.rows[0]).toMatchObject({ stock_after: 3 });
    const newTask = async (type: string) => {
      const id = (
        await pool.query<{ id: string }>(`INSERT INTO service_tasks (scooter_id, type) VALUES ($1, $2) RETURNING id`, [
          scooter,
          type,
        ])
      ).rows[0]!.id;
      return id;
    };
    const task = await newTask('REPAIR');
    const use = (taskId: string, quantity: number) =>
      pool.query<{ line_quantity: number; stock_after: number }>(`CALL sp_task_use_part($1, $2, $3, $4, NULL, NULL)`, [
        taskId,
        part,
        quantity,
        admin,
      ]);
    expect(await domainCode(use(task, 1))).toEqual({ code: 'TASK_NOT_IN_PROGRESS', details: undefined });
    await pool.query(`UPDATE service_tasks SET status = 'IN_PROGRESS', assignee_id = $2 WHERE id = $1`, [task, admin]);
    expect((await use(task, 1)).rows[0]).toEqual({ line_quantity: 1, stock_after: 2 });
    // Cena przyjęcia dotyczy kolejnych użyć; ponowne dodanie zwiększa ilość pozycji z kosztem pierwszego użycia.
    await pool.query(`CALL sp_part_receive($1, 1, 1500, NULL, $2, NULL, NULL)`, [part, admin]);
    expect((await use(task, 1)).rows[0]).toEqual({ line_quantity: 2, stock_after: 2 });
    expect(await domainCode(use(task, 3))).toEqual({ code: 'PART_OUT_OF_STOCK', details: { available: 2 } });
    const line = await pool.query(`SELECT quantity, unit_cost FROM service_task_parts WHERE task_id = $1`, [task]);
    expect(line.rows[0]).toEqual({ quantity: 2, unit_cost: '1200' });

    const ret = (quantity: number | null) =>
      pool.query(`CALL sp_task_return_part($1, $2, $3, $4, NULL, NULL)`, [task, part, quantity, admin]);
    expect(await domainCode(ret(5))).toEqual({ code: 'PART_RETURN_EXCEEDS', details: { quantity: 2 } });
    expect((await ret(1)).rows[0]).toEqual({ line_quantity: 1, stock_after: 3 });

    // Równoległe użycie ostatnich sztuk: blokada wiersza części przepuszcza jedno, drugie widzi stan po nim.
    await pool.query(`CALL sp_part_adjust($1, 1, 'STOCKTAKE', NULL, $2, NULL, NULL)`, [part, admin]);
    expect(
      await domainCode(pool.query(`CALL sp_part_adjust($1, 1, 'STOCKTAKE', NULL, $2, NULL, NULL)`, [part, admin])),
    ).toEqual({
      code: 'PART_ADJUST_NO_CHANGE',
      details: undefined,
    });
    expect(
      await domainCode(pool.query(`CALL sp_part_adjust($1, 2, 'OTHER', NULL, $2, NULL, NULL)`, [part, admin])),
    ).toEqual({
      code: 'VALIDATION_FAILED',
      details: undefined,
    });
    const second = await newTask('INSPECTION');
    await pool.query(`UPDATE service_tasks SET status = 'IN_PROGRESS', assignee_id = $2 WHERE id = $1`, [
      second,
      admin,
    ]);
    const a = await pool.connect();
    const b = await pool.connect();
    try {
      await a.query('BEGIN');
      await b.query('BEGIN');
      await a.query(`CALL sp_task_use_part($1, $2, 1, NULL, NULL, NULL)`, [task, part]);
      const waiting = b.query(`CALL sp_task_use_part($1, $2, 1, NULL, NULL, NULL)`, [second, part]).then(
        () => null,
        (error: unknown) => error,
      );
      await a.query('COMMIT');
      expect(await domainCode(Promise.reject(await waiting))).toEqual({
        code: 'PART_OUT_OF_STOCK',
        details: { available: 0 },
      });
    } finally {
      await b.query('ROLLBACK');
      a.release();
      b.release();
    }
    const stock = async () =>
      (await pool.query<{ stock_qty: number }>(`SELECT stock_qty FROM spare_parts WHERE id = $1`, [part])).rows[0]!
        .stock_qty;
    expect(await stock()).toBe(0);
    await expect(pool.query(`UPDATE spare_parts SET stock_qty = -1 WHERE id = $1`, [part])).rejects.toThrow(
      /stock_qty_check/,
    );

    // Anulowanie zwraca części ruchem RETURN z autorem anulowania i usuwa pozycje.
    await pool.query(
      `UPDATE service_tasks SET status = 'CANCELLED', cancel_reason = 'Zła diagnoza', cancelled_by = $2 WHERE id = $1`,
      [task, admin],
    );
    expect(await stock()).toBe(2);
    const left = await pool.query(`SELECT count(*)::int AS n FROM service_task_parts WHERE task_id = $1`, [task]);
    expect(left.rows[0]).toEqual({ n: 0 });
    const movements = await pool.query<{ kind: string; delta: number; stock_after: number; staff_id: string | null }>(
      `SELECT kind, delta, stock_after, staff_id FROM v_spare_part_movements WHERE part_id = $1 ORDER BY id`,
      [part],
    );
    expect(movements.rows.map((m) => [m.kind, m.delta, m.stock_after])).toEqual([
      ['RECEIPT', 3, 3],
      ['USE', -1, 2],
      ['RECEIPT', 1, 3],
      ['USE', -1, 2],
      ['RETURN', 1, 3],
      ['ADJUSTMENT', -2, 1],
      ['USE', -1, 0],
      ['RETURN', 2, 2],
    ]);
    expect(movements.rows.at(-1)!.staff_id).toBe(admin);
    const sum = movements.rows.reduce((acc, m) => acc + m.delta, 0);
    expect(sum).toBe(await stock());
    expect(await domainCode(pool.query(`DELETE FROM spare_part_movements WHERE part_id = $1`, [part]))).toEqual({
      code: 'PART_MOVEMENTS_APPEND_ONLY',
      details: undefined,
    });
    const listed = await pool.query(
      `SELECT stock_qty, below_minimum, used_30d, last_movement_kind FROM v_spare_part_list WHERE id = $1`,
      [part],
    );
    expect(listed.rows[0]).toEqual({ stock_qty: 2, below_minimum: false, used_30d: 0, last_movement_kind: 'RETURN' });
  });

  it('zgłoszenia: numer z sekwencji, pilność z kategorii, jedno otwarte automatyczne danego rodzaju, RESOLVED końcowe (0008)', async () => {
    const scooter = await testScooter(803);
    const user = (await pool.query<{ id: string }>(`INSERT INTO users (phone) VALUES ('+48500000080') RETURNING id`))
      .rows[0]!.id;
    const insert = (categories: string, urgent: boolean, source = 'USER') =>
      pool.query<{ id: string; number: string }>(
        `INSERT INTO tickets (scooter_id, reported_by, source, categories, urgent) VALUES ($1, $2, $3::ticket_source, $4::ticket_category[], $5)
         RETURNING id, number`,
        [scooter, user, source, categories, urgent],
      );
    expect(await domainCode(insert('{BRAKES,LIGHTS}', false))).toEqual({
      code: 'VALIDATION_FAILED',
      details: undefined,
    });
    expect(await domainCode(insert('{LIGHTS}', true))).toEqual({ code: 'VALIDATION_FAILED', details: undefined });
    expect(await domainCode(insert('{CONNECTION}', false))).toEqual({
      code: 'TICKET_CATEGORY_NOT_ALLOWED',
      details: undefined,
    });
    // Nowe wartości z 0008 działają po zatwierdzeniu migracji.
    expect(await domainCode(insert('{BILLING}', false))).toEqual({
      code: 'TICKET_RENTAL_REQUIRED',
      details: undefined,
    });
    const first = (await insert('{WHEEL}', true)).rows[0]!;
    const next = (await insert('{QR_CODE}', false)).rows[0]!;
    expect(Number(next.number)).toBe(Number(first.number) + 1);

    const auto = () =>
      pool.query(
        `INSERT INTO tickets (scooter_id, source, auto_kind, categories) VALUES ($1, 'AUTO', 'OFFLINE', '{CONNECTION}')
         ON CONFLICT (scooter_id, auto_kind) WHERE status <> 'RESOLVED' DO NOTHING RETURNING id`,
        [scooter],
      );
    const created = await auto();
    expect(created.rowCount).toBe(1);
    expect((await auto()).rowCount).toBe(0);
    expect(
      await domainCode(
        pool.query(
          `INSERT INTO tickets (scooter_id, source, auto_kind, categories) VALUES ($1, 'AUTO', 'OFFLINE', '{CONNECTION}')`,
          [scooter],
        ),
      ),
    ).toEqual({ code: 'AUTO_TICKET_ALREADY_OPEN', details: undefined });
    // Inny rodzaj i inna kategoria rodzaju.
    expect(
      await domainCode(
        pool.query(
          `INSERT INTO tickets (scooter_id, source, auto_kind, categories) VALUES ($1, 'AUTO', 'OUT_OF_ZONE', '{BATTERY}')`,
          [scooter],
        ),
      ),
    ).toEqual({ code: 'VALIDATION_FAILED', details: undefined });
    await pool.query(
      `INSERT INTO tickets (scooter_id, source, auto_kind, categories) VALUES ($1, 'AUTO', 'OUT_OF_ZONE', '{OUT_OF_ZONE}')`,
      [scooter],
    );
    // Po rozwiązaniu wolno założyć następne; rozwiązanego nie da się otworzyć ponownie.
    const autoId = created.rows[0]!.id as string;
    await pool.query(`UPDATE tickets SET status = 'RESOLVED', resolution_note = 'Łączność wróciła' WHERE id = $1`, [
      autoId,
    ]);
    const resolved = await pool.query(`SELECT resolved_at IS NOT NULL AS ok FROM tickets WHERE id = $1`, [autoId]);
    expect(resolved.rows[0]).toEqual({ ok: true });
    expect((await auto()).rowCount).toBe(1);
    expect(await domainCode(pool.query(`UPDATE tickets SET status = 'IN_PROGRESS' WHERE id = $1`, [autoId]))).toEqual({
      code: 'INVALID_TICKET_TRANSITION',
      details: { from: 'RESOLVED', to: 'IN_PROGRESS' },
    });
    // Odpowiedź dla klienta ma czas, a odczyt wymaga odpowiedzi.
    await expect(
      pool.query(`UPDATE tickets SET customer_reply = 'Sprawdzamy' WHERE id = $1`, [first.id]),
    ).rejects.toThrow(/tickets_reply_consistent/);
    // Najwyżej trzy zdjęcia w kolejności.
    const photo = async (position: number) => {
      const file = await pool.query<{ id: string }>(
        `INSERT INTO files (storage_key, purpose, content_type) VALUES ('ticket/' || gen_random_uuid(), 'TICKET_PHOTO', 'image/jpeg') RETURNING id`,
      );
      return pool.query(`INSERT INTO ticket_photos (ticket_id, file_id, position) VALUES ($1, $2, $3)`, [
        first.id,
        file.rows[0]!.id,
        position,
      ]);
    };
    await photo(1);
    expect(await domainCode(photo(1))).toEqual({ code: 'TICKET_TOO_MANY_PHOTOS', details: undefined });
    expect(await domainCode(photo(4))).toEqual({ code: 'TICKET_TOO_MANY_PHOTOS', details: undefined });
    const list = await pool.query(`SELECT photos, reporter_name, urgent FROM v_ticket_list WHERE id = $1`, [first.id]);
    expect(list.rows[0]).toEqual({ photos: 1, reporter_name: null, urgent: true });
  });

  it('powrót do floty: fn_scooter_return_blockers liczy otwarte zadania, łączność i baterię z progiem cennika (0008)', async () => {
    const blockers = async (id: string) =>
      (await pool.query<{ b: string[] }>(`SELECT fn_scooter_return_blockers($1) AS b`, [id])).rows[0]!.b;
    const threshold = (await pool.query<{ t: number }>(`SELECT fn_low_battery_threshold() AS t`)).rows[0]!.t;
    expect(threshold).toBe(DEV_TARIFF.minBatteryPct);
    const ok = await testScooter(804, { battery: threshold, status: 'MAINTENANCE' });
    expect(await blockers(ok)).toEqual([]);
    const all = await testScooter(805, { online: false, battery: threshold - 1, status: 'MAINTENANCE' });
    await pool.query(`INSERT INTO service_tasks (scooter_id, type) VALUES ($1, 'BATTERY_SWAP')`, [all]);
    expect(await blockers(all)).toEqual(['OPEN_TASKS', 'OFFLINE', 'BATTERY_BELOW_THRESHOLD']);
    const unknownBattery = await testScooter(806, { status: 'MAINTENANCE' });
    await pool.query(`UPDATE scooters SET battery_pct = NULL WHERE id = $1`, [unknownBattery]);
    expect(await blockers(unknownBattery)).toEqual(['BATTERY_BELOW_THRESHOLD']);
    expect(await blockers(randomUUID())).toBeNull();

    // Otwarte pilne zgłoszenie bez zadania (0009) jest pierwszą przeszkodą, jak `returnToFleetBlockers` w core.
    const user = (await pool.query<{ id: string }>(`INSERT INTO users (phone) VALUES ('+48500000091') RETURNING id`))
      .rows[0]!.id;
    const urgent = await testScooter(820, { battery: threshold, status: 'MAINTENANCE' });
    const ticket = await pool.query<{ id: string }>(
      `INSERT INTO tickets (scooter_id, reported_by, source, categories, urgent) VALUES ($1, $2, 'USER', '{WHEEL}', true)
       RETURNING id`,
      [urgent, user],
    );
    await pool.query(
      `INSERT INTO tickets (scooter_id, reported_by, source, categories, urgent) VALUES ($1, $2, 'USER', '{LIGHTS}', false)`,
      [urgent, user],
    );
    expect(await blockers(urgent)).toEqual(['URGENT_TICKET']);
    await pool.query(
      `INSERT INTO tickets (scooter_id, reported_by, source, categories, urgent) VALUES ($1, $2, 'USER', '{BRAKES}', true)`,
      [all, user],
    );
    expect(await blockers(all)).toEqual([...RETURN_BLOCKERS]);
    await pool.query(`UPDATE tickets SET status = 'RESOLVED' WHERE id = $1`, [ticket.rows[0]!.id]);
    expect(await blockers(urgent)).toEqual([]);
  });

  it('przyczyna stanu: zmiana stanu bez jawnej przyczyny dostaje przyczynę zgodną ze stanem (0009)', async () => {
    const status = async (id: string) =>
      (await pool.query(`SELECT status, status_reason FROM scooters WHERE id = $1`, [id])).rows[0];
    const stolen = await testScooter(821);
    await pool.query(`UPDATE scooters SET status = 'RETIRED', status_reason = 'THEFT' WHERE id = $1`, [stolen]);
    // Wycofana po kradzieży wraca do serwisu: THEFT nie pasuje do MAINTENANCE, więc OTHER zamiast błędu CHECK.
    await pool.query(`UPDATE scooters SET status = 'MAINTENANCE' WHERE id = $1`, [stolen]);
    expect(await status(stolen)).toEqual({ status: 'MAINTENANCE', status_reason: 'OTHER' });
    // W serwisie z pilnym zgłoszeniem, potem wycofana bez powodu: URGENT_TICKET nie pasuje do RETIRED.
    const held = await testScooter(822, { status: 'MAINTENANCE' });
    await pool.query(`UPDATE scooters SET status_reason = 'URGENT_TICKET' WHERE id = $1`, [held]);
    await pool.query(`UPDATE scooters SET status = 'RETIRED' WHERE id = $1`, [held]);
    expect(await status(held)).toEqual({ status: 'RETIRED', status_reason: 'OTHER' });
    // Do serwisu bez przyczyny: OTHER; przyczyna pasująca do stanu zostaje; poza serwisem znika.
    const free = await testScooter(823);
    await pool.query(`UPDATE scooters SET status = 'MAINTENANCE' WHERE id = $1`, [free]);
    expect(await status(free)).toEqual({ status: 'MAINTENANCE', status_reason: 'OTHER' });
    await pool.query(`UPDATE scooters SET status = 'RETIRED' WHERE id = $1`, [free]);
    expect(await status(free)).toEqual({ status: 'RETIRED', status_reason: 'OTHER' });
    await pool.query(`UPDATE scooters SET status = 'MAINTENANCE', status_reason = 'SERVICE_TASK' WHERE id = $1`, [
      free,
    ]);
    expect(await status(free)).toEqual({ status: 'MAINTENANCE', status_reason: 'SERVICE_TASK' });
    await pool.query(`UPDATE scooters SET status = 'AVAILABLE' WHERE id = $1`, [free]);
    expect(await status(free)).toEqual({ status: 'AVAILABLE', status_reason: null });
    // Jawna przyczyna niezgodna ze stanem dalej odrzuca CHECK (błąd domeny VALIDATION_FAILED).
    expect(
      await domainCode(
        pool.query(`UPDATE scooters SET status = 'RETIRED', status_reason = 'SERVICE_TASK' WHERE id = $1`, [free]),
      ),
    ).toEqual({ code: 'VALIDATION_FAILED', details: undefined });
  });

  it('pliki: zdjęcie parkowania w jednym przejeździe, zdjęcie zgłoszenia w jednym zgłoszeniu (0009)', async () => {
    const user = (await pool.query<{ id: string }>(`INSERT INTO users (phone) VALUES ('+48500000092') RETURNING id`))
      .rows[0]!.id;
    const scooter = await testScooter(824);
    const file = async (purpose: string) =>
      (
        await pool.query<{ id: string }>(
          `INSERT INTO files (storage_key, purpose, content_type, sha256, uploaded_by)
           VALUES ($1 || '/' || gen_random_uuid(), $1::file_purpose, 'image/jpeg', repeat('b', 64), $2) RETURNING id`,
          [purpose, user],
        )
      ).rows[0]!.id;
    const rental = async (photoId: string) =>
      pool.query(
        `INSERT INTO rentals (user_id, scooter_id, tariff_id, state, started_at, ended_at, total_amount, parking_photo_id)
         SELECT $1, $2, (SELECT id FROM tariffs WHERE version = 1), 'ENDED', now() - interval '5 minutes', now(), 380, $3`,
        [user, scooter, photoId],
      );
    const parking = await file('PARKING_PHOTO');
    await rental(parking);
    expect(await domainCode(rental(parking))).toEqual({ code: 'FILE_ALREADY_ATTACHED', details: undefined });

    const photo = await file('TICKET_PHOTO');
    const ticket = async () =>
      (
        await pool.query<{ id: string }>(
          `INSERT INTO tickets (scooter_id, reported_by, source, categories, urgent) VALUES ($1, $2, 'USER', '{LIGHTS}', false)
           RETURNING id`,
          [scooter, user],
        )
      ).rows[0]!.id;
    const attach = (ticketId: string, position: number) =>
      pool.query(`INSERT INTO ticket_photos (ticket_id, file_id, position) VALUES ($1, $2, $3)`, [
        ticketId,
        photo,
        position,
      ]);
    const first = await ticket();
    await attach(first, 1);
    expect(await domainCode(attach(first, 2))).toEqual({ code: 'FILE_ALREADY_ATTACHED', details: undefined });
    expect(await domainCode(attach(await ticket(), 1))).toEqual({ code: 'FILE_ALREADY_ATTACHED', details: undefined });
  });

  it('koniec przejazdu albo rezerwacji z otwartym pilnym zgłoszeniem lub zadaniem daje MAINTENANCE z wpisem systemu (0008)', async () => {
    const user = (await pool.query<{ id: string }>(`INSERT INTO users (phone) VALUES ('+48500000081') RETURNING id`))
      .rows[0]!.id;
    const riding = await testScooter(807, { status: 'IN_USE' });
    await pool.query(
      `INSERT INTO tickets (scooter_id, reported_by, source, categories, urgent) VALUES ($1, $2, 'USER', '{BRAKES}', true)`,
      [riding, user],
    );
    await pool.query(`UPDATE scooters SET status = 'AVAILABLE' WHERE id = $1`, [riding]);
    const status = async (id: string) =>
      (await pool.query(`SELECT status, status_reason FROM scooters WHERE id = $1`, [id])).rows[0];
    expect(await status(riding)).toEqual({ status: 'MAINTENANCE', status_reason: 'URGENT_TICKET' });
    const audit = await pool.query(
      `SELECT actor, staff_id, staff_name, action, data->>'reason' AS reason FROM v_audit_log WHERE entity_id = $1`,
      [riding],
    );
    expect(audit.rows).toEqual([
      { actor: 'SYSTEM', staff_id: null, staff_name: null, action: 'scooter.sent_to_service', reason: 'URGENT_TICKET' },
    ]);

    // Rezerwacja wygasła przez procedurę, hulajnoga ma otwarte zadanie.
    const reserved = await testScooter(808, { status: 'RESERVED' });
    await pool.query(`INSERT INTO service_tasks (scooter_id, type) VALUES ($1, 'INSPECTION')`, [reserved]);
    await pool.query(
      `INSERT INTO rentals (user_id, scooter_id, tariff_id, state, reserved_at, reservation_expires_at)
       SELECT $1, $2, (SELECT id FROM tariffs WHERE version = 1), 'RESERVED', now() - interval '20 minutes', now() - interval '1 minute'`,
      [user, reserved],
    );
    await pool.query(`CALL sp_expire_reservations(NULL)`);
    expect(await status(reserved)).toEqual({ status: 'MAINTENANCE', status_reason: 'SERVICE_TASK' });

    // Bez przeszkód wraca do AVAILABLE, a powrót z serwisu wyzwalacz zostawia regule powrotu do floty.
    const free = await testScooter(809, { status: 'IN_USE' });
    await pool.query(`UPDATE scooters SET status = 'AVAILABLE' WHERE id = $1`, [free]);
    expect(await status(free)).toEqual({ status: 'AVAILABLE', status_reason: null });
    await pool.query(`UPDATE scooters SET status = 'AVAILABLE' WHERE id = $1`, [riding]);
    expect(await status(riding)).toEqual({ status: 'AVAILABLE', status_reason: null });
    // Przyczyna pasuje do stanu: wycofanie ma własne powody.
    await expect(
      pool.query(`UPDATE scooters SET status = 'RETIRED', status_reason = 'SERVICE_TASK' WHERE id = $1`, [free]),
    ).rejects.toThrow(/scooters_status_reason_matches/);
    await pool.query(`UPDATE scooters SET status = 'RETIRED', status_reason = 'THEFT' WHERE id = $1`, [free]);
    expect(await status(free)).toEqual({ status: 'RETIRED', status_reason: 'THEFT' });
  });

  it('opłata za odholowanie: jeden wpis na przejazd, w kwocie zapłaconej, limicie zwrotu i paragonie przejazdu (0008)', async () => {
    const user = (await pool.query<{ id: string }>(`INSERT INTO users (phone) VALUES ('+48500000082') RETURNING id`))
      .rows[0]!.id;
    const scooter = await testScooter(810);
    const rental = (
      await pool.query<{ id: string }>(
        `INSERT INTO rentals (user_id, scooter_id, tariff_id, state, started_at, ended_at, total_amount, end_mode, towing_fee)
         SELECT $1, $2, (SELECT id FROM tariffs WHERE version = 1), 'ENDED', now() - interval '10 minutes', now(), 3260, 'REMOTE', 2000
         RETURNING id`,
        [user, scooter],
      )
    ).rows[0]!.id;
    await expect(pool.query(`UPDATE rentals SET end_mode = 'CUSTOMER' WHERE id = $1`, [rental])).rejects.toThrow(
      /rentals_towing_fee_remote/,
    );
    const post = (type: string, amount: number) =>
      pool.query(`CALL sp_wallet_post($1, $2::ledger_entry_type, $3, $4, NULL, NULL, NULL, NULL, NULL, NULL, NULL)`, [
        user,
        type,
        amount,
        rental,
      ]);
    await post('RIDE_CHARGE', -1260);
    await post('TOWING_FEE', -2000);
    expect(await domainCode(post('TOWING_FEE', -2000))).toEqual({ code: 'RENTAL_ALREADY_CHARGED', details: undefined });
    const details = await pool.query(
      `SELECT settlement, paid_amount, wallet_charge, towing_fee, end_mode FROM v_rental_details WHERE id = $1`,
      [rental],
    );
    expect(details.rows[0]).toEqual({
      settlement: 'WALLET_PAID',
      paid_amount: '3260',
      wallet_charge: '-1260',
      towing_fee: '2000',
      end_mode: 'REMOTE',
    });
    const balance = await pool.query(`SELECT balance FROM wallets WHERE user_id = $1`, [user]);
    expect(balance.rows[0]).toEqual({ balance: '-3260' });

    // Samą opłatę można zwrócić zwrotem częściowym; limit to cała kwota z opłatą.
    const refund = (amount: number) =>
      pool.query(`CALL sp_record_refund($1, $2, NULL, 'WALLET', $3, 'BILLING_ERROR', NULL, NULL, 'SUCCEEDED', NULL)`, [
        user,
        rental,
        amount,
      ]);
    await refund(2000);
    expect(await domainCode(refund(1261))).toEqual({ code: 'REFUND_EXCEEDS_PAYMENT', details: { remaining: 1260 } });

    const items = JSON.stringify([
      { description: 'UNLOCK', quantity: 1, unitPrice: 300, vatRate: 23, amount: 300 },
      { description: 'RIDE_MINUTES', quantity: 12, unitPrice: 80, vatRate: 23, amount: 960 },
      { description: 'TOWING_FEE', quantity: 1, unitPrice: 2000, vatRate: null, amount: 2000 },
    ]);
    const sale = await pool.query<{ receipt_id: string; receipt_number: string }>(
      `CALL sp_issue_receipt($1, 'SALE', $2, NULL, NULL, NULL, 'WALLET', '{}'::jsonb, $3::jsonb, NULL, NULL)`,
      [user, rental, items],
    );
    const ledger = await pool.query<{ type: string; receipt_number: string | null }>(
      `SELECT type, receipt_number FROM v_wallet_ledger WHERE rental_id = $1 AND amount < 0 ORDER BY id`,
      [rental],
    );
    expect(ledger.rows).toEqual([
      { type: 'RIDE_CHARGE', receipt_number: sale.rows[0]!.receipt_number },
      { type: 'TOWING_FEE', receipt_number: sale.rows[0]!.receipt_number },
    ]);
    const total = await pool.query(`SELECT total_amount FROM receipts WHERE rental_id = $1`, [rental]);
    expect(total.rows[0]).toEqual({ total_amount: '3260' });

    // Opłata poza VAT (0010, ADR 0061): VAT tylko od grupy 23% (1260 × 23/123 = 235,6…), stawka jedynej grupy z VAT.
    const saleId = sale.rows[0]!.receipt_id;
    const vat = async (id: string) =>
      (
        await pool.query(`SELECT total_amount, vat_amount, net_amount, vat_rate FROM v_receipt_list WHERE id = $1`, [
          id,
        ])
      ).rows[0];
    expect(await vat(saleId)).toEqual({
      total_amount: '3260',
      vat_amount: '236',
      net_amount: '3024',
      vat_rate: '23.00',
    });
    const correct = (lines: [number | null, number][]) =>
      pool.query<{ receipt_id: string }>(
        `CALL sp_issue_receipt($1, 'CORRECTION', $2, NULL, NULL, $3, 'WALLET', '{}'::jsonb, $4::jsonb, NULL, NULL)`,
        [
          user,
          rental,
          saleId,
          JSON.stringify(
            lines.map(([vatRate, amount]) => ({
              description: 'REFUND',
              quantity: 1,
              unitPrice: amount,
              vatRate,
              amount,
            })),
          ),
        ],
      );
    // Korekta z dwiema grupami: VAT od części z VAT (387 × 23/123 = 72,3…).
    const split = (
      await correct([
        [23, -387],
        [null, -613],
      ])
    ).rows[0]!.receipt_id;
    expect(await vat(split)).toEqual({
      total_amount: '-1000',
      vat_amount: '-72',
      net_amount: '-928',
      vat_rate: '23.00',
    });
    // Korekta tylko poza VAT: bez stawki i bez VAT.
    const outside = (await correct([[null, -100]])).rows[0]!.receipt_id;
    expect(await vat(outside)).toEqual({ total_amount: '-100', vat_amount: '0', net_amount: '-100', vat_rate: null });
    // Grupa poza VAT ma jeszcze 1287: więcej z niej nie, choć dokument ma 2160 do zwrotu; stawka spoza paragonu też nie.
    expect(await domainCode(correct([[null, -1288]]))).toEqual({
      code: 'RECEIPT_CORRECTION_EXCEEDS',
      details: undefined,
    });
    expect(await domainCode(correct([[8, -10]]))).toEqual({ code: 'RECEIPT_CORRECTION_EXCEEDS', details: undefined });
    await correct([
      [23, -873],
      [null, -1287],
    ]);
    const left = await pool.query(
      `SELECT i.vat_rate, sum(i.amount)::bigint AS left FROM receipt_items i JOIN receipts r ON r.id = i.receipt_id
       WHERE r.id = $1 OR r.corrects_receipt_id = $1 GROUP BY i.vat_rate ORDER BY i.vat_rate NULLS LAST`,
      [saleId],
    );
    expect(left.rows).toEqual([
      { vat_rate: '23.00', left: '0' },
      { vat_rate: null, left: '0' },
    ]);

    // Zdjęcie parkowania jest wymagane po zakończeniu bez łączności.
    await pool.query(`UPDATE rentals SET towing_fee = NULL, end_mode = 'CUSTOMER_OFFLINE' WHERE id = $1`, [rental]);
    const photo = await pool.query(`SELECT parking_photo_required FROM v_rental_details WHERE id = $1`, [rental]);
    expect(photo.rows[0]).toEqual({ parking_photo_required: true });
  });

  it('powiadomienia: jedno na zdarzenie (dedupe_key), stan wysyłki, wersje szablonu przy zmianie treści (0008)', async () => {
    const user = (await pool.query<{ id: string }>(`INSERT INTO users (phone) VALUES ('+48500000083') RETURNING id`))
      .rows[0]!.id;
    const key = `ride_ended:${randomUUID()}`;
    const queue = () =>
      pool.query(
        `INSERT INTO notifications (user_id, template_code, channel, payload, dedupe_key) VALUES ($1, 'ride_ended', 'PUSH', '{}', $2)
         ON CONFLICT (dedupe_key) DO NOTHING RETURNING id`,
        [user, key],
      );
    const first = await queue();
    expect(first.rowCount).toBe(1);
    expect((await queue()).rowCount).toBe(0);
    expect(
      await domainCode(
        pool.query(`INSERT INTO notifications (user_id, template_code, dedupe_key) VALUES ($1, 'ride_ended', $2)`, [
          user,
          key,
        ]),
      ),
    ).toEqual({ code: 'NOTIFICATION_DUPLICATE', details: undefined });
    const id = first.rows[0]!.id as string;
    await expect(pool.query(`UPDATE notifications SET status = 'SENT' WHERE id = $1`, [id])).rejects.toThrow(
      /notifications_sent_at/,
    );
    await expect(pool.query(`UPDATE notifications SET status = 'FAILED' WHERE id = $1`, [id])).rejects.toThrow(
      /notifications_failed_error/,
    );
    await pool.query(
      `UPDATE notifications SET status = 'SENT', sent_at = now(), template_version = 1, title = 'Przejazd zakończony' WHERE id = $1`,
      [id],
    );
    const listed = await pool.query(`SELECT status, template_code, user_phone FROM v_notification_list WHERE id = $1`, [
      id,
    ]);
    expect(listed.rows[0]).toEqual({ status: 'SENT', template_code: 'ride_ended', user_phone: '+48500000083' });

    // Zmiana treści zapisuje wersję; zmiana bez podniesienia wersji trafia na unikalność, opis nie tworzy wersji.
    const admin = await staffId();
    await pool.query(
      `UPDATE notification_templates SET body = 'Przejazd {rideNumber} zakończony.', version = version + 1, updated_by = $1
       WHERE code = 'ride_ended'`,
      [admin],
    );
    await expect(
      pool.query(`UPDATE notification_templates SET body = 'Inna treść {rideNumber}.' WHERE code = 'ride_ended'`),
    ).rejects.toThrow(/notification_template_versions_template_id_version_key/);
    await pool.query(`UPDATE notification_templates SET description = 'Opis' WHERE code = 'ride_ended'`);
    const versions = await pool.query(
      `SELECT version, staff_id IS NOT NULL AS by_staff, is_current FROM v_notification_template_versions
       WHERE code = 'ride_ended' ORDER BY version`,
    );
    expect(versions.rows).toEqual([
      { version: 1, by_staff: false, is_current: false },
      { version: 2, by_staff: true, is_current: true },
    ]);
    await expect(
      pool.query(
        `UPDATE notification_templates SET title = repeat('x', 51), version = version + 1 WHERE code = 'ride_ended'`,
      ),
    ).rejects.toThrow(/notification_templates_title_length/);

    // Token push należy do sesji klienta; usunięcie sesji usuwa token.
    const session = await pool.query<{ id: string }>(
      `INSERT INTO sessions (user_id, refresh_token_hash, expires_at) VALUES ($1, gen_random_uuid()::text, now() + interval '1 day') RETURNING id`,
      [user],
    );
    await pool.query(`INSERT INTO push_tokens (user_id, expo_token, platform, session_id) VALUES ($1, $2, 'IOS', $3)`, [
      user,
      `ExponentPushToken[${randomUUID()}]`,
      session.rows[0]!.id,
    ]);
    const tokens = await pool.query(`SELECT session_active FROM v_push_tokens WHERE user_id = $1`, [user]);
    expect(tokens.rows).toEqual([{ session_active: true }]);
    await pool.query(`DELETE FROM sessions WHERE id = $1`, [session.rows[0]!.id]);
    const left = await pool.query(`SELECT count(*)::int AS n FROM push_tokens WHERE user_id = $1`, [user]);
    expect(left.rows[0]).toEqual({ n: 0 });
  });

  it('dziennik audytu: wpis systemu bez operatora, oś czasu zgłoszenia, pulpit i uprawnienia Dyspozytora (0008)', async () => {
    await expect(
      pool.query(`INSERT INTO audit_log (actor, action, entity_type) VALUES ('STAFF', 'x.y', 'ticket')`),
    ).rejects.toThrow(/audit_log_actor_staff/);
    await expect(
      pool.query(
        `INSERT INTO audit_log (actor, staff_id, action, entity_type) VALUES ('SYSTEM', $1, 'x.y', 'ticket')`,
        [await staffId()],
      ),
    ).rejects.toThrow(/audit_log_actor_staff/);

    const user = (await pool.query<{ id: string }>(`INSERT INTO users (phone) VALUES ('+48500000084') RETURNING id`))
      .rows[0]!.id;
    const scooter = await testScooter(811);
    const ticket = (
      await pool.query<{ id: string }>(
        `INSERT INTO tickets (scooter_id, reported_by, source, categories, urgent, created_at)
         VALUES ($1, $2, 'USER', '{HANDLEBAR}', true, now() - interval '1 minute') RETURNING id`,
        [scooter, user],
      )
    ).rows[0]!.id;
    const task = (
      await pool.query<{ id: string }>(
        `INSERT INTO service_tasks (scooter_id, ticket_id, type) VALUES ($1, $2, 'REPAIR') RETURNING id`,
        [scooter, ticket],
      )
    ).rows[0]!.id;
    await pool.query(
      `INSERT INTO audit_log (actor, staff_id, action, entity_type, entity_id) VALUES ('SYSTEM', NULL, 'scooter.sent_to_service', 'scooter', $1),
         ('SYSTEM', NULL, 'ticket.status_changed', 'ticket', $2), ('SYSTEM', NULL, 'service_task.created', 'service_task', $3)`,
      [scooter, ticket, task],
    );
    await pool.query(
      `INSERT INTO notifications (user_id, template_code, ticket_id, dedupe_key) VALUES ($1, 'ticket_received', $2::uuid, 'ticket_received:' || $2::text)`,
      [user, ticket],
    );
    const timeline = await pool.query<{ kind: string; action: string; actor: string }>(
      `SELECT kind, action, actor FROM v_ticket_timeline WHERE ticket_id = $1 ORDER BY at, kind_order, seq`,
      [ticket],
    );
    expect(timeline.rows).toEqual([
      { kind: 'CREATED', action: 'ticket.created', actor: 'CUSTOMER' },
      { kind: 'AUDIT', action: 'ticket.status_changed', actor: 'SYSTEM' },
      { kind: 'AUDIT', action: 'service_task.created', actor: 'SYSTEM' },
      { kind: 'NOTIFICATION', action: 'ticket_received', actor: 'SYSTEM' },
    ]);

    const attention = await pool.query(`SELECT * FROM fn_dashboard_attention(10)`);
    expect(attention.rows).toHaveLength(1);
    expect(attention.rows[0].urgent_new_unassigned).toBeGreaterThanOrEqual(1);
    expect(Object.keys(attention.rows[0]).sort()).toEqual([
      'billing_stopped',
      'critical_battery',
      'failed_payments_today',
      'offline_in_rental',
      'unpaid_rentals',
      'urgent_new_unassigned',
    ]);

    const dispatcher = await pool.query(
      `SELECT EXISTS (SELECT 1 FROM role_permissions rp JOIN roles r ON r.id = rp.role_id
                      WHERE r.name = 'Dyspozytor' AND rp.permission_code = 'service.manage') AS ok`,
    );
    expect(dispatcher.rows[0]).toEqual({ ok: true });

    const file = await pool.query<{ id: string }>(
      `INSERT INTO files (storage_key, purpose, content_type, sha256) VALUES ('parking/' || gen_random_uuid(), 'PARKING_PHOTO', 'image/jpeg', repeat('a', 64)) RETURNING id`,
    );
    await expect(pool.query(`UPDATE files SET status = 'DELETED' WHERE id = $1`, [file.rows[0]!.id])).rejects.toThrow(
      /files_deleted_at/,
    );
    await pool.query(`UPDATE files SET status = 'DELETED', deleted_at = now() WHERE id = $1`, [file.rows[0]!.id]);
    const files = await pool.query(`SELECT status, attached FROM v_file_list WHERE id = $1`, [file.rows[0]!.id]);
    expect(files.rows[0]).toEqual({ status: 'DELETED', attached: false });
  });
});
