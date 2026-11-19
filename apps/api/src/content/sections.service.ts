import { contentAuditData, DomainError, ensureSectionSave, planSectionItems } from '@hulajnogi/core';
import {
  type ContentBlockFields,
  type ContentBlockRecord,
  type Database,
  DrizzleContentRepository,
  DrizzleMediaRepository,
  type HistoryRow,
  toContentHistoryEntry,
} from '@hulajnogi/db';
import {
  CONTENT_SECTION_KEYS,
  contentSection,
  isContentSectionKey,
  type ContentBlockInput,
  type ContentBlockListItem,
  type ContentBlockView,
  type ContentHistoryEntry,
  type ContentSectionKey,
  type ContentSectionSave,
  type ContentSectionSummary,
  type ContentSectionView,
  type ListQuery,
  type ListResponse,
  type MediaRef,
} from '@hulajnogi/shared';
import { Inject, Injectable } from '@nestjs/common';
import { AuditedTransaction } from '../audit/audited-transaction.js';
import { DB } from '../database/database.module.js';
import { CONTENT_RULES } from './content-rules.js';
import { ContentPublisher } from './content-publisher.service.js';

/** Stan bloku we wpisie dziennika (historia z „Przywróć”): pola edytora z identyfikatorem i pozycją. */
interface BlockSnapshot {
  id: string;
  position: number;
  title: string | null;
  bodyMd: string | null;
  mediaId: string | null;
  buttonLabel: string | null;
  buttonHref: string | null;
  icon: string | null;
  status: string;
}

/** Stan sekcji we wpisie dziennika: nagłówek i elementy w kolejności (kształt żądania zapisu sekcji). */
interface SectionSnapshot {
  key: string;
  client: string;
  header: BlockSnapshot;
  items: BlockSnapshot[];
}

const blockSnapshot = (block: ContentBlockRecord | (ContentBlockFields & { id: string; position: number })) => ({
  id: block.id,
  position: block.position,
  title: block.title,
  bodyMd: block.bodyMd,
  mediaId: block.mediaId,
  buttonLabel: block.buttonLabel,
  buttonHref: block.buttonHref,
  icon: block.icon,
  status: block.status,
});

const fields = (input: ContentBlockInput): ContentBlockFields => ({
  title: input.title,
  bodyMd: input.bodyMd,
  mediaId: input.mediaId,
  buttonLabel: input.buttonLabel,
  buttonHref: input.buttonHref?.trim() ?? null,
  icon: input.icon,
  status: input.status,
});

const sameFields = (block: ContentBlockRecord, next: ContentBlockFields) =>
  block.title === next.title &&
  block.bodyMd === next.bodyMd &&
  block.mediaId === next.mediaId &&
  block.buttonLabel === next.buttonLabel &&
  block.buttonHref === next.buttonHref &&
  block.icon === next.icon &&
  block.status === next.status;

/**
 * Wpis danych startowych jednego bloku (seed zapisuje blok po bloku, z `ctaLabel` i `ctaUrl`) w kształcie stanu
 * bloku z edytora.
 */
function seedBlockSnapshot(row: HistoryRow): BlockSnapshot | null {
  const after = row.data.after as Record<string, unknown> | null;
  if (!after || !row.entityId) return null;
  const text = (value: unknown) => (typeof value === 'string' ? value : null);
  return {
    id: row.entityId,
    position: Number(after.position ?? 0),
    title: text(after.title),
    bodyMd: text(after.bodyMd),
    mediaId: text(after.mediaId),
    buttonLabel: text(after.buttonLabel ?? after.ctaLabel),
    buttonHref: text(after.buttonHref ?? after.ctaUrl),
    icon: text(after.icon),
    status: text(after.status) ?? 'PUBLISHED',
  };
}

/**
 * Sekcje treści (ADR 0062, D1): sekcje wyznacza rejestr w packages/shared, a panel zmienia treść nagłówka
 * (albo bloku pojedynczego) i elementy sekcji-list jednym zapisem z blokadą wersji nagłówka. Reguły (pola i limity
 * z rejestru, Markdown z wierszem i kolumną, przejścia stanu, sekcja wymagana, liczba elementów, usuwanie tylko
 * szkicu albo archiwum) sprawdza core; zapis ma w dzienniku audytu pełny stan sekcji przed i po.
 */
