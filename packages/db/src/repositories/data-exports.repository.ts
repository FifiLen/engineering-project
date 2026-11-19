import {
  dataExportsResource,
  type DataExportListItem,
  type JobStatus,
  type ListQuery,
  type ListResponse,
} from '@hulajnogi/shared';
import { sql, type SQL } from 'drizzle-orm';
import { runListQuery, type ListSource } from '../admin/list-query.js';
import type { DbExecutor } from '../client.js';
import { vDataExports } from '../schema/schema.js';
import { rethrowDatabaseRule } from './errors.js';

type Row = Record<string, unknown>;
type DataExportField = keyof typeof dataExportsResource.fields & string;

const listSource: ListSource<DataExportField> = {
  from: vDataExports,
  id: vDataExports.id,
  columns: {
    id: vDataExports.id,
    userId: vDataExports.userId,
    userName: vDataExports.userName,
    userPhone: vDataExports.userPhone,
    status: vDataExports.status,
    state: vDataExports.state,
    sizeBytes: vDataExports.sizeBytes,
    requestedAt: vDataExports.requestedAt,
    startedAt: vDataExports.startedAt,
    finishedAt: vDataExports.finishedAt,
    expiresAt: vDataExports.expiresAt,
    deletedAt: vDataExports.deletedAt,
    errorCode: vDataExports.errorCode,
  },
};

/** Wiersz `data_exports` (ADR 0069) z kluczem pliku w magazynie. */
export interface DataExportRecord {
  id: string;
  userId: string;
  status: JobStatus;
  fileId: string | null;
  storageKey: string | null;
  sizeBytes: number | null;
  requestedAt: Date;
  startedAt: Date | null;
  finishedAt: Date | null;
  expiresAt: Date | null;
  errorCode: string | null;
  deletedAt: Date | null;
}

const date = (value: unknown): Date | null =>
  value === null || value === undefined ? null : new Date(value as string);

const exportSql = sql`SELECT e.*, f.storage_key FROM data_exports e LEFT JOIN files f ON f.id = e.file_id`;

const toExport = (r: Row): DataExportRecord => ({
  id: r.id as string,
  userId: r.user_id as string,
  status: r.status as JobStatus,
  fileId: (r.file_id as string | null) ?? null,
  storageKey: (r.storage_key as string | null) ?? null,
  sizeBytes: r.size_bytes === null || r.size_bytes === undefined ? null : Number(r.size_bytes),
  requestedAt: new Date(r.requested_at as string),
  startedAt: date(r.started_at),
  finishedAt: date(r.finished_at),
  expiresAt: date(r.expires_at),
  errorCode: (r.error_code as string | null) ?? null,
  deletedAt: date(r.deleted_at),
});

/** Eksport danych klienta (ADR 0069): zlecenia z limitem raz na dobę w procedurze bazy, plik ważny 7 dni. */
export class DrizzleDataExportRepository {
  constructor(private readonly db: DbExecutor) {}

  private async rows(query: SQL): Promise<Row[]> {
    return (await this.db.execute<Row>(query)).rows;
  }

  list(query: ListQuery): Promise<ListResponse<DataExportListItem>> {
    return runListQuery<DataExportField, DataExportListItem>(this.db, dataExportsResource, listSource, query);
  }

  /**
   * `CALL sp_data_export_request`: blokada wiersza klienta szereguje zlecenia, a limit 24 h daje `DATA_EXPORT_LIMIT`
   * z `nextAllowedAt`; drugie zlecenie w toku odrzuca indeks `data_exports_one_open` (`DATA_EXPORT_IN_PROGRESS`).
   */
  async request(userId: string): Promise<string> {
    try {
      const [row] = await this.rows(sql`CALL sp_data_export_request(${userId}, NULL)`);
      return row!.export_id as string;
    } catch (error) {
      rethrowDatabaseRule(error);
    }
  }

  async find(id: string): Promise<DataExportRecord | null> {
    const [row] = await this.rows(sql`${exportSql} WHERE e.id = ${id}`);
    return row ? toExport(row) : null;
  }

  async lock(id: string): Promise<DataExportRecord | null> {
    await this.rows(sql`SELECT 1 FROM data_exports WHERE id = ${id} FOR UPDATE`);
    return this.find(id);
  }

