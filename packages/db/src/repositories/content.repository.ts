import {
  contentBlocksResource,
  faqCategoriesResource,
  faqItemsResource,
  newsResource,
  type ContentBlockListItem,
  type ContentClient,
  type ContentHistoryEntry,
  type ContentIcon,
  type ContentStatus,
  type FaqCategoryListItem,
  type FaqItemView,
  type ListQuery,
  type ListResponse,
  type MediaRef,
  type NewsState,
} from '@hulajnogi/shared';
import { sql, type SQL } from 'drizzle-orm';
import { runListQuery, type ListSource } from '../admin/list-query.js';
import type { DbExecutor } from '../client.js';
import { vContentBlocks, vFaqCategories, vFaqList, vNewsList } from '../schema/schema.js';

type Row = Record<string, unknown>;
type BlockField = keyof typeof contentBlocksResource.fields & string;
type FaqField = keyof typeof faqItemsResource.fields & string;
type CategoryField = keyof typeof faqCategoriesResource.fields & string;
type NewsField = keyof typeof newsResource.fields & string;

const date = (v: unknown) => (v === null || v === undefined ? null : new Date(v as string));

const blockSource: ListSource<BlockField> = {
  from: vContentBlocks,
  id: vContentBlocks.id,
  columns: {
    id: vContentBlocks.id,
    key: vContentBlocks.key,
    client: vContentBlocks.client,
    position: vContentBlocks.position,
    isHeader: vContentBlocks.isHeader,
    title: vContentBlocks.title,
    bodyMd: vContentBlocks.bodyMd,
    icon: vContentBlocks.icon,
    buttonLabel: vContentBlocks.ctaLabel,
    buttonHref: vContentBlocks.ctaUrl,
    mediaId: vContentBlocks.mediaId,
    mediaKey: vContentBlocks.mediaKey,
    mediaName: vContentBlocks.mediaName,
    status: vContentBlocks.status,
    sectionItems: vContentBlocks.sectionItems,
    sectionItemsPublished: vContentBlocks.sectionItemsPublished,
    sectionDrafts: vContentBlocks.sectionDrafts,
    updatedByName: vContentBlocks.updatedByName,
    createdAt: vContentBlocks.createdAt,
    updatedAt: vContentBlocks.updatedAt,
    version: vContentBlocks.version,
  },
};

const faqSource: ListSource<FaqField> = {
  from: vFaqList,
  id: vFaqList.id,
  columns: {
    id: vFaqList.id,
    categoryId: vFaqList.categoryId,
    categoryName: vFaqList.categoryName,
    categorySortOrder: vFaqList.categorySortOrder,
    question: vFaqList.question,
    answerMd: vFaqList.answerMd,
    sortOrder: vFaqList.sortOrder,
    status: vFaqList.status,
    showOnWeb: vFaqList.showOnWeb,
    showInApp: vFaqList.showInApp,
    updatedByName: vFaqList.updatedByName,
    createdAt: vFaqList.createdAt,
    updatedAt: vFaqList.updatedAt,
    version: vFaqList.version,
  },
};

const categorySource: ListSource<CategoryField> = {
  from: vFaqCategories,
  id: vFaqCategories.id,
  columns: {
    id: vFaqCategories.id,
    name: vFaqCategories.name,
    sortOrder: vFaqCategories.sortOrder,
    items: vFaqCategories.items,
    itemsPublished: vFaqCategories.itemsPublished,
    createdAt: vFaqCategories.createdAt,
    updatedAt: vFaqCategories.updatedAt,
    version: vFaqCategories.version,
  },
};

const newsSource: ListSource<NewsField> = {
  from: vNewsList,
  id: vNewsList.id,
  columns: {
    id: vNewsList.id,
    slug: vNewsList.slug,
    title: vNewsList.title,
    lead: vNewsList.lead,
    status: vNewsList.status,
    state: vNewsList.state,
    publishFrom: vNewsList.publishFrom,
    publishTo: vNewsList.publishTo,
    firstPublishedAt: vNewsList.firstPublishedAt,
    mediaId: vNewsList.mediaId,
    mediaKey: vNewsList.mediaKey,
    mediaName: vNewsList.mediaName,
    createdByName: vNewsList.createdByName,
    updatedByName: vNewsList.updatedByName,
    createdAt: vNewsList.createdAt,
    updatedAt: vNewsList.updatedAt,
    version: vNewsList.version,
  },
};

// --- Rekordy ------------------------------------------------------------------------------------