@Injectable()
export class SectionsService {
  constructor(
    @Inject(DB) private readonly db: Database,
    private readonly audited: AuditedTransaction,
    private readonly publisher: ContentPublisher,
  ) {}

  listBlocks(query: ListQuery): Promise<ListResponse<ContentBlockListItem>> {
    return new DrizzleContentRepository(this.db).listBlocks(query);
  }

  /** Sekcje z rejestru w jego kolejności ze stanem nagłówka i licznikami elementów. */
  async sections(): Promise<ContentSectionSummary[]> {
    const headers = new Map(
      (await new DrizzleContentRepository(this.db).sectionHeaders()).map((header) => [header.key, header]),
    );
    return CONTENT_SECTION_KEYS.flatMap((key): ContentSectionSummary[] => {
      const header = headers.get(key);
      if (!header) return [];
      const section = contentSection(key);
      return [
        {
          key,
          client: section.client,
          kind: section.kind,
          required: section.required,
          headerId: header.id,
          status: header.status,
          title: header.title,
          items: header.sectionItems,
          itemsPublished: header.sectionItemsPublished,
          drafts: header.sectionDrafts,
          version: header.version,
          updatedAt: header.updatedAt.toISOString(),
          updatedByName: header.updatedByName,
        },
      ];
    });
  }

  async section(key: string): Promise<ContentSectionView> {
    const sectionKey = this.ensureKey(key);
    const repo = new DrizzleContentRepository(this.db);
    const blocks = await repo.section(sectionKey);
    const header = blocks.find((block) => block.position === 0);
    if (!header) throw new DomainError('NOT_FOUND', { entity: 'content_section', id: key });
    const media = await repo.mediaRefs(blocks.map((block) => block.mediaId));
    return {
      key: sectionKey,
      header: blockView(header, media),
      items: blocks.filter((block) => block.position > 0).map((block) => blockView(block, media)),
    };
  }

  /**
   * Historia sekcji od najnowszej zmiany. Dane startowe (wpis systemu na każdy blok) składają się w jeden wpis
   * „Dane startowe” z całą sekcją, więc „Przywróć” działa tak samo dla każdego wpisu. Elementy usunięte od tamtej
   * pory panel zapisuje jako nowe (bez `id`).
   */
  async history(key: string): Promise<ContentHistoryEntry[]> {
    const sectionKey = this.ensureKey(key);
    const repo = new DrizzleContentRepository(this.db);
    const header = (await repo.section(sectionKey)).find((block) => block.position === 0);
    if (!header) throw new DomainError('NOT_FOUND', { entity: 'content_section', id: key });
    const rows = await repo.sectionHistory(sectionKey, header.id);
    const entries: ContentHistoryEntry[] = [];
    const seed = rows.filter((row) => row.system && row.data.source === 'seed' && !this.isSectionEntry(row));
    for (const row of rows) {
      if (seed.includes(row)) continue;
      entries.push(toContentHistoryEntry(row));
    }
    const blocks = seed.map(seedBlockSnapshot).filter((block): block is BlockSnapshot => block !== null);
    const seedHeader = blocks.find((block) => block.position === 0);
    if (seedHeader) {
      const first = seed.find((row) => row.entityId === seedHeader.id)!;
      const after: SectionSnapshot = {
        key: sectionKey,
        client: contentSection(sectionKey).client,
        header: seedHeader,
        items: blocks.filter((block) => block.position > 0).sort((a, b) => a.position - b.position),
      };
      entries.push(toContentHistoryEntry(first, after as unknown as Record<string, unknown>));
    }
    return entries.sort((a, b) => b.createdAt.localeCompare(a.createdAt) || b.auditId - a.auditId);
  }

