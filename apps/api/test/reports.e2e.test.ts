import { localDateOf } from '@hulajnogi/core';
import {
  reportPreviewSchema,
  type DocumentFileLink,
  type ListResponse,
  type ReportCatalog,
  type ReportDefinitionDetails,
  type ReportDefinitionListItem,
  type ReportRunListItem,
  type ReportRunView,
} from '@hulajnogi/shared';
import type { NestFastifyApplication } from '@nestjs/platform-fastify';
import ExcelJS from 'exceljs';
import type { InjectOptions } from 'fastify';
import { afterAll, beforeAll, describe, expect, it, vi, type MockInstance } from 'vitest';
import { DOCUMENT_RENDERER, type FakeRenderer } from '../src/documents/renderers.js';
import { JOBS } from '../src/jobs/jobs.service.js';
import { FleetGateway } from '../src/realtime/fleet.gateway.js';
import { asStaff, staffToken } from './helpers.js';
import { operationsContext, type OperationsContext } from './operations-helpers.js';

const hasDb = Boolean(process.env.DATABASE_URL);
type Inject = (options: InjectOptions) => ReturnType<NestFastifyApplication['inject']>;

describe.skipIf(!hasDb)('raporty (ADR 0071)', () => {
  let ctx: OperationsContext;
  let editor: Inject;
  let renderer: FakeRenderer;
  let ready: MockInstance<FleetGateway['reportReady']>;
  let today: string;
  let done = 0;

  /** Zadania `report.generate` zaplanowane od ostatniego wywołania, wykonane po kolei. */
  async function runReportJobs(attempt?: { retryCount: number; retryLimit: number }): Promise<void> {
    const pending = ctx
      .jobs()
      .sent.slice(done)
      .filter((job) => job.name === JOBS.reportGenerate);
    done = ctx.jobs().sent.length;
    for (const job of pending) await ctx.jobs().run(JOBS.reportGenerate, job.data, attempt);
  }

  async function exportReport(who: Inject, code: string, format: 'PDF' | 'XLSX', params: object) {
    const res = await who({ method: 'POST', url: `/admin/reports/${code}/runs`, payload: { format, params } });
    expect(res.statusCode, res.body).toBe(202);
    return res.json<ReportRunView>();
  }

  async function finished(who: Inject, id: string): Promise<ReportRunView> {
    await runReportJobs();
    return (await who({ method: 'GET', url: `/admin/report-runs/${id}` })).json<ReportRunView>();
  }

  async function download(link: DocumentFileLink) {
    const res = await ctx.app.inject({ method: 'GET', url: link.url });
    expect(res.statusCode).toBe(200);
    return res;
  }

  beforeAll(async () => {
    ctx = await operationsContext('reports_api', 4, { DOCUMENT_RENDERER: 'fake' });
    const editorId = (
      await ctx.pool.query<{ id: string }>(
        `INSERT INTO staff (email, name, password_hash) VALUES ('r@test.local', 'Redaktor Testowy', 'x') RETURNING id`,
      )
    ).rows[0]!.id;
    await ctx.pool.query(
      `INSERT INTO staff_roles (staff_id, role_id) SELECT $1, id FROM roles WHERE name = 'Redaktor'`,
      [editorId],
    );
    editor = asStaff(ctx.app, staffToken(ctx.app, editorId));
    renderer = ctx.app.get<FakeRenderer>(DOCUMENT_RENDERER);
    ready = vi.spyOn(ctx.app.get(FleetGateway), 'reportReady');
    today = localDateOf(new Date());

    // Przejazd z portfela zakończony dziś: paragon sprzedaży (ADR 0052) i dane wszystkich raportów przejazdów.
    const anna = await ctx.register('+48500800100', 'Anna Raportowa');
    await ctx.ride(anna.token, 1);
    await ctx.endRide(anna.token, 1);
  });

  afterAll(async () => {
    await ctx?.close();
  });

  it('katalog według uprawnień: Administrator wszystkie, Dyspozytor floty i stref, Serwisant awaryjność, Redaktor nic', async () => {
    const codes = async (who: Inject) => {
      const res = await who({ method: 'GET', url: '/admin/reports' });
      expect(res.statusCode).toBe(200);
      const body = res.json<ReportCatalog>();
      return { codes: body.items.map((i) => i.code), canManage: body.canManage, body };
    };
    const admin = await codes(ctx.staff.admin);
    expect(admin.codes).toEqual(['revenue', 'fleet_usage', 'rides_by_zone', 'reliability', 'users', 'wallet']);
    expect(admin.canManage).toBe(true);
    const revenue = admin.body.items[0]!;
    expect(revenue).toMatchObject({
      name: 'Przychody',
      formats: ['PDF', 'XLSX'],
      orientation: 'portrait',
      params: { granularity: true, compare: true, filters: [] },
      lastRun: null,
    });
    expect(revenue.sections.tables.map((t) => t.key)).toContain('salesByVat');
    expect(await codes(ctx.staff.dispatcher)).toMatchObject({
      codes: ['fleet_usage', 'rides_by_zone'],
      canManage: false,
    });
    expect((await codes(ctx.staff.technician)).codes).toEqual(['reliability']);
    expect((await codes(editor)).codes).toEqual([]);
  });

  it('podgląd przychodów na danych testowych: kafelki, wykres, tabele, chwila danych i najwcześniejsze dane', async () => {
    const res = await ctx.staff.admin({ method: 'GET', url: '/admin/reports/revenue/preview?preset=today&compare=1' });
    expect(res.statusCode, res.body).toBe(200);
    const preview = reportPreviewSchema.parse(res.json());
    expect(preview).toMatchObject({ code: 'revenue', name: 'Przychody', empty: false });
    expect(preview.params).toMatchObject({ preset: 'today', from: today, to: today, days: 1, granularity: 'day' });
    expect(preview.params.comparison).not.toBeNull();
    const tile = (key: string) => preview.tiles.find((t) => t.key === key)!;
    expect(tile('rides').value).toBe(1);
    const gross = (
      await ctx.pool.query<{ total: string }>(`SELECT sum(total_amount) AS total FROM receipts WHERE kind = 'SALE'`)
    ).rows[0]!.total;
    expect(tile('salesGross').value).toBe(Number(gross));
    expect(preview.charts[0]).toMatchObject({ type: 'bar', axis: 'time', items: [{ key: today }] });
    expect(preview.tables.map((t) => t.key)).toEqual([
      'salesByVat',
      'inflowsByMethod',
      'refunds',
      'salesByZone',
      'salesSeries',
    ]);
    expect(preview.earliestDataAt).not.toBeNull();
    expect(Date.parse(preview.dataAsOf)).toBeGreaterThan(Date.now() - 60_000);

    // Pozostałe raporty liczą się na tych samych danych bez błędu.
    for (const code of ['fleet_usage', 'rides_by_zone', 'reliability', 'users', 'wallet']) {
      const other = await ctx.staff.admin({ method: 'GET', url: `/admin/reports/${code}/preview?preset=this_month` });
      expect(other.statusCode, `${code}: ${other.body}`).toBe(200);
      reportPreviewSchema.parse(other.json());
    }
    const rides = reportPreviewSchema.parse(
      (await ctx.staff.dispatcher({ method: 'GET', url: '/admin/reports/rides_by_zone/preview?preset=today' })).json(),
    );
    expect(rides.tiles.find((t) => t.key === 'rides')!.value).toBe(1);
    expect(rides.charts[0]).toMatchObject({ type: 'heatmap' });
  });

  it('podgląd bez uprawnienia, nieznany i wyłączony raport to 404 REPORT_NOT_FOUND', async () => {
    const dispatcher = await ctx.staff.dispatcher({ method: 'GET', url: '/admin/reports/revenue/preview' });
    expect(dispatcher.statusCode).toBe(404);
    expect(dispatcher.json()).toMatchObject({ code: 'REPORT_NOT_FOUND' });
    expect((await ctx.staff.admin({ method: 'GET', url: '/admin/reports/nieznany/preview' })).statusCode).toBe(404);
    expect((await editor({ method: 'GET', url: '/admin/reports/wallet/preview' })).statusCode).toBe(404);
  });

  it('walidacja parametrów: kształt (400 VALIDATION_ERROR), reguły okresu z core, parametr spoza raportu pomijany', async () => {
    const preview = (query: string) =>
      ctx.staff.admin({ method: 'GET', url: `/admin/reports/revenue/preview?${query}` });
    const error = async (query: string, code: string, status = 400) => {
      const res = await preview(query);
      expect(res.statusCode, `${query}: ${res.body}`).toBe(status);
      expect(res.json<{ code: string }>().code).toBe(code);
      return res.json<{ details?: Record<string, unknown> }>();
    };
    await error('from=2026-10-31&to=2026-10-01', 'REPORT_RANGE_INVALID');
    await error('from=2026-10-01&to=2999-01-01', 'REPORT_RANGE_IN_FUTURE');
    expect((await error('from=2024-01-01&to=2025-06-30', 'REPORT_RANGE_TOO_LONG')).details).toMatchObject({
      maxDays: 366,
    });
    await error('from=2026-1-01&to=2026-10-31', 'VALIDATION_ERROR');
    await error('from=2026-02-30&to=2026-03-31', 'VALIDATION_FAILED');
    await error('granularity=hour', 'VALIDATION_ERROR');
    await error('preset=custom', 'VALIDATION_FAILED');
    await error('from=2026-10-01', 'VALIDATION_FAILED');
    // Parametr innego raportu z adresu jest pomijany (schemat w shared), więc nie psuje podglądu.
    const zones = await ctx.staff.admin({ method: 'GET', url: '/admin/reports/rides_by_zone/preview?granularity=day' });
    expect(zones.statusCode).toBe(200);
    expect(zones.json()).toMatchObject({ params: { granularity: null } });
  });

  it('eksport pustego raportu to 409 REPORT_EMPTY, format spoza definicji 422 REPORT_FORMAT_NOT_ALLOWED', async () => {
    const empty = await ctx.staff.admin({
      method: 'POST',
      url: '/admin/reports/revenue/runs',
      payload: { format: 'PDF', params: { from: '2020-01-01', to: '2020-01-31' } },
    });
    expect(empty.statusCode).toBe(409);
    expect(empty.json()).toMatchObject({ code: 'REPORT_EMPTY' });
    // Podgląd tego okresu działa i pokazuje stan „Brak danych”.
    const preview = await ctx.staff.admin({
      method: 'GET',
      url: '/admin/reports/revenue/preview?from=2020-01-01&to=2020-01-31',
    });
    expect(preview.json()).toMatchObject({ empty: true });

    await ctx.pool.query(`UPDATE report_definitions SET formats = '{PDF}' WHERE code = 'wallet'`);
    const xlsx = await ctx.staff.admin({
      method: 'POST',
      url: '/admin/reports/wallet/runs',
      payload: { format: 'XLSX', params: { preset: 'today' } },
    });
    expect(xlsx.statusCode).toBe(422);
    expect(xlsx.json()).toMatchObject({ code: 'REPORT_FORMAT_NOT_ALLOWED' });
    await ctx.pool.query(`UPDATE report_definitions SET formats = '{PDF,XLSX}' WHERE code = 'wallet'`);
    expect(
      (
        await ctx.staff.admin({
          method: 'POST',
          url: '/admin/reports/wallet/runs',
          payload: { format: 'CSV', params: {} },
        })
      ).statusCode,
    ).toBe(400);
    done = ctx.jobs().sent.length;
  });

  it('eksport PDF: wiersz QUEUED i zadanie, HTML ze stopką przez silnik, plik do pobrania i report.ready', async () => {
    const queued = await exportReport(ctx.staff.admin, 'revenue', 'PDF', { preset: 'today' });
    expect(queued).toMatchObject({
      reportCode: 'revenue',
      format: 'PDF',
      status: 'QUEUED',
      state: 'QUEUED',
      file: null,
    });
    expect(queued.params).toMatchObject({ preset: 'today', from: today, to: today, granularity: 'day', compare: true });
    expect(ctx.jobs().sent.at(-1)).toMatchObject({ name: JOBS.reportGenerate, data: { runId: queued.id } });
    expect((await ctx.auditOf(queued.id, 'report_run.requested')).length).toBe(1);

    const run = await finished(ctx.staff.admin, queued.id);
    expect(run).toMatchObject({ status: 'SUCCEEDED', state: 'SUCCEEDED', pageCount: 1, errorCode: null });
    expect(run.rowCount).toBeGreaterThan(0);
    expect(run.dataAsOf).not.toBeNull();
    expect(run.fileName).toBe(`revenue-${today}.pdf`);
    const call = renderer.calls.at(-1)!;
    expect(call).toMatchObject({ kind: 'html', trace: queued.id, assets: ['footer.html'], timeoutMs: 60_000 });
    expect(call.html).toContain('<h1>Przychody</h1>');
    expect(call.html).toContain('Sprzedaż według stawek VAT');
    expect(call.html).toContain('size: A4 portrait');
    expect(call.html).toContain(queued.shortId);

    const file = await download(run.file!);
    expect(file.headers['content-type']).toBe('application/pdf');
    expect(file.headers['content-disposition']).toBe(`inline; filename="revenue-${today}.pdf"`);
    expect(file.rawPayload.subarray(0, 5).toString()).toBe('%PDF-');
    const link = await ctx.staff.admin({ method: 'GET', url: `/admin/report-runs/${queued.id}/file` });
    expect(link.statusCode).toBe(200);
    expect(link.json<DocumentFileLink>().fileName).toBe(`revenue-${today}.pdf`);

    expect(ready).toHaveBeenLastCalledWith(
      ctx.staffIds.admin,
      expect.objectContaining({
        id: queued.id,
        status: 'SUCCEEDED',
        file: expect.objectContaining({ url: expect.any(String) }),
      }),
    );
    const catalog = (await ctx.staff.admin({ method: 'GET', url: '/admin/reports' })).json<ReportCatalog>();
    expect(catalog.items[0]!.lastRun).toMatchObject({ id: queued.id, state: 'SUCCEEDED', format: 'PDF' });
    expect(catalog.recentRuns[0]).toMatchObject({ id: queued.id });
  });

  it('eksport XLSX: prawdziwy skoroszyt ExcelJS z arkuszem „Parametry”, kwotami w złotych i formatem', async () => {
    const queued = await exportReport(ctx.staff.admin, 'revenue', 'XLSX', { preset: 'today' });
    const run = await finished(ctx.staff.admin, queued.id);
    expect(run).toMatchObject({ status: 'SUCCEEDED', pageCount: null, fileName: `revenue-${today}.xlsx` });
    const file = await download(run.file!);
    expect(file.headers['content-type']).toBe('application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    expect(file.headers['content-disposition']).toBe(`attachment; filename="revenue-${today}.xlsx"`);

    const workbook = new ExcelJS.Workbook();
    await workbook.xlsx.load(file.rawPayload as unknown as ArrayBuffer);
    expect(workbook.worksheets.map((s) => s.name)).toEqual([
      'Parametry',
      'Sprzedaż według VAT',
      'Wpływy',
      'Zwroty',
      'Sprzedaż według stref',
      'Sprzedaż w czasie',
    ]);
    const params = workbook.getWorksheet('Parametry')!;
    expect(params.getRow(2).values).toEqual([undefined, 'Raport', 'Przychody']);
    expect(params.getColumn(1).values).toContain('Dane na');

    const vat = workbook.getWorksheet('Sprzedaż według VAT')!;
    expect(vat.getRow(1).values).toEqual([undefined, 'Pozycja', 'Stawka', 'Paragony', 'Netto', 'VAT', 'Brutto']);
    expect(vat.views[0]).toMatchObject({ state: 'frozen', ySplit: 1 });
    const gross = (
      await ctx.pool.query<{ total: string }>(`SELECT sum(total_amount) AS total FROM receipts WHERE kind = 'SALE'`)
    ).rows[0]!.total;
    const cell = vat.getRow(2).getCell(6);
    expect(cell.value).toBe(Number(gross) / 100);
    expect(typeof cell.value).toBe('number');
    expect(cell.numFmt).toBe('#,##0.00 "zł"');
    const series = workbook.getWorksheet('Sprzedaż w czasie')!;
    const bucket = series.getRow(2).getCell(1);
    expect(bucket.value).toBeInstanceOf(Date);
    expect((bucket.value as Date).toISOString().slice(0, 10)).toBe(today);
    expect(bucket.numFmt).toBe('dd.mm.yyyy');
  });

  it('historia: cudze uruchomienia raportów z uprawnieniem, bez uprawnienia 404, bez żadnego raportu 403', async () => {
    const fleet = await exportReport(ctx.staff.dispatcher, 'fleet_usage', 'PDF', { preset: 'today' });
    await finished(ctx.staff.dispatcher, fleet.id);
    const call = renderer.calls.at(-1)!;
    expect(call.html).toContain('size: A4 landscape');

    const admin = (await ctx.staff.admin({ method: 'GET', url: '/admin/report-runs?sort=-createdAt' })).json<
      ListResponse<ReportRunListItem>
    >();
    expect(admin.items.map((i) => i.reportCode)).toEqual(expect.arrayContaining(['revenue', 'fleet_usage']));
    expect(admin.items.find((i) => i.id === fleet.id)).toMatchObject({
      requestedByName: 'Dyspozytor Testowy',
      state: 'SUCCEEDED',
      shortId: fleet.shortId,
    });
    const search = (await ctx.staff.admin({ method: 'GET', url: `/admin/report-runs?q=${fleet.shortId}` })).json<
      ListResponse<ReportRunListItem>
    >();
    expect(search.items.map((i) => i.id)).toEqual([fleet.id]);

    const dispatcher = (await ctx.staff.dispatcher({ method: 'GET', url: '/admin/report-runs' })).json<
      ListResponse<ReportRunListItem>
    >();
    expect(new Set(dispatcher.items.map((i) => i.reportCode))).toEqual(new Set(['fleet_usage']));

    const revenue = admin.items.find((i) => i.reportCode === 'revenue')!;
    for (const url of [`/admin/report-runs/${revenue.id}`, `/admin/report-runs/${revenue.id}/file`]) {
      const res = await ctx.staff.technician({ method: 'GET', url });
      expect(res.statusCode).toBe(404);
      expect(res.json()).toMatchObject({ code: 'REPORT_RUN_NOT_FOUND' });
    }
    expect(
      (await ctx.staff.technician({ method: 'POST', url: `/admin/report-runs/${revenue.id}/retry` })).statusCode,
    ).toBe(404);
    // Cudze uruchomienie raportu z uprawnieniem: szczegóły i plik.
    expect((await ctx.staff.admin({ method: 'GET', url: `/admin/report-runs/${fleet.id}/file` })).statusCode).toBe(200);
    const none = await editor({ method: 'GET', url: '/admin/report-runs' });
    expect(none.statusCode).toBe(403);
  });

  it('plik przed końcem 409 REPORT_RUN_NOT_READY, ponowienie w toku 409, ponowienie gotowego z tym samym okresem', async () => {
    const queued = await exportReport(ctx.staff.admin, 'wallet', 'PDF', { preset: 'today', compare: false });
    const file = await ctx.staff.admin({ method: 'GET', url: `/admin/report-runs/${queued.id}/file` });
    expect(file.statusCode).toBe(409);
    expect(file.json()).toMatchObject({ code: 'REPORT_RUN_NOT_READY' });
    const busy = await ctx.staff.admin({ method: 'POST', url: `/admin/report-runs/${queued.id}/retry` });
    expect(busy.statusCode).toBe(409);
    expect(busy.json()).toMatchObject({ code: 'REPORT_RUN_NOT_RETRYABLE' });
    await runReportJobs();

    const again = await ctx.staff.admin({ method: 'POST', url: `/admin/report-runs/${queued.id}/retry` });
    expect(again.statusCode, again.body).toBe(202);
    const retried = again.json<ReportRunView>();
    expect(retried).toMatchObject({ retryOf: queued.id, format: 'PDF', state: 'QUEUED' });
    expect(retried.id).not.toBe(queued.id);
    expect(retried.params).toMatchObject({ from: today, to: today, compare: false, preset: 'today' });
    await runReportJobs();
  });

  it('błąd silnika: limit renderu kończy się FAILED, niedostępny silnik wraca do kolejki do wyczerpania ponowień', async () => {
    const timeout = await exportReport(ctx.staff.admin, 'revenue', 'PDF', { preset: 'today' });
    renderer.failNext({ kind: 'timeout' });
    const failed = await finished(ctx.staff.admin, timeout.id);
    expect(failed).toMatchObject({ status: 'FAILED', state: 'FAILED', errorCode: 'REPORT_RENDER_TIMEOUT', file: null });
    expect(ready).toHaveBeenLastCalledWith(
      ctx.staffIds.admin,
      expect.objectContaining({ id: timeout.id, status: 'FAILED' }),
    );

    const network = await exportReport(ctx.staff.admin, 'revenue', 'PDF', { preset: 'today' });
    const job = ctx.jobs().sent.at(-1)!;
    done = ctx.jobs().sent.length;
    renderer.failNext({ kind: 'network' }, 2);
    await expect(ctx.jobs().run(JOBS.reportGenerate, job.data, { retryCount: 0, retryLimit: 2 })).rejects.toThrow();
    expect((await ctx.staff.admin({ method: 'GET', url: `/admin/report-runs/${network.id}` })).json()).toMatchObject({
      status: 'QUEUED',
    });
    await ctx.jobs().run(JOBS.reportGenerate, job.data, { retryCount: 2, retryLimit: 2 });
    expect((await ctx.staff.admin({ method: 'GET', url: `/admin/report-runs/${network.id}` })).json()).toMatchObject({
      status: 'FAILED',
      errorCode: 'RENDERER_UNAVAILABLE',
    });
    // Ponowienie nieudanego („Ponów”) tworzy nowy wiersz.
    const retry = await ctx.staff.admin({ method: 'POST', url: `/admin/report-runs/${network.id}/retry` });
    expect(retry.statusCode).toBe(202);
    expect((await finished(ctx.staff.admin, retry.json<ReportRunView>().id)).status).toBe('SUCCEEDED');
  });

  it('definicje: reports.manage, zmiana nazwy z wersją i dziennikiem, konflikt, wyłączenie i kolejność', async () => {
    expect((await ctx.staff.dispatcher({ method: 'GET', url: '/admin/report-definitions' })).statusCode).toBe(403);
    const list = (await ctx.staff.admin({ method: 'GET', url: '/admin/report-definitions' })).json<
      ListResponse<ReportDefinitionListItem>
    >();
    expect(list.items.map((d) => d.code)).toEqual([
      'revenue',
      'fleet_usage',
      'rides_by_zone',
      'reliability',
      'users',
      'wallet',
    ]);
    const revenue = (
      await ctx.staff.admin({ method: 'GET', url: '/admin/report-definitions/revenue' })
    ).json<ReportDefinitionDetails>();
    expect(revenue).toMatchObject({ code: 'revenue', permissionCode: 'reports.revenue', orientation: 'portrait' });
    expect(revenue.parameters).toMatchObject({ type: 'object' });

    const patch = await ctx.staff.admin({
      method: 'PATCH',
      url: '/admin/report-definitions/revenue',
      payload: { version: revenue.version, name: 'Przychody i wpływy' },
    });
    expect(patch.statusCode, patch.body).toBe(200);
    expect(patch.json()).toMatchObject({ name: 'Przychody i wpływy', version: revenue.version + 1 });
    const audit = await ctx.pool.query<{ data: Record<string, unknown> }>(
      `SELECT data FROM audit_log WHERE action = 'report_definition.updated' ORDER BY id DESC LIMIT 1`,
    );
    expect(audit.rows[0]!.data).toMatchObject({
      code: 'revenue',
      changes: { name: ['Przychody', 'Przychody i wpływy'] },
    });
    const stale = await ctx.staff.admin({
      method: 'PATCH',
      url: '/admin/report-definitions/revenue',
      payload: { version: revenue.version, name: 'Stara' },
    });
    expect(stale.statusCode).toBe(409);
    expect(stale.json()).toMatchObject({ code: 'CONFLICT' });
    expect(
      (
        await ctx.staff.dispatcher({
          method: 'PATCH',
          url: '/admin/report-definitions/fleet_usage',
          payload: { version: 1, name: 'X' },
        })
      ).statusCode,
    ).toBe(403);
    const preview = (
      await ctx.staff.admin({ method: 'GET', url: '/admin/reports/revenue/preview?preset=today' })
    ).json<{ name: string }>();
    expect(preview.name).toBe('Przychody i wpływy');

    // Wyłączony raport znika z katalogu także dla Administratora, a podgląd daje 404.
    const users = (
      await ctx.staff.admin({ method: 'GET', url: '/admin/report-definitions/users' })
    ).json<ReportDefinitionDetails>();
    await ctx.staff.admin({
      method: 'PATCH',
      url: '/admin/report-definitions/users',
      payload: { version: users.version, active: false },
    });
    const catalog = (await ctx.staff.admin({ method: 'GET', url: '/admin/reports' })).json<ReportCatalog>();
    expect(catalog.items.map((i) => i.code)).not.toContain('users');
    expect((await ctx.staff.admin({ method: 'GET', url: '/admin/reports/users/preview' })).statusCode).toBe(404);

    // Kolejność: wallet przed revenue (te same miejsca, zamienione).
    const defs = Object.fromEntries(
      (await ctx.staff.admin({ method: 'GET', url: '/admin/report-definitions' }))
        .json<ListResponse<ReportDefinitionListItem>>()
        .items.map((d) => [d.code, d]),
    );
    const reorder = await ctx.staff.admin({
      method: 'POST',
      url: '/admin/report-definitions/reorder',
      payload: {
        items: [
          { code: 'wallet', version: defs.wallet!.version },
          { code: 'revenue', version: defs.revenue!.version },
        ],
      },
    });
    expect(reorder.statusCode, reorder.body).toBe(200);
    expect(reorder.json<ReportDefinitionDetails[]>().map((d) => d.code)).toEqual([
      'wallet',
      'fleet_usage',
      'rides_by_zone',
      'reliability',
      'users',
      'revenue',
    ]);
    const conflict = await ctx.staff.admin({
      method: 'POST',
      url: '/admin/report-definitions/reorder',
      payload: { items: [{ code: 'wallet', version: defs.wallet!.version }] },
    });
    expect(conflict.statusCode).toBe(409);
  });

  it('porządki: porzucone uruchomienie FAILED z REPORT_TIMEOUT, plik po 30 dniach usunięty (410), ponowienie działa', async () => {
    const stuck = await exportReport(ctx.staff.admin, 'fleet_usage', 'XLSX', { preset: 'today' });
    done = ctx.jobs().sent.length;
    await ctx.pool.query(`UPDATE report_runs SET created_at = now() - interval '20 minutes' WHERE id = $1`, [stuck.id]);
    await ctx.jobs().run(JOBS.reportsSweep);
    expect((await ctx.staff.admin({ method: 'GET', url: `/admin/report-runs/${stuck.id}` })).json()).toMatchObject({
      status: 'FAILED',
      errorCode: 'REPORT_TIMEOUT',
    });
    expect(ready).toHaveBeenLastCalledWith(ctx.staffIds.admin, expect.objectContaining({ id: stuck.id }));

    const old = await exportReport(ctx.staff.admin, 'fleet_usage', 'XLSX', { preset: 'today' });
    const run = await finished(ctx.staff.admin, old.id);
    const url = run.file!.url;
    await ctx.pool.query(
      `UPDATE report_runs SET created_at = created_at - interval '31 days', started_at = started_at - interval '31 days',
              finished_at = finished_at - interval '31 days' WHERE id = $1`,
      [old.id],
    );
    await ctx.jobs().run(JOBS.reportsRetention);
    const after = (await ctx.staff.admin({ method: 'GET', url: `/admin/report-runs/${old.id}` })).json<ReportRunView>();
    expect(after).toMatchObject({ status: 'SUCCEEDED', state: 'FILE_DELETED', file: null });
    expect(after.fileDeletedAt).not.toBeNull();
    const file = await ctx.staff.admin({ method: 'GET', url: `/admin/report-runs/${old.id}/file` });
    expect(file.statusCode).toBe(410);
    expect(file.json()).toMatchObject({ code: 'REPORT_FILE_DELETED' });
    expect((await ctx.app.inject({ method: 'GET', url })).statusCode).toBe(410);
    const status = await ctx.pool.query<{ status: string }>(
      `SELECT f.status::text FROM files f JOIN report_runs r ON r.file_id = f.id WHERE r.id = $1`,
      [old.id],
    );
    expect(status.rows[0]!.status).toBe('DELETED');
    const deleted = await ctx.staff.admin({ method: 'GET', url: '/admin/report-runs?state=FILE_DELETED' });
    expect(deleted.statusCode, deleted.body).toBe(200);
    const list = deleted.json<ListResponse<ReportRunListItem>>();
    expect(list.items.map((i) => i.id)).toEqual([old.id]);

    const rerun = await ctx.staff.admin({ method: 'POST', url: `/admin/report-runs/${old.id}/retry` });
    expect(rerun.statusCode).toBe(202);
    expect((await finished(ctx.staff.admin, rerun.json<ReportRunView>().id)).state).toBe('SUCCEEDED');
  });
});
