import type { AttachableFile, FileContentType, StaffUploadFilePurpose } from '@hulajnogi/core';
import {
  filesResource,
  type FileListItem,
  type FilePurpose,
  type ListQuery,
  type ListResponse,
} from '@hulajnogi/shared';
import { inArray, sql } from 'drizzle-orm';
import { runListQuery, type ListSource } from '../admin/list-query.js';
import type { DbExecutor } from '../client.js';
import { vFileList } from '../schema/schema.js';

type FileField = keyof typeof filesResource.fields & string;

const listColumns: ListSource<FileField>['columns'] = {
  id: vFileList.id,
  purpose: vFileList.purpose,
  status: vFileList.status,
  contentType: vFileList.contentType,
  sizeBytes: vFileList.sizeBytes,
  sha256: vFileList.sha256,
  originalName: vFileList.originalName,
  uploadedBy: vFileList.uploadedBy,
  uploadedByName: vFileList.uploadedByName,
  uploadedByStaff: vFileList.uploadedByStaff,
  uploadedByStaffName: vFileList.uploadedByStaffName,
  createdAt: vFileList.createdAt,
  deletedAt: vFileList.deletedAt,
  rentalId: vFileList.rentalId,
  rentalNumber: vFileList.rentalNumber,
  ticketId: vFileList.ticketId,
  ticketNumber: vFileList.ticketNumber,
  attached: vFileList.attached,
};

/** Wiersz `files` (ADR 0057): obiekt w magazynie S3 pod `storageKey`, wiersz zostaje po usunięciu obiektu. */
export interface FileRecord {
  id: string;
  storageKey: string;
  purpose: string;
  contentType: string;
  sizeBytes: number | null;
  sha256: string | null;
  status: 'READY' | 'DELETED';
  uploadedBy: string | null;
  uploadedByStaff: string | null;
  createdAt: Date;
  deletedAt: Date | null;
  /** Wymiary grafiki (cel `MEDIA`); `null` dla innych plików. */
  width: number | null;
  height: number | null;
  originalName: string | null;
}

export interface NewFile {
  id: string;
  storageKey: string;
  purpose: StaffUploadFilePurpose;
  contentType: FileContentType;
  sizeBytes: number;
  sha256: string;
  originalName: string | null;
  uploadedBy: string | null;
  uploadedByStaff: string | null;
  /** Wymiary grafiki biblioteki mediów (core `readImageInfo`, ADR 0064); inne pliki ich nie mają. */
  width?: number | null;
  height?: number | null;
}

type Row = Record<string, unknown>;

const fileSql = sql`SELECT f.id, f.storage_key, f.purpose::text AS purpose, f.content_type, f.size_bytes, f.sha256,
                           f.status::text AS status, f.uploaded_by, f.uploaded_by_staff, f.created_at, f.deleted_at,
                           f.width, f.height, f.original_name
                    FROM files f`;
const toFile = (r: Row): FileRecord => ({
  id: r.id as string,
  storageKey: r.storage_key as string,
  purpose: r.purpose as string,
  contentType: r.content_type as string,
  sizeBytes: r.size_bytes === null ? null : Number(r.size_bytes),
  sha256: (r.sha256 as string | null) ?? null,
  status: r.status as FileRecord['status'],
  uploadedBy: (r.uploaded_by as string | null) ?? null,
  uploadedByStaff: (r.uploaded_by_staff as string | null) ?? null,
  createdAt: new Date(r.created_at as string),
  deletedAt: r.deleted_at ? new Date(r.deleted_at as string) : null,
  width: r.width === null || r.width === undefined ? null : Number(r.width),
  height: r.height === null || r.height === undefined ? null : Number(r.height),
  originalName: (r.original_name as string | null) ?? null,
});

/**
 * Plik przypięty do rekordu: zdjęcie parkowania przejazdu, zdjęcie zgłoszenia, plik grafiki biblioteki mediów, plik
 * wersji szablonu wydruku (iteracja 7), plik wydruku (DOCX i PDF), eksportu danych klienta albo raportu (iteracja 8).
 * Plik bez przypięcia usuwa `files.cleanup` po 24 h (tylko cele z wysyłki i szablony), także stary plik grafiki po
 * „Zastąp plik” (ADR 0064); pliki wydruków, eksportów i raportów usuwa ich własna retencja.
 */