/** Blok treści (`content_blocks`): pozycja 0 to blok pojedynczy albo nagłówek sekcji-listy (ADR 0062). */
export interface ContentBlockRecord {
  id: string;
  key: string;
  client: ContentClient;
  position: number;
  title: string | null;
  bodyMd: string | null;
  mediaId: string | null;
  buttonLabel: string | null;
  buttonHref: string | null;
  icon: ContentIcon | null;
  status: ContentStatus;
  version: number;
  updatedAt: Date;
  updatedByName: string | null;
}

/** Pola bloku zapisywane z edytora sekcji. */
export interface ContentBlockFields {
  title: string | null;
  bodyMd: string | null;
  mediaId: string | null;
  buttonLabel: string | null;
  buttonHref: string | null;
  icon: string | null;
  status: ContentStatus;
}

export interface FaqItemRecord {
  id: string;
  categoryId: string;
  categoryName: string;
  question: string;
  answerMd: string;
  sortOrder: number;
  showOnWeb: boolean;
  showInApp: boolean;
  status: ContentStatus;
  version: number;
  updatedAt: Date;
  updatedByName: string | null;
}

export interface FaqItemFields {
  categoryId: string;
  question: string;
  answerMd: string;
  sortOrder: number;
  showOnWeb: boolean;
  showInApp: boolean;
  status: ContentStatus;
}

export interface FaqCategoryRecord {
  id: string;
  name: string;
  sortOrder: number;
  items: number;
  version: number;
}

export interface NewsRecord {
  id: string;
  slug: string;
  title: string;
  lead: string;
  bodyMd: string;
  mediaId: string | null;
  status: ContentStatus;
  state: NewsState;
  publishFrom: Date | null;
  publishTo: Date | null;
  firstPublishedAt: Date | null;
  version: number;
  updatedAt: Date;
  updatedByName: string | null;
}

export interface NewsFields {
  slug: string;
  title: string;
  lead: string;
  bodyMd: string;
  mediaId: string | null;
  status: ContentStatus;
  publishFrom: Date | null;
  publishTo: Date | null;
}

/** Dane firmy (`company_profile`): puste pola adresu i NIP są w bazie `NULL`. */
export interface CompanyProfileRecord {
  name: string;
  street: string | null;
  postalCode: string | null;
  city: string | null;
  taxId: string | null;
  supportEmail: string;
  supportPhone: string;
  supportHours: string | null;
  regon: string | null;
  krs: string | null;
  registryCourt: string | null;
  shareCapitalGrosze: number | null;
  version: number;
  updatedAt: Date;
  updatedByName: string | null;
}

export type CompanyProfileFields = Omit<CompanyProfileRecord, 'version' | 'updatedAt' | 'updatedByName'>;

/** Opublikowany blok z `v_public_content_blocks`. */
export interface PublicBlockRecord {
  id: string;
  key: string;
  position: number;
  title: string | null;
  bodyMd: string | null;
  mediaId: string | null;
  buttonLabel: string | null;
  buttonHref: string | null;
  icon: ContentIcon | null;
}

export interface PublicFaqRecord {
  categoryId: string;
  categoryName: string;
  id: string;
  question: string;
  answerMd: string;
}

export interface PublicModelRecord {
  code: string;
  name: string;
  rangeKm: number | null;
  maxSpeedKmh: number | null;
  photoMediaId: string | null;
}

export interface PublicNewsRecord {
  slug: string;
  title: string;
  lead: string;
  bodyMd: string;
  mediaId: string | null;
  publishFrom: Date;
  updatedAt: Date;
}

export interface PublicDocumentVersionRecord {
  slug: string;
  versionNo: number;
  title: string;
  bodyMd: string;
  changeSummary: string | null;
  publishedAt: Date;
  validTo: Date | null;
  isCurrent: boolean;
}

const toBlock = (r: Row): ContentBlockRecord => ({
  id: r.id as string,
  key: r.key as string,
  client: r.client as ContentClient,
  position: Number(r.position),
  title: (r.title as string | null) ?? null,
  bodyMd: (r.body_md as string | null) ?? null,
  mediaId: (r.media_id as string | null) ?? null,
  buttonLabel: (r.cta_label as string | null) ?? null,
  buttonHref: (r.cta_url as string | null) ?? null,
  icon: (r.icon as ContentIcon | null) ?? null,
  status: r.status as ContentStatus,
  version: Number(r.version),
  updatedAt: new Date(r.updated_at as string),
  updatedByName: (r.updated_by_name as string | null) ?? null,
});

const blockSql = sql`SELECT b.id, b.key, b.client::text AS client, b.position, b.title, b.body_md, b.media_id,
                            b.cta_label, b.cta_url, b.icon, b.status::text AS status, b.version, b.updated_at,
                            s.name AS updated_by_name
                     FROM content_blocks b LEFT JOIN staff s ON s.id = b.updated_by`;