  async latest(userId: string): Promise<DataExportRecord | null> {
    const [row] = await this.rows(sql`${exportSql} WHERE e.user_id = ${userId} ORDER BY e.requested_at DESC LIMIT 1`);
    return row ? toExport(row) : null;
  }

  /** Zlecenia klienta z ostatniej doby (porównanie reguły core z `fn_data_export_next_allowed_at`). */
  async recent(userId: string, since: Date): Promise<DataExportRecord[]> {
    const rows = await this.rows(sql`${exportSql} WHERE e.user_id = ${userId} AND e.requested_at > ${since}`);
    return rows.map(toExport);
  }

  /** Czas kolejnego zlecenia z bazy (`fn_data_export_next_allowed_at`); `null`: można od razu. */
  async nextAllowedAt(userId: string): Promise<Date | null> {
    const [row] = await this.rows(sql`SELECT fn_data_export_next_allowed_at(${userId}) AS at`);
    return date(row?.at);
  }

  /** Start zadania: `QUEUED` albo porzucony `RUNNING` (decyduje `shouldRunDataExportJob`); `started_at` od nowa. */
  async markRunning(id: string): Promise<void> {
    await this.db.execute(sql`
      UPDATE data_exports SET status = 'RUNNING', started_at = now()
      WHERE id = ${id} AND status IN ('QUEUED', 'RUNNING')`);
  }

  /**
   * Zlecenia porzucone (`data-exports.sweep`): `RUNNING` od `started_at` albo `QUEUED` od zlecenia dłużej niż do
   * `before` kończą się jako `FAILED` z kodem, więc indeks `data_exports_one_open` przestaje blokować klienta.
   */
  async failAbandoned(before: Date, code: string, limit = 200): Promise<Array<{ id: string; userId: string }>> {
    const rows = await this.rows(sql`
      UPDATE data_exports e SET status = 'FAILED', error_code = ${code}, finished_at = now()
      WHERE e.id IN (
        SELECT id FROM data_exports
        WHERE status IN ('QUEUED', 'RUNNING') AND COALESCE(started_at, requested_at) < ${before}
        ORDER BY requested_at LIMIT ${limit}
        FOR UPDATE SKIP LOCKED)
      RETURNING e.id, e.user_id`);
    return rows.map((r) => ({ id: r.id as string, userId: r.user_id as string }));
  }

  async requeue(id: string): Promise<void> {
    await this.db.execute(sql`
      UPDATE data_exports SET status = 'QUEUED', started_at = NULL WHERE id = ${id} AND status = 'RUNNING'`);
  }

  async succeed(id: string, input: { fileId: string; sizeBytes: number; finishedAt: Date; expiresAt: Date }) {
    await this.db.execute(sql`
      UPDATE data_exports
      SET status = 'SUCCEEDED', file_id = ${input.fileId}, size_bytes = ${input.sizeBytes},
          finished_at = ${input.finishedAt}, expires_at = ${input.expiresAt}
      WHERE id = ${id}`);
  }

  async fail(id: string, code: string): Promise<void> {
    await this.db.execute(sql`
      UPDATE data_exports SET status = 'FAILED', error_code = ${code}, finished_at = now()
      WHERE id = ${id} AND status IN ('QUEUED', 'RUNNING')`);
  }

  /** Gotowe pliki do usunięcia: po `expires_at` (`data-exports.purge`) albo wszystkie klienta po usunięciu konta. */
  async filesToPurge(input: { before?: Date; userId?: string }, limit = 200): Promise<DataExportRecord[]> {
    const condition = input.userId ? sql`e.user_id = ${input.userId}` : sql`e.expires_at <= ${input.before!}`;
    const rows = await this.rows(sql`
      ${exportSql}
      WHERE e.status = 'SUCCEEDED' AND e.deleted_at IS NULL AND ${condition}
      ORDER BY e.expires_at LIMIT ${limit}`);
    return rows.map(toExport);
  }

  /** Plik eksportu usunięty: `files.status = DELETED` i `data_exports.deleted_at`; wiersz zostaje jako ślad. */
  async markDeleted(id: string): Promise<boolean> {
    const [row] = await this.rows(sql`
      UPDATE data_exports SET deleted_at = now() WHERE id = ${id} AND deleted_at IS NULL RETURNING file_id`);
    if (!row) return false;
    await this.db.execute(sql`
      UPDATE files SET status = 'DELETED', deleted_at = now() WHERE id = ${row.file_id as string} AND status = 'READY'`);
    return true;
  }
}
