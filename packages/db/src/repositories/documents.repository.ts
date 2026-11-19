import {
  documentTemplatesResource,
  generatedDocumentsResource,
  type DocumentFormat,
  type DocumentTemplateListItem,
  type DocumentType,
  type GeneratedDocumentListItem,
  type JobStatus,
  type ListQuery,
  type ListResponse,
  type ResourceDefinition,
  type TemplateDocumentType,
} from '@hulajnogi/shared';
import { and, inArray, sql, type SQL } from 'drizzle-orm';
import { runListQuery, type ListSource } from '../admin/list-query.js';
import type { DbExecutor } from '../client.js';
import { vDocumentTemplates, vGeneratedDocuments } from '../schema/schema.js';
import { rethrowDatabaseRule, rethrowUniqueViolation } from './errors.js';

type Row = Record<string, unknown>;
type TemplateField = keyof typeof documentTemplatesResource.fields & string;
type GeneratedField = keyof typeof generatedDocumentsResource.fields & string;

const templateSource: ListSource<TemplateField> = {
  from: vDocumentTemplates,
  id: vDocumentTemplates.id,
  columns: {
    id: vDocumentTemplates.id,
    documentType: vDocumentTemplates.documentType,
    name: vDocumentTemplates.name,
    description: vDocumentTemplates.description,
    isDefault: vDocumentTemplates.isDefault,
    active: vDocumentTemplates.active,
    activeVersionId: vDocumentTemplates.activeVersionId,
    activeVersionNo: vDocumentTemplates.activeVersionNo,
    activeSince: vDocumentTemplates.activeSince,
    versions: vDocumentTemplates.versions,
    pendingVersions: vDocumentTemplates.pendingVersions,
    lastGeneratedAt: vDocumentTemplates.lastGeneratedAt,
    updatedByName: vDocumentTemplates.updatedByName,
    createdAt: vDocumentTemplates.createdAt,
    updatedAt: vDocumentTemplates.updatedAt,
    version: vDocumentTemplates.version,
  },
};

const generatedColumns: ListSource<GeneratedField>['columns'] = {
  id: vGeneratedDocuments.id,
  documentType: vGeneratedDocuments.documentType,
  entityRef: vGeneratedDocuments.entityRef,
  entityLabel: vGeneratedDocuments.entityLabel,
  format: vGeneratedDocuments.format,
  status: vGeneratedDocuments.status,
  state: vGeneratedDocuments.state,
  templateId: vGeneratedDocuments.templateId,
  templateName: vGeneratedDocuments.templateName,
  templateVersionId: vGeneratedDocuments.templateVersionId,
  templateVersionNo: vGeneratedDocuments.templateVersionNo,
  builtIn: vGeneratedDocuments.builtIn,
  requesterKind: vGeneratedDocuments.requesterKind,
  requestedByStaff: vGeneratedDocuments.requestedByStaff,
  staffName: vGeneratedDocuments.staffName,
  requestedByUser: vGeneratedDocuments.requestedByUser,
  userName: vGeneratedDocuments.userName,
  errorCode: vGeneratedDocuments.errorCode,
  retryOf: vGeneratedDocuments.retryOf,
  createdAt: vGeneratedDocuments.createdAt,
  startedAt: vGeneratedDocuments.startedAt,
  finishedAt: vGeneratedDocuments.finishedAt,
  filesDeletedAt: vGeneratedDocuments.filesDeletedAt,
  durationMs: vGeneratedDocuments.durationMs,
  customerDataVisible: vGeneratedDocuments.customerDataVisible,
};

// --- Rekordy -------------------------------------------------------------------------------------

export interface DocumentTemplateRecord {
  id: string;
  documentType: TemplateDocumentType;
  name: string;
  description: string | null;
  isDefault: boolean;
  active: boolean;
  activeVersionId: string | null;
  activeVersionNo: number | null;
  versions: number;
  lastGeneratedAt: Date | null;
  version: number;
}

export interface TemplateVersionRecord {
  id: string;
  templateId: string;
  documentType: TemplateDocumentType;
  templateName: string;
  versionNo: number;
  state: 'ACTIVE' | 'ARCHIVED' | 'PENDING';
  isActive: boolean;
  fileId: string;
  fileName: string | null;
  storageKey: string;
  sizeBytes: number;
  uncompressedBytes: number;
  fields: string[];
  warnings: Array<{ code: 'TEMPLATE_UNUSED_FIELD'; field: string; loop: string | null }>;
  note: string | null;
  uploadedAt: Date;
  uploadedByName: string | null;
  activatedAt: Date | null;
  activatedByName: string | null;
  previewFileId: string | null;
  documents: number;
}

