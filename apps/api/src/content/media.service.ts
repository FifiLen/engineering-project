import {
  contentAuditData,
  DomainError,
  ensureMediaDeletable,
  ensureMediaKeyAllowed,
  ensureMediaReplaceable,
  ensureVersion,
  notFound,
  resolveMediaRequest,
  type MediaUsage,
} from '@hulajnogi/core';
import {
  type Database,
  type DbExecutor,
  DrizzleContentRepository,
  DrizzleFileRepository,
  DrizzleMediaRepository,
  type FileRecord,
  type MediaRecord,
  type MediaUsageRecord,
  toContentHistoryEntry,
} from '@hulajnogi/db';
import {
  contentSection,
  isContentSectionKey,
  type ContentClient,
  type ContentHistoryEntry,
  type ContentSectionKey,
  type ListQuery,
  type ListResponse,
  type MediaCreate,
  type MediaDetails,
  type MediaListItem,
  type MediaReplaceFile,
  type MediaUpdate,
  type MediaUsageView,
  type MediaView,
} from '@hulajnogi/shared';
import { Inject, Injectable } from '@nestjs/common';
import { AuditedTransaction } from '../audit/audited-transaction.js';
import { DB } from '../database/database.module.js';
import type { StoredObject } from '../files/file-storage.js';
import { FilesService } from '../files/files.service.js';
import { ContentPublisher } from './content-publisher.service.js';

/** Stan grafiki we wpisie dziennika (jak w danych startowych). */
const snapshot = (media: { key: string; name: string; altText: string; caption: string | null; fileId: string }) => ({
  key: media.key,
  name: media.name,
  altText: media.altText,
  caption: media.caption,
  fileId: media.fileId,
});

const view = (media: MediaRecord, usageCount: number): MediaView => ({
  id: media.id,
  key: media.key,
  url: media.url,
  altText: media.altText,
  caption: media.caption,
  width: media.width,
  height: media.height,
  name: media.name,
  isSystem: media.isSystem,
  contentType: media.contentType,
  sizeBytes: media.sizeBytes,
  usageCount,
  version: media.version,
  createdAt: media.createdAt.toISOString(),
  updatedAt: media.updatedAt.toISOString(),
});

/** Minimalna szerokość grafiki w miejscu użycia: pole grafiki nagłówka albo elementu sekcji z rejestru. */
function usageMinWidth(usage: MediaUsageRecord): number | null {
  if (usage.kind !== 'CONTENT_BLOCK' || !isContentSectionKey(usage.ref)) return null;
  const section = contentSection(usage.ref);
  const rules = usage.position && usage.position > 0 ? section.item : section.header;
  return rules?.media?.minWidth ?? null;
}

const usageView = (usage: MediaUsageRecord): MediaUsageView => ({
  kind: usage.kind,
  id: usage.entityId,
  label: usage.kind === 'CONTENT_BLOCK' ? usage.ref : (usage.label ?? usage.ref),
  sectionKey: usage.kind === 'CONTENT_BLOCK' ? (usage.ref as ContentSectionKey) : null,
});

const coreUsage = (usage: MediaUsageRecord): MediaUsage => ({
  kind: usage.kind,
  id: usage.entityId,
  label: usage.kind === 'CONTENT_BLOCK' ? usage.ref : (usage.label ?? usage.ref),
  minWidth: usageMinWidth(usage),
});

/** Klienci, którzy pokazują grafikę: strona (aktualności, modele, bloki strony) i aplikacja (bloki, rendery). */
function clientsOf(media: { isSystem: boolean }, usages: readonly MediaUsageRecord[]): ContentClient[] {
  const clients = new Set<ContentClient>();
  if (media.isSystem) clients.add('MOBILE');
  for (const usage of usages) {
    if (usage.kind !== 'CONTENT_BLOCK') clients.add('WEB');
    else if (usage.client === 'WEB' || usage.client === 'MOBILE' || usage.client === 'ADMIN') clients.add(usage.client);
  }
  return [...clients];
}

