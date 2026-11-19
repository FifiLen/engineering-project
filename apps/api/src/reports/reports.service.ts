import { randomUUID } from 'node:crypto';
import {
  computeReport,
  DomainError,
  ensureCanSeeReportRun,
  ensureCanUseReport,
  ensureReportFileDownloadable,
  ensureReportFormat,
  ensureReportNotEmpty,
  ensureReportRunRetryable,
  REPORT_LIMITS,
  REPORT_MANAGE_PERMISSION,
  reportParamsView,
  rerunParamsInput,
  resolveReportParams,
  storedReportParams,
  truncateReportTables,
  visibleReportCodes,
  type ReportCode,
  type ReportParamsInput,
  type StoredReportParams,
} from '@hulajnogi/core';
import {
  type Database,
  DrizzleReportDefinitionsRepository,
  DrizzleReportRunsRepository,
  type ReportDefinitionRecord,
} from '@hulajnogi/db';
import {
  parseReportParams,
  type DocumentFileLink,
  type ListQuery,
  type ListResponse,
  type ReportCatalog,
  type ReportFormat,
  type ReportPreview,
  type ReportRunListItem,
  type ReportRunView,
} from '@hulajnogi/shared';
import { HttpStatus, Inject, Injectable } from '@nestjs/common';
import { AuditedTransaction } from '../audit/audited-transaction.js';
import { StaffPermissionsService } from '../auth/staff-permissions.service.js';
import { ApiError } from '../common/api-error.js';
import { DB } from '../database/database.module.js';
import { FilesService } from '../files/files.service.js';
import { JOBS, JobsService } from '../jobs/jobs.service.js';
import { reportSnapshot } from './report-snapshot.js';
import { catalogItem, reportRunView } from './report-views.js';

/**
 * Raporty w panelu (ADR 0071): katalog według uprawnień `reports.<kod>` i aktywności definicji, podgląd synchroniczny
 * w migawce `REPEATABLE READ READ ONLY` z limitem 15 s, eksport jako wiersz `report_runs` i zadanie `report.generate`
 * w jednej transakcji, Historia (także cudze uruchomienia raportów z uprawnieniem) i ponowienie z tymi samymi datami.
 * Raport bez uprawnienia albo wyłączony daje `404 REPORT_NOT_FOUND`, uruchomienie bez uprawnienia
 * `404 REPORT_RUN_NOT_FOUND` (bez zdradzania, że istnieje).
 */
@Injectable()
export class ReportsService {
  constructor(
    @Inject(DB) private readonly db: Database,
    private readonly permissions: StaffPermissionsService,
    private readonly audited: AuditedTransaction,
    private readonly jobs: JobsService,
    private readonly files: FilesService,
  ) {}

  private async granted(staffId: string) {
    return (await this.permissions.get(staffId)).permissions;
  }

  /** Aktywna definicja raportu; wyłączony raport znika z katalogu także dla Administratora (ADR 0071). */
  private async activeDefinition(code: ReportCode): Promise<ReportDefinitionRecord> {
    const def = await new DrizzleReportDefinitionsRepository(this.db).get(code);
    if (!def || !def.active) throw new DomainError('REPORT_NOT_FOUND', { code });
    return def;
  }

  /** Kształt parametrów schematem z shared (400 `VALIDATION_ERROR`), reguły okresu w core. */
  private parseParams(code: ReportCode, input: unknown): ReportParamsInput {
    const parsed = parseReportParams(code, input ?? {});
    if (!parsed.success) {
      throw new ApiError(
        HttpStatus.BAD_REQUEST,
        'VALIDATION_ERROR',
        'Nieprawidłowe parametry raportu',
        parsed.error.issues,
      );
    }
    return parsed.data;
  }

  private async reportNames(): Promise<Map<string, string>> {
    const defs = await new DrizzleReportDefinitionsRepository(this.db).all();
    return new Map(defs.map((d) => [d.code, d.name]));
  }

  // --- Katalog i podgląd ---------------------------------------------------------------------------------

  /** `GET /admin/reports`: aktywne raporty z uprawnieniem w kolejności definicji i trzy ostatnie eksporty operatora. */
  async catalog(staffId: string): Promise<ReportCatalog> {
    const permissions = await this.granted(staffId);
    const codes = visibleReportCodes(permissions);
    const defs = await new DrizzleReportDefinitionsRepository(this.db).catalog(codes);
    const recent = await new DrizzleReportRunsRepository(this.db).recentForStaff(staffId, codes, 3);
    const names = await this.reportNames();
    const now = new Date();
    return {
      items: defs.map(catalogItem),
      recentRuns: recent.map((run) => reportRunView(run, names.get(run.reportCode) ?? run.reportCode, this.files, now)),
      canManage: permissions.has(REPORT_MANAGE_PERMISSION),
    };
  }