const toFaqItem = (r: Row): FaqItemRecord => ({
  id: r.id as string,
  categoryId: r.category_id as string,
  categoryName: r.category_name as string,
  question: r.question as string,
  answerMd: r.answer_md as string,
  sortOrder: Number(r.sort_order),
  showOnWeb: Boolean(r.show_on_web),
  showInApp: Boolean(r.show_in_app),
  status: r.status as ContentStatus,
  version: Number(r.version),
  updatedAt: new Date(r.updated_at as string),
  updatedByName: (r.updated_by_name as string | null) ?? null,
});

const faqSql = sql`SELECT f.id, f.category_id, c.name AS category_name, f.question, f.answer_md, f.sort_order,
                          f.show_on_web, f.show_in_app, f.status::text AS status, f.version, f.updated_at,
                          s.name AS updated_by_name
                   FROM faq_items f JOIN faq_categories c ON c.id = f.category_id LEFT JOIN staff s ON s.id = f.updated_by`;

const toCategory = (r: Row): FaqCategoryRecord => ({
  id: r.id as string,
  name: r.name as string,
  sortOrder: Number(r.sort_order),
  items: Number(r.items ?? 0),
  version: Number(r.version),
});

const categorySql = sql`SELECT c.id, c.name, c.sort_order, c.version,
                               (SELECT count(*)::int FROM faq_items f WHERE f.category_id = c.id) AS items
                        FROM faq_categories c`;

const toNews = (r: Row): NewsRecord => ({
  id: r.id as string,
  slug: r.slug as string,
  title: r.title as string,
  lead: r.lead as string,
  bodyMd: r.body_md as string,
  mediaId: (r.media_id as string | null) ?? null,
  status: r.status as ContentStatus,
  state: r.state as NewsState,
  publishFrom: date(r.publish_from),
  publishTo: date(r.publish_to),
  firstPublishedAt: date(r.first_published_at),
  version: Number(r.version),
  updatedAt: new Date(r.updated_at as string),
  updatedByName: (r.updated_by_name as string | null) ?? null,
});

const newsSql = sql`SELECT n.id, n.slug, n.title, n.lead, n.body_md, n.media_id, n.status::text AS status,
                           fn_news_state(n.status, n.publish_from, n.publish_to, now()) AS state,
                           n.publish_from, n.publish_to, n.first_published_at, n.version, n.updated_at,
                           s.name AS updated_by_name
                    FROM news n LEFT JOIN staff s ON s.id = n.updated_by`;

const toCompany = (r: Row): CompanyProfileRecord => ({
  name: r.name as string,
  street: (r.street as string | null) ?? null,
  postalCode: (r.postal_code as string | null) ?? null,
  city: (r.city as string | null) ?? null,
  taxId: (r.tax_id as string | null) ?? null,
  supportEmail: r.support_email as string,
  supportPhone: r.support_phone as string,
  supportHours: (r.support_hours as string | null) ?? null,
  regon: (r.regon as string | null) ?? null,
  krs: (r.krs as string | null) ?? null,
  registryCourt: (r.registry_court as string | null) ?? null,
  shareCapitalGrosze: r.share_capital_grosze === null ? null : Number(r.share_capital_grosze),
  version: Number(r.version),
  updatedAt: new Date(r.updated_at as string),
  updatedByName: (r.updated_by_name as string | null) ?? null,
});

const toMediaRef = (r: Row): MediaRef => ({
  id: r.id as string,
  key: r.key as string,
  url: r.path as string,
  altText: r.alt_text as string,
  caption: (r.caption as string | null) ?? null,
  width: Number(r.width),
  height: Number(r.height),
});

const uuidList = (ids: readonly string[]): SQL =>
  sql`(${sql.join(
    ids.map((id) => sql`${id}::uuid`),
    sql`, `,
  )})`;

/**
 * Moduł Treści (ADR 0062): bloki sekcji, FAQ z kategoriami, aktualności, dane firmy, publiczne odczyty strony
 * i aplikacji oraz historia z dziennika audytu. Reguły zapisu (rejestr sekcji, Markdown, przejścia stanu) są
 * w packages/core; repozytorium tylko czyta i zapisuje wiersze.
 */
export class DrizzleContentRepository {
  constructor(private readonly db: DbExecutor) {}

  private async rows(query: SQL): Promise<Row[]> {
    return (await this.db.execute<Row>(query)).rows;
  }