/**
 * Biblioteka mediów (ADR 0064): grafika powstaje z pliku celu `MEDIA` wysłanego przez `POST /files`, z kluczem
 * (niezmiennym, bez przedrostka systemowego), tekstem alternatywnym i podpisem. „Zastąp plik” zachowuje identyfikator
 * i użycia, usuwa się tylko grafikę nieużytą i niesystemową, a publiczny odczyt idzie po sumie SHA-256 z długim cache.
 */
@Injectable()
export class MediaService {
  constructor(
    @Inject(DB) private readonly db: Database,
    private readonly audited: AuditedTransaction,
    private readonly publisher: ContentPublisher,
    private readonly files: FilesService,
  ) {}

  list(query: ListQuery): Promise<ListResponse<MediaListItem>> {
    return new DrizzleMediaRepository(this.db).list(query);
  }

  async details(id: string, executor: DbExecutor = this.db): Promise<MediaDetails> {
    const repo = new DrizzleMediaRepository(executor);
    const media = await repo.find(id);
    if (!media) throw notFound('media_asset', id);
    const usages = await repo.usages(id);
    return { ...view(media, usages.length), usages: usages.map(usageView) };
  }

  async history(id: string): Promise<ContentHistoryEntry[]> {
    const rows = await new DrizzleContentRepository(this.db).history('media_asset', id);
    return rows.map((row) => toContentHistoryEntry(row));
  }

  /** `POST /admin/media` po `POST /files` z celem `MEDIA`: plik własny operatora, jeszcze nieprzypięty. */
  async create(staffId: string, body: MediaCreate): Promise<MediaDetails> {
    const id = await this.audited.run(staffId, async ({ tx, audit }) => {
      const repo = new DrizzleMediaRepository(tx);
      ensureMediaKeyAllowed(body.key, (await repo.keyExists(body.key)) ? new Set([body.key]) : new Set());
      await this.files.ensureAttachable(tx, body.fileId, { staffId }, 'MEDIA');
      const file = (await new DrizzleFileRepository(tx).find(body.fileId))!;
      const fields = {
        key: body.key,
        name: body.name ?? file.originalName ?? body.key,
        fileId: body.fileId,
        altText: body.altText,
        caption: body.caption,
      };
      const created = await repo.insert({ ...fields, name: fields.name.slice(0, 120) }, staffId);
      await audit({
        action: 'media_asset.created',
        entityType: 'media_asset',
        entityId: created,
        data: contentAuditData(null, snapshot(fields), { from: null, to: 1 }),
      });
      return created;
    });
    return this.details(id);
  }

  /** Tekst alternatywny, podpis i nazwa należą do grafiki, więc zmiana działa wszędzie, gdzie grafika jest użyta. */
  async update(staffId: string, id: string, body: MediaUpdate): Promise<MediaDetails> {
    const clients = await this.audited.run(staffId, async ({ tx, audit }) => {
      const repo = new DrizzleMediaRepository(tx);
      const current = await repo.find(id, { lock: true });
      if (!current) throw notFound('media_asset', id);
      ensureVersion(body.version, current.version);
      const next = { ...snapshot(current), name: body.name, altText: body.altText, caption: body.caption };
      if (JSON.stringify(next) === JSON.stringify(snapshot(current))) return [];
      if (!(await repo.update(id, current.version, next, staffId))) {
        throw new DomainError('CONFLICT', { expectedVersion: current.version });
      }
      await audit({
        action: 'media_asset.updated',
        entityType: 'media_asset',
        entityId: id,
        data: contentAuditData(snapshot(current), next, { from: current.version, to: current.version + 1 }),
      });
      const usages = await repo.usages(id);
      const affected = clientsOf(current, usages);
      await this.publisher.changed(tx, affected);
      await this.revalidateScooterPages(tx, usages);
      return affected;
    });
    await this.publisher.notify(clients);
    return this.details(id);
  }

