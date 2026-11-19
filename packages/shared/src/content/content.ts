/**
 * Kontrakt modułu Treści (iteracja 7): bloki i sekcje-listy, FAQ z kategoriami, aktualności, biblioteka mediów,
 * dane firmy i publiczne odczyty strony i aplikacji (ADR 0062–0065). Limity treści bloków są w rejestrze sekcji,
 * a reguły (wymagane pola, Markdown, schematy adresów, przejścia stanu) sprawdza core; schematy tutaj pilnują tylko
 * kształtu żądania i twardych granic długości.
 */
import { z } from 'zod';
import { HREF_MAX_LENGTH } from '../markdown/href.js';
import type { MarkdownConstruct, MarkdownIssueCode } from '../markdown/markdown.js';
import {
  CONTENT_ICONS,
  CONTENT_SECTION_KEY_PATTERN,
  CONTENT_STATUSES,
  MEDIA_KEY_MAX,
  MEDIA_KEY_PATTERN,
  PUBLIC_CONTENT_CLIENTS,
  type ContentClient,
  type ContentIcon,
  type ContentSectionKey,
  type ContentStatus,
} from './sections.js';

const version = z.number().int().min(1);
/** Tekst opcjonalny: pusty po przycięciu zapisuje się jako `null`. */
const optionalText = (max: number) =>
  z
    .string()
    .trim()
    .max(max)
    .nullable()
    .default(null)
    .transform((value) => (value ? value : null));
/** Treść w Markdown: bez przycinania (wcięcia mają znaczenie), z twardą granicą ponad limity rejestru. */
const markdown = (max: number) => z.string().max(max);
const optionalMarkdown = (max: number) =>
  markdown(max)
    .nullable()
    .default(null)
    .transform((value) => (value?.trim() ? value : null));

// --- Bloki i sekcje (ADR 0062) ------------------------------------------------------------------

/** Pola bloku z formularza; dozwolone pola i limity sekcji sprawdza core z rejestrem. */
export const contentBlockInputSchema = z.object({
  title: optionalText(200),
  bodyMd: optionalMarkdown(10_000),
  mediaId: z.uuid().nullable().default(null),
  buttonLabel: optionalText(100),
  buttonHref: optionalText(HREF_MAX_LENGTH),
  icon: z.enum(CONTENT_ICONS).nullable().default(null),
  status: z.enum(CONTENT_STATUSES),
});
export type ContentBlockInput = z.infer<typeof contentBlockInputSchema>;

/**
 * `PUT /admin/content-sections/{key}`: nagłówek (albo blok pojedynczy) i elementy sekcji-listy jednym żądaniem.
 * Kolejność tablicy `items` to kolejność elementów (pozycje od 1); element bez `id` jest nowy, a brak istniejącego
 * elementu na liście usuwa go (tylko szkic albo archiwum). Blokadą całej sekcji jest wersja nagłówka.
 * `restoredFrom` to identyfikator wpisu dziennika audytu przy „Przywróć”.
 */
export const contentSectionSaveSchema = z.object({
  version,
  header: contentBlockInputSchema,
  items: z
    .array(contentBlockInputSchema.extend({ id: z.uuid().optional() }))
    .max(20)
    .default([]),
  restoredFrom: z.number().int().positive().nullable().default(null),
});
export type ContentSectionSave = z.infer<typeof contentSectionSaveSchema>;

export const contentSectionKeyParamSchema = z.string().regex(CONTENT_SECTION_KEY_PATTERN).max(60);

/** Opis grafiki w widokach (adres względny `/media/{id}/{sha256}.{ext}`, który klient dokleja do adresu API). */
export interface MediaRef {
  id: string;
  key: string;
  url: string;
  altText: string;
  caption: string | null;
  width: number;
  height: number;
}

export interface ContentBlockView {
  id: string;
  key: ContentSectionKey;
  client: ContentClient;
  /** 0: blok pojedynczy albo nagłówek listy; od 1: elementy. */
  position: number;
  title: string | null;
  bodyMd: string | null;
  media: MediaRef | null;
  buttonLabel: string | null;
  buttonHref: string | null;
  icon: ContentIcon | null;
  status: ContentStatus;
  version: number;
  updatedAt: string;
  updatedByName: string | null;
}

