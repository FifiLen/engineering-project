/**
 * Testy repozytoriów raportów i nowych list (iteracja 8, ADR 0071, ADR 0074, ADR 0076) na prawdziwym PostgreSQL:
 * synchronizacja `report_definitions` z katalogu w core, zgodność `fn_scooter_time_category` z core, model raportu
 * z funkcji `fn_report_*` zgodny ze schematem podglądu w shared, uruchomienia i definicje, listy na widokach 0013
 * i telemetria z kursorem. Każde uruchomienie tworzy tymczasową bazę i usuwa ją na końcu.
 */
import { randomUUID } from 'node:crypto';
import {
  computeReport,
  REPORT_CATALOG,
  REPORT_CODES,
  reportParamsView,
  resolveReportParams,
  SCOOTER_STATUSES,
  scooterTimeCategory,
  SCOOTER_TIME_CATEGORIES,
  type ReportModel,
} from '@hulajnogi/core';
import {
  ADMIN_RESOURCES,
  REPORT_CODES as SHARED_REPORT_CODES,
  parseListQuery,
  reportParamsJsonSchema,
  reportPreviewSchema,
  type FieldDefinition,
  type ListQuery,
  type ReportPreview,
  type ResourceDefinition,
} from '@hulajnogi/shared';
import { sql } from 'drizzle-orm';
import { Pool } from 'pg';
import { afterAll, beforeAll, describe, expect, expectTypeOf, it } from 'vitest';
import { createDb, type Database } from './client.js';
import { listPages } from './admin/list-query.js';
import { runMigrations } from './migrator.js';
import type { PlacesFile } from './places.js';
import { DrizzleAdminListsRepository } from './repositories/admin-lists.repository.js';
import {
  DrizzleReportDefinitionsRepository,
  DrizzleReportRunsRepository,
  DrizzleReportsRepository,
  withReportSnapshot,
} from './repositories/reports.repository.js';
import { seedDatabase } from './seed.js';

const adminUrl = process.env.DATABASE_URL;
const dbName = `hulajnogi_reports_repo_${randomUUID().slice(0, 8)}`;

// Syntetyczne współrzędne testowe (nie są to prawdziwe miejsca w Rybniku).
const places: PlacesFile = {
  city: 'Test',
  note: '',
  serviceArea: { code: 'AREA-TEST', name: 'Obszar testowy', centerPlace: 'P-01', radiusM: 3000 },
  places: [
    { code: 'P-01', name: 'Centrum', query: '', type: 'PARKING', radiusM: 50, capacity: 20, lat: 50.0, lon: 18.5 },
    { code: 'P-02', name: 'Północ', query: '', type: 'PARKING', radiusM: 50, capacity: 20, lat: 50.01, lon: 18.5 },
  ],
};

const NOW = new Date();

/** Typ modelu z core musi pasować do odpowiedzi podglądu w shared (kontrakt panelu). */
type PreviewBody = Omit<ReportPreview, 'code' | 'name' | 'description' | 'params' | 'dataAsOf' | 'earliestDataAt'>;
expectTypeOf<Omit<ReportModel, 'code'>>().toExtend<PreviewBody>();