  private async one(query: SQL): Promise<Row | null> {
    return (await this.rows(query))[0] ?? null;
  }

  /** Licznik treści (`fn_content_revision()`): `ETag` publicznych treści i `content.updated`. */
  async revision(): Promise<number> {
    const row = await this.one(sql`SELECT fn_content_revision() AS revision`);
    return Number(row?.revision ?? 0);
  }

  /** Zwiększenie licznika bez zmiany wiersza (granica publikacji aktualności, ADR 0062). */
  async bumpRevision(): Promise<void> {
    await this.db.execute(sql`CALL sp_content_bump_revision()`);
  }

  // --- Bloki i sekcje -----------------------------------------------------------------------------

  listBlocks(query: ListQuery): Promise<ListResponse<ContentBlockListItem>> {
    return runListQuery<BlockField, ContentBlockListItem>(this.db, contentBlocksResource, blockSource, query);
  }

  /** Nagłówki wszystkich sekcji (pozycja 0) z licznikami elementów do listy sekcji w panelu. */
  async sectionHeaders(): Promise<
    Array<ContentBlockRecord & { sectionItems: number; sectionItemsPublished: number; sectionDrafts: number }>
  > {
    const rows = await this.rows(sql`
      SELECT v.id, v.key, v.client::text AS client, v.position, v.title, v.body_md, v.media_id, v.cta_label,
             v.cta_url, v.icon, v.status::text AS status, v.version, v.updated_at, v.updated_by_name,
             v.section_items, v.section_items_published, v.section_drafts
      FROM v_content_blocks v WHERE v.is_header`);
    return rows.map((r) => ({
      ...toBlock(r),
      sectionItems: Number(r.section_items),
      sectionItemsPublished: Number(r.section_items_published),
      sectionDrafts: Number(r.section_drafts),
    }));
  }

  /**
   * Bloki sekcji w kolejności pozycji. Z `lock` blokuje nagłówek przed odczytem elementów: zapisy tej samej sekcji
   * idą po kolei, a elementy czytane po blokadzie są aktualne.
   */
  async section(key: string, options: { lock?: boolean } = {}): Promise<ContentBlockRecord[]> {
    if (options.lock) {
      await this.db.execute(sql`SELECT id FROM content_blocks WHERE key = ${key} AND position = 0 FOR UPDATE`);
    }
    const rows = await this.rows(sql`${blockSql} WHERE b.key = ${key} ORDER BY b.position`);
    return rows.map(toBlock);
  }

  async insertBlock(
    block: ContentBlockFields & { key: string; client: ContentClient; position: number },
    staffId: string,
  ): Promise<string> {
    const row = await this.one(sql`
      INSERT INTO content_blocks (key, client, position, title, body_md, media_id, cta_label, cta_url, icon, status, updated_by)
      VALUES (${block.key}, ${block.client}::content_client, ${block.position}, ${block.title}, ${block.bodyMd},
              ${block.mediaId}, ${block.buttonLabel}, ${block.buttonHref}, ${block.icon}, ${block.status}::content_status,
              ${staffId})
      RETURNING id`);
    return row!.id as string;
  }

  /** Zapis bloku z nową pozycją i wersją +1; `false`, gdy wersja się zmieniła. */
  async updateBlock(
    id: string,
    expectedVersion: number,
    block: ContentBlockFields & { position: number },
    staffId: string,
  ): Promise<boolean> {
    const { rowCount } = await this.db.execute(sql`
      UPDATE content_blocks
      SET position = ${block.position}, title = ${block.title}, body_md = ${block.bodyMd}, media_id = ${block.mediaId},
          cta_label = ${block.buttonLabel}, cta_url = ${block.buttonHref}, icon = ${block.icon},
          status = ${block.status}::content_status, updated_by = ${staffId}, updated_at = now(), version = version + 1
      WHERE id = ${id} AND version = ${expectedVersion}`);
    return (rowCount ?? 0) > 0;
  }

  async deleteBlock(id: string): Promise<void> {
    await this.db.execute(sql`DELETE FROM content_blocks WHERE id = ${id}`);
  }

  // --- Grafiki w treściach ------------------------------------------------------------------------

  /** Opisy grafik po identyfikatorach (adres względny, tekst alternatywny, wymiary). */
  async mediaRefs(ids: Iterable<string | null | undefined>): Promise<Map<string, MediaRef>> {
    const unique = [...new Set([...ids].filter((id): id is string => Boolean(id)))];
    if (!unique.length) return new Map();
    const rows = await this.rows(sql`
      SELECT id, key, path, alt_text, caption, width, height FROM v_public_media WHERE id IN ${uuidList(unique)}`);
    return new Map(rows.map((r) => [r.id as string, toMediaRef(r)]));
  }

