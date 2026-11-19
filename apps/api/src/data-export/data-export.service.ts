import {
  buildDataExport,
  dataExportExpiresAt,
  dataExportFileName,
  dataExportKey,
  dataExportNextAllowedAt,
  dataExportState,
  DATA_EXPORT_INTERVAL_MS,
  DATA_EXPORT_JOB_ABANDONED_MS,
  formatDocumentDateTime,
  shouldRunDataExportJob,
} from '@hulajnogi/core';
import {
  type Database,
  type DataExportRecord,
  DrizzleDataExportRepository,
  DrizzleFileRepository,
} from '@hulajnogi/db';
import {
  dataExportSchema,
  type DataExportLatest,
  type DataExportListItem,
  type DataExportView,
  type ListQuery,
  type ListResponse,
} from '@hulajnogi/shared';
import { Inject, Injectable, Logger, type OnModuleInit } from '@nestjs/common';
import { DB } from '../database/database.module.js';
import { storeFile } from '../documents/document-files.js';
import { FILE_STORAGE, type FileStorage } from '../files/file-storage.js';
import { FilesService } from '../files/files.service.js';
import { JOBS, JobsService, type JobAttempt } from '../jobs/jobs.service.js';
import { NotificationsService } from '../notifications/notifications.service.js';
import { FleetGateway } from '../realtime/fleet.gateway.js';
import { DataExportRegistry } from './data-export.registry.js';

/** Partia usuwania plików i sprzątania; zadanie przechodzi kolejne partie do wyczerpania kandydatów. */
const BATCH = 200;

/**
 * Eksport danych klienta (ADR 0069, RODO art. 15 i 20): zlecenie z limitem raz na dobę w procedurze bazy, zadanie
 * `data-export.generate` zbierające dane przez porty modułów, plik JSON sprawdzony ścisłym schematem z shared
 * przed zapisem, ważny 7 dni, powiadomienie `data_export_ready` w transakcji zakończenia i `data-export.ready`.
 */
@Injectable()
export class DataExportService implements OnModuleInit {
  private readonly logger = new Logger(DataExportService.name);

  constructor(
    @Inject(DB) private readonly db: Database,
    @Inject(FILE_STORAGE) private readonly storage: FileStorage,
    private readonly files: FilesService,
    private readonly jobs: JobsService,
    private readonly registry: DataExportRegistry,
    private readonly notifications: NotificationsService,
    private readonly gateway: FleetGateway,
  ) {}

  onModuleInit(): void {
    this.jobs.handle(JOBS.dataExportGenerate, async (data, attempt) => this.generate(String(data.exportId), attempt));
    this.jobs.handle(JOBS.dataExportsPurge, async (data) => {
      await this.purge(new Date(), typeof data.userId === 'string' ? data.userId : undefined);
    });
    this.jobs.handle(JOBS.dataExportsSweep, async () => {
      await this.sweep();
    });
  }

  /**
   * `POST /me/data-exports`: `CALL sp_data_export_request` (limit 24 h z `nextAllowedAt`, jedno zlecenie w toku)
   * i zadanie w tej samej transakcji z kluczem singletonu równym identyfikatorowi zlecenia.
   */
  async request(userId: string): Promise<DataExportView> {
    const id = await this.db.transaction(async (tx) => {
      const exportId = await new DrizzleDataExportRepository(tx).request(userId);
      await this.jobs.sendInTransaction(tx, JOBS.dataExportGenerate, { exportId }, new Date(), {
        singletonKey: exportId,
      });
      return exportId;
    });
    return this.view((await new DrizzleDataExportRepository(this.db).find(id))!);
  }

  /** `GET /me/data-exports/latest`: ostatnie zlecenie i czas następnego (ta sama reguła co w bazie, core). */
  async latest(userId: string, now = new Date()): Promise<DataExportLatest> {
    const repo = new DrizzleDataExportRepository(this.db);
    const latest = await repo.latest(userId);
    const recent = await repo.recent(userId, new Date(now.getTime() - DATA_EXPORT_INTERVAL_MS));
    const next = dataExportNextAllowedAt(recent, now);
    return { export: latest ? this.view(latest, now) : null, nextAllowedAt: next?.toISOString() ?? null };
  }