  /**
   * `PUT /admin/content-sections/{key}`: nagłówek i elementy jednym zapisem. Kolejność tablicy `items` to pozycje
   * od 1 (unikalność `(key, position)` w bazie jest odroczona), element bez `id` jest nowy, a brakujący usunięty.
   * Niezmieniona sekcja nie tworzy wersji ani wpisu.
   */
  async save(staffId: string, key: string, body: ContentSectionSave): Promise<ContentSectionView> {
    const sectionKey = this.ensureKey(key);
    const section = contentSection(sectionKey);
    const changed = await this.audited.run(staffId, async ({ tx, audit }) => {
      const repo = new DrizzleContentRepository(tx);
      const blocks = await repo.section(sectionKey, { lock: true });
      const header = blocks.find((block) => block.position === 0);
      if (!header) throw new DomainError('NOT_FOUND', { entity: 'content_section', id: key });
      const items = blocks.filter((block) => block.position > 0);
      const nextHeader = fields(body.header);
      const nextItems = body.items.map(fields);
      const widths = await new DrizzleMediaRepository(tx).widths([
        nextHeader.mediaId,
        ...nextItems.map((item) => item.mediaId),
      ]);
      ensureSectionSave(
        section,
        { version: body.version, header: nextHeader, items: nextItems },
        { version: header.version, status: header.status },
        CONTENT_RULES,
        widths,
      );
      const plan = planSectionItems(items, body.items);
      if (body.restoredFrom !== null && !(await repo.auditEntryExists(body.restoredFrom, 'content_block'))) {
        throw new DomainError('VALIDATION_FAILED', { fields: ['restoredFrom'] });
      }

      const byId = new Map(items.map((item) => [item.id, item]));
      const unchanged =
        !plan.created.length &&
        !plan.deleted.length &&
        sameFields(header, nextHeader) &&
        plan.kept.every(({ id, position, index }) => {
          const item = byId.get(id)!;
          return item.position === position && sameFields(item, nextItems[index]!);
        });
      if (unchanged) return false;

      const before: SectionSnapshot = {
        key: sectionKey,
        client: section.client,
        header: blockSnapshot(header),
        items: items.map(blockSnapshot),
      };
      for (const id of plan.deleted) await repo.deleteBlock(id);
      if (!(await repo.updateBlock(header.id, header.version, { ...nextHeader, position: 0 }, staffId))) {
        throw new DomainError('CONFLICT', { expectedVersion: body.version });
      }
      const afterItems: BlockSnapshot[] = [];
      for (const [index, item] of nextItems.entries()) {
        const position = index + 1;
        const id = body.items[index]!.id;
        if (id) {
          const current = byId.get(id)!;
          if (current.position !== position || !sameFields(current, item)) {
            await repo.updateBlock(id, current.version, { ...item, position }, staffId);
          }
          afterItems.push(blockSnapshot({ ...item, id, position }));
        } else {
          const created = await repo.insertBlock(
            { ...item, key: sectionKey, client: section.client, position },
            staffId,
          );
          afterItems.push(blockSnapshot({ ...item, id: created, position }));
        }
      }
      const after: SectionSnapshot = {
        key: sectionKey,
        client: section.client,
        header: blockSnapshot({ ...nextHeader, id: header.id, position: 0 }),
        items: afterItems,
      };
      await audit({
        action: body.restoredFrom === null ? 'content_block.section_saved' : 'content_block.section_restored',
        entityType: 'content_block',
        entityId: header.id,
        data: {
          key: sectionKey,
          ...contentAuditData(
            before as unknown as Record<string, unknown>,
            after as unknown as Record<string, unknown>,
            { from: header.version, to: header.version + 1 },
            body.restoredFrom,
          ),
        },
      });
      await this.publisher.changed(tx, [section.client]);
      return true;
    });
    if (changed) await this.publisher.notify([section.client]);
    return this.section(sectionKey);
  }

  private isSectionEntry(row: HistoryRow): boolean {
    const after = row.data.after as Record<string, unknown> | null;
    return Boolean(after && typeof after === 'object' && 'header' in after);
  }

  private ensureKey(key: string): ContentSectionKey {
    if (!isContentSectionKey(key)) throw new DomainError('NOT_FOUND', { entity: 'content_section', id: key });
    return key;
  }
}

function blockView(block: ContentBlockRecord, media: ReadonlyMap<string, MediaRef>): ContentBlockView {
  return {
    id: block.id,
    key: block.key as ContentSectionKey,
    client: block.client,
    position: block.position,
    title: block.title,
    bodyMd: block.bodyMd,
    media: (block.mediaId && media.get(block.mediaId)) || null,
    buttonLabel: block.buttonLabel,
    buttonHref: block.buttonHref,
    icon: block.icon,
    status: block.status,
    version: block.version,
    updatedAt: block.updatedAt.toISOString(),
    updatedByName: block.updatedByName,
  };
}