/** Sekcja w edytorze panelu: nagłówek i elementy w kolejności pozycji. */
export interface ContentSectionView {
  key: ContentSectionKey;
  header: ContentBlockView;
  items: ContentBlockView[];
}

/** Problem treści z walidacji w core (`422 CONTENT_VALIDATION_FAILED`, `details.issues[]`). */
export interface ContentIssueView {
  /** Indeks elementu w `items` żądania; `null` dla nagłówka i całej sekcji. */
  item: number | null;
  field: 'title' | 'bodyMd' | 'mediaId' | 'button' | 'icon' | 'status' | 'items' | string;
  code: MarkdownIssueCode | string;
  line?: number;
  column?: number;
  construct?: MarkdownConstruct;
  max?: number;
  length?: number;
  min?: number;
  count?: number;
  minWidth?: number;
  width?: number;
}

/** Wpis historii z dziennika audytu: pełny stan po zmianie do „Przywróć”. */
export interface ContentHistoryEntry {
  auditId: number;
  action: string;
  staffName: string | null;
  /** `true` dla wpisu systemu (dane startowe). */
  system: boolean;
  createdAt: string;
  versionFrom: number | null;
  versionTo: number | null;
  restoredFrom: number | null;
  after: Record<string, unknown> | null;
}

// --- FAQ ------------------------------------------------------------------------------------------

export const FAQ_QUESTION_MAX = 120;
export const FAQ_ANSWER_MAX = 2000;
export const FAQ_CATEGORY_MAX = 60;

/**
 * Zapis pytania; kategoria po nazwie (bez względu na wielkość liter), a nazwa, której jeszcze nie ma, tworzy nową
 * kategorię. Pytanie jest widoczne na stronie, w aplikacji albo w obu miejscach.
 */
export const faqItemCreateSchema = z
  .object({
    category: z.string().trim().min(1).max(FAQ_CATEGORY_MAX),
    question: z.string().trim().min(1).max(FAQ_QUESTION_MAX),
    answerMd: markdown(FAQ_ANSWER_MAX).refine((value) => value.trim().length > 0),
    showOnWeb: z.boolean().default(true),
    showInApp: z.boolean().default(true),
    status: z.enum(CONTENT_STATUSES).default('DRAFT'),
  })
  .refine((value) => value.showOnWeb || value.showInApp, { path: ['showOnWeb'], message: 'FAQ_NO_CLIENT' });
export type FaqItemCreate = z.infer<typeof faqItemCreateSchema>;

export const faqItemUpdateSchema = z
  .object({
    version,
    category: z.string().trim().min(1).max(FAQ_CATEGORY_MAX),
    question: z.string().trim().min(1).max(FAQ_QUESTION_MAX),
    answerMd: markdown(FAQ_ANSWER_MAX).refine((value) => value.trim().length > 0),
    showOnWeb: z.boolean(),
    showInApp: z.boolean(),
    status: z.enum(CONTENT_STATUSES),
    restoredFrom: z.number().int().positive().nullable().default(null),
  })
  .refine((value) => value.showOnWeb || value.showInApp, { path: ['showOnWeb'], message: 'FAQ_NO_CLIENT' });
export type FaqItemUpdate = z.infer<typeof faqItemUpdateSchema>;

/** Kolejność jako lista identyfikatorów z wersjami (blokada wszystkich przestawianych wierszy). */
const orderEntries = z
  .array(z.object({ id: z.uuid(), version }))
  .min(1)
  .max(200);

/** `PUT /admin/faq/order`: kolejność pytań jednej kategorii. */
export const faqOrderSchema = z.object({ categoryId: z.uuid(), items: orderEntries });
export type FaqOrder = z.infer<typeof faqOrderSchema>;

/** `PUT /admin/faq-categories/order`. */
export const faqCategoryOrderSchema = z.object({ items: orderEntries });
export type FaqCategoryOrder = z.infer<typeof faqCategoryOrderSchema>;

export const faqCategoryUpdateSchema = z.object({ version, name: z.string().trim().min(1).max(FAQ_CATEGORY_MAX) });
export type FaqCategoryUpdate = z.infer<typeof faqCategoryUpdateSchema>;

export interface FaqCategoryView {
  id: string;
  name: string;
  sortOrder: number;
  itemCount: number;
  version: number;
}

export interface FaqItemView {
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
  updatedAt: string;
  updatedByName: string | null;
}