describe.skipIf(!adminUrl)('repozytoria raportów i nowych list (iteracja 8)', () => {
  let admin: Pool;
  let pool: Pool;
  let db: Database;
  const one = async <T = Record<string, unknown>>(text: string, params: unknown[] = []) =>
    (await pool.query(text, params)).rows[0] as T;
  const staffId = async () => (await one<{ id: string }>(`SELECT id FROM staff WHERE email = 'a@test.local'`)).id;
  const reseed = () =>
    seedDatabase(pool, {
      places,
      fleetSize: 3,
      admin: { email: 'a@test.local', name: 'Piotr Mazur', passwordHash: 'x' },
    });

  beforeAll(async () => {
    admin = new Pool({ connectionString: adminUrl });
    await admin.query(`CREATE DATABASE ${dbName}`);
    const url = new URL(adminUrl!);
    url.pathname = `/${dbName}`;
    pool = new Pool({ connectionString: url.toString() });
    pool.on('error', () => undefined);
    await runMigrations(pool);
    await reseed();
    db = createDb(pool);
  });

  afterAll(async () => {
    await pool?.end();
    await admin?.query(`DROP DATABASE IF EXISTS ${dbName} WITH (FORCE)`);
    await admin?.end();
  });

  // --- Definicje z katalogu ---------------------------------------------------------------------

  it('seed wstawia sześć definicji z katalogu: uprawnienie, JSON Schema parametrów, formaty, kolejność', async () => {
    expect([...SHARED_REPORT_CODES]).toEqual([...REPORT_CODES]);
    const defs = await new DrizzleReportDefinitionsRepository(db).all();
    expect(defs.map((d) => d.code)).toEqual([
      'revenue',
      'fleet_usage',
      'rides_by_zone',
      'reliability',
      'users',
      'wallet',
    ]);
    for (const def of defs) {
      const spec = REPORT_CATALOG[def.code];
      expect(def).toMatchObject({
        name: spec.defaultName,
        description: spec.defaultDescription,
        permissionCode: spec.permission,
        formats: ['PDF', 'XLSX'],
        active: true,
        sortOrder: spec.sortOrder,
        version: 1,
      });
      expect(def.parameters).toEqual(reportParamsJsonSchema(def.code));
    }
    expect(
      await one(
        `SELECT count(*)::int AS n FROM audit_log WHERE action = 'report_definition.created' AND actor = 'SYSTEM'
           AND data->>'source' = 'catalog'`,
      ),
    ).toEqual({ n: 6 });
  });

  it('seed nie nadpisuje nazwy, opisu, aktywności i kolejności, przywraca pola z kodu bez podbijania wersji', async () => {
    const staff = await staffId();
    const repo = new DrizzleReportDefinitionsRepository(db);
    expect(
      await repo.update(
        'wallet',
        1,
        { name: 'Portfele klientów', description: null, active: false, sortOrder: 5 },
        staff,
      ),
    ).toBe(true);
    expect(await repo.update('wallet', 1, { name: 'Konflikt' }, staff)).toBe(false);
    await pool.query(
      `UPDATE report_definitions SET formats = '{PDF}', parameters = '{}'::jsonb, permission_code = 'reports.users'
       WHERE code = 'revenue'`,
    );
    const before = await repo.get('revenue');
    await reseed();
    const wallet = await repo.get('wallet');
    expect(wallet).toMatchObject({
      name: 'Portfele klientów',
      description: null,
      active: false,
      sortOrder: 5,
      version: 2,
      updatedByName: 'Piotr Mazur',
    });
    const revenue = await repo.get('revenue');
    expect(revenue).toMatchObject({
      formats: ['PDF', 'XLSX'],
      permissionCode: 'reports.revenue',
      version: before!.version,
    });
    expect(revenue!.updatedAt).toEqual(before!.updatedAt);
    expect(revenue!.parameters).toEqual(reportParamsJsonSchema('revenue'));
    const synced = await pool.query(`SELECT data FROM audit_log WHERE action = 'report_definition.synced' ORDER BY id`);
    expect(synced.rows.map((r) => r.data)).toEqual([
      { code: 'revenue', fields: ['permissionCode', 'parameters', 'formats'], source: 'catalog' },
    ]);
    // Ponowny seed bez zmian w katalogu nie dopisuje wpisów.
    await reseed();
    expect(await one(`SELECT count(*)::int AS n FROM audit_log WHERE entity_type = 'report_definition'`)).toEqual({
      n: 7,
    });

    // Katalog: aktywne definicje z uprawnieniem operatora w kolejności `sort_order`.
    expect((await repo.catalog(['wallet', 'users', 'revenue'])).map((d) => d.code)).toEqual(['revenue', 'users']);
    const list = await repo.list(query(definitionsDef(), ''));
    expect(list.items.map((d) => d.code)).toEqual([
      'wallet',
      'revenue',
      'fleet_usage',
      'rides_by_zone',
      'reliability',
      'users',
    ]);
    expect(list.items[0]!.formats).toEqual(['PDF', 'XLSX']);
    expect(list.items[1]!.permissionRoles).toEqual(['Administrator']);
    await pool.query(`UPDATE report_definitions SET active = true, sort_order = 60 WHERE code = 'wallet'`);
  });

  // --- Kategorie czasu: baza i core -------------------------------------------------------------

  it('fn_scooter_time_category liczy kategorię czasu tak samo jak packages/core (ADR 0074)', async () => {
    const cases = SCOOTER_STATUSES.flatMap((status) => [true, false].map((online) => ({ status, online })));
    const { rows } = await pool.query<{ i: number; category: string }>(
      `SELECT i, fn_scooter_time_category(c.status::scooter_status, c.online) AS category
       FROM jsonb_to_recordset($1::jsonb) AS c(i int, status text, online boolean)`,
      [JSON.stringify(cases.map((c, i) => ({ i, ...c })))],
    );
    for (const row of rows) expect(row.category).toBe(scooterTimeCategory(cases[row.i]!.status, cases[row.i]!.online));
    expect(new Set(rows.map((r) => r.category))).toEqual(new Set(SCOOTER_TIME_CATEGORIES));
  });

  // --- Model raportów z funkcji raportowych -------------------------------------------------------

  it('każdy raport: funkcje raportowe przez port, liczby zamiast tekstu, odpowiedź zgodna ze schematem podglądu', async () => {
    // Dane: dwa przejazdy zakończone w strefie P-01 (2 h i 26 h temu), bez paragonów.
    const user = (
      await one<{ id: string }>(
        `INSERT INTO users (phone, name) VALUES ('+48500000777', 'Klient raportu') RETURNING id`,
      )
    ).id;
    const scooter = (await one<{ id: string }>(`SELECT id FROM scooters WHERE number = 1`)).id;
    const zone = (await one<{ id: string }>(`SELECT id FROM zones WHERE code = 'P-01'`)).id;
    for (const hoursAgo of [2, 26]) {
      await pool.query(
        `INSERT INTO rentals (user_id, scooter_id, tariff_id, state, reserved_at, started_at, ended_at, end_zone_id,
                              ride_seconds, distance_m, end_mode, total_amount, created_at)
         VALUES ($1, $2, (SELECT id FROM tariffs WHERE version = 1), 'ENDED', now() - make_interval(hours => $3),
                 now() - make_interval(hours => $3), now() - make_interval(hours => $3) + interval '10 minutes', $4,
                 600, 2400, 'CUSTOMER', 1500, now() - make_interval(hours => $3))`,
        [user, scooter, hoursAgo, zone],
      );
    }
    for (const code of REPORT_CODES) {
      const params = resolveReportParams(code, { preset: 'last_7_days' }, NOW);
      const preview = await withReportSnapshot(db, { timeoutMs: 15_000 }, async (repo, dataAsOf) => {
        const model = await computeReport(repo, params);
        const earliest = await repo.earliestData(code);
        return {
          ...model,
          name: REPORT_CATALOG[code].defaultName,
          description: null,
          params: reportParamsView(params),
          dataAsOf: dataAsOf.toISOString(),
          earliestDataAt: earliest?.toISOString() ?? null,
        };
      });
      const parsed = reportPreviewSchema.safeParse(JSON.parse(JSON.stringify(preview)));
      expect(parsed.error?.issues ?? [], code).toEqual([]);
      for (const tile of preview.tiles)
        expect(['number', 'object'], `${code}.${tile.key}`).toContain(typeof tile.value);
    }

    const model = await withReportSnapshot(db, { timeoutMs: 15_000 }, (repo) =>
      computeReport(repo, resolveReportParams('rides_by_zone', { preset: 'last_7_days' }, NOW)),
    );
    expect(model.empty).toBe(false);
    expect(model.tiles.find((t) => t.key === 'rides')!.value).toBe(2);
    expect(model.tiles.find((t) => t.key === 'avgRideSeconds')!.value).toBe(600);
    const byZone = model.tables.find((t) => t.key === 'byEndZone')!;
    expect(byZone.rows[0]!.cells).toMatchObject({
      zone: 'P-01 Centrum',
      zoneType: 'parkowanie',
      rides: 2,
      avgDistance: 2400,
    });
    const heat = model.charts[0]!;
    expect(heat.type === 'heatmap' && heat.cells.reduce((s, c) => s + c.rides, 0)).toBe(2);

    const fleet = await withReportSnapshot(db, { timeoutMs: 15_000 }, (repo) =>
      repo.fleetUsageByScooter(resolveReportParams('fleet_usage', { preset: 'today' }, NOW).period, {}),
    );
    expect(typeof fleet[0]!.periodSeconds).toBe('number');
    const hours = await new DrizzleReportsRepository(db).dashboardRidesByHour(
      resolveReportParams('revenue', { preset: 'today' }, NOW).range.from,
    );
    expect(hours).toHaveLength(24);
    expect(typeof hours[0]!.avgPrevious).toBe('number');
  });

  it('migawka: przekroczony limit czasu zapytania to REPORT_TIMEOUT', async () => {
    await expect(
      withReportSnapshot(db, { timeoutMs: 50 }, async (repo) => {
        await (repo as unknown as { db: Database }).db.execute(sql`SELECT pg_sleep(1)`);
      }),
    ).rejects.toMatchObject({ code: 'REPORT_TIMEOUT', details: { timeoutMs: 50 } });
  });

  // --- Uruchomienia -------------------------------------------------------------------------------

  it('uruchomienia: zlecenie, przejęcie, wynik, błąd, porzucone, retencja i historia według uprawnień', async () => {
    const runs = new DrizzleReportRunsRepository(db);
    const staff = await staffId();
    const [a, b, c] = [randomUUID(), randomUUID(), randomUUID()];
    const params = { preset: 'previous_month', from: '2026-10-01', to: '2026-10-31' };
    await runs.insert({ id: a, reportCode: 'revenue', format: 'PDF', params, requestedBy: staff });
    await runs.insert({ id: b, reportCode: 'fleet_usage', format: 'XLSX', params, requestedBy: staff });
    await runs.insert({ id: c, reportCode: 'revenue', format: 'XLSX', params, requestedBy: staff, retryOf: a });
    const tokenA = (await runs.markRunning(a))!;
    const file = (
      await one<{ id: string }>(
        `INSERT INTO files (storage_key, purpose, content_type, size_bytes)
         VALUES ('report/2026/11/' || gen_random_uuid() || '.pdf', 'REPORT_EXPORT', 'application/pdf', 4096) RETURNING id`,
      )
    ).id;
    expect(
      await runs.succeed(a, tokenA, {
        fileId: file,
        dataAsOf: new Date('2026-11-19T10:00:00Z'),
        rowCount: 42,
        pageCount: 3,
      }),
    ).toBe(true);
    expect(await runs.fail(b, (await runs.markRunning(b))!, 'REPORT_RENDER_TIMEOUT', 'Gotenberg 60 s')).toBe(true);
    expect(await runs.get(a)).toMatchObject({
      status: 'SUCCEEDED',
      fileId: file,
      fileSizeBytes: 4096,
      rowCount: 42,
      pageCount: 3,
      requestedByName: 'Piotr Mazur',
      params,
    });
    expect(await runs.get(b)).toMatchObject({ status: 'FAILED', errorCode: 'REPORT_RENDER_TIMEOUT' });

    await pool.query(`UPDATE report_runs SET created_at = now() - interval '20 minutes' WHERE id = $1`, [c]);
    expect(await runs.failAbandoned(new Date(Date.now() - 15 * 60_000))).toEqual([c]);
    expect(await runs.get(c)).toMatchObject({ status: 'FAILED', errorCode: 'REPORT_TIMEOUT', retryOf: a });

    await pool.query(
      `UPDATE report_runs SET started_at = started_at - interval '31 days', finished_at = finished_at - interval '31 days' WHERE id = $1`,
      [a],
    );
    expect((await runs.expiredFiles(new Date(Date.now() - 30 * 86_400_000))).map((r) => r.id)).toEqual([a]);
    expect(await runs.markFileDeleted(a)).toBe(true);
    expect(await runs.markFileDeleted(a)).toBe(false);

    const history = await runs.list(query(reportRunsDef(), 'facets=state,reportCode'), ['revenue']);
    expect(history.items.map((r) => [r.id, r.state])).toEqual([
      [a, 'FILE_DELETED'],
      [c, 'FAILED'],
    ]);
    expect(history.items[0]).toMatchObject({ requestedByRoles: ['Administrator'], fileSizeBytes: 4096, params });
    expect(history.facets.reportCode).toEqual({ revenue: 2 });
    expect((await runs.list(query(reportRunsDef(), ''), [])).total).toBe(0);
    expect((await runs.recentForStaff(staff, ['fleet_usage'])).map((r) => r.id)).toEqual([b]);
  });

  it('uruchomienia: wynik zapisuje tylko wykonanie z aktualnym żetonem przejęcia (dwa wykonania, sweep)', async () => {
    const runs = new DrizzleReportRunsRepository(db);
    const staff = await staffId();
    const params = { preset: 'today', from: '2026-11-19', to: '2026-11-19' };
    const result = { fileId: null as unknown as string, dataAsOf: new Date(), rowCount: 1, pageCount: 1 };
    const newFile = async () =>
      (
        await one<{ id: string }>(
          `INSERT INTO files (storage_key, purpose, content_type, size_bytes)
           VALUES ('report/race/' || gen_random_uuid() || '.pdf', 'REPORT_EXPORT', 'application/pdf', 10) RETURNING id`,
        )
      ).id;

    // Dwa wykonania: drugie przejmuje wiersz, więc wynik, błąd i powrót do kolejki pierwszego nic nie zmieniają.
    const twice = randomUUID();
    await runs.insert({ id: twice, reportCode: 'revenue', format: 'PDF', params, requestedBy: staff });
    const first = (await runs.markRunning(twice))!;
    const second = (await runs.markRunning(twice))!;
    expect(second).not.toBe(first);
    expect(await runs.succeed(twice, first, { ...result, fileId: await newFile() })).toBe(false);
    expect(await runs.fail(twice, first, 'REPORT_FAILED', 'x')).toBe(false);
    expect(await runs.requeue(twice, first)).toBe(false);
    expect(await runs.get(twice)).toMatchObject({ status: 'RUNNING', fileId: null });
    const fileId = await newFile();
    expect(await runs.succeed(twice, second, { ...result, fileId })).toBe(true);
    expect(await runs.get(twice)).toMatchObject({ status: 'SUCCEEDED', fileId });
    // Stan końcowy: ponowne przejęcie i drugi wynik niemożliwe.
    expect(await runs.markRunning(twice)).toBeNull();
    expect(await runs.succeed(twice, second, { ...result, fileId: await newFile() })).toBe(false);

    // `reports.sweep` przed spóźnionym `succeed`.
    const swept = randomUUID();
    await runs.insert({ id: swept, reportCode: 'revenue', format: 'PDF', params, requestedBy: staff });
    const token = (await runs.markRunning(swept))!;
    await pool.query(`UPDATE report_runs SET started_at = started_at - interval '20 minutes' WHERE id = $1`, [swept]);
    expect(await runs.failAbandoned(new Date(Date.now() - 15 * 60_000))).toContain(swept);
    expect(await runs.succeed(swept, token, { ...result, fileId: await newFile() })).toBe(false);
    expect(await runs.get(swept)).toMatchObject({ status: 'FAILED', errorCode: 'REPORT_TIMEOUT', fileId: null });
  });

  it('migawka zadania: łączny limit czasu przerywa kolejne zapytania (REPORT_TIMEOUT z limitem łącznym)', async () => {
    let calls = 0;
    await expect(
      withReportSnapshot(db, { timeoutMs: 60_000, totalTimeoutMs: 300 }, async (repo) => {
        // Każde zapytanie mieści się w limicie jednego zapytania, ale razem przekraczają limit łączny.
        for (;;) {
          await repo.earliestData('revenue');
          calls += 1;
          await (repo as unknown as { db: Database }).db.execute(sql`SELECT pg_sleep(0.1)`);
        }
      }),
    ).rejects.toMatchObject({ code: 'REPORT_TIMEOUT', details: { timeoutMs: 300 } });
    expect(calls).toBeGreaterThanOrEqual(1);
    expect(calls).toBeLessThanOrEqual(4);
    // Zapytanie, które samo przekroczyłoby resztę limitu, przerywa `statement_timeout` równy tej reszcie.
    const started = Date.now();
    await expect(
      withReportSnapshot(db, { timeoutMs: 60_000, totalTimeoutMs: 200 }, async (repo) => {
        await repo.earliestData('revenue');
        await (repo as unknown as { execute: (q: unknown) => Promise<unknown> }).execute(sql`SELECT pg_sleep(5)`);
      }),
    ).rejects.toMatchObject({ code: 'REPORT_TIMEOUT', details: { timeoutMs: 200 } });
    expect(Date.now() - started).toBeLessThan(2_000);
  });

  // --- Listy na widokach 0013 ---------------------------------------------------------------------

  it('każda nowa lista: domyślne zapytanie, liczniki szybkich filtrów i sortowanie po każdym polu', async () => {
    const lists = new DrizzleAdminListsRepository(db);
    const names: Record<string, (q: ListQuery) => Promise<{ total: number; items: unknown[] }>> = {
      consents: (q) => lists.consents(q),
      sessions: (q) => lists.sessions(q),
      'staff-sessions': (q) => lists.staffSessions(q),
      'staff-invitations': (q) => lists.staffInvitations(q),
      'otp-codes': (q) => lists.otpCodes(q),
      permissions: (q) => lists.permissions(q),
      'saved-places': (q) => lists.savedPlaces(q),
      'scooter-commands': (q) => lists.scooterCommands(q),
      'scooter-status-history': (q) => lists.statusHistory(q),
      'rental-events': (q) => lists.rentalEvents(q),
      'zone-presence': (q) => lists.zonePresence(q),
      'zone-control': (q) => lists.zoneControl(q),
      'payment-customers': (q) => lists.paymentCustomers(q),
    };
    for (const [name, list] of Object.entries(names)) {
      const def = ADMIN_RESOURCES.find((r) => r.name === name)!;
      const fields = def.fields as Record<string, FieldDefinition>;
      const facets = Object.keys(fields).filter((f) => fields[f]!.facet);
      await expect(list(query(def, facets.length ? `facets=${facets.join(',')}` : '')), name).resolves.toBeDefined();
      for (const field of Object.keys(fields).filter((f) => fields[f]!.sortable)) {
        await expect(list(query(def, `sort=-${field}`)), `${name} sort ${field}`).resolves.toBeDefined();
      }
      if (def.search.length) await expect(list(query(def, 'q=%230001')), `${name} q`).resolves.toBeDefined();
    }

    const permissions = await lists.permissions(query(permissionsDef(), 'module=reports&sort=code'));
    expect(permissions.items.map((p) => p.code)).toContain('reports.manage');
    expect(permissions.items.find((p) => p.code === 'reports.manage')).toMatchObject({
      roleNames: ['Administrator'],
      inAdministrator: true,
      version: 1,
    });
    const staff = await staffId();
    expect(await lists.updatePermissionDescription('reports.manage', 1, 'Definicje raportów', staff)).toBe(true);
    expect(await lists.updatePermissionDescription('reports.manage', 1, 'Konflikt', staff)).toBe(false);

    // Historia stanów: przedziały nachodzące na okres, także otwarte; przejazdy z poprzedniego testu.
    const history = await lists.statusHistory(query(historyDef(), 'scooterNumber=1'), {
      overlap: { from: new Date(Date.now() - 3_600_000), to: new Date(Date.now() + 3_600_000) },
    });
    expect(history.items.every((h) => h.scooterNumber === 1)).toBe(true);
    expect(history.items.some((h) => h.isOpen)).toBe(true);
    const scooter = (await one<{ id: string }>(`SELECT id FROM scooters WHERE number = 1`)).id;
    expect(
      (await lists.statusIntervals(scooter, { from: new Date(0), to: new Date(Date.now() + 1000) })).length,
    ).toBeGreaterThan(0);

    // Wszystkie strony partiami (eksport listy).
    const batches: number[] = [];
    for await (const items of listPages((q) => lists.permissions(q), query(permissionsDef(), ''), 10))
      batches.push(items.length);
    expect(batches.reduce((s, n) => s + n, 0)).toBe((await lists.permissions(query(permissionsDef(), ''))).total);
    expect(batches[0]).toBe(10);
  });

  it('telemetria z kursorem: strony starsze i nowsze bez nakładania, bez liczby wszystkich', async () => {
    const scooter = (await one<{ id: string }>(`SELECT id FROM scooters WHERE number = 2`)).id;
    await pool.query(
      `INSERT INTO telemetry (scooter_id, recorded_at, position, battery_pct, speed_kmh, locked, buffered)
       SELECT $1, timestamptz '2026-11-18T10:00:00Z' + make_interval(secs => i * 5), ST_SetSRID(ST_MakePoint(18.5, 50.0), 4326),
              80 - i, 0, true, false
       FROM generate_series(0, 24) AS i`,
      [scooter],
    );
    const lists = new DrizzleAdminListsRepository(db);
    const base = {
      scooterId: scooter,
      from: '2026-11-18T10:00:00Z',
      to: '2026-11-18T11:00:00Z',
      direction: 'older' as const,
      pageSize: 10,
    };
    const first = await lists.telemetryReadings(base);
    expect(first.items).toHaveLength(10);
    expect(first.items[0]!.recordedAt).toBe('2026-11-18T10:02:00.000Z');
    expect(first.items[1]!.gapSeconds).toBe(5);
    expect(first.newerCursor).toBeNull();
    const second = await lists.telemetryReadings({ ...base, cursor: first.olderCursor! });
    expect(second.items[0]!.recordedAt).toBe('2026-11-18T10:01:10.000Z');
    const third = await lists.telemetryReadings({ ...base, cursor: second.olderCursor! });
    expect(third.items).toHaveLength(5);
    expect(third.olderCursor).toBeNull();
    const back = await lists.telemetryReadings({ ...base, direction: 'newer', cursor: second.newerCursor! });
    expect(back.items.map((i) => i.recordedAt)).toEqual(first.items.map((i) => i.recordedAt));
    expect(back.newerCursor).toBeNull();
    const low = await lists.telemetryReadings({ ...base, batteryBelow: 60 });
    expect(low.items.map((i) => i.batteryPct)).toEqual([56, 57, 58, 59]);
  });
});

function query(def: ResourceDefinition, qs: string): ListQuery {
  const result = parseListQuery(def, new URLSearchParams(qs));
  if (!result.ok) throw new Error(JSON.stringify(result.issues));
  return result.query;
}
const byName = (name: string) => ADMIN_RESOURCES.find((r) => r.name === name)!;
const definitionsDef = () => byName('report-definitions');
const reportRunsDef = () => byName('report-runs');
const permissionsDef = () => byName('permissions');
const historyDef = () => byName('scooter-status-history');