export interface NewTemplateVersion {
  id: string;
  templateId: string;
  versionNo: number;
  fileId: string;
  fields: string[];
  warnings: unknown[];
  note: string | null;
  uploadedBy: string;
  sizeBytes: number;
  uncompressedBytes: number;
}

/** Plik wydruku do odpowiedzi (adres z podpisem wystawia API). */
export interface DocumentFileRecord {
  id: string;
  sizeBytes: number;
  status: 'READY' | 'DELETED';
  storageKey: string;
}

export interface GeneratedDocumentRecord {
  id: string;
  documentType: DocumentType;
  entityRef: string;
  entityLabel: string;
  params: Record<string, string | number | boolean>;
  format: DocumentFormat;
  status: JobStatus;
  templateVersionId: string | null;
  templateId: string | null;
  templateName: string | null;
  templateVersionNo: number | null;
  requestedByStaff: string | null;
  staffName: string | null;
  requestedByUser: string | null;
  errorCode: string | null;
  error: string | null;
  retryOf: string | null;
  createdAt: Date;
  startedAt: Date | null;
  finishedAt: Date | null;
  filesDeletedAt: Date | null;
  /** Plik zawiera dane klienta bez maskowania (`customer_data_visible`): pobiera tylko operator z `users.read`. */
  customerDataVisible: boolean;
  docx: DocumentFileRecord | null;
  pdf: DocumentFileRecord | null;
}

export interface NewGeneratedDocument {
  id: string;
  documentType: DocumentType;
  templateVersionId: string | null;
  entityRef: string;
  entityLabel: string;
  params: Record<string, string | number | boolean>;
  format: DocumentFormat;
  requestedByStaff: string | null;
  requestedByUser: string | null;
  retryOf?: string | null;
}

const date = (value: unknown): Date | null =>
  value === null || value === undefined ? null : new Date(value as string);
const num = (value: unknown): number | null => (value === null || value === undefined ? null : Number(value));

const toTemplate = (r: Row): DocumentTemplateRecord => ({
  id: r.id as string,
  documentType: r.document_type as TemplateDocumentType,
  name: r.name as string,
  description: (r.description as string | null) ?? null,
  isDefault: r.is_default as boolean,
  active: r.active as boolean,
  activeVersionId: (r.active_version_id as string | null) ?? null,
  activeVersionNo: num(r.active_version_no),
  versions: Number(r.versions),
  lastGeneratedAt: date(r.last_generated_at),
  version: Number(r.version),
});

const versionSql = sql`
  SELECT v.*, f.original_name AS file_name, f.storage_key
  FROM v_document_template_versions v JOIN files f ON f.id = v.file_id`;

const toVersion = (r: Row): TemplateVersionRecord => ({
  id: r.id as string,
  templateId: r.template_id as string,
  documentType: r.document_type as TemplateDocumentType,
  templateName: r.template_name as string,
  versionNo: Number(r.version_no),
  state: r.state as TemplateVersionRecord['state'],
  isActive: r.is_active as boolean,
  fileId: r.file_id as string,
  fileName: (r.file_name as string | null) ?? null,
  storageKey: r.storage_key as string,
  sizeBytes: Number(r.size_bytes),
  uncompressedBytes: Number(r.uncompressed_bytes),
  fields: (r.fields as string[] | null) ?? [],
  warnings: (r.warnings as TemplateVersionRecord['warnings'] | null) ?? [],
  note: (r.note as string | null) ?? null,
  uploadedAt: new Date(r.uploaded_at as string),
  uploadedByName: (r.uploaded_by_name as string | null) ?? null,
  activatedAt: date(r.activated_at),
  activatedByName: (r.activated_by_name as string | null) ?? null,
  previewFileId: (r.preview_file_id as string | null) ?? null,
  documents: Number(r.documents),
});

const generatedSql = sql`
  SELECT g.*, d.size_bytes AS docx_size, d.status::text AS docx_status, d.storage_key AS docx_key,
         p.size_bytes AS pdf_size, p.status::text AS pdf_status, p.storage_key AS pdf_key
  FROM v_generated_documents g
  LEFT JOIN files d ON d.id = g.docx_file_id
  LEFT JOIN files p ON p.id = g.pdf_file_id`;

