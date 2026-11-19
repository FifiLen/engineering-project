import { DATA_EXPORT_INTERVAL_MS, DATA_EXPORT_TTL_MS } from '@hulajnogi/core';
import { DATA_EXPORT_SECTIONS, dataExportSchema } from '@hulajnogi/shared';
import type * as shared from '@hulajnogi/shared';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { DataExportRegistry } from '../src/data-export/data-export.registry.js';
import { FILE_STORAGE, type MemoryFileStorage } from '../src/files/file-storage.js';
import { JOBS } from '../src/jobs/jobs.service.js';
import { FleetGateway } from '../src/realtime/fleet.gateway.js';
import { fundWallet } from './helpers.js';
import { operationsContext, type OperationsContext } from './operations-helpers.js';

const hasDb = Boolean(process.env.DATABASE_URL);

describe.skipIf(!hasDb)('eksport danych klienta (ADR 0069)', () => {
  let ctx: OperationsContext;
  let anna: { id: string; token: string };
  const events = () => vi.mocked(ctx.app.get(FleetGateway).dataExportReady);

  const runExports = async () => {
    for (const job of ctx.jobs().sent.filter((j) => j.name === JOBS.dataExportGenerate)) {
      await ctx.jobs().run(JOBS.dataExportGenerate, job.data);
    }
  };

  beforeAll(async () => {
    ctx = await operationsContext('data_export_api', 2, { DOCUMENT_RENDERER: 'fake' });
    vi.spyOn(ctx.app.get(FleetGateway), 'dataExportReady');
    anna = await ctx.register('+48500800100', 'Anna Eksportowa');
    await ctx.ride(anna.token, 1);
    await ctx.endRide(anna.token, 1);
  });

  afterAll(async () => {
    await ctx?.close();
  });

  it('zlecenie, plik JSON zgodny ze schematem, powiadomienie, zdarzenie i limit raz na 24 h', async () => {
    const me = ctx.customer(anna.token);
    const requested = await me({ method: 'POST', url: '/me/data-exports' });
    expect(requested.statusCode).toBe(202);
    const view = requested.json<shared.DataExportView>();
    expect(view).toMatchObject({ status: 'QUEUED', state: 'QUEUED', file: null });
    expect(ctx.jobs().sent.at(-1)).toMatchObject({ name: JOBS.dataExportGenerate, singletonKey: view.id });

    const limited = await me({ method: 'POST', url: '/me/data-exports' });
    expect(limited.statusCode).toBe(429);
    const limit = limited.json<{ code: string; details: { nextAllowedAt: string } }>();
    expect(limit.code).toBe('DATA_EXPORT_LIMIT');
    expect(new Date(limit.details.nextAllowedAt).getTime()).toBe(
      new Date(view.requestedAt).getTime() + DATA_EXPORT_INTERVAL_MS,
    );

    await runExports();
    const latest = (await me({ method: 'GET', url: '/me/data-exports/latest' })).json<shared.DataExportLatest>();
    expect(latest.export).toMatchObject({ id: view.id, status: 'SUCCEEDED', state: 'SUCCEEDED', errorCode: null });
    expect(latest.export!.sizeBytes).toBeGreaterThan(100);
    expect(new Date(latest.export!.expiresAt!).getTime() - new Date(latest.export!.finishedAt!).getTime()).toBe(
      DATA_EXPORT_TTL_MS,
    );
    // Ta sama reguła limitu w core (odpowiedź API) i w bazie (`fn_data_export_next_allowed_at`).
    const db = (await ctx.pool.query<{ at: Date }>('SELECT fn_data_export_next_allowed_at($1) AS at', [anna.id]))
      .rows[0]!.at;
    expect(latest.nextAllowedAt).toBe(db.toISOString());
    expect(latest.export!.file!.fileName).toMatch(/^dane-\d{4}-\d{2}-\d{2}\.json$/);

    const file = await ctx.app.inject({ method: 'GET', url: latest.export!.file!.url });
    expect(file.statusCode).toBe(200);
    expect(file.headers['content-type']).toBe('application/json');
    expect(file.headers['content-disposition']).toBe(`attachment; filename="${latest.export!.file!.fileName}"`);
    expect(file.headers['cache-control']).toBe('private, no-store');
    const json = JSON.parse(file.body) as shared.DataExportFile;
    expect(dataExportSchema.safeParse(json).success).toBe(true);
    for (const section of DATA_EXPORT_SECTIONS) expect(json[section].about).toEqual(expect.any(String));
    expect(json.profile).toMatchObject({ phone: '+48500800100', name: 'Anna Eksportowa' });
    expect(json.rentals.items).toHaveLength(1);
    expect(json.rentals.items[0]).toMatchObject({ scooterNumber: '0001', state: 'ENDED', end: { zone: 'P-01' } });
    expect(json.receipts.items[0]!.items[0]).toMatchObject({ code: 'UNLOCK', amount: { currency: 'PLN' } });
    expect(json.wallet.balance.grosze).toBeGreaterThan(0);
    expect(json.consents.items.length).toBeGreaterThan(0);
    expect(file.body).not.toMatch(/refresh_token|token_hash|code_hash/i);

    const notification = (
      await ctx.pool.query<{ status: string; payload: { params: { expiresAt: string } } }>(
        `SELECT status::text, payload FROM notifications WHERE dedupe_key = $1`,
        [`data_export_ready:${view.id}`],
      )
    ).rows;
    expect(notification).toHaveLength(1);
    expect(notification[0]!.payload.params.expiresAt).toMatch(/^\d{2}\.\d{2}\.\d{4}, \d{2}:\d{2}$/);
    expect(events()).toHaveBeenLastCalledWith(anna.id, expect.objectContaining({ id: view.id, status: 'SUCCEEDED' }));

    // Zadanie uruchomione drugi raz (powtórka z kolejki) niczego nie dubluje.
    await ctx.jobs().run(JOBS.dataExportGenerate, { exportId: view.id });
    expect((await ctx.pool.query('SELECT 1 FROM files WHERE purpose = $1', ['DATA_EXPORT'])).rowCount).toBe(1);
  });

  it('nieudane zlecenie nie liczy się do limitu i nie wysyła powiadomienia; plik niezgodny ze schematem nie powstaje', async () => {
    const bob = await ctx.register('+48500800200', 'Bob Błędny');
    const me = ctx.customer(bob.token);
    const registry = ctx.app.get(DataExportRegistry);
    const collect = vi.spyOn(registry, 'collect').mockRejectedValueOnce(new Error('Port niedostępny'));
    const first = (await me({ method: 'POST', url: '/me/data-exports' })).json<shared.DataExportView>();
    await ctx.jobs().run(JOBS.dataExportGenerate, { exportId: first.id });
    let latest = (await me({ method: 'GET', url: '/me/data-exports/latest' })).json<shared.DataExportLatest>();
    expect(latest).toMatchObject({
      export: { status: 'FAILED', errorCode: 'DATA_EXPORT_FAILED' },
      nextAllowedAt: null,
    });
    expect(events()).toHaveBeenLastCalledWith(bob.id, expect.objectContaining({ id: first.id, status: 'FAILED' }));

    // Pole spoza schematu albo zły typ z portu zatrzymuje zapis pliku (ścisły schemat z shared).
    collect.mockRestore();
    const sources = await registry.collect(bob.id);
    vi.spyOn(registry, 'collect').mockResolvedValueOnce({
      ...sources,
      notifications: [{ code: 'x', title: null, body: null as unknown as string, sentAt: null, readAt: null }],
    });
    const second = await me({ method: 'POST', url: '/me/data-exports' });
    expect(second.statusCode).toBe(202);
    await ctx.jobs().run(JOBS.dataExportGenerate, { exportId: second.json<shared.DataExportView>().id });
    latest = (await me({ method: 'GET', url: '/me/data-exports/latest' })).json<shared.DataExportLatest>();
    expect(latest.export).toMatchObject({ status: 'FAILED', errorCode: 'DATA_EXPORT_SCHEMA_INVALID' });
    const files = await ctx.pool.query(`SELECT 1 FROM files WHERE purpose = 'DATA_EXPORT' AND uploaded_by = $1`, [
      bob.id,
    ]);
    expect(files.rowCount).toBe(0);
    const notifications = await ctx.pool.query(
      `SELECT 1 FROM notifications WHERE user_id = $1 AND template_code = $2`,
      [bob.id, 'data_export_ready'],
    );
    expect(notifications.rowCount).toBe(0);
    expect((await me({ method: 'POST', url: '/me/data-exports' })).statusCode).toBe(202);
  });

  it('ważność 7 dni: po expires_at stan EXPIRED bez adresu, a data-exports.purge usuwa plik i zostawia wiersz', async () => {
    const row = (
      await ctx.pool.query<{ id: string; file_id: string }>(
        `UPDATE data_exports SET finished_at = now() - interval '8 days', expires_at = now() - interval '1 day'
         WHERE user_id = $1 AND status = 'SUCCEEDED' RETURNING id, file_id`,
        [anna.id],
      )
    ).rows[0]!;
    const me = ctx.customer(anna.token);
    const latest = (await me({ method: 'GET', url: '/me/data-exports/latest' })).json<shared.DataExportLatest>();
    expect(latest.export).toMatchObject({ id: row.id, state: 'EXPIRED', file: null });
    const storage = ctx.app.get<MemoryFileStorage>(FILE_STORAGE);
    const key = (
      await ctx.pool.query<{ storage_key: string }>('SELECT storage_key FROM files WHERE id = $1', [row.file_id])
    ).rows[0]!.storage_key;
    expect(storage.objects.has(key)).toBe(true);
    await ctx.jobs().run(JOBS.dataExportsPurge);
    expect(storage.objects.has(key)).toBe(false);
    const after = (
      await ctx.pool.query<{ deleted_at: Date | null; status: string }>(
        `SELECT e.deleted_at, f.status::text AS status FROM data_exports e JOIN files f ON f.id = e.file_id WHERE e.id = $1`,
        [row.id],
      )
    ).rows[0]!;
    expect(after.deleted_at).not.toBeNull();
    expect(after.status).toBe('DELETED');
    const list = (await ctx.staff.dispatcher({ method: 'GET', url: `/admin/data-exports?userId=${anna.id}` })).json<
      shared.ListResponse<shared.DataExportListItem>
    >();
    expect(list.items[0]).toMatchObject({ id: row.id, state: 'DELETED', userName: 'Anna Eksportowa' });
    expect((await ctx.staff.technician({ method: 'GET', url: '/admin/data-exports' })).statusCode).toBe(403);
  });

  it('usunięcie konta zamyka zlecenie w toku (ACCOUNT_DELETED) i planuje usunięcie plików', async () => {
    const carl = await ctx.register('+48500800300', 'Carl Odchodzący');
    await fundWallet(ctx.pool, carl.id, -50_000);
    const me = ctx.customer(carl.token);
    const exp = (await me({ method: 'POST', url: '/me/data-exports' })).json<shared.DataExportView>();
    expect((await me({ method: 'DELETE', url: '/me' })).statusCode).toBe(204);
    const row = (
      await ctx.pool.query<{ status: string; error_code: string }>(
        'SELECT status::text, error_code FROM data_exports WHERE id = $1',
        [exp.id],
      )
    ).rows[0]!;
    expect(row).toEqual({ status: 'FAILED', error_code: 'ACCOUNT_DELETED' });
    expect(ctx.jobs().sent.at(-1)).toMatchObject({ name: JOBS.dataExportsPurge, data: { userId: carl.id } });
    // Zadanie z kolejki po zamknięciu zlecenia nic nie robi.
    await ctx.jobs().run(JOBS.dataExportGenerate, { exportId: exp.id });
    expect((await ctx.pool.query('SELECT status::text FROM data_exports WHERE id = $1', [exp.id])).rows[0]).toEqual({
      status: 'FAILED',
    });
  });

  it('restart API w trakcie eksportu: ponowienie przejmuje RUNNING po 300 s, sprzątanie odblokowuje zlecenie', async () => {
    const dora = await ctx.register('+48500800400', 'Dora Restartowa');
    const me = ctx.customer(dora.token);
    const first = (await me({ method: 'POST', url: '/me/data-exports' })).json<shared.DataExportView>();
    // Zadanie przerwane restartem: wiersz RUNNING od 6 min, ponowienie pg-boss przejmuje go i kończy eksport.
    await ctx.pool.query(
      `UPDATE data_exports SET status = 'RUNNING', started_at = now() - interval '6 minutes' WHERE id = $1`,
      [first.id],
    );
    await ctx.jobs().run(JOBS.dataExportGenerate, { exportId: first.id });
    expect((await me({ method: 'GET', url: '/me/data-exports/latest' })).json()).toMatchObject({
      export: { id: first.id, status: 'SUCCEEDED' },
    });

    // Zlecenie bez zadania (RUNNING od 40 min) blokowałoby klienta na zawsze (409 DATA_EXPORT_IN_PROGRESS).
    await ctx.pool.query(`UPDATE data_exports SET requested_at = now() - interval '2 days' WHERE id = $1`, [first.id]);
    const stuck = (await me({ method: 'POST', url: '/me/data-exports' })).json<shared.DataExportView>();
    await ctx.pool.query(
      `UPDATE data_exports SET status = 'RUNNING', started_at = now() - interval '40 minutes',
              requested_at = now() - interval '41 minutes' WHERE id = $1`,
      [stuck.id],
    );
    events().mockClear();
    await ctx.jobs().run(JOBS.dataExportsSweep);
    expect(
      (await ctx.pool.query('SELECT status::text, error_code FROM data_exports WHERE id = $1', [stuck.id])).rows[0],
    ).toEqual({ status: 'FAILED', error_code: 'DATA_EXPORT_FAILED' });
    expect(events()).toHaveBeenCalledWith(dora.id, expect.objectContaining({ id: stuck.id, status: 'FAILED' }));
    // Nieudane nie liczy się do limitu: klient zleca od razu.
    expect((await me({ method: 'POST', url: '/me/data-exports' })).statusCode).toBe(202);
  });

  it('usuwanie plików przechodzi kolejne partie po 200 (nie tylko pierwszą)', async () => {
    const eve = await ctx.register('+48500800500', 'Ewa Partiowa');
    // 205 gotowych, wygasłych plików eksportu jednego klienta (dane testowe wprost w bazie).
    await ctx.pool.query(
      `WITH f AS (
         INSERT INTO files (storage_key, purpose, content_type, size_bytes, status, uploaded_by)
         SELECT 'data-export/test/' || g || '.json', 'DATA_EXPORT', 'application/json', 10, 'READY', $1
         FROM generate_series(1, 205) g RETURNING id)
       INSERT INTO data_exports (user_id, status, file_id, size_bytes, requested_at, started_at, finished_at, expires_at)
       SELECT $1, 'SUCCEEDED', id, 10, now() - interval '9 days', now() - interval '9 days',
              now() - interval '9 days', now() - interval '2 days' FROM f`,
      [eve.id],
    );
    await ctx.jobs().run(JOBS.dataExportsPurge, {});
    const left = await ctx.pool.query(
      `SELECT count(*)::int AS n FROM data_exports WHERE user_id = $1 AND deleted_at IS NULL`,
      [eve.id],
    );
    expect(left.rows[0]).toEqual({ n: 0 });
  });
});
