/**
 * Zasoby panelu modułu Treści (iteracja 7, ADR 0031, ADR 0062, ADR 0064, wymaganie 12): bloki sekcji, pytania
 * i kategorie FAQ, aktualności i biblioteka mediów. Sekcje istnieją tylko w rejestrze (`CONTENT_SECTIONS`), więc
 * lista bloków jest tylko do odczytu, a zapis idzie przez `PUT /admin/content-sections/{key}` (nagłówek i elementy
 * jednym żądaniem). Podgląd wymaga `content.read`, zapis `content.write`.
 */
import { z } from 'zod';
import { FILE_CONTENT_TYPES } from '../files.js';
import {
  contentSectionSaveSchema,
  FAQ_CATEGORY_MAX,
  faqCategoryUpdateSchema,
  faqItemCreateSchema,
  faqItemUpdateSchema,
  mediaCreateSchema,
  mediaUpdateSchema,
  NEWS_STATES,
  newsCreateSchema,
  newsUpdateSchema,
} from '../content/content.js';
import {
  CONTENT_CLIENTS,
  CONTENT_ICONS,
  CONTENT_SECTION_KEYS,
  CONTENT_STATUSES,
  type ContentClient,
  type ContentIcon,
  type ContentSectionKey,
  type ContentStatus,
} from '../content/sections.js';
import type { ResourceDefinition } from './list.js';

// --- Bloki treści ---------------------------------------------------------------------------------

/**
 * Bloki z `v_content_blocks` z licznikami sekcji (elementy, opublikowane, szkice) do grupowania w panelu.
 * Blok nie ma własnego formularza: edytor sekcji zapisuje nagłówek i elementy razem.
 */
export const contentBlocksResource = {
  name: 'content-blocks',
  fields: {
    id: { type: 'uuid', filters: ['eq'] },
    key: { type: 'enum', values: CONTENT_SECTION_KEYS, filters: ['eq'], facet: true, sortable: true },
    client: { type: 'enum', values: CONTENT_CLIENTS, filters: ['eq'], facet: true, sortable: true },
    position: { type: 'integer', filters: ['eq', 'gte', 'lte'], sortable: true },
    isHeader: { type: 'boolean', filters: ['eq'], facet: true },
    title: { type: 'text', filters: ['contains'], sortable: true },
    bodyMd: { type: 'text', filters: ['contains'] },
    icon: { type: 'enum', values: CONTENT_ICONS, filters: ['eq'] },
    buttonLabel: { type: 'text' },
    buttonHref: { type: 'text', filters: ['contains'] },
    mediaId: { type: 'uuid', filters: ['eq'] },
    mediaKey: { type: 'text', filters: ['eq'] },
    mediaName: { type: 'text' },
    status: { type: 'enum', values: CONTENT_STATUSES, filters: ['eq'], facet: true, sortable: true },
    sectionItems: { type: 'integer', filters: ['gte', 'lte'] },
    sectionItemsPublished: { type: 'integer', filters: ['gte', 'lte'] },
    sectionDrafts: { type: 'integer', filters: ['gte', 'lte'] },
    updatedByName: { type: 'text', sortable: true },
    createdAt: { type: 'datetime', filters: ['gte', 'lte'], sortable: true },
    updatedAt: { type: 'datetime', filters: ['gte', 'lte'], sortable: true },
    version: { type: 'integer', sortable: true },
  },
  search: ['title', 'bodyMd', 'buttonLabel', 'mediaName'],
  defaultSort: ['client', 'key', 'position'],
  // Sekcje wyznacza rejestr; element listy usuwa zapis sekcji (tylko szkic albo archiwum).
  deleteMode: 'none',
  permissions: { read: 'content.read', write: 'content.write' },
  updateSchema: contentSectionSaveSchema,
} as const satisfies ResourceDefinition;

export interface ContentBlockListItem {
  id: string;
  key: ContentSectionKey;
  client: ContentClient;
  position: number;
  isHeader: boolean;
  title: string | null;
  bodyMd: string | null;
  icon: ContentIcon | null;
  buttonLabel: string | null;
  buttonHref: string | null;
  mediaId: string | null;
  mediaKey: string | null;
  mediaName: string | null;
  status: ContentStatus;
  sectionItems: number;
  sectionItemsPublished: number;
  sectionDrafts: number;
  updatedByName: string | null;
  createdAt: string;
  updatedAt: string;
  version: number;
}