const fileOf = (r: Row, prefix: 'docx' | 'pdf'): DocumentFileRecord | null =>
  r[`${prefix}_file_id`]
    ? {
        id: r[`${prefix}_file_id`] as string,
        sizeBytes: Number(r[`${prefix}_size`] ?? 0),
        status: r[`${prefix}_status`] as DocumentFileRecord['status'],
        storageKey: r[`${prefix}_key`] as string,
      }
    : null;

const toGenerated = (r: Row): GeneratedDocumentRecord => ({
  id: r.id as string,
  documentType: r.document_type as DocumentType,
  entityRef: r.entity_ref as string,
  entityLabel: r.entity_label as string,
  params: (r.params as GeneratedDocumentRecord['params'] | null) ?? {},
  format: r.format as DocumentFormat,
  status: r.status as JobStatus,
  templateVersionId: (r.template_version_id as string | null) ?? null,
  templateId: (r.template_id as string | null) ?? null,
  templateName: (r.template_name as string | null) ?? null,
  templateVersionNo: num(r.template_version_no),
  requestedByStaff: (r.requested_by_staff as string | null) ?? null,
  staffName: (r.staff_name as string | null) ?? null,
  requestedByUser: (r.requested_by_user as string | null) ?? null,
  errorCode: (r.error_code as string | null) ?? null,
  error: (r.error as string | null) ?? null,
  retryOf: (r.retry_of as string | null) ?? null,
  createdAt: new Date(r.created_at as string),
  startedAt: date(r.started_at),
  finishedAt: date(r.finished_at),
  filesDeletedAt: date(r.files_deleted_at),
  customerDataVisible: r.customer_data_visible === true,
  docx: fileOf(r, 'docx'),
  pdf: fileOf(r, 'pdf'),
});

/** Widoki danych wydruków (migracja 0011): kontrakt modułu, do którego należą dane (ADR 0068). */
const SOURCE_VIEWS = {
  RECEIPT: { view: sql.raw('v_doc_receipt'), key: sql.raw('receipt_id') },
  RENTAL_CONFIRMATION: { view: sql.raw('v_doc_rental'), key: sql.raw('rental_id') },
  SERVICE_PROTOCOL: { view: sql.raw('v_doc_service_task'), key: sql.raw('task_id') },
  SCOOTER_CARD: { view: sql.raw('v_doc_scooter'), key: sql.raw('scooter_id') },
  INCIDENT_REPORT: { view: sql.raw('v_doc_ticket'), key: sql.raw('ticket_id') },
  WALLET_ADJUSTMENT: { view: sql.raw('v_doc_wallet_adjustment'), key: sql.raw('entry_id') },
} as const;

const isUuid = (value: string) => /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value);

/**
 * Moduł Dokumenty (ADR 0066–0068): szablony wydruków z wersjami, wygenerowane dokumenty z retencją plików
 * i odczyt danych wydruku z widoków `v_doc_*` (moduł nie czyta tabel innych modułów, tylko ich widoki danych).
 */
export class DrizzleDocumentRepository {
  constructor(private readonly db: DbExecutor) {}

  private async rows(query: SQL): Promise<Row[]> {
    return (await this.db.execute<Row>(query)).rows;
  }

  // --- Szablony -----------------------------------------------------------------------------------

  listTemplates(query: ListQuery): Promise<ListResponse<DocumentTemplateListItem>> {
    return runListQuery<TemplateField, DocumentTemplateListItem>(
      this.db,
      documentTemplatesResource,
      templateSource,
      query,
    );
  }

  async templates(type?: TemplateDocumentType): Promise<DocumentTemplateRecord[]> {
    const where = type ? sql`WHERE document_type = ${type}::document_type` : sql``;
    const rows = await this.rows(
      sql`SELECT * FROM v_document_templates ${where} ORDER BY document_type, is_default DESC, name`,
    );
    return rows.map(toTemplate);
  }

  async template(id: string, options: { lock?: boolean } = {}): Promise<DocumentTemplateRecord | null> {
    if (options.lock) await this.rows(sql`SELECT 1 FROM document_templates WHERE id = ${id} FOR UPDATE`);
    const [row] = await this.rows(sql`SELECT * FROM v_document_templates WHERE id = ${id}`);
    return row ? toTemplate(row) : null;
  }

  async insertTemplate(input: {
    documentType: TemplateDocumentType;
    name: string;
    description: string | null;
    staffId: string;
  }): Promise<string> {
    try {
      const [row] = await this.rows(sql`
        INSERT INTO document_templates (document_type, name, description, created_by, updated_by)
        VALUES (${input.documentType}::document_type, ${input.name}, ${input.description}, ${input.staffId},
                ${input.staffId})
        RETURNING id`);
      return row!.id as string;
    } catch (error) {
      rethrowUniqueViolation(error);
    }
  }

