/**
 * Testy integracyjne na prawdziwym PostgreSQL z PostGIS. Każde uruchomienie tworzy
 * tymczasową bazę i usuwa ją na końcu. Wymagają DATABASE_URL (w CI: kontener postgis).
 */
import { randomUUID } from 'node:crypto';
import { copyFileSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { OPEN_RENTAL_STATES, PERMISSIONS, RENTAL_STATES, RentalStateMachine, type RentalState } from '@hulajnogi/core';
import { Pool } from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createDb } from './client.js';
import { migrationsDir, runMigrations } from './migrator.js';
import type { PlacesFile } from './places.js';
import { DrizzleZoneRepository } from './repositories/zones.repository.js';
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
    expect(first.applied).toEqual(['0002_admin_modules.sql', '0003_fleet_lists.sql', '0004_accounts_access.sql']);
    const second = await runMigrations(pool);
    expect(second.applied).toEqual([]);

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
    expect(rows[0]).toEqual({ tables: 48, views: 18, functions: 10, procedures: 8 });
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
    await pool.query(`INSERT INTO wallets (user_id, balance) VALUES ($1, 500)`, [userId]);
    await pool.query(
      `INSERT INTO wallet_ledger (user_id, type, amount, balance_after) VALUES ($1, 'TOPUP', 2000, 2000), ($1, 'ADJUSTMENT', -300, 1700)`,
      [userId],
    );
    const before = await pool.query(`SELECT cached_balance, ledger_balance, out_of_sync FROM v_wallet_balances WHERE user_id = $1`, [userId]);
    expect(before.rows[0]).toEqual({ cached_balance: '500', ledger_balance: '1700', out_of_sync: true });

    const fixed = await pool.query<{ fixed_count: number }>(`CALL sp_rebuild_wallet_balances(NULL)`);
    expect(fixed.rows[0]!.fixed_count).toBe(1);
    const after = await pool.query(`SELECT fn_wallet_balance($1) AS balance, (SELECT out_of_sync FROM v_wallet_balances WHERE user_id = $1)`, [userId]);
    expect(after.rows[0]).toEqual({ balance: '1700', out_of_sync: false });
  });

  it('sp_anonymize_user odmawia przy otwartym przejeździe i usuwa dane osobowe', async () => {
    const busy = await pool.query<{ id: string }>(`SELECT user_id AS id FROM rentals WHERE state = 'UNLOCKING' LIMIT 1`);
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
    await pool.query(`INSERT INTO staff_roles (staff_id, role_id) SELECT $1, id FROM roles WHERE name = 'Dyspozytor'`, [staffId]);
    const check = (code: string) =>
      pool.query<{ ok: boolean }>(`SELECT fn_staff_has_permission($1, $2) AS ok`, [staffId, code]).then((r) => r.rows[0]!.ok);
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
    const created = await pool.query<{ created_count: number }>(`CALL sp_ensure_telemetry_partitions(${today}, 2, NULL)`);
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
    const revision = () => pool.query<{ r: string }>(`SELECT fn_content_revision() AS r`).then((r) => Number(r.rows[0]!.r));
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
      pool.query(`INSERT INTO service_tasks (scooter_id, type) SELECT id, 'BATTERY_SWAP' FROM scooters WHERE number = 3`);
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
    const managers = await pool.query(`SELECT staff_id FROM v_staff_permissions WHERE permission_code = 'roles.manage'`);
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
        .query(`SELECT status, totp_enabled, invitation_expires_at IS NOT NULL AS invited FROM v_staff_overview WHERE id = $1`, [
          staffId,
        ])
        .then((r) => r.rows[0]);
    expect(await overview()).toEqual({ status: 'INVITED', totp_enabled: false, invited: true });

    await pool.query(`UPDATE staff_invitations SET accepted_at = now() WHERE staff_id = $1`, [staffId]);
    await pool.query(`UPDATE staff SET password_hash = 'x', totp_secret_enc = 'enc', totp_confirmed_at = now() WHERE id = $1`, [
      staffId,
    ]);
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
    await pool.query(`UPDATE sessions SET replaced_by = $1, revoked_at = now() WHERE id = $2`, [second.rows[0]!.id, firstId]);

    const active = () =>
      pool.query<{ n: string }>(`SELECT active_sessions AS n FROM v_user_activity WHERE id = $1`, [userId]).then((r) => Number(r.rows[0]!.n));
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
    const staffRevoked = await pool.query<{ revoked_count: number }>(`CALL sp_revoke_staff_sessions($1, NULL)`, [staffId]);
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
      await pool.query(`UPDATE content_page_versions SET status = 'ARCHIVED' WHERE page_id = $1 AND status = 'PUBLISHED'`, [
        pageId,
      ]);
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
    expect(await pending()).toEqual([{ consent_type: 'PRIVACY', version_no: 2, change_summary: 'Nowy odbiorca danych' }]);
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
});
