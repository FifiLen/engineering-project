import {
  computeReport,
  DomainError,
  isRetryableReportError,
  REPORT_CONTENT_TYPES,
  REPORT_LIMITS,
  reportFileExpired,
  reportFileKey,
  reportFileName,
  reportRenderErrorCode,
  reportWorkbookSheets,
  rerunParamsInput,
  resolveReportParams,
  shouldRunReportJob,
  truncateReportTables,
  type ReportModel,
  type ResolvedReportParams,
  type StoredReportParams,
} from '@hulajnogi/core';
import {
  type Database,
  DrizzleFileRepository,
  DrizzleReportDefinitionsRepository,
  DrizzleReportRunsRepository,
  type ReportRunRecord,
} from '@hulajnogi/db';
import { Inject, Injectable, Logger, type OnModuleInit } from '@nestjs/common';
import { spreadsheetBuffer } from '../common/spreadsheet/exceljs-writer.js';
import { CompanyService } from '../content/company.service.js';
import { DB } from '../database/database.module.js';
import { storeFile } from '../documents/document-files.js';
import { DOCUMENT_RENDERER, type DocumentEngine } from '../documents/renderers.js';
import { FILE_STORAGE, type FileStorage } from '../files/file-storage.js';
import { FilesService } from '../files/files.service.js';
import { JOBS, JobsService, type JobAttempt } from '../jobs/jobs.service.js';
import { FleetGateway } from '../realtime/fleet.gateway.js';
import { reportParamLabels } from './report-format.js';
import { reportFooterHtml, reportHtml } from './report-html.js';
import { reportSnapshot } from './report-snapshot.js';
import { reportRunView } from './report-views.js';
import { pdfPageCount } from './pdf-pages.js';

/** Kody błędów silnika dokumentów (ADR 0066), które zamieniamy na kody uruchomienia raportu. */
const RENDER_CODES = new Set(['RENDER_TIMEOUT', 'RENDERER_UNAVAILABLE', 'RENDER_FAILED']);
const BATCH = REPORT_LIMITS.retentionBatch;

/**
 * Zadania raportów (ADR 0071, wzór `document.generate` z ADR 0066 i ADR 0068): `report.generate` liczy dane od nowa
 * w migawce z limitem 60 s na zapytanie i 45 s łącznie, buduje PDF (HTML w API, Gotenberg, stopka `footer.html`,
 * limit renderu 60 s) albo XLSX (ExcelJS za portem `SpreadsheetWriter`), zapisuje plik w magazynie (cel
 * `REPORT_EXPORT`) i wysyła `report.ready` do pokoju zlecającego. `reports.sweep` kończy porzucone uruchomienia, `reports.retention` usuwa pliki po 30 dniach.
 */
@Injectable()
export class ReportGeneratorService implements OnModuleInit {
  private readonly logger = new Logger(ReportGeneratorService.name);

  constructor(
    @Inject(DB) private readonly db: Database,
    @Inject(FILE_STORAGE) private readonly storage: FileStorage,
    @Inject(DOCUMENT_RENDERER) private readonly renderer: DocumentEngine,
    private readonly files: FilesService,
    private readonly jobs: JobsService,
    private readonly gateway: FleetGateway,
    private readonly company: CompanyService,
  ) {}

  onModuleInit(): void {
    this.jobs.handle(JOBS.reportGenerate, async (data, attempt) => this.generate(String(data.runId), attempt));
    this.jobs.handle(JOBS.reportsSweep, async () => {
      await this.sweep();
    });
    this.jobs.handle(JOBS.reportsRetention, async () => {
      await this.retention();
    });
  }

