import {
  mediaResource,
  type FileContentType,
  type ListQuery,
  type ListResponse,
  type MediaListItem,
  type MediaUsageKind,
} from '@hulajnogi/shared';
import { sql, type SQL } from 'drizzle-orm';
import { runListQuery, type ListSource } from '../admin/list-query.js';
import type { DbExecutor } from '../client.js';
import { vMediaList } from '../schema/schema.js';

type Row = Record<string, unknown>;
type MediaField = keyof typeof mediaResource.fields & string;

const mediaSource: ListSource<MediaField> = {
  from: vMediaList,
  id: vMediaList.id,
  columns: {
    id: vMediaList.id,
    key: vMediaList.key,
    name: vMediaList.name,
    altText: vMediaList.altText,
    caption: vMediaList.caption,
    isSystem: vMediaList.isSystem,
    contentType: vMediaList.contentType,
    sizeBytes: vMediaList.sizeBytes,
    width: vMediaList.width,
    height: vMediaList.height,
    sha256: vMediaList.sha256,
    originalName: vMediaList.originalName,
    usages: vMediaList.usages,
    url: vMediaList.path,
    updatedByName: vMediaList.updatedByName,
    createdAt: vMediaList.createdAt,
    updatedAt: vMediaList.updatedAt,
    version: vMediaList.version,
  },
};

/** Grafika biblioteki z plikiem (`media_assets` i `files`). */
export interface MediaRecord {
  id: string;
  key: string;
  name: string;
  altText: string;
  caption: string | null;
  isSystem: boolean;
  fileId: string;
  contentType: FileContentType;
  sizeBytes: number;
  width: number;
  height: number;
  sha256: string;
  storageKey: string;
  url: string;
  version: number;
  createdAt: Date;
  updatedAt: Date;
  updatedByName: string | null;
}

/** Miejsce użycia z `v_media_usages`: blok sekcji (klucz i pozycja), aktualność (slug) albo model (kod). */
export interface MediaUsageRecord {
  kind: MediaUsageKind;
  entityId: string;
  ref: string;
  position: number | null;
  label: string | null;
  /** Klient bloku (`WEB`, `MOBILE`, `ADMIN`), `WEB` dla aktualności, `null` dla modelu. */
  client: string | null;
  status: string;
}

const toMedia = (r: Row): MediaRecord => ({
  id: r.id as string,
  key: r.key as string,
  name: r.name as string,
  altText: r.alt_text as string,
  caption: (r.caption as string | null) ?? null,
  isSystem: Boolean(r.is_system),
  fileId: r.file_id as string,
  contentType: r.content_type as FileContentType,
  sizeBytes: Number(r.size_bytes ?? 0),
  width: Number(r.width),
  height: Number(r.height),
  sha256: r.sha256 as string,
  storageKey: r.storage_key as string,
  url: r.path as string,
  version: Number(r.version),
  createdAt: new Date(r.created_at as string),
  updatedAt: new Date(r.updated_at as string),
  updatedByName: (r.updated_by_name as string | null) ?? null,
});

const mediaSql = sql`SELECT m.id, m.key, m.name, m.alt_text, m.caption, m.is_system, m.file_id, f.content_type,
                            f.size_bytes, f.width, f.height, f.sha256, f.storage_key,
                            fn_media_path(m.id, f.sha256, f.content_type) AS path, m.version, m.created_at,
                            m.updated_at, s.name AS updated_by_name
                     FROM media_assets m JOIN files f ON f.id = m.file_id LEFT JOIN staff s ON s.id = m.updated_by`;

/** Biblioteka mediów (ADR 0064): grafiki z plikiem celu `MEDIA`, użycia i publiczny odczyt po sumie SHA-256. */
export class DrizzleMediaRepository {
  constructor(private readonly db: DbExecutor) {}

  private async rows(query: SQL): Promise<Row[]> {
    return (await this.db.execute<Row>(query)).rows;
  }