  /**
   * „Zastąp plik” (`POST /admin/media/{id}/file`): nowy plik spełnia minimalną szerokość wszystkich miejsc użycia
   * (`MEDIA_TOO_NARROW`), adres zmienia się razem z sumą SHA-256, a stary plik usuwa `files.cleanup` po 24 h.
   */
  async replaceFile(staffId: string, id: string, body: MediaReplaceFile): Promise<MediaDetails> {
    const clients = await this.audited.run(staffId, async ({ tx, audit }) => {
      const repo = new DrizzleMediaRepository(tx);
      const current = await repo.find(id, { lock: true });
      if (!current) throw notFound('media_asset', id);
      ensureVersion(body.version, current.version);
      await this.files.ensureAttachable(tx, body.fileId, { staffId }, 'MEDIA');
      const file = (await new DrizzleFileRepository(tx).find(body.fileId))!;
      const usages = await repo.usages(id);
      ensureMediaReplaceable({ width: file.width ?? 0 }, usages.map(coreUsage));
      if (!(await repo.replaceFile(id, current.version, body.fileId, staffId))) {
        throw new DomainError('CONFLICT', { expectedVersion: current.version });
      }
      await audit({
        action: 'media_asset.file_replaced',
        entityType: 'media_asset',
        entityId: id,
        data: contentAuditData(
          snapshot(current),
          { ...snapshot(current), fileId: body.fileId },
          { from: current.version, to: current.version + 1 },
        ),
      });
      const affected = clientsOf(current, usages);
      await this.publisher.changed(tx, affected);
      await this.revalidateScooterPages(tx, usages);
      return affected;
    });
    await this.publisher.notify(clients);
    return this.details(id);
  }

  /**
   * Zdjęcie modelu jest też na stronach `/h/{numer}` (tag cache `scooters`, ADR 0065): zmiana tekstu alternatywnego
   * albo pliku grafiki użytej przez model odświeża je razem z tagiem `content`.
   */
  private async revalidateScooterPages(tx: DbExecutor, usages: readonly MediaUsageRecord[]): Promise<void> {
    if (usages.some((usage) => usage.kind === 'SCOOTER_MODEL')) await this.publisher.revalidateSite(tx, ['scooters']);
  }

  /**
   * Usunięcie grafiki nieużytej i niesystemowej (`MEDIA_IN_USE` z miejscami, `MEDIA_SYSTEM`); plik dostaje `DELETED`
   * w tej samej transakcji, a obiekt znika z magazynu po zatwierdzeniu.
   */
  async remove(staffId: string, id: string, version: number): Promise<void> {
    const released = await this.audited.run(staffId, async ({ tx, audit }) => {
      const repo = new DrizzleMediaRepository(tx);
      const current = await repo.find(id, { lock: true });
      if (!current) throw notFound('media_asset', id);
      ensureVersion(version, current.version);
      ensureMediaDeletable({ isSystem: current.isSystem, usages: (await repo.usages(id)).map(coreUsage) });
      await repo.delete(id);
      await audit({
        action: 'media_asset.deleted',
        entityType: 'media_asset',
        entityId: id,
        data: contentAuditData(snapshot(current), null, { from: current.version, to: null }),
      });
      return this.files.claimReleased(tx, current.fileId);
    });
    if (released) await this.files.deleteObject(released as FileRecord);
  }

  /**
   * `GET /media/{id}/{sha256}.{ext}`: bieżąca suma daje plik, starsza przekierowanie na bieżący adres, a nieznana
   * grafika 404 (core `resolveMediaRequest`).
   */
  async publicFile(
    id: string,
    request: { sha256: string; ext: string },
  ): Promise<{ kind: 'serve'; media: MediaRecord; object: StoredObject } | { kind: 'redirect'; location: string }> {
    const media = await new DrizzleMediaRepository(this.db).find(id);
    const resolution = resolveMediaRequest(media, request);
    if (resolution === 'not_found' || !media) throw notFound('media_asset', id);
    if (resolution === 'redirect') return { kind: 'redirect', location: media.url };
    const object = await this.files.readObject(media.storageKey);
    if (!object) throw notFound('media_asset', id);
    return { kind: 'serve', media, object };
  }
}