const ATTACHED = sql`(EXISTS (SELECT 1 FROM rentals r WHERE r.parking_photo_id = f.id)
                      OR EXISTS (SELECT 1 FROM ticket_photos p WHERE p.file_id = f.id)
                      OR EXISTS (SELECT 1 FROM media_assets m WHERE m.file_id = f.id)
                      OR EXISTS (SELECT 1 FROM document_template_versions v
                                 WHERE v.file_id = f.id OR v.preview_file_id = f.id)
                      OR EXISTS (SELECT 1 FROM generated_documents g
                                 WHERE g.docx_file_id = f.id OR g.pdf_file_id = f.id)
                      OR EXISTS (SELECT 1 FROM data_exports x WHERE x.file_id = f.id)
                      OR EXISTS (SELECT 1 FROM report_runs rr WHERE rr.file_id = f.id))`;

/**
 * Zdjęcie parkowania jest dowodem w sprawie: przejazd, do którego je przypięto, ma zgłoszenie (np. reklamację
 * „Rozliczenie”) albo zdjęcie jest w zgłoszeniu. Retencja 30 dni go pomija (ADR 0057).
 */
const EVIDENCE = sql`(EXISTS (SELECT 1 FROM ticket_photos p WHERE p.file_id = f.id)
                      OR EXISTS (SELECT 1 FROM rentals r JOIN tickets t ON t.rental_id = r.id
                                 WHERE r.parking_photo_id = f.id))`;

/** Warunek usunięcia pliku: nieprzypięty (panel i `files.cleanup`) albo zdjęcie parkowania bez sprawy (retencja). */
export type FileDeletionRule = 'UNATTACHED' | 'RETENTION';

/** Moduł Pliki (ADR 0057): metadane plików; obiekty zapisuje port `FileStorage` w API. */
export class DrizzleFileRepository {
  constructor(private readonly db: DbExecutor) {}

  private async rows(query: ReturnType<typeof sql>): Promise<Row[]> {
    return (await this.db.execute<Row>(query)).rows;
  }

  /**
   * Lista plików w panelu (ADR 0031) zawężona do celów, do których operator ma uprawnienie modułu
   * (`rentals.read` dla zdjęć parkowania, `tickets.read` dla zdjęć zgłoszeń); adres podglądu dokłada API.
   */
  list(query: ListQuery, purposes: readonly FilePurpose[]): Promise<ListResponse<Omit<FileListItem, 'url'>>> {
    const source: ListSource<FileField> = {
      from: vFileList,
      id: vFileList.id,
      columns: listColumns,
      where: purposes.length ? inArray(vFileList.purpose, [...purposes]) : sql`false`,
    };
    return runListQuery<FileField, Omit<FileListItem, 'url'>>(this.db, filesResource, source, query);
  }

  /**
   * Plik z blokadą wiersza; stan przypięcia sprawdza osobna instrukcja po blokadzie. W READ COMMITTED podzapytanie
   * w tej samej instrukcji co `FOR UPDATE` widzi migawkę sprzed czekania na blokadę, więc przegapiłoby przypięcie
   * zatwierdzone przez równoległą transakcję (E i F z przeglądu iteracji 6).
   */
  private async lockWithAttachment(id: string): Promise<(FileRecord & { attached: boolean }) | null> {
    const [row] = await this.rows(sql`${fileSql} WHERE f.id = ${id} FOR UPDATE OF f`);
    if (!row) return null;
    const [attached] = await this.rows(sql`SELECT ${ATTACHED} AS attached FROM files f WHERE f.id = ${id}`);
    return { ...toFile(row), attached: attached!.attached as boolean };
  }

  /**
   * Oznaczenie `DELETED` przed usunięciem obiektu z magazynu, w transakcji wywołującego z blokadą pliku: plik
   * przypięty w międzyczasie (albo dowód w sprawie przy retencji) zostaje. Obiekt usuwa API po zatwierdzeniu, więc
   * równoległe przypięcie, które czekało na blokadę, widzi `DELETED` i kończy się błędem `FILE_DELETED`.
   * Wynik: plik oznaczony do usunięcia obiektu, `{ attached: true }` albo `null` (nie ma albo już usunięty).
   */
  async claimForDeletion(
    id: string,
    rule: FileDeletionRule,
  ): Promise<{ claimed: FileRecord } | { attached: true } | null> {
    const file = await this.lockWithAttachment(id);
    if (!file || file.status !== 'READY') return null;
    if (rule === 'UNATTACHED' && file.attached) return { attached: true };
    if (rule === 'RETENTION') {
      const [evidence] = await this.rows(sql`SELECT ${EVIDENCE} AS evidence FROM files f WHERE f.id = ${id}`);
      if (evidence!.evidence) return { attached: true };
    }
    await this.markDeleted(id);
    return { claimed: file };
  }