  async versions(templateId: string): Promise<TemplateVersionRecord[]> {
    const rows = await this.rows(sql`${versionSql} WHERE v.template_id = ${templateId} ORDER BY v.version_no DESC`);
    return rows.map(toVersion);
  }

  async version(id: string): Promise<TemplateVersionRecord | null> {
    const [row] = await this.rows(sql`${versionSql} WHERE v.id = ${id}`);
    return row ? toVersion(row) : null;
  }

  /** Najwyższy numer wersji szablonu (wywołujący trzyma blokadę szablonu). */
  async highestVersionNo(templateId: string): Promise<number | null> {
    const [row] = await this.rows(
      sql`SELECT max(version_no) AS no FROM document_template_versions WHERE template_id = ${templateId}`,
    );
    return num(row?.no);
  }

  async insertVersion(version: NewTemplateVersion): Promise<void> {
    await this.db.execute(sql`
      INSERT INTO document_template_versions (id, template_id, version_no, file_id, fields, warnings, note, uploaded_by,
                                              size_bytes, uncompressed_bytes)
      VALUES (${version.id}, ${version.templateId}, ${version.versionNo}, ${version.fileId},
              ${sql`ARRAY[${sql.join(
                version.fields.map((f) => sql`${f}`),
                sql`, `,
              )}]::text[]`},
              ${JSON.stringify(version.warnings)}::jsonb, ${version.note}, ${version.uploadedBy},
              ${version.sizeBytes}, ${version.uncompressedBytes})`);
  }

  /** Aktywacja i „Przywróć” (`sp_document_template_activate`, blokada szablonu w procedurze). */
  async activate(versionId: string, staffId: string): Promise<void> {
    try {
      await this.db.execute(sql`CALL sp_document_template_activate(${versionId}, ${staffId})`);
    } catch (error) {
      rethrowDatabaseRule(error);
    }
  }

  async setDefault(templateId: string): Promise<void> {
    try {
      await this.db.execute(sql`CALL sp_document_template_set_default(${templateId})`);
    } catch (error) {
      rethrowDatabaseRule(error);
    }
  }

  async touchTemplate(templateId: string, staffId: string): Promise<void> {
    await this.db.execute(sql`
      UPDATE document_templates SET updated_at = now(), updated_by = ${staffId}, version = version + 1
      WHERE id = ${templateId}`);
  }

  async deleteVersion(id: string): Promise<void> {
    try {
      await this.db.execute(sql`DELETE FROM document_template_versions WHERE id = ${id}`);
    } catch (error) {
      rethrowDatabaseRule(error);
    }
  }

  /** Podgląd PDF zapamiętany przy wersji; drugi równoległy podgląd nie nadpisuje pierwszego. */
  async setPreviewFile(versionId: string, fileId: string): Promise<boolean> {
    const { rowCount } = await this.db.execute(sql`
      UPDATE document_template_versions SET preview_file_id = ${fileId}
      WHERE id = ${versionId} AND preview_file_id IS NULL`);
    return (rowCount ?? 0) > 0;
  }

  /** Plik podglądu albo wersji (klucz obiektu w magazynie). */
  async fileKey(fileId: string): Promise<{ storageKey: string; status: string; sizeBytes: number } | null> {
    const [row] = await this.rows(
      sql`SELECT storage_key, status::text AS status, size_bytes FROM files WHERE id = ${fileId}`,
    );
    return row
      ? { storageKey: row.storage_key as string, status: row.status as string, sizeBytes: Number(row.size_bytes) }
      : null;
  }

  // --- Wygenerowane dokumenty ---------------------------------------------------------------------

  listGenerated(
    query: ListQuery,
    types: readonly DocumentType[],
    options: { def?: ResourceDefinition<GeneratedField>; idPrefix?: string } = {},
  ): Promise<ListResponse<GeneratedDocumentListItem>> {
    const conditions: SQL[] = [
      types.length ? inArray(vGeneratedDocuments.documentType, [...types]) : sql`false`,
      ...(options.idPrefix
        ? [sql`replace(${vGeneratedDocuments.id}::text, '-', '') LIKE ${`${options.idPrefix}%`}`]
        : []),
    ];
    const source: ListSource<GeneratedField> = {
      from: vGeneratedDocuments,
      id: vGeneratedDocuments.id,
      columns: generatedColumns,
      where: and(...conditions)!,
    };
    return runListQuery<GeneratedField, GeneratedDocumentListItem>(
      this.db,
      options.def ?? generatedDocumentsResource,
      source,
      query,
    );
  }