/** FAQ w publicznej treści: opublikowane pytania klienta w kolejności kategorii i pytań. */
export interface PublicFaqCategory {
  id: string;
  name: string;
  items: Array<{ id: string; question: string; answerMd: string }>;
}

// --- Aktualności ----------------------------------------------------------------------------------

export const NEWS_TITLE_MAX = 120;
/** Zajawka wymagana (ADR 0062; plansza `tresci-aktualnosci` miała licznik 200, ADR ustala 280). */
export const NEWS_LEAD_MAX = 280;
export const NEWS_BODY_MAX = 20_000;
/** Aktualności na stronę listy (`/aktualnosci?strona=`). */
export const NEWS_PAGE_SIZE = 12;
export const NEWS_SLUG_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

/**
 * Stan aktualności liczony ze statusu i dat (widok `v_news_list`, core `newsState`): zaplanowana to opublikowana
 * z `publishFrom` w przyszłości, wygasła to opublikowana po `publishTo`.
 */
export const NEWS_STATES = ['DRAFT', 'SCHEDULED', 'PUBLISHED', 'EXPIRED', 'ARCHIVED'] as const;
export type NewsState = (typeof NEWS_STATES)[number];

const newsFields = {
  title: z.string().trim().min(1).max(NEWS_TITLE_MAX),
  /** Brak: slug z tytułu (`headingId`); po pierwszej publikacji adres się nie zmienia (`NEWS_SLUG_LOCKED`). */
  slug: z.string().trim().max(100).regex(NEWS_SLUG_PATTERN).nullable().default(null),
  lead: z.string().trim().min(1).max(NEWS_LEAD_MAX),
  bodyMd: markdown(NEWS_BODY_MAX),
  mediaId: z.uuid().nullable().default(null),
  publishFrom: z.iso.datetime({ offset: true }).nullable().default(null),
  publishTo: z.iso.datetime({ offset: true }).nullable().default(null),
  status: z.enum(CONTENT_STATUSES).default('DRAFT'),
};

export const newsCreateSchema = z.object(newsFields);
export type NewsCreate = z.infer<typeof newsCreateSchema>;

export const newsUpdateSchema = z.object({
  ...newsFields,
  version,
  restoredFrom: z.number().int().positive().nullable().default(null),
});
export type NewsUpdate = z.infer<typeof newsUpdateSchema>;

export interface NewsListItem {
  id: string;
  slug: string;
  title: string;
  lead: string;
  state: NewsState;
  status: ContentStatus;
  publishFrom: string | null;
  publishTo: string | null;
  media: MediaRef | null;
  version: number;
  updatedAt: string;
  updatedByName: string | null;
}

export interface NewsDetails extends NewsListItem {
  bodyMd: string;
  firstPublishedAt: string | null;
}

/** `GET /news?page=&pageSize=` (strona) i `GET /news/{slug}`. */
export const newsPageQuerySchema = z.object({
  page: z.coerce.number().int().min(1).max(1000).default(1),
  pageSize: z.coerce.number().int().min(1).max(50).default(NEWS_PAGE_SIZE),
});
export type NewsPageQuery = z.infer<typeof newsPageQuerySchema>;

export const newsSlugParamSchema = z.string().max(100).regex(NEWS_SLUG_PATTERN);

export interface PublicNewsListItem {
  slug: string;
  title: string;
  lead: string;
  /** Data na stronie (`publish_from`). */
  publishedAt: string;
  media: MediaRef | null;
}

export interface PublicNewsPage {
  items: PublicNewsListItem[];
  page: number;
  pageSize: number;
  total: number;
}

export interface PublicNewsArticle extends PublicNewsListItem {
  bodyMd: string;
  updatedAt: string;
}

// --- Biblioteka mediów (ADR 0064) ---------------------------------------------------------------

export const MEDIA_ALT_MIN = 3;
export const MEDIA_ALT_MAX = 250;
export const MEDIA_CAPTION_MAX = 200;
export const MEDIA_NAME_MAX = 120;
/** Limity wysyłki grafiki (kopia z core: `MEDIA_MAX_BYTES`, `MEDIA_MAX_DIMENSION`, `MEDIA_WARN_DIMENSION`). */
export const MEDIA_MAX_BYTES = 5 * 1024 * 1024;
export const MEDIA_MAX_DIMENSION = 8000;
export const MEDIA_WARN_DIMENSION = 2560;
/** Plików naraz w oknie wysyłki (seria par `POST /files` i `POST /admin/media`). */
export const MEDIA_UPLOAD_BATCH = 10;