  /** Wiersz po zapisaniu obiektu w magazynie: plik od razu `READY`, jeszcze nieprzypięty. */
  async insert(file: NewFile): Promise<FileRecord> {
    await this.db.execute(sql`
      INSERT INTO files (id, storage_key, purpose, content_type, size_bytes, sha256, original_name, uploaded_by,
                         uploaded_by_staff, width, height)
      VALUES (${file.id}, ${file.storageKey}, ${file.purpose}::file_purpose, ${file.contentType}, ${file.sizeBytes},
              ${file.sha256}, ${file.originalName}, ${file.uploadedBy}, ${file.uploadedByStaff}, ${file.width ?? null},
              ${file.height ?? null})`);
    return (await this.find(file.id))!;
  }

  /**
   * Plik wytworzony przez API (iteracja 7): wersja szablonu (`DOCUMENT_TEMPLATE`), wydruk (`GENERATED_DOCUMENT`)
   * albo eksport danych (`DATA_EXPORT`). Typ nie jest obrazem, więc nie przechodzi przez reguły wysyłki zdjęć.
   */
  async insertStored(file: {
    id: string;
    storageKey: string;
    purpose: 'DOCUMENT_TEMPLATE' | 'GENERATED_DOCUMENT' | 'DATA_EXPORT' | 'REPORT_EXPORT';
    contentType: string;
    sizeBytes: number;
    sha256: string;
    originalName: string | null;
    uploadedBy?: string | null;
    uploadedByStaff?: string | null;
  }): Promise<FileRecord> {
    await this.db.execute(sql`
      INSERT INTO files (id, storage_key, purpose, content_type, size_bytes, sha256, original_name, uploaded_by,
                         uploaded_by_staff)
      VALUES (${file.id}, ${file.storageKey}, ${file.purpose}::file_purpose, ${file.contentType}, ${file.sizeBytes},
              ${file.sha256}, ${file.originalName}, ${file.uploadedBy ?? null}, ${file.uploadedByStaff ?? null})`);
    return (await this.find(file.id))!;
  }

  async find(id: string): Promise<FileRecord | null> {
    const [row] = await this.rows(sql`${fileSql} WHERE f.id = ${id}`);
    return row ? toFile(row) : null;
  }

  /**
   * Blokada pliku przed przypięciem: równoległe przypięcie tego samego pliku czeka na blokadę i widzi `attached`
   * z osobnej instrukcji (`lockWithAttachment`); gdyby wyścig i tak przeszedł, drugie przypięcie odrzucają unikalne
   * indeksy `rentals_parking_photo_unique` i `ticket_photos_file_unique` (migracja 0009).
   */
  async lockAttachable(id: string): Promise<AttachableFile | null> {
    const file = await this.lockWithAttachment(id);
    if (!file) return null;
    return {
      purpose: file.purpose,
      status: file.status,
      uploadedBy: file.uploadedBy,
      uploadedByStaff: file.uploadedByStaff,
      attached: file.attached,
    };
  }

  /**
   * Pliki z wysyłki (`PARKING_PHOTO`, `TICKET_PHOTO`, `MEDIA`) i szablony (`DOCUMENT_TEMPLATE`) nieprzypięte do niczego
   * od chwili `before` (`files.cleanup`; ADR 0064: także plik grafiki zastąpiony nowym).
   */
  async unattached(before: Date, limit = 200): Promise<FileRecord[]> {
    const rows = await this.rows(sql`
      ${fileSql}
      WHERE f.status = 'READY' AND f.purpose IN ('PARKING_PHOTO', 'TICKET_PHOTO', 'MEDIA', 'DOCUMENT_TEMPLATE')
        AND f.created_at < ${before}
        AND NOT ${ATTACHED}
      ORDER BY f.created_at LIMIT ${limit}`);
    return rows.map(toFile);
  }

  /**
   * Zdjęcia parkowania starsze niż `before`, które nie są dowodem w sprawie (`EVIDENCE`: w zgłoszeniu albo przy
   * przejeździe ze zgłoszeniem) — kandydaci `files.retention`.
   */
  async expiredParkingPhotos(before: Date, limit = 200): Promise<FileRecord[]> {
    const rows = await this.rows(sql`
      ${fileSql}
      WHERE f.status = 'READY' AND f.purpose = 'PARKING_PHOTO' AND f.created_at < ${before}
        AND NOT ${EVIDENCE}
      ORDER BY f.created_at LIMIT ${limit}`);
    return rows.map(toFile);
  }

  /** Obiekt usunięty z magazynu: wiersz zostaje dla kluczy obcych (`rentals.parking_photo_id`). */
  async markDeleted(id: string): Promise<boolean> {
    const { rowCount } = await this.db.execute(sql`
      UPDATE files SET status = 'DELETED', deleted_at = now() WHERE id = ${id} AND status = 'READY'`);
    return (rowCount ?? 0) > 0;
  }
}