  /**
   * Zadanie `report.generate`: blokada wiersza i `RUNNING` (`shouldRunReportJob`: `QUEUED` albo porzucony `RUNNING`
   * po limicie 120 s) z żetonem przejęcia (`started_at`), plik, `succeed` z chwilą danych, liczbą wierszy i stron.
   * Niedostępny silnik wraca do kolejki, dopóki są ponowienia; inny błąd to `FAILED` z kodem (`REPORT_TIMEOUT`,
   * `REPORT_RENDER_TIMEOUT`, `REPORT_FAILED`). Wynik zapisuje tylko wykonanie z aktualnym żetonem: gdy wiersz przejęło
   * drugie wykonanie albo zakończył go `reports.sweep`, zapisany plik jest usuwany, a `report.ready` nie idzie.
   */
  async generate(runId: string, attempt: JobAttempt = { retryCount: 0, retryLimit: 0 }): Promise<void> {
    const started = await this.db.transaction(async (tx) => {
      const repo = new DrizzleReportRunsRepository(tx);
      const run = await repo.lock(runId);
      if (!run || !shouldRunReportJob(run, new Date())) return null;
      const token = await repo.markRunning(runId);
      return token ? { run, token } : null;
    });
    if (!started) return;
    const { run, token } = started;
    const runs = new DrizzleReportRunsRepository(this.db);
    let dataAsOf: Date | null = null;
    try {
      const result = await this.render(run, (at) => (dataAsOf = at));
      if (!(await runs.succeed(runId, token, result))) {
        this.logger.warn(`Raport ${runId}: wynik spóźnionego wykonania odrzucony (wiersz przejęty albo zakończony)`);
        await this.discardFile(result.fileId, result.storageKey);
        return;
      }
    } catch (error) {
      const raw = error instanceof DomainError ? error.code : 'REPORT_FAILED';
      const code = RENDER_CODES.has(raw) ? reportRenderErrorCode(raw) : raw;
      if (isRetryableReportError(code) && attempt.retryCount < attempt.retryLimit) {
        // Wiersz przejęty przez inne wykonanie: to wykonanie kończy się bez ponowienia.
        if (!(await runs.requeue(runId, token))) return;
        throw error;
      }
      if (!(error instanceof DomainError)) this.logger.error(`Raport ${runId}: ${(error as Error).stack}`);
      const detail = error instanceof DomainError ? JSON.stringify(error.details ?? {}) : (error as Error).message;
      if (!(await runs.fail(runId, token, code, detail, dataAsOf))) return;
    }
    await this.emitReady(runId);
  }

  /** Plik wykonania, którego wynik odrzucono: wiersz `DELETED`, potem obiekt z magazynu (błąd magazynu w logu). */
  private async discardFile(fileId: string, storageKey: string): Promise<void> {
    try {
      await new DrizzleFileRepository(this.db).markDeleted(fileId);
      await this.storage.delete(storageKey);
    } catch (error) {
      this.logger.warn(`Nie usunięto pliku odrzuconego raportu ${fileId}: ${(error as Error).message}`);
    }
  }

  /** Parametry zapisane przy zleceniu: ten sam okres bezwzględny (daty z `report_runs.params`). */
  private params(run: ReportRunRecord): ResolvedReportParams {
    return resolveReportParams(
      run.reportCode,
      rerunParamsInput(run.params as unknown as StoredReportParams),
      // Okres jest bezwzględny, a „dziś” służy tylko sprawdzeniu, że koniec nie jest w przyszłości.
      new Date(Math.max(Date.now(), run.createdAt.getTime())),
    );
  }

  private async render(
    run: ReportRunRecord,
    onSnapshot: (dataAsOf: Date) => void,
  ): Promise<{ fileId: string; storageKey: string; dataAsOf: Date; rowCount: number; pageCount: number | null }> {
    const params = this.params(run);
    const definition = await new DrizzleReportDefinitionsRepository(this.db).get(run.reportCode);
    const { model, dataAsOf } = await reportSnapshot(
      this.db,
      { timeoutMs: REPORT_LIMITS.jobQueryTimeoutMs, totalTimeoutMs: REPORT_LIMITS.jobSnapshotTotalMs },
      async (repo, at): Promise<{ model: ReportModel; dataAsOf: Date }> => {
        onSnapshot(at);
        return { model: await computeReport(repo, params), dataAsOf: at };
      },
    );
    const company = await this.company.publicView();
    const filterNames = await new DrizzleReportRunsRepository(this.db).filterNames(params.filters);
    const paramLabels = reportParamLabels(params, filterNames);
    const name = definition?.name ?? run.reportCode;
    const description = definition?.description ?? null;
    const generatedAt = new Date();
    const fileName = reportFileName(params, run.format);

    let bytes: Uint8Array;
    let pageCount: number | null = null;
    if (run.format === 'PDF') {
      const ctx = {
        runId: run.id,
        name,
        description,
        params,
        paramLabels,
        company,
        dataAsOf,
        generatedAt,
        requestedBy: run.requestedByName,
        format: run.format,
      };
      const html = reportHtml(truncateReportTables(model, REPORT_LIMITS.pdfRows), ctx);
      bytes = await this.renderer.htmlToPdf(html, {
        trace: run.id,
        fileName: fileName.replace(/\.pdf$/, ''),
        timeoutMs: REPORT_LIMITS.renderTimeoutMs,
        assets: [{ name: 'footer.html', bytes: new TextEncoder().encode(reportFooterHtml(ctx)) }],
      });
      pageCount = pdfPageCount(bytes);
    } else {
      bytes = await spreadsheetBuffer(
        reportWorkbookSheets(model, {
          runId: run.id,
          name,
          description,
          params,
          paramLabels,
          dataAsOf,
          generatedAt,
          requestedBy: run.requestedByName,
          companyName: company.name,
        }),
        { title: name, creator: company.name, createdAt: generatedAt },
      );
    }

    const file = await storeFile(this.storage, this.db, {
      purpose: 'REPORT_EXPORT',
      key: (fileId) => reportFileKey(fileId, run.format, generatedAt),
      bytes,
      contentType: REPORT_CONTENT_TYPES[run.format],
      originalName: fileName,
      staffId: run.requestedBy,
    });
    return { fileId: file.id, storageKey: file.storageKey, dataAsOf, rowCount: model.rowCount, pageCount };
  }