  /** Grafiki systemowe (`scooter.*`): rendery wariantów w aplikacji. */
  async systemMedia(): Promise<MediaRef[]> {
    const rows = await this.rows(sql`
      SELECT id, key, path, alt_text, caption, width, height FROM v_public_media WHERE is_system ORDER BY key`);
    return rows.map(toMediaRef);
  }

  // --- FAQ ----------------------------------------------------------------------------------------

  listFaq(query: ListQuery): Promise<ListResponse<FaqItemView>> {
    return runListQuery<FaqField, FaqItemView>(this.db, faqItemsResource, faqSource, query);
  }

  async faqItem(id: string, options: { lock?: boolean } = {}): Promise<FaqItemRecord | null> {
    const row = await this.one(sql`${faqSql} WHERE f.id = ${id} ${options.lock ? sql`FOR UPDATE OF f` : sql``}`);
    return row ? toFaqItem(row) : null;
  }

  /** Pytania kategorii w kolejności (z blokadą do zmiany kolejności). */
  async faqItemsIn(categoryId: string, options: { lock?: boolean } = {}): Promise<FaqItemRecord[]> {
    const rows = await this.rows(sql`
      ${faqSql} WHERE f.category_id = ${categoryId} ORDER BY f.sort_order, f.created_at
      ${options.lock ? sql`FOR UPDATE OF f` : sql``}`);
    return rows.map(toFaqItem);
  }

  async nextFaqSortOrder(categoryId: string): Promise<number> {
    const row = await this.one(
      sql`SELECT COALESCE(max(sort_order), 0) + 1 AS next FROM faq_items WHERE category_id = ${categoryId}`,
    );
    return Number(row!.next);
  }

  async insertFaqItem(item: FaqItemFields, staffId: string): Promise<string> {
    const row = await this.one(sql`
      INSERT INTO faq_items (category_id, question, answer_md, sort_order, show_on_web, show_in_app, status, updated_by)
      VALUES (${item.categoryId}, ${item.question}, ${item.answerMd}, ${item.sortOrder}, ${item.showOnWeb},
              ${item.showInApp}, ${item.status}::content_status, ${staffId})
      RETURNING id`);
    return row!.id as string;
  }

  async updateFaqItem(id: string, expectedVersion: number, item: FaqItemFields, staffId: string): Promise<boolean> {
    const { rowCount } = await this.db.execute(sql`
      UPDATE faq_items
      SET category_id = ${item.categoryId}, question = ${item.question}, answer_md = ${item.answerMd},
          sort_order = ${item.sortOrder}, show_on_web = ${item.showOnWeb}, show_in_app = ${item.showInApp},
          status = ${item.status}::content_status, updated_by = ${staffId}, updated_at = now(), version = version + 1
      WHERE id = ${id} AND version = ${expectedVersion}`);
    return (rowCount ?? 0) > 0;
  }

  /** Nowa pozycja w kolejności z wersją +1 (blokada wszystkich przestawianych wierszy). */
  async setFaqSortOrder(id: string, sortOrder: number, staffId: string): Promise<void> {
    await this.db.execute(sql`
      UPDATE faq_items SET sort_order = ${sortOrder}, updated_by = ${staffId}, updated_at = now(), version = version + 1
      WHERE id = ${id} AND sort_order <> ${sortOrder}`);
  }

  async deleteFaqItem(id: string): Promise<void> {
    await this.db.execute(sql`DELETE FROM faq_items WHERE id = ${id}`);
  }

  // --- Kategorie FAQ ------------------------------------------------------------------------------

  listCategories(query: ListQuery): Promise<ListResponse<FaqCategoryListItem>> {
    return runListQuery<CategoryField, FaqCategoryListItem>(this.db, faqCategoriesResource, categorySource, query);
  }

  async category(id: string, options: { lock?: boolean } = {}): Promise<FaqCategoryRecord | null> {
    const row = await this.one(sql`${categorySql} WHERE c.id = ${id} ${options.lock ? sql`FOR UPDATE OF c` : sql``}`);
    return row ? toCategory(row) : null;
  }

  async categories(options: { lock?: boolean } = {}): Promise<FaqCategoryRecord[]> {
    const rows = await this.rows(
      sql`${categorySql} ORDER BY c.sort_order, c.created_at ${options.lock ? sql`FOR UPDATE OF c` : sql``}`,
    );
    return rows.map(toCategory);
  }