/** `GET /admin/content-sections`: sekcje z rejestru w jego kolejności ze stanem nagłówka. */
export interface ContentSectionSummary {
  key: ContentSectionKey;
  client: ContentClient;
  kind: 'single' | 'list';
  required: boolean;
  /** Identyfikator nagłówka (pozycja 0): historia `GET /admin/content-sections/{key}/history`. */
  headerId: string;
  status: ContentStatus;
  title: string | null;
  items: number;
  itemsPublished: number;
  drafts: number;
  version: number;
  updatedAt: string;
  updatedByName: string | null;
}

// --- FAQ ------------------------------------------------------------------------------------------

/** Pytania z `v_faq_list` z kategorią i jej kolejnością; kolejność w kategorii zapisuje `PUT /admin/faq-items/order`. */
export const faqItemsResource = {
  name: 'faq-items',
  fields: {
    id: { type: 'uuid', filters: ['eq'] },
    categoryId: { type: 'uuid', filters: ['eq'] },
    categoryName: { type: 'text', filters: ['contains'], sortable: true },
    categorySortOrder: { type: 'integer', sortable: true },
    question: { type: 'text', filters: ['contains'], sortable: true },
    answerMd: { type: 'text', filters: ['contains'] },
    sortOrder: { type: 'integer', sortable: true },
    status: { type: 'enum', values: CONTENT_STATUSES, filters: ['eq'], facet: true, sortable: true },
    showOnWeb: { type: 'boolean', filters: ['eq'], facet: true },
    showInApp: { type: 'boolean', filters: ['eq'], facet: true },
    updatedByName: { type: 'text', sortable: true },
    createdAt: { type: 'datetime', filters: ['gte', 'lte'], sortable: true },
    updatedAt: { type: 'datetime', filters: ['gte', 'lte'], sortable: true },
    version: { type: 'integer', sortable: true },
  },
  search: ['question', 'answerMd', 'categoryName'],
  defaultSort: ['categorySortOrder', 'sortOrder'],
  // Usunąć da się szkic albo archiwum (wyzwalacz `CONTENT_DELETE_PUBLISHED`).
  deleteMode: 'delete',
  permissions: { read: 'content.read', write: 'content.write' },
  createSchema: faqItemCreateSchema,
  updateSchema: faqItemUpdateSchema,
} as const satisfies ResourceDefinition;

/** `POST /admin/faq-categories`: pusta kategoria na końcu listy (pytanie z nową nazwą też ją tworzy). */
export const faqCategoryCreateSchema = z.object({ name: z.string().trim().min(1).max(FAQ_CATEGORY_MAX) });
export type FaqCategoryCreate = z.infer<typeof faqCategoryCreateSchema>;

/** Kategorie z `v_faq_categories` z liczbą pytań; usunąć można tylko pustą (`FAQ_CATEGORY_NOT_EMPTY`). */
export const faqCategoriesResource = {
  name: 'faq-categories',
  fields: {
    id: { type: 'uuid', filters: ['eq'] },
    name: { type: 'text', filters: ['contains'], sortable: true },
    sortOrder: { type: 'integer', sortable: true },
    items: { type: 'integer', filters: ['gte', 'lte'], sortable: true },
    itemsPublished: { type: 'integer', filters: ['gte', 'lte'], sortable: true },
    createdAt: { type: 'datetime', filters: ['gte', 'lte'], sortable: true },
    updatedAt: { type: 'datetime', filters: ['gte', 'lte'], sortable: true },
    version: { type: 'integer', sortable: true },
  },
  search: ['name'],
  defaultSort: ['sortOrder'],
  deleteMode: 'delete',
  permissions: { read: 'content.read', write: 'content.write' },
  createSchema: faqCategoryCreateSchema,
  updateSchema: faqCategoryUpdateSchema,
} as const satisfies ResourceDefinition;

export interface FaqCategoryListItem {
  id: string;
  name: string;
  sortOrder: number;
  items: number;
  itemsPublished: number;
  createdAt: string;
  updatedAt: string;
  version: number;
}

// --- Aktualności ----------------------------------------------------------------------------------