  list(query: ListQuery): Promise<ListResponse<DataExportListItem>> {
    return new DrizzleDataExportRepository(this.db).list(query);
  }

  private view(exp: DataExportRecord, now = new Date()): DataExportView {
    const state = dataExportState(exp, now);
    const signed = state === 'SUCCEEDED' && exp.fileId ? this.files.sign(exp.fileId, now) : null;
    return {
      id: exp.id,
      status: exp.status,
      state,
      sizeBytes: exp.sizeBytes,
      requestedAt: exp.requestedAt.toISOString(),
      finishedAt: exp.finishedAt?.toISOString() ?? null,
      expiresAt: exp.expiresAt?.toISOString() ?? null,
      errorCode: exp.errorCode,
      file: signed
        ? {
            url: signed.url,
            urlExpiresAt: signed.expiresAt.toISOString(),
            fileName: dataExportFileName(exp.requestedAt),
          }
        : null,
    };
  }

  /**
   * Zadanie `data-export.generate`: dane z portów modułów, plik z core sprawdzony schematem (pole spoza schematu
   * zatrzymuje zapis), zapis w magazynie i `SUCCEEDED` z ważnością 7 dni razem z powiadomieniem `QUEUED`.
   * Błąd to `FAILED` z kodem (bez powiadomienia, nie liczy się do limitu); konto usunięte w trakcie zostaje `FAILED`.
   * Ponowienie pg-boss po restarcie API przejmuje wiersz `RUNNING` starszy niż limit czasu zadania.
   */
  async generate(exportId: string, attempt: JobAttempt = { retryCount: 0, retryLimit: 0 }): Promise<void> {
    const started = await this.db.transaction(async (tx) => {
      const repo = new DrizzleDataExportRepository(tx);
      const exp = await repo.lock(exportId);
      if (!exp || !shouldRunDataExportJob(exp, new Date())) return null;
      await repo.markRunning(exportId);
      return exp;
    });
    if (!started) return;
    const now = new Date();
    let file: Awaited<ReturnType<typeof storeFile>> | null = null;
    try {
      const sources = await this.registry.collect(started.userId);
      const parsed = dataExportSchema.safeParse(buildDataExport(sources, now));
      if (!parsed.success) {
        this.logger.error(`Eksport ${exportId} niezgodny ze schematem: ${parsed.error.message.slice(0, 500)}`);
        await this.finishFailed(started, 'DATA_EXPORT_SCHEMA_INVALID');
        return;
      }
      const bytes = Buffer.from(JSON.stringify(parsed.data, null, 2), 'utf8');
      file = await storeFile(this.storage, this.db, {
        purpose: 'DATA_EXPORT',
        key: () => dataExportKey(exportId, now),
        bytes,
        contentType: 'application/json',
        originalName: dataExportFileName(started.requestedAt),
        userId: started.userId,
      });
      const stored = file;
      const expiresAt = dataExportExpiresAt(now);
      const done = await this.db.transaction(async (tx) => {
        const repo = new DrizzleDataExportRepository(tx);
        const current = await repo.lock(exportId);
        // Usunięcie konta w trakcie zamknęło zlecenie (`ACCOUNT_DELETED`); plik nie może zostać.
        if (current?.status !== 'RUNNING') return false;
        await repo.succeed(exportId, { fileId: stored.id, sizeBytes: bytes.length, finishedAt: now, expiresAt });
        await this.notifications.enqueue(tx, {
          userId: started.userId,
          code: 'data_export_ready',
          params: { expiresAt: formatDocumentDateTime(expiresAt) },
          key: [exportId],
        });
        return true;
      });
      if (!done) {
        await this.discard(stored.id, stored.storageKey);
        return;
      }
      this.gateway.dataExportReady(started.userId, {
        id: exportId,
        status: 'SUCCEEDED',
        state: 'SUCCEEDED',
        sizeBytes: bytes.length,
        expiresAt: expiresAt.toISOString(),
      });
    } catch (error) {
      if (file) await this.discard(file.id, file.storageKey);
      if (attempt.retryCount < attempt.retryLimit) {
        await new DrizzleDataExportRepository(this.db).requeue(exportId);
        throw error;
      }
      this.logger.error(`Eksport ${exportId}: ${(error as Error).message}`);
      await this.finishFailed(started, 'DATA_EXPORT_FAILED');
    }
  }