  /**
   * Kategoria po nazwie bez względu na wielkość liter; brakująca powstaje na końcu kolejności. `created` mówi,
   * czy zapis utworzył kategorię (wpis w dzienniku).
   */
  async ensureCategory(name: string): Promise<{ category: FaqCategoryRecord; created: boolean }> {
    const inserted = await this.one(sql`
      INSERT INTO faq_categories (name, sort_order)
      VALUES (${name}, (SELECT COALESCE(max(sort_order), 0) + 1 FROM faq_categories))
      ON CONFLICT ((lower(name))) DO NOTHING
      RETURNING id`);
    const row = await this.one(sql`${categorySql} WHERE lower(c.name) = lower(${name})`);
    return { category: toCategory(row!), created: Boolean(inserted) };
  }

  async updateCategory(id: string, expectedVersion: number, name: string): Promise<boolean> {
    const { rowCount } = await this.db.execute(sql`
      UPDATE faq_categories SET name = ${name}, updated_at = now(), version = version + 1
      WHERE id = ${id} AND version = ${expectedVersion}`);
    return (rowCount ?? 0) > 0;
  }

  async setCategorySortOrder(id: string, sortOrder: number): Promise<void> {
    await this.db.execute(sql`
      UPDATE faq_categories SET sort_order = ${sortOrder}, updated_at = now(), version = version + 1
      WHERE id = ${id} AND sort_order <> ${sortOrder}`);
  }

  async deleteCategory(id: string): Promise<void> {
    await this.db.execute(sql`DELETE FROM faq_categories WHERE id = ${id}`);
  }

  // --- Aktualności --------------------------------------------------------------------------------

  listNews(query: ListQuery): Promise<ListResponse<Row>> {
    return runListQuery<NewsField, Row>(this.db, newsResource, newsSource, query);
  }

  async news(id: string, options: { lock?: boolean } = {}): Promise<NewsRecord | null> {
    const row = await this.one(sql`${newsSql} WHERE n.id = ${id} ${options.lock ? sql`FOR UPDATE OF n` : sql``}`);
    return row ? toNews(row) : null;
  }

  /** Zajęte adresy z danym początkiem (unikalny slug z przyrostkiem `-2`, `-3`). */
  async slugsLike(base: string, exceptId: string | null = null): Promise<string[]> {
    const rows = await this.rows(sql`
      SELECT slug FROM news WHERE (slug = ${base} OR slug LIKE ${`${base}-%`})
        ${exceptId ? sql`AND id <> ${exceptId}` : sql``}`);
    return rows.map((r) => r.slug as string);
  }

  async insertNews(news: NewsFields, staffId: string): Promise<string> {
    const row = await this.one(sql`
      INSERT INTO news (slug, title, lead, body_md, media_id, status, publish_from, publish_to, created_by, updated_by)
      VALUES (${news.slug}, ${news.title}, ${news.lead}, ${news.bodyMd}, ${news.mediaId}, ${news.status}::content_status,
              ${news.publishFrom}, ${news.publishTo}, ${staffId}, ${staffId})
      RETURNING id`);
    return row!.id as string;
  }

  async updateNews(id: string, expectedVersion: number, news: NewsFields, staffId: string): Promise<boolean> {
    const { rowCount } = await this.db.execute(sql`
      UPDATE news
      SET slug = ${news.slug}, title = ${news.title}, lead = ${news.lead}, body_md = ${news.bodyMd},
          media_id = ${news.mediaId}, status = ${news.status}::content_status, publish_from = ${news.publishFrom},
          publish_to = ${news.publishTo}, updated_by = ${staffId}, updated_at = now(), version = version + 1
      WHERE id = ${id} AND version = ${expectedVersion}`);
    return (rowCount ?? 0) > 0;
  }

  async deleteNews(id: string): Promise<void> {
    await this.db.execute(sql`DELETE FROM news WHERE id = ${id}`);
  }

  // --- Dane firmy ---------------------------------------------------------------------------------

  async company(options: { lock?: boolean } = {}): Promise<CompanyProfileRecord> {
    const row = await this.one(sql`
      SELECT c.*, s.name AS updated_by_name FROM company_profile c LEFT JOIN staff s ON s.id = c.updated_by
      ${options.lock ? sql`FOR UPDATE OF c` : sql``}`);
    return toCompany(row!);
  }