  async insertGenerated(doc: NewGeneratedDocument): Promise<void> {
    await this.db.execute(sql`
      INSERT INTO generated_documents (id, document_type, template_version_id, entity_ref, entity_label, params, format,
                                       requested_by_staff, requested_by_user, retry_of)
      VALUES (${doc.id}, ${doc.documentType}::document_type, ${doc.templateVersionId}, ${doc.entityRef},
              ${doc.entityLabel}, ${JSON.stringify(doc.params)}::jsonb, ${doc.format}::document_format,
              ${doc.requestedByStaff}, ${doc.requestedByUser}, ${doc.retryOf ?? null})`);
  }

  /**
   * Paragon PDF klienta (pytanie 2): wstawienie z ponownym użyciem pilnowanym indeksem częściowym
   * `generated_documents_receipt_reuse`; przy konflikcie (równoległe kliknięcie) `false`, a wywołujący czyta istniejący.
   */
  async insertCustomerReceipt(doc: NewGeneratedDocument): Promise<boolean> {
    const { rowCount } = await this.db.execute(sql`
      INSERT INTO generated_documents (id, document_type, template_version_id, entity_ref, entity_label, params, format,
                                       requested_by_user)
      VALUES (${doc.id}, 'RECEIPT', ${doc.templateVersionId}, ${doc.entityRef}, ${doc.entityLabel}, '{}'::jsonb, 'PDF',
              ${doc.requestedByUser})
      ON CONFLICT (entity_ref, template_version_id)
        WHERE document_type = 'RECEIPT' AND format = 'PDF' AND requested_by_user IS NOT NULL
          AND status <> 'FAILED' AND files_deleted_at IS NULL
      DO NOTHING`);
    return (rowCount ?? 0) > 0;
  }

  /** Wydruk klienta tego paragonu z tą wersją szablonu, który można użyć ponownie (stan inny niż `FAILED`, pliki są). */
  async reusableCustomerReceipt(receiptId: string, templateVersionId: string): Promise<GeneratedDocumentRecord | null> {
    const [row] = await this.rows(sql`
      ${generatedSql}
      WHERE g.document_type = 'RECEIPT' AND g.format = 'PDF' AND g.requested_by_user IS NOT NULL
        AND g.entity_ref = ${receiptId} AND g.template_version_id = ${templateVersionId}
        AND g.status <> 'FAILED' AND g.files_deleted_at IS NULL
      ORDER BY g.created_at DESC LIMIT 1`);
    return row ? toGenerated(row) : null;
  }

  async generated(id: string): Promise<GeneratedDocumentRecord | null> {
    const [row] = await this.rows(sql`${generatedSql} WHERE g.id = ${id}`);
    return row ? toGenerated(row) : null;
  }

  /** Wiersz wydruku z blokadą (zadanie `document.generate`). */
  async lockGenerated(id: string): Promise<GeneratedDocumentRecord | null> {
    await this.rows(sql`SELECT 1 FROM generated_documents WHERE id = ${id} FOR UPDATE`);
    return this.generated(id);
  }

  /**
   * Start zadania na zablokowanym wierszu: `QUEUED` albo porzucony `RUNNING` (ponowienie po restarcie API, o czym
   * decyduje `shouldRunDocumentJob`); `started_at` liczy się od nowa.
   */
  async markRunning(id: string): Promise<void> {
    await this.db.execute(sql`
      UPDATE generated_documents SET status = 'RUNNING', started_at = now()
      WHERE id = ${id} AND status IN ('QUEUED', 'RUNNING')`);
  }

  /**
   * Wydruki porzucone (zadanie porządkowe `documents.sweep`): `RUNNING` od `started_at` albo `QUEUED` od zlecenia
   * dłużej niż do `before`; kończą się jako `FAILED` z kodem, a zapisany DOCX zostaje do pobrania. Zwraca identyfikatory.
   */
  async failAbandoned(before: Date, code: string, limit = 200): Promise<string[]> {
    const rows = await this.rows(sql`
      UPDATE generated_documents g
      SET status = 'FAILED', finished_at = now(), error_code = ${code}, error = 'abandoned',
          started_at = COALESCE(g.started_at, now())
      WHERE g.id IN (
        SELECT id FROM generated_documents
        WHERE status IN ('QUEUED', 'RUNNING') AND COALESCE(started_at, created_at) < ${before}
        ORDER BY created_at LIMIT ${limit}
        FOR UPDATE SKIP LOCKED)
      RETURNING g.id`);
    return rows.map((r) => r.id as string);
  }