const altText = z.string().trim().min(MEDIA_ALT_MIN).max(MEDIA_ALT_MAX);

/** `POST /admin/media` po `POST /files` z celem `MEDIA`; klucz nie zmienia się po utworzeniu. */
export const mediaCreateSchema = z.object({
  fileId: z.uuid(),
  key: z.string().trim().max(MEDIA_KEY_MAX).regex(MEDIA_KEY_PATTERN),
  name: z.string().trim().min(1).max(MEDIA_NAME_MAX).optional(),
  altText,
  caption: optionalText(MEDIA_CAPTION_MAX),
});
export type MediaCreate = z.infer<typeof mediaCreateSchema>;

/** Tekst alternatywny należy do grafiki, więc jego zmiana działa wszędzie, gdzie grafika jest użyta. */
export const mediaUpdateSchema = z.object({
  version,
  name: z.string().trim().min(1).max(MEDIA_NAME_MAX),
  altText,
  caption: optionalText(MEDIA_CAPTION_MAX),
});
export type MediaUpdate = z.infer<typeof mediaUpdateSchema>;

/** `POST /admin/media/{id}/file`: „Zastąp plik” zachowuje identyfikator i użycia, a adres zmienia się z SHA-256. */
export const mediaReplaceFileSchema = z.object({ fileId: z.uuid(), version });
export type MediaReplaceFile = z.infer<typeof mediaReplaceFileSchema>;

export const MEDIA_USAGE_KINDS = ['CONTENT_BLOCK', 'NEWS', 'SCOOTER_MODEL'] as const;
export type MediaUsageKind = (typeof MEDIA_USAGE_KINDS)[number];

/** Miejsce użycia grafiki (szczegóły i komunikat `MEDIA_IN_USE`). */
export interface MediaUsageView {
  kind: MediaUsageKind;
  id: string;
  /** Klucz sekcji, tytuł aktualności albo kod modelu. */
  label: string;
  sectionKey: ContentSectionKey | null;
}

export interface MediaView extends MediaRef {
  name: string;
  isSystem: boolean;
  contentType: 'image/jpeg' | 'image/png' | 'image/webp';
  sizeBytes: number;
  usageCount: number;
  version: number;
  createdAt: string;
  updatedAt: string;
}

export interface MediaDetails extends MediaView {
  usages: MediaUsageView[];
}

// --- Dane firmy (ADR 0062) ------------------------------------------------------------------------

export const POSTAL_CODE_PATTERN = /^\d{2}-\d{3}$/;
export const COMPANY_HOURS_MAX = 60;

/**
 * `PATCH /admin/company` (`company.write`): zapis częściowy z wersją. NIP z sumą kontrolną, REGON i KRS sprawdza
 * core; tu tylko format. NIP przychodzi bez kresek (panel je usuwa).
 */
export const companyProfileUpdateSchema = z.object({
  version,
  name: z.string().trim().min(1).max(200).optional(),
  street: z.string().trim().min(1).max(200).optional(),
  postalCode: z.string().trim().regex(POSTAL_CODE_PATTERN).optional(),
  city: z.string().trim().min(1).max(100).optional(),
  taxId: z
    .string()
    .trim()
    .regex(/^\d{10}$/)
    .optional(),
  supportEmail: z.email().max(254).optional(),
  supportPhone: z
    .string()
    .trim()
    .regex(/^\+?[0-9 ]{9,20}$/)
    .optional(),
  supportHours: z.string().trim().min(1).max(COMPANY_HOURS_MAX).optional(),
  regon: z
    .string()
    .trim()
    .regex(/^(\d{9}|\d{14})$/)
    .nullable()
    .optional(),
  krs: z
    .string()
    .trim()
    .regex(/^\d{10}$/)
    .nullable()
    .optional(),
  registryCourt: z.string().trim().max(200).nullable().optional(),
  shareCapitalGrosze: z.number().int().positive().nullable().optional(),
  restoredFrom: z.number().int().positive().nullable().default(null),
});
export type CompanyProfileUpdate = z.infer<typeof companyProfileUpdateSchema>;

