import {
  contentAuditData,
  DomainError,
  ensureContentDeletable,
  ensureFaqCategoryDeletable,
  ensureNoContentIssues,
  ensureReorder,
  ensureVersion,
  faqItemIssues,
  normalizeFaqCategory,
  notFound,
} from '@hulajnogi/core';
import {
  type Database,
  type DbExecutor,
  DrizzleContentRepository,
  type FaqItemFields,
  type FaqItemRecord,
  toContentHistoryEntry,
} from '@hulajnogi/db';
import type {
  ContentClient,
  ContentHistoryEntry,
  FaqCategoryCreate,
  FaqCategoryListItem,
  FaqCategoryOrder,
  FaqCategoryUpdate,
  FaqCategoryView,
  FaqItemCreate,
  FaqItemUpdate,
  FaqItemView,
  FaqOrder,
  ListQuery,
  ListResponse,
} from '@hulajnogi/shared';
import { Inject, Injectable } from '@nestjs/common';
import { type AuditScope, AuditedTransaction } from '../audit/audited-transaction.js';
import { DB } from '../database/database.module.js';
import { CONTENT_RULES } from './content-rules.js';
import { ContentPublisher } from './content-publisher.service.js';

const itemView = (item: FaqItemRecord): FaqItemView => ({
  id: item.id,
  categoryId: item.categoryId,
  categoryName: item.categoryName,
  question: item.question,
  answerMd: item.answerMd,
  sortOrder: item.sortOrder,
  showOnWeb: item.showOnWeb,
  showInApp: item.showInApp,
  status: item.status,
  version: item.version,
  updatedAt: item.updatedAt.toISOString(),
  updatedByName: item.updatedByName,
});

/** Stan pytania we wpisie dziennika (jak w danych startowych, z nazwą kategorii do „Przywróć”). */
const snapshot = (item: FaqItemFields & { category: string }): Record<string, unknown> => ({
  categoryId: item.categoryId,
  category: item.category,
  question: item.question,
  answerMd: item.answerMd,
  sortOrder: item.sortOrder,
  status: item.status,
  showOnWeb: item.showOnWeb,
  showInApp: item.showInApp,
});

/** Klienci, których dotyczy pytanie (`content.updated`, odświeżenie strony). */
const clientsOf = (...items: Array<{ showOnWeb: boolean; showInApp: boolean } | null>): ContentClient[] => [
  ...(items.some((item) => item?.showOnWeb) ? (['WEB'] as const) : []),
  ...(items.some((item) => item?.showInApp) ? (['MOBILE'] as const) : []),
];

/**
 * FAQ (ADR 0062): pytania w kategoriach z jawną kolejnością, widoczne na stronie, w aplikacji albo w obu miejscach.
 * Kategoria po nazwie bez względu na wielkość liter (nowa nazwa tworzy kategorię na końcu), usunięcie tylko szkicu
 * albo archiwum, kategorii tylko pustej. Każdy zapis z pełnym stanem w dzienniku audytu.
 */
@Injectable()
export class FaqService {
  constructor(
    @Inject(DB) private readonly db: Database,
    private readonly audited: AuditedTransaction,
    private readonly publisher: ContentPublisher,
  ) {}

  list(query: ListQuery): Promise<ListResponse<FaqItemView>> {
    return new DrizzleContentRepository(this.db).listFaq(query);
  }

  async details(id: string, executor: DbExecutor = this.db): Promise<FaqItemView> {
    const item = await new DrizzleContentRepository(executor).faqItem(id);
    if (!item) throw notFound('faq_item', id);
    return itemView(item);
  }

  async history(id: string): Promise<ContentHistoryEntry[]> {
    const rows = await new DrizzleContentRepository(this.db).history('faq_item', id);
    return rows.map((row) => toContentHistoryEntry(row));
  }

  async create(staffId: string, body: FaqItemCreate): Promise<FaqItemView> {
    const name = normalizeFaqCategory(body.category);
    ensureNoContentIssues(faqItemIssues({ ...body, category: name }, CONTENT_RULES));
    const id = await this.audited.run(staffId, async (scope) => {
      const repo = new DrizzleContentRepository(scope.tx);
      const category = await this.category(scope, name);
      const item: FaqItemFields = {
        categoryId: category.id,
        question: body.question,
        answerMd: body.answerMd,
        sortOrder: await repo.nextFaqSortOrder(category.id),
        showOnWeb: body.showOnWeb,
        showInApp: body.showInApp,
        status: body.status,
      };
      const created = await repo.insertFaqItem(item, staffId);
      await scope.audit({
        action: 'faq_item.created',
        entityType: 'faq_item',
        entityId: created,
        data: contentAuditData(null, snapshot({ ...item, category: category.name }), { from: null, to: 1 }),
      });
      await this.publisher.changed(scope.tx, clientsOf(item));
      return created;
    });
    await this.publisher.notify(clientsOf(body));
    return this.details(id);
  }