  /** Zapis wypełnionego szablonu: czy plik ma dane klienta bez maskowania (`customer_data_visible`). */
  async setCustomerDataVisible(id: string, visible: boolean): Promise<void> {
    await this.db.execute(sql`UPDATE generated_documents SET customer_data_visible = ${visible} WHERE id = ${id}`);
  }

  /** Powrót do kolejki przed ponowieniem zadania (`RENDERER_UNAVAILABLE`); zapisany DOCX zostaje. */
  async requeue(id: string): Promise<void> {
    await this.db.execute(sql`
      UPDATE generated_documents SET status = 'QUEUED', started_at = NULL WHERE id = ${id} AND status = 'RUNNING'`);
  }

  async attachFile(id: string, format: DocumentFormat, fileId: string): Promise<void> {
    const column = sql.raw(format === 'PDF' ? 'pdf_file_id' : 'docx_file_id');
    await this.db.execute(sql`UPDATE generated_documents SET ${column} = ${fileId} WHERE id = ${id}`);
  }

  async succeed(id: string): Promise<void> {
    await this.db.execute(sql`
      UPDATE generated_documents SET status = 'SUCCEEDED', finished_at = now(), error_code = NULL, error = NULL
      WHERE id = ${id}`);
  }

  async fail(id: string, code: string, error: string | null): Promise<void> {
    await this.db.execute(sql`
      UPDATE generated_documents
      SET status = 'FAILED', finished_at = now(), error_code = ${code}, error = ${error?.slice(0, 500) ?? null},
          started_at = COALESCE(started_at, now())
      WHERE id = ${id}`);
  }

  /** Wydruki z plikami starszymi niż `before` (kandydaci `documents.retention`). */
  async expiredFiles(before: Date, limit = 200): Promise<GeneratedDocumentRecord[]> {
    const rows = await this.rows(sql`
      ${generatedSql}
      WHERE g.finished_at < ${before} AND g.files_deleted_at IS NULL
      ORDER BY g.finished_at LIMIT ${limit}`);
    return rows.map(toGenerated);
  }

  /** Pliki usunięte przez retencję: wiersz zostaje z `files_deleted_at` (stan `DELETED` na liście). */
  async markFilesDeleted(id: string): Promise<boolean> {
    const { rowCount } = await this.db.execute(sql`
      UPDATE generated_documents SET files_deleted_at = now()
      WHERE id = ${id} AND files_deleted_at IS NULL AND finished_at IS NOT NULL`);
    return (rowCount ?? 0) > 0;
  }

  // --- Dane wydruków (`v_doc_*`) ------------------------------------------------------------------

  /** Wiersz widoku danych wydruku rodzaju; identyfikator spoza formatu klucza to brak obiektu. */
  async source(type: TemplateDocumentType, entityId: string): Promise<Row | null> {
    const { view, key } = SOURCE_VIEWS[type];
    if (type === 'WALLET_ADJUSTMENT' ? !/^\d{1,18}$/.test(entityId) : !isUuid(entityId)) return null;
    const [row] = await this.rows(sql`SELECT * FROM ${view} WHERE ${key} = ${entityId}`);
    return row ?? null;
  }

  /** Stan na żywo hulajnogi z widoku floty (bateria, ostatnia łączność) do protokołu i karty. */
  async scooterLiveState(scooterId: string): Promise<{ batteryPct: number | null; lastSeenAt: Date | null } | null> {
    const [row] = await this.rows(sql`SELECT battery_pct, last_seen_at FROM v_fleet_status WHERE id = ${scooterId}`);
    return row ? { batteryPct: num(row.battery_pct), lastSeenAt: date(row.last_seen_at) } : null;
  }

  /** Paragony klienta (`requested_by_user`): czy paragon należy do klienta, z `v_doc_receipt`. */
  async receiptOwner(receiptId: string): Promise<{ userId: string; number: string } | null> {
    if (!isUuid(receiptId)) return null;
    const [row] = await this.rows(sql`SELECT user_id, number FROM v_doc_receipt WHERE receipt_id = ${receiptId}`);
    return row ? { userId: row.user_id as string, number: row.number as string } : null;
  }
}