/** Dane firmy dla stopki strony, Pomocy w aplikacji i wydruków (bez autora zmian). */
export interface CompanyPublicView {
  name: string;
  street: string;
  postalCode: string;
  city: string;
  taxId: string;
  supportEmail: string;
  supportPhone: string;
  supportHours: string;
  regon: string | null;
  krs: string | null;
  registryCourt: string | null;
  shareCapitalGrosze: number | null;
}

export interface CompanyProfileView extends CompanyPublicView {
  version: number;
  updatedAt: string;
  updatedByName: string | null;
}

// --- Publiczne treści (`GET /content/{client}`) -------------------------------------------------

export const contentClientParamSchema = z.enum(PUBLIC_CONTENT_CLIENTS);

/**
 * Nagłówek `ETag` odpowiedzi `GET /content/{client}`: `"content-{hash}"` ze skrótem treści (pole `hash`), więc ETag
 * opisuje dokładnie te dane, które API odczytało (licznik `fn_content_revision()` rośnie już w niezatwierdzonej
 * transakcji i mógł być nowszy niż dane). `If-None-Match` z tym samym skrótem daje `304`.
 */
export type ContentEtag = `"content-${string}"`;

export interface PublicContentItem {
  id: string;
  title: string | null;
  bodyMd: string | null;
  media: MediaRef | null;
  buttonLabel: string | null;
  buttonHref: string | null;
  icon: ContentIcon | null;
}

/** Opublikowana sekcja z opublikowanymi elementami (sekcja w szkicu albo archiwum nie trafia do odpowiedzi). */
export interface PublicContentSection extends Omit<PublicContentItem, 'id'> {
  key: ContentSectionKey;
  items: PublicContentItem[];
}

/** Aktywny model z parametrami na stronie (`web.design`) i na `/h/{numer}`. */
export interface PublicScooterModel {
  code: string;
  name: string;
  rangeKm: number | null;
  maxSpeedKmh: number | null;
  photo: MediaRef | null;
}

export interface PublicContent {
  client: (typeof PUBLIC_CONTENT_CLIENTS)[number];
  /** Licznik treści z chwili odczytu (dla porównania ze zdarzeniem `content.updated`; o świeżości decyduje `hash`). */
  revision: number;
  /**
   * Skrót SHA-256 (32 znaki szesnastkowe) treści odpowiedzi bez pól `revision` i `hash`, odczytanej w jednej transakcji
   * `REPEATABLE READ`; ten sam skrót jest w `ETag`. Aplikacja porównuje go z zapisanym w pamięci telefonu.
   */
  hash: string;
  sections: Partial<Record<ContentSectionKey, PublicContentSection>>;
  faq: PublicFaqCategory[];
  company: CompanyPublicView;
  /** Grafiki systemowe po kluczu (`scooter.*`): rendery wariantów w aplikacji. */
  systemMedia: Record<string, MediaRef>;
  /** Tylko strona: aktywne modele w kolejności kodu. */
  models?: PublicScooterModel[];
}

// --- Dokumenty prawne na stronie (ADR 0065) ----------------------------------------------------

/** `GET /legal/{slug}/versions`: tylko wersje opublikowane i archiwalne, nigdy robocze. */
export interface PublicLegalVersionItem {
  versionNo: number;
  title: string;
  publishedAt: string;
  /** `published_at` następnej wersji („obowiązywała do”); `null` dla bieżącej. */
  supersededAt: string | null;
  changeSummary: string | null;
  current: boolean;
}

/** `GET /legal/{slug}/versions/{n}`: wersja archiwalna z banerem na stronie. */
export interface PublicLegalVersionView extends PublicLegalVersionItem {
  slug: string;
  bodyMd: string;
}

export const legalVersionParamSchema = z.coerce.number().int().min(1).max(10_000);

// --- Strona hulajnogi `/h/{numer}` (ADR 0065) ---------------------------------------------------

/** Numer z adresu: 1–4 cyfry; krótszy niż 4 przekierowuje na `/h/0007`. */
export const publicScooterNumberSchema = z.string().regex(/^\d{1,4}$/);

/** `GET /public/scooters/{number}`: bez dostępności, baterii i położenia; `RETIRED` daje 404. */
export interface PublicScooterView {
  number: number;
  model: { code: string; name: string; photo: MediaRef | null };
}