  /**
   * Zapis pytania z blokadą wersji; zmiana kategorii przenosi pytanie na koniec nowej kategorii. Niezmienione pytanie
   * nie tworzy wersji ani wpisu.
   */
  async update(staffId: string, id: string, body: FaqItemUpdate): Promise<FaqItemView> {
    const name = normalizeFaqCategory(body.category);
    const clients = await this.audited.run(staffId, async (scope) => {
      const repo = new DrizzleContentRepository(scope.tx);
      const current = await repo.faqItem(id, { lock: true });
      if (!current) throw notFound('faq_item', id);
      ensureVersion(body.version, current.version);
      ensureNoContentIssues(faqItemIssues({ ...body, category: name }, CONTENT_RULES));
      if (body.restoredFrom !== null && !(await repo.auditEntryExists(body.restoredFrom, 'faq_item'))) {
        throw new DomainError('VALIDATION_FAILED', { fields: ['restoredFrom'] });
      }
      const category = await this.category(scope, name);
      const moved = category.id !== current.categoryId;
      const next: FaqItemFields = {
        categoryId: category.id,
        question: body.question,
        answerMd: body.answerMd,
        sortOrder: moved ? await repo.nextFaqSortOrder(category.id) : current.sortOrder,
        showOnWeb: body.showOnWeb,
        showInApp: body.showInApp,
        status: body.status,
      };
      const before = snapshot({ ...current, category: current.categoryName });
      const after = snapshot({ ...next, category: category.name });
      if (JSON.stringify(before) === JSON.stringify(after)) return [];
      if (!(await repo.updateFaqItem(id, current.version, next, staffId))) {
        throw new DomainError('CONFLICT', { expectedVersion: current.version });
      }
      await scope.audit({
        action: body.restoredFrom === null ? 'faq_item.updated' : 'faq_item.restored',
        entityType: 'faq_item',
        entityId: id,
        data: contentAuditData(before, after, { from: current.version, to: current.version + 1 }, body.restoredFrom),
      });
      const affected = clientsOf(current, next);
      await this.publisher.changed(scope.tx, affected);
      return affected;
    });
    await this.publisher.notify(clients);
    return this.details(id);
  }

  /** Usunięcie szkicu albo pytania z archiwum (opublikowane trzeba najpierw zarchiwizować). */
  async remove(staffId: string, id: string, version: number): Promise<void> {
    const clients = await this.audited.run(staffId, async ({ tx, audit }) => {
      const repo = new DrizzleContentRepository(tx);
      const current = await repo.faqItem(id, { lock: true });
      if (!current) throw notFound('faq_item', id);
      ensureVersion(version, current.version);
      ensureContentDeletable(current.status);
      await repo.deleteFaqItem(id);
      await audit({
        action: 'faq_item.deleted',
        entityType: 'faq_item',
        entityId: id,
        data: contentAuditData(snapshot({ ...current, category: current.categoryName }), null, {
          from: current.version,
          to: null,
        }),
      });
      const affected = clientsOf(current);
      await this.publisher.changed(tx, affected);
      return affected;
    });
    await this.publisher.notify(clients);
  }

  /** `PUT /admin/faq-items/order`: kolejność pytań jednej kategorii z blokadą wersji każdego pytania. */
  async reorder(staffId: string, body: FaqOrder): Promise<FaqItemView[]> {
    await this.audited.run(staffId, async ({ tx, audit }) => {
      const repo = new DrizzleContentRepository(tx);
      if (!(await repo.category(body.categoryId, { lock: true }))) throw notFound('faq_category', body.categoryId);
      const current = await repo.faqItemsIn(body.categoryId, { lock: true });
      const ids = ensureReorder(current, body.items);
      const before = current.map((item) => item.id);
      if (before.every((id, index) => ids[index] === id)) return;
      for (const [index, id] of ids.entries()) await repo.setFaqSortOrder(id, index + 1, staffId);
      await audit({
        action: 'faq_item.reordered',
        entityType: 'faq_category',
        entityId: body.categoryId,
        data: { before: { order: before }, after: { order: ids } },
      });
      await this.publisher.changed(tx, ['WEB', 'MOBILE']);
    });
    await this.publisher.notify(['WEB', 'MOBILE']);
    return (await new DrizzleContentRepository(this.db).faqItemsIn(body.categoryId)).map(itemView);
  }

  // --- Kategorie ----------------------------------------------------------------------------------

  listCategories(query: ListQuery): Promise<ListResponse<FaqCategoryListItem>> {
    return new DrizzleContentRepository(this.db).listCategories(query);
  }

  async categoryDetails(id: string, executor: DbExecutor = this.db): Promise<FaqCategoryView> {
    const category = await new DrizzleContentRepository(executor).category(id);
    if (!category) throw notFound('faq_category', id);
    return {
      id: category.id,
      name: category.name,
      sortOrder: category.sortOrder,
      itemCount: category.items,
      version: category.version,
    };
  }