  private async finishFailed(exp: DataExportRecord, code: string): Promise<void> {
    await new DrizzleDataExportRepository(this.db).fail(exp.id, code);
    this.gateway.dataExportReady(exp.userId, {
      id: exp.id,
      status: 'FAILED',
      state: 'FAILED',
      sizeBytes: null,
      expiresAt: null,
    });
  }

  private async discard(fileId: string, storageKey: string): Promise<void> {
    await new DrizzleFileRepository(this.db).markDeleted(fileId);
    await this.storage.delete(storageKey).catch(() => undefined);
  }

  /**
   * Zadanie dobowe `data-exports.purge` (03:45): pliki po `expires_at` znikają z magazynu (`files.status = DELETED`,
   * `data_exports.deleted_at`), a wiersz zostaje jako ślad zlecenia. Z `userId` (usunięcie konta) usuwa od razu
   * wszystkie gotowe pliki klienta. Kolejne partie po 200 do wyczerpania kandydatów (partia bez usunięcia kończy).
   */
  async purge(now = new Date(), userId?: string): Promise<number> {
    const repo = new DrizzleDataExportRepository(this.db);
    let deleted = 0;
    for (;;) {
      const candidates = await repo.filesToPurge(userId ? { userId } : { before: now }, BATCH);
      let removed = 0;
      for (const exp of candidates) {
        try {
          const marked = await this.db.transaction((tx) => new DrizzleDataExportRepository(tx).markDeleted(exp.id));
          if (marked && exp.storageKey) await this.storage.delete(exp.storageKey).catch(() => undefined);
          if (marked) removed += 1;
        } catch (error) {
          this.logger.warn(`Nie usunięto pliku eksportu ${exp.id}: ${(error as Error).message}`);
        }
      }
      deleted += removed;
      if (candidates.length < BATCH || removed === 0) break;
    }
    if (deleted) this.logger.log(`Usunięte pliki eksportu danych: ${deleted}`);
    return deleted;
  }

  /**
   * Zadanie porządkowe `data-exports.sweep` (co 5 min): zlecenie w kolejce albo w toku dłużej niż 30 min nie ma już
   * zadania (restart API po wyczerpaniu ponowień), więc kończy się jako `FAILED` z `DATA_EXPORT_FAILED` i zdarzeniem
   * `data-export.ready`. Indeks „jedno zlecenie w toku” przestaje blokować klienta, a nieudane nie liczy się do limitu.
   */
  async sweep(now = new Date()): Promise<number> {
    const before = new Date(now.getTime() - DATA_EXPORT_JOB_ABANDONED_MS);
    let failed = 0;
    for (;;) {
      const rows = await new DrizzleDataExportRepository(this.db).failAbandoned(before, 'DATA_EXPORT_FAILED', BATCH);
      for (const row of rows) {
        this.gateway.dataExportReady(row.userId, {
          id: row.id,
          status: 'FAILED',
          state: 'FAILED',
          sizeBytes: null,
          expiresAt: null,
        });
      }
      failed += rows.length;
      if (rows.length < BATCH) break;
    }
    if (failed) this.logger.warn(`Porzucone eksporty danych zakończone jako nieudane: ${failed}`);
    return failed;
  }
}