  /**
   * `GET /admin/reports/{code}/preview`: parametry z adresu, dane w jednej migawce z limitem 15 s (`REPORT_TIMEOUT`),
   * najwcześniejsza data źródła do stanu „Brak danych” i tabele skrócone do 200 wierszy z liczbą wszystkich.
   */
  async preview(staffId: string, code: string, query: unknown, now = new Date()): Promise<ReportPreview> {
    const reportCode = ensureCanUseReport(await this.granted(staffId), code);
    const def = await this.activeDefinition(reportCode);
    const params = resolveReportParams(reportCode, this.parseParams(reportCode, query), now);
    return reportSnapshot(this.db, REPORT_LIMITS.previewTimeoutMs, async (repo, dataAsOf) => {
      const model = truncateReportTables(await computeReport(repo, params), REPORT_LIMITS.previewRows);
      const earliest = await repo.earliestData(reportCode);
      return {
        code: reportCode,
        name: def.name,
        description: def.description,
        params: reportParamsView(params),
        dataAsOf: dataAsOf.toISOString(),
        earliestDataAt: earliest?.toISOString() ?? null,
        empty: model.empty,
        rowCount: model.rowCount,
        tiles: model.tiles,
        charts: model.charts,
        tables: model.tables,
      };
    });
  }

  // --- Eksport -------------------------------------------------------------------------------------------

  /** `POST /admin/reports/{code}/runs`: parametry z treści żądania. */
  async export(staffId: string, code: string, format: ReportFormat, params: unknown): Promise<ReportRunView> {
    const reportCode = ensureCanUseReport(await this.granted(staffId), code);
    return this.createRun(staffId, reportCode, format, this.parseParams(reportCode, params), null);
  }

  /**
   * Nowe uruchomienie: format z definicji (`422 REPORT_FORMAT_NOT_ALLOWED`), parametry po regułach z core, dane
   * policzone w migawce (eksport pustego raportu to `409 REPORT_EMPTY`, plansza `raport-stany`), potem wiersz
   * `QUEUED`, wpis `report_run.requested` i zadanie `report.generate` w jednej transakcji. Zadanie liczy dane od nowa.
   */
  private async createRun(
    staffId: string,
    code: ReportCode,
    format: string,
    input: ReportParamsInput,
    retryOf: string | null,
  ): Promise<ReportRunView> {
    const def = await this.activeDefinition(code);
    const allowed = ensureReportFormat(code, format, def.formats);
    const params = resolveReportParams(code, input, new Date());
    const model = await reportSnapshot(this.db, REPORT_LIMITS.previewTimeoutMs, (repo) => computeReport(repo, params));
    ensureReportNotEmpty(model);
    const stored = storedReportParams(params);
    const id = randomUUID();
    await this.audited.run(staffId, async ({ tx, audit }) => {
      await new DrizzleReportRunsRepository(tx).insert({
        id,
        reportCode: code,
        format: allowed,
        params: stored as unknown as Record<string, unknown>,
        requestedBy: staffId,
        retryOf,
      });
      await audit({
        action: 'report_run.requested',
        entityType: 'report_run',
        entityId: id,
        data: { reportCode: code, format: allowed, params: stored, retryOf },
      });
      await this.jobs.sendInTransaction(tx, JOBS.reportGenerate, { runId: id }, new Date(), { singletonKey: id });
    });
    return this.runView(id, def.name);
  }

  /**
   * „Ponów” (błąd) i „Uruchom ponownie z tymi parametrami” (gotowy, plik usunięty): nowy wiersz z `retry_of`, ten sam
   * okres bezwzględny i format, dane na teraz; uruchomienie w toku daje `409 REPORT_RUN_NOT_RETRYABLE`.
   */
  async retry(staffId: string, id: string): Promise<ReportRunView> {
    const permissions = await this.granted(staffId);
    const run = await this.findRun(id);
    ensureCanSeeReportRun(permissions, run);
    ensureReportRunRetryable(run);
    const code = ensureCanUseReport(permissions, run.reportCode);
    return this.createRun(staffId, code, run.format, rerunParamsInput(run.params as unknown as StoredReportParams), id);
  }

  // --- Historia ------------------------------------------------------------------------------------------

  private async findRun(id: string) {
    const run = await new DrizzleReportRunsRepository(this.db).get(id);
    if (!run) throw new DomainError('REPORT_RUN_NOT_FOUND', { id });
    return run;
  }

  private async runView(id: string, reportName?: string): Promise<ReportRunView> {
    const run = await this.findRun(id);
    const name = reportName ?? (await this.reportNames()).get(run.reportCode) ?? run.reportCode;
    return reportRunView(run, name, this.files);
  }

  /** `GET /admin/report-runs`: kontrakt list zawężony do raportów z uprawnieniem operatora (także cudze). */
  async list(staffId: string, query: ListQuery): Promise<ListResponse<ReportRunListItem>> {
    const codes = visibleReportCodes(await this.granted(staffId));
    if (!codes.length) throw new DomainError('FORBIDDEN', { permission: 'reports.*' });
    return new DrizzleReportRunsRepository(this.db).list(query, codes);
  }

  /** `GET /admin/report-runs/{id}`: szczegóły z adresem pliku (zapas dla `report.ready`, odpytywanie co 2 s). */
  async details(staffId: string, id: string): Promise<ReportRunView> {
    const run = await this.findRun(id);
    ensureCanSeeReportRun(await this.granted(staffId), run);
    return this.runView(id);
  }

  /**
   * `GET /admin/report-runs/{id}/file`: adres z podpisem na 10 min; uruchomienie przed końcem albo nieudane
   * `409 REPORT_RUN_NOT_READY`, plik po retencji `410 REPORT_FILE_DELETED`.
   */
  async file(staffId: string, id: string): Promise<DocumentFileLink> {
    const run = await this.findRun(id);
    ensureReportFileDownloadable(await this.granted(staffId), run);
    const view = await this.runView(id);
    if (!view.file) throw new DomainError('REPORT_FILE_DELETED', { id });
    return view.file;
  }
}