/** Aktualności z `v_news_list` ze stanem z dat (szkic, zaplanowana, opublikowana, wygasła, archiwum). */
export const newsResource = {
  name: 'news',
  fields: {
    id: { type: 'uuid', filters: ['eq'] },
    slug: { type: 'text', filters: ['eq', 'contains'], sortable: true },
    title: { type: 'text', filters: ['contains'], sortable: true },
    lead: { type: 'text', filters: ['contains'] },
    status: { type: 'enum', values: CONTENT_STATUSES, filters: ['eq'], facet: true, sortable: true },
    state: { type: 'enum', values: NEWS_STATES, filters: ['eq'], facet: true, sortable: true },
    publishFrom: { type: 'datetime', filters: ['gte', 'lte'], sortable: true },
    publishTo: { type: 'datetime', filters: ['gte', 'lte'], sortable: true },
    firstPublishedAt: { type: 'datetime', filters: ['gte', 'lte'], sortable: true },
    mediaId: { type: 'uuid', filters: ['eq'] },
    mediaKey: { type: 'text', filters: ['eq'] },
    mediaName: { type: 'text' },
    createdByName: { type: 'text', sortable: true },
    updatedByName: { type: 'text', sortable: true },
    createdAt: { type: 'datetime', filters: ['gte', 'lte'], sortable: true },
    updatedAt: { type: 'datetime', filters: ['gte', 'lte'], sortable: true },
    version: { type: 'integer', sortable: true },
  },
  search: ['title', 'lead', 'slug'],
  defaultSort: ['-updatedAt'],
  deleteMode: 'delete',
  permissions: { read: 'content.read', write: 'content.write' },
  createSchema: newsCreateSchema,
  updateSchema: newsUpdateSchema,
} as const satisfies ResourceDefinition;

// --- Biblioteka mediów ----------------------------------------------------------------------------

/**
 * Grafiki z `v_media_list` z liczbą użyć: filtry „Używane” (`usages.gte=1`) i „Nieużywane” (`usages.lte=0`).
 * Usunięcie tylko grafiki nieużytej i niesystemowej (`MEDIA_IN_USE`, `MEDIA_SYSTEM`).
 */
export const mediaResource = {
  name: 'media',
  fields: {
    id: { type: 'uuid', filters: ['eq'] },
    key: { type: 'text', filters: ['eq', 'contains'], sortable: true },
    name: { type: 'text', filters: ['contains'], sortable: true },
    altText: { type: 'text', filters: ['contains'] },
    caption: { type: 'text', filters: ['contains'] },
    isSystem: { type: 'boolean', filters: ['eq'], facet: true },
    contentType: { type: 'enum', values: FILE_CONTENT_TYPES, filters: ['eq'], facet: true },
    sizeBytes: { type: 'integer', filters: ['gte', 'lte'], sortable: true },
    width: { type: 'integer', filters: ['gte', 'lte'], sortable: true },
    height: { type: 'integer', filters: ['gte', 'lte'], sortable: true },
    sha256: { type: 'text', filters: ['eq'] },
    originalName: { type: 'text', filters: ['contains'] },
    usages: { type: 'integer', filters: ['gte', 'lte'], sortable: true },
    /** Adres publiczny `/media/{id}/{sha256}.{ext}` (ADR 0064). */
    url: { type: 'text' },
    updatedByName: { type: 'text', sortable: true },
    createdAt: { type: 'datetime', filters: ['gte', 'lte'], sortable: true },
    updatedAt: { type: 'datetime', filters: ['gte', 'lte'], sortable: true },
    version: { type: 'integer', sortable: true },
  },
  search: ['name', 'key', 'altText', 'caption'],
  defaultSort: ['-createdAt'],
  deleteMode: 'delete',
  permissions: { read: 'content.read', write: 'content.write' },
  createSchema: mediaCreateSchema,
  updateSchema: mediaUpdateSchema,
} as const satisfies ResourceDefinition;

export interface MediaListItem {
  id: string;
  key: string;
  name: string;
  altText: string;
  caption: string | null;
  isSystem: boolean;
  contentType: (typeof FILE_CONTENT_TYPES)[number];
  sizeBytes: number;
  width: number;
  height: number;
  sha256: string;
  originalName: string | null;
  usages: number;
  url: string;
  updatedByName: string | null;
  createdAt: string;
  updatedAt: string;
  version: number;
}