  async updateCompany(expectedVersion: number, fields: CompanyProfileFields, staffId: string): Promise<boolean> {
    const { rowCount } = await this.db.execute(sql`
      UPDATE company_profile
      SET name = ${fields.name}, street = ${fields.street}, postal_code = ${fields.postalCode}, city = ${fields.city},
          tax_id = ${fields.taxId}, support_email = ${fields.supportEmail}, support_phone = ${fields.supportPhone},
          support_hours = ${fields.supportHours}, regon = ${fields.regon}, krs = ${fields.krs},
          registry_court = ${fields.registryCourt}, share_capital_grosze = ${fields.shareCapitalGrosze},
          updated_by = ${staffId}, updated_at = now(), version = version + 1
      WHERE id AND version = ${expectedVersion}`);
    return (rowCount ?? 0) > 0;
  }

  // --- Historia (dziennik audytu) -----------------------------------------------------------------

  /**
   * Wpisy dziennika obiektu od najnowszego z pełnym stanem po zmianie (ADR 0062, „Przywróć”). Dane firmy mają
   * jeden wiersz, więc ich wpisy nie mają identyfikatora (`entityId = null`). `extra` dokłada warunek (np. wpisy
   * danych startowych sekcji zapisane osobno dla każdego bloku).
   */
  async history(entityType: string, entityId: string | null, limit = 50, extra?: SQL): Promise<HistoryRow[]> {
    const rows = await this.rows(sql`
      SELECT a.id, a.action, a.actor::text AS actor, a.entity_id, s.name AS staff_name, a.created_at, a.data
      FROM audit_log a LEFT JOIN staff s ON s.id = a.staff_id
      WHERE a.entity_type = ${entityType}
        AND (${entityId ? sql`a.entity_id = ${entityId}` : sql`a.entity_id IS NULL`} ${extra ? sql`OR (${extra})` : sql``})
      ORDER BY a.created_at DESC, a.id DESC
      LIMIT ${limit}`);
    return rows.map((r) => ({
      id: Number(r.id),
      action: r.action as string,
      system: r.actor === 'SYSTEM',
      entityId: (r.entity_id as string | null) ?? null,
      staffName: (r.staff_name as string | null) ?? null,
      createdAt: new Date(r.created_at as string),
      data: (r.data as Record<string, unknown> | null) ?? {},
    }));
  }

  /**
   * Historia sekcji: zapisy sekcji (wpis na nagłówku) i wpisy danych startowych, które seed zapisał osobno dla
   * każdego bloku sekcji (`data.source = 'seed'`).
   */
  sectionHistory(key: string, headerId: string, limit = 50): Promise<HistoryRow[]> {
    return this.history(
      'content_block',
      headerId,
      limit,
      sql`a.actor = 'SYSTEM' AND a.data->>'source' = 'seed' AND a.data->'after'->>'key' = ${key}`,
    );
  }

  /** Wpis dziennika danego rodzaju obiektu (`restoredFrom` w zapisie musi wskazywać istniejący wpis). */
  async auditEntryExists(id: number, entityType: string): Promise<boolean> {
    const row = await this.one(sql`SELECT 1 AS ok FROM audit_log WHERE id = ${id} AND entity_type = ${entityType}`);
    return Boolean(row);
  }

  // --- Publiczne treści ---------------------------------------------------------------------------

  /** Opublikowane bloki klienta (`v_public_content_blocks`): element tylko z opublikowanym nagłówkiem. */
  async publicBlocks(client: ContentClient): Promise<PublicBlockRecord[]> {
    const rows = await this.rows(sql`
      SELECT b.id, p.key, p.position, p.title, p.body_md, p.media_id, p.cta_label, p.cta_url, p.icon
      FROM v_public_content_blocks p JOIN content_blocks b ON b.key = p.key AND b.position = p.position
      WHERE p.client = ${client}::content_client
      ORDER BY p.key, p.position`);
    return rows.map((r) => ({
      id: r.id as string,
      key: r.key as string,
      position: Number(r.position),
      title: (r.title as string | null) ?? null,
      bodyMd: (r.body_md as string | null) ?? null,
      mediaId: (r.media_id as string | null) ?? null,
      buttonLabel: (r.cta_label as string | null) ?? null,
      buttonHref: (r.cta_url as string | null) ?? null,
      icon: (r.icon as ContentIcon | null) ?? null,
    }));
  }

  /** Opublikowane pytania klienta w kolejności kategorii i pytań (`v_public_faq`). */
  async publicFaq(client: 'web' | 'mobile'): Promise<PublicFaqRecord[]> {
    const rows = await this.rows(sql`
      SELECT category_id, category_name, id, question, answer_md FROM v_public_faq
      WHERE ${client === 'web' ? sql`show_on_web` : sql`show_in_app`}
      ORDER BY category_sort_order, category_name, sort_order, id`);
    return rows.map((r) => ({
      categoryId: r.category_id as string,
      categoryName: r.category_name as string,
      id: r.id as string,
      question: r.question as string,
      answerMd: r.answer_md as string,
    }));
  }