  /** `report.ready` po stanie końcowym do pokoju `staff:{id}` zlecającego, z adresem pliku z podpisem. */
  private async emitReady(runId: string): Promise<void> {
    const run = await new DrizzleReportRunsRepository(this.db).get(runId);
    if (!run || (run.status !== 'SUCCEEDED' && run.status !== 'FAILED')) return;
    const definition = await new DrizzleReportDefinitionsRepository(this.db).get(run.reportCode);
    this.gateway.reportReady(run.requestedBy, reportRunView(run, definition?.name ?? run.reportCode, this.files));
  }

  /**
   * `reports.sweep` (co 5 min): uruchomienia w kolejce albo w toku dłużej niż 15 min nie mają już zadania (restart API
   * po wyczerpaniu ponowień), więc kończą się `FAILED` z `REPORT_TIMEOUT` i `report.ready`.
   */
  async sweep(now = new Date()): Promise<number> {
    const before = new Date(now.getTime() - REPORT_LIMITS.abandonedMs);
    let failed = 0;
    for (;;) {
      const ids = await new DrizzleReportRunsRepository(this.db).failAbandoned(before, 'REPORT_TIMEOUT', BATCH);
      for (const id of ids) await this.emitReady(id);
      failed += ids.length;
      if (ids.length < BATCH) break;
    }
    if (failed) this.logger.warn(`Porzucone raporty zakończone jako nieudane: ${failed}`);
    return failed;
  }

  /**
   * `reports.retention` (dobowo): pliki gotowych raportów starsze niż 30 dni znikają z magazynu
   * (`files.status = DELETED`), wiersz dostaje `file_deleted_at` i zostaje na zawsze (stan „Plik usunięty”).
   * Partie po 200 do wyczerpania kandydatów; partia bez usunięcia kończy przebieg.
   */
  async retention(now = new Date()): Promise<number> {
    const before = new Date(now.getTime() - REPORT_LIMITS.fileRetentionMs);
    let deleted = 0;
    for (;;) {
      const candidates = await new DrizzleReportRunsRepository(this.db).expiredFiles(before, BATCH);
      let removed = 0;
      for (const run of candidates) {
        if (!reportFileExpired(run, now)) continue;
        try {
          const key = await this.db.transaction(async (tx) => {
            if (!(await new DrizzleReportRunsRepository(tx).markFileDeleted(run.id))) return null;
            if (!run.fileId || !run.fileStorageKey) return null;
            return (await new DrizzleFileRepository(tx).markDeleted(run.fileId)) ? run.fileStorageKey : null;
          });
          if (key) await this.storage.delete(key).catch(() => undefined);
          removed += 1;
        } catch (error) {
          this.logger.warn(`Nie usunięto pliku raportu ${run.id}: ${(error as Error).message}`);
        }
      }
      deleted += removed;
      if (candidates.length < BATCH || removed === 0) break;
    }
    if (deleted) this.logger.log(`Retencja raportów: ${deleted}`);
    return deleted;
  }
}