  async categoryHistory(id: string): Promise<ContentHistoryEntry[]> {
    const rows = await new DrizzleContentRepository(this.db).history('faq_category', id);
    return rows.map((row) => toContentHistoryEntry(row));
  }

  /** Nowa kategoria na końcu kolejności; istniejąca nazwa (bez względu na wielkość liter) to `ALREADY_EXISTS`. */
  async createCategory(staffId: string, body: FaqCategoryCreate): Promise<FaqCategoryView> {
    const name = normalizeFaqCategory(body.name);
    const id = await this.audited.run(staffId, async (scope) => {
      const { category, created } = await new DrizzleContentRepository(scope.tx).ensureCategory(name);
      if (!created) throw new DomainError('ALREADY_EXISTS', { field: 'name' });
      await this.auditCategoryCreated(scope, category);
      return category.id;
    });
    return this.categoryDetails(id);
  }

  async updateCategory(staffId: string, id: string, body: FaqCategoryUpdate): Promise<FaqCategoryView> {
    const name = normalizeFaqCategory(body.name);
    const changed = await this.audited.run(staffId, async ({ tx, audit }) => {
      const repo = new DrizzleContentRepository(tx);
      const current = await repo.category(id, { lock: true });
      if (!current) throw notFound('faq_category', id);
      ensureVersion(body.version, current.version);
      if (current.name === name) return false;
      if (!(await repo.updateCategory(id, current.version, name))) {
        throw new DomainError('CONFLICT', { expectedVersion: current.version });
      }
      await audit({
        action: 'faq_category.updated',
        entityType: 'faq_category',
        entityId: id,
        data: contentAuditData({ name: current.name }, { name }, { from: current.version, to: current.version + 1 }),
      });
      await this.publisher.changed(tx, ['WEB', 'MOBILE']);
      return true;
    });
    if (changed) await this.publisher.notify(['WEB', 'MOBILE']);
    return this.categoryDetails(id);
  }

  /** Usunięcie kategorii bez pytań (także szkiców i archiwalnych): inaczej `FAQ_CATEGORY_NOT_EMPTY`. */
  async removeCategory(staffId: string, id: string, version: number): Promise<void> {
    await this.audited.run(staffId, async ({ tx, audit }) => {
      const repo = new DrizzleContentRepository(tx);
      const current = await repo.category(id, { lock: true });
      if (!current) throw notFound('faq_category', id);
      ensureVersion(version, current.version);
      ensureFaqCategoryDeletable(current.items);
      await repo.deleteCategory(id);
      await audit({
        action: 'faq_category.deleted',
        entityType: 'faq_category',
        entityId: id,
        data: contentAuditData({ name: current.name, sortOrder: current.sortOrder }, null, {
          from: current.version,
          to: null,
        }),
      });
    });
  }

  /** `PUT /admin/faq-categories/order`: kolejność wszystkich kategorii z blokadą wersji każdej z nich. */
  async reorderCategories(staffId: string, body: FaqCategoryOrder): Promise<FaqCategoryView[]> {
    await this.audited.run(staffId, async ({ tx, audit }) => {
      const repo = new DrizzleContentRepository(tx);
      const current = await repo.categories({ lock: true });
      const ids = ensureReorder(current, body.items);
      const before = current.map((category) => category.id);
      if (before.every((id, index) => ids[index] === id)) return;
      for (const [index, id] of ids.entries()) await repo.setCategorySortOrder(id, index + 1);
      await audit({
        action: 'faq_category.reordered',
        entityType: 'faq_category',
        entityId: null,
        data: { before: { order: before }, after: { order: ids } },
      });
      await this.publisher.changed(tx, ['WEB', 'MOBILE']);
    });
    await this.publisher.notify(['WEB', 'MOBILE']);
    const categories = await new DrizzleContentRepository(this.db).categories();
    return categories.map((category) => ({
      id: category.id,
      name: category.name,
      sortOrder: category.sortOrder,
      itemCount: category.items,
      version: category.version,
    }));
  }

  /** Kategoria pytania po nazwie; nowa nazwa tworzy kategorię z wpisem w dzienniku. */
  private async category(scope: AuditScope, name: string) {
    const { category, created } = await new DrizzleContentRepository(scope.tx).ensureCategory(name);
    if (created) await this.auditCategoryCreated(scope, category);
    return category;
  }

  private async auditCategoryCreated(scope: AuditScope, category: { id: string; name: string; sortOrder: number }) {
    await scope.audit({
      action: 'faq_category.created',
      entityType: 'faq_category',
      entityId: category.id,
      data: contentAuditData(null, { name: category.name, sortOrder: category.sortOrder }, { from: null, to: 1 }),
    });
  }
}