  /** Aktywne modele w kolejności kodu (parametry na stronie, `web.design`). */
  async activeModels(): Promise<PublicModelRecord[]> {
    const rows = await this.rows(sql`
      SELECT code, name, range_km, max_speed_kmh, photo_media_id FROM scooter_models WHERE active ORDER BY code`);
    return rows.map((r) => ({
      code: r.code as string,
      name: r.name as string,
      rangeKm: r.range_km === null ? null : Number(r.range_km),
      maxSpeedKmh: r.max_speed_kmh === null ? null : Number(r.max_speed_kmh),
      photoMediaId: (r.photo_media_id as string | null) ?? null,
    }));
  }

  /** Hulajnoga na stronie `/h/{numer}` (`v_public_scooters`): numer i model, bez stanu floty; wycofana: `null`. */
  async publicScooter(number: number): Promise<{
    number: number;
    modelCode: string;
    modelName: string;
    photoMediaId: string | null;
  } | null> {
    const row = await this.one(sql`
      SELECT number, model_code, model_name, photo_media_id FROM v_public_scooters WHERE number = ${number}`);
    return row
      ? {
          number: Number(row.number),
          modelCode: row.model_code as string,
          modelName: row.model_name as string,
          photoMediaId: (row.photo_media_id as string | null) ?? null,
        }
      : null;
  }

  /** Strona listy opublikowanych aktualności (`v_published_news`), od najnowszej daty publikacji. */
  async publishedNews(page: number, pageSize: number): Promise<{ items: PublicNewsRecord[]; total: number }> {
    const rows = await this.rows(sql`
      SELECT slug, title, lead, body_md, media_id, publish_from, updated_at, count(*) OVER () AS total
      FROM v_published_news ORDER BY publish_from DESC, slug
      LIMIT ${pageSize} OFFSET ${(page - 1) * pageSize}`);
    const total = rows.length
      ? Number(rows[0]!.total)
      : Number((await this.one(sql`SELECT count(*)::int AS total FROM v_published_news`))!.total);
    return { items: rows.map(toPublicNews), total };
  }

  async publishedArticle(slug: string): Promise<PublicNewsRecord | null> {
    const row = await this.one(sql`
      SELECT slug, title, lead, body_md, media_id, publish_from, updated_at FROM v_published_news WHERE slug = ${slug}`);
    return row ? toPublicNews(row) : null;
  }

  /** Wersje opublikowane i archiwalne dokumentu (`v_public_document_versions`), od najnowszej. */
  async publicDocumentVersions(slug: string): Promise<PublicDocumentVersionRecord[]> {
    const rows = await this.rows(sql`
      SELECT slug, version_no, title, body_md, change_summary, published_at, valid_to, is_current
      FROM v_public_document_versions WHERE slug = ${slug} ORDER BY version_no DESC`);
    return rows.map((r) => ({
      slug: r.slug as string,
      versionNo: Number(r.version_no),
      title: r.title as string,
      bodyMd: r.body_md as string,
      changeSummary: (r.change_summary as string | null) ?? null,
      publishedAt: new Date(r.published_at as string),
      validTo: date(r.valid_to),
      isCurrent: Boolean(r.is_current),
    }));
  }
}

export interface HistoryRow {
  id: number;
  action: string;
  system: boolean;
  entityId: string | null;
  staffName: string | null;
  createdAt: Date;
  data: Record<string, unknown>;
}

const toPublicNews = (r: Row): PublicNewsRecord => ({
  slug: r.slug as string,
  title: r.title as string,
  lead: r.lead as string,
  bodyMd: r.body_md as string,
  mediaId: (r.media_id as string | null) ?? null,
  publishFrom: new Date(r.publish_from as string),
  updatedAt: new Date(r.updated_at as string),
});

/** Wpis historii w kształcie kontraktu panelu. */
export function toContentHistoryEntry(
  row: HistoryRow,
  after: Record<string, unknown> | null = (row.data.after as Record<string, unknown> | null) ?? null,
): ContentHistoryEntry {
  const version = Array.isArray(row.data.version) ? (row.data.version as Array<number | null>) : [null, null];
  return {
    auditId: row.id,
    action: row.action,
    staffName: row.staffName,
    system: row.system,
    createdAt: row.createdAt.toISOString(),
    versionFrom: version[0] ?? null,
    versionTo: version[1] ?? null,
    restoredFrom: typeof row.data.restoredFrom === 'number' ? row.data.restoredFrom : null,
    after,
  };
}