  list(query: ListQuery): Promise<ListResponse<MediaListItem>> {
    return runListQuery<MediaField, MediaListItem>(this.db, mediaResource, mediaSource, query);
  }

  async find(id: string, options: { lock?: boolean } = {}): Promise<MediaRecord | null> {
    const [row] = await this.rows(sql`${mediaSql} WHERE m.id = ${id} ${options.lock ? sql`FOR UPDATE OF m` : sql``}`);
    return row ? toMedia(row) : null;
  }

  async keyExists(key: string): Promise<boolean> {
    const [row] = await this.rows(sql`SELECT 1 AS ok FROM media_assets WHERE key = ${key}`);
    return Boolean(row);
  }

  async usages(id: string): Promise<MediaUsageRecord[]> {
    const rows = await this.rows(sql`
      SELECT kind, entity_id, ref, position, label, client, status FROM v_media_usages WHERE media_id = ${id}
      ORDER BY kind, ref, position`);
    return rows.map((r) => ({
      kind: r.kind as MediaUsageKind,
      entityId: r.entity_id as string,
      ref: r.ref as string,
      position: r.position === null ? null : Number(r.position),
      label: (r.label as string | null) ?? null,
      client: (r.client as string | null) ?? null,
      status: r.status as string,
    }));
  }

  async insert(
    media: { key: string; name: string; fileId: string; altText: string; caption: string | null },
    staffId: string,
  ): Promise<string> {
    const [row] = await this.rows(sql`
      INSERT INTO media_assets (key, name, file_id, alt_text, caption, is_system, updated_by)
      VALUES (${media.key}, ${media.name}, ${media.fileId}, ${media.altText}, ${media.caption}, false, ${staffId})
      RETURNING id`);
    return row!.id as string;
  }

  async update(
    id: string,
    expectedVersion: number,
    fields: { name: string; altText: string; caption: string | null },
    staffId: string,
  ): Promise<boolean> {
    const { rowCount } = await this.db.execute(sql`
      UPDATE media_assets SET name = ${fields.name}, alt_text = ${fields.altText}, caption = ${fields.caption},
             updated_by = ${staffId}, updated_at = now(), version = version + 1
      WHERE id = ${id} AND version = ${expectedVersion}`);
    return (rowCount ?? 0) > 0;
  }

  /** „Zastąp plik”: nowy plik pod tym samym identyfikatorem i kluczem (wyzwalacz sprawdza plik `MEDIA`). */
  async replaceFile(id: string, expectedVersion: number, fileId: string, staffId: string): Promise<boolean> {
    const { rowCount } = await this.db.execute(sql`
      UPDATE media_assets SET file_id = ${fileId}, updated_by = ${staffId}, updated_at = now(), version = version + 1
      WHERE id = ${id} AND version = ${expectedVersion}`);
    return (rowCount ?? 0) > 0;
  }

  async delete(id: string): Promise<void> {
    await this.db.execute(sql`DELETE FROM media_assets WHERE id = ${id}`);
  }

  /**
   * Szerokość grafik po identyfikatorach (minimalna szerokość sekcji, `MEDIA_TOO_NARROW`) z blokadą `FOR SHARE`
   * wiersza grafiki do końca transakcji zapisu: równoległe „Zastąp plik” (`FOR UPDATE`) czeka i widzi już nowe
   * użycie, a zapis po zastąpieniu czyta nową szerokość, więc za wąski plik nie obejdzie minimum.
   */
  async widths(ids: Iterable<string | null | undefined>): Promise<Map<string, number>> {
    const unique = [...new Set([...ids].filter((id): id is string => Boolean(id)))];
    if (!unique.length) return new Map();
    const rows = await this.rows(sql`
      SELECT m.id, f.width FROM media_assets m JOIN files f ON f.id = m.file_id
      WHERE m.id IN (${sql.join(
        unique.map((id) => sql`${id}::uuid`),
        sql`, `,
      )})
      FOR SHARE OF m`);
    return new Map(rows.map((r) => [r.id as string, Number(r.width)]));
  }
}
