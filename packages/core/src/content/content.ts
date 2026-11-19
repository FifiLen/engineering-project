import { ensureVersion } from '../concurrency.js';
import { DomainError } from '../errors.js';

/**
 * Treści sterowane z panelu (ADR 0062): bloki w sekcjach z rejestru, sekcje-listy, FAQ i historia z dziennika
 * audytu. Rejestr sekcji i parser Markdown są w packages/shared; core nie zależy od shared, więc dostaje definicję
 * sekcji, parser (ADR 0063) i regułę adresów (`isAllowedHref`) jako argumenty, jak walidacja szablonów powiadomień
 * dostaje parametry kodu.
 */
export const CONTENT_STATUSES = ['DRAFT', 'PUBLISHED', 'ARCHIVED'] as const;
export type ContentStatus = (typeof CONTENT_STATUSES)[number];

/** Problem z parsera Markdown z shared (`MarkdownIssue`). */
export interface MarkdownIssueLike {
  code: string;
  line: number;
  column: number;
  construct: string;
  href?: string;
}

/** Zależności reguł treści dostarczane przez API: parser z profilem pola, reguła adresów i lista ikon. */
export interface ContentRulesContext {
  markdown: (source: string, profile: string) => { issues: readonly MarkdownIssueLike[] };
  isAllowedHref: (href: string) => boolean;
  icons: readonly string[];
}

/** Pola bloku dozwolone w sekcji (kształt `ContentFieldsDefinition` z rejestru w shared). */
export interface ContentFieldsRules {
  title?: { max: number; required: boolean };
  body?: { max: number; required: boolean; profile: string };
  media?: { required: boolean; minWidth?: number };
  button?: { required: boolean; labelMax: number };
  icon?: { required: boolean };
}

/** Definicja sekcji z rejestru (`ContentSectionDefinition` z shared). */
export interface ContentSectionRules {
  client: string;
  kind: 'single' | 'list';
  required: boolean;
  header: ContentFieldsRules;
  item?: ContentFieldsRules;
  items?: { min: number; max: number };
}

export interface ContentBlockDraft {
  title: string | null;
  bodyMd: string | null;
  mediaId: string | null;
  buttonLabel: string | null;
  buttonHref: string | null;
  icon: string | null;
  status: ContentStatus;
}

export type ContentIssueCode =
  | 'CONTENT_FIELD_REQUIRED'
  | 'CONTENT_FIELD_NOT_ALLOWED'
  | 'CONTENT_FIELD_INVALID'
  | 'CONTENT_TOO_LONG'
  | 'CONTENT_HREF_NOT_ALLOWED'
  | 'CONTENT_BUTTON_INCOMPLETE'
  | 'CONTENT_ICON_UNKNOWN'
  | 'CONTENT_ITEMS_LIMIT'
  | 'MEDIA_NOT_FOUND'
  | 'MEDIA_TOO_NARROW'
  | 'FAQ_NO_CLIENT'
  | 'NEWS_DATES_INVALID'
  | 'COMPANY_TAX_ID_INVALID'
  | 'COMPANY_REGON_INVALID'
  | 'COMPANY_KRS_INVALID'
  | 'COMPANY_POSTAL_CODE_INVALID'
  | 'COMPANY_REGISTRY_INCOMPLETE';

/**
 * Problem treści (`422 CONTENT_VALIDATION_FAILED`, `details.issues[]`). `item` to indeks elementu sekcji-listy
 * w żądaniu (`null`: nagłówek, blok pojedynczy albo cały wpis); kody Markdown (`MD_*`) przechodzą z parsera
 * razem z wierszem, kolumną i konstrukcją.
 */
export interface ContentIssue {
  item: number | null;
  field: string;
  code: ContentIssueCode | string;
  line?: number;
  column?: number;
  construct?: string;
  href?: string;
  max?: number;
  length?: number;
  min?: number;
  count?: number;
  minWidth?: number;
  width?: number;
}

/** Znaki widoczne dla operatora (punkty kodowe), jak licznik „168 / 240” w edytorze. */
export const contentLength = (text: string): number => [...text].length;

const filled = (value: string | null | undefined): value is string => Boolean(value?.trim());

/** Wspólne sprawdzenie tekstu: wymagany, limit i (dla tytułów) jeden wiersz. */
export function textIssues(
  value: string | null | undefined,
  rules: { max: number; required: boolean },
  where: { item: number | null; field: string },
  singleLine = true,
): ContentIssue[] {
  if (!filled(value)) return rules.required ? [{ ...where, code: 'CONTENT_FIELD_REQUIRED' }] : [];
  const issues: ContentIssue[] = [];
  const length = contentLength(value);
  if (length > rules.max) issues.push({ ...where, code: 'CONTENT_TOO_LONG', max: rules.max, length });
  if (singleLine && /[\r\n]/.test(value)) issues.push({ ...where, code: 'CONTENT_FIELD_INVALID' });
  return issues;
}

/** Treść Markdown: wymagana, limit znaków źródła i błędy parsera w profilu pola. */
export function markdownIssues(
  value: string | null | undefined,
  rules: { max: number; required: boolean; profile: string },
  where: { item: number | null; field: string },
  ctx: Pick<ContentRulesContext, 'markdown'>,
): ContentIssue[] {
  const issues = textIssues(value, rules, where, false);
  if (!filled(value) || issues.some((issue) => issue.code === 'CONTENT_TOO_LONG')) return issues;
  for (const issue of ctx.markdown(value, rules.profile).issues) {
    const { code, line, column, construct, href } = issue;
    issues.push(
      href === undefined
        ? { ...where, code, line, column, construct }
        : { ...where, code, line, column, construct, href },
    );
  }
  return issues;
}

/**
 * Pola jednego bloku względem definicji sekcji. `mediaWidths` podaje szerokość grafik z biblioteki wskazanych
 * w blokach (brak klucza: grafika nie istnieje, `MEDIA_NOT_FOUND`).
 */
export function contentBlockIssues(
  fields: ContentFieldsRules,
  block: ContentBlockDraft,
  ctx: ContentRulesContext,
  mediaWidths: ReadonlyMap<string, number>,
  item: number | null = null,
): ContentIssue[] {
  const issues: ContentIssue[] = [];
  const notAllowed = (field: string) => issues.push({ item, field, code: 'CONTENT_FIELD_NOT_ALLOWED' });

  if (fields.title) issues.push(...textIssues(block.title, fields.title, { item, field: 'title' }));
  else if (filled(block.title)) notAllowed('title');

  if (fields.body) issues.push(...markdownIssues(block.bodyMd, fields.body, { item, field: 'bodyMd' }, ctx));
  else if (filled(block.bodyMd)) notAllowed('bodyMd');

  if (fields.media) {
    if (!block.mediaId) {
      if (fields.media.required) issues.push({ item, field: 'mediaId', code: 'CONTENT_FIELD_REQUIRED' });
    } else {
      const width = mediaWidths.get(block.mediaId);
      if (width === undefined) issues.push({ item, field: 'mediaId', code: 'MEDIA_NOT_FOUND' });
      else if (fields.media.minWidth && width < fields.media.minWidth) {
        issues.push({ item, field: 'mediaId', code: 'MEDIA_TOO_NARROW', minWidth: fields.media.minWidth, width });
      }
    }
  } else if (block.mediaId) notAllowed('mediaId');

  const hasLabel = filled(block.buttonLabel);
  const hasHref = filled(block.buttonHref);
  if (fields.button) {
    if (!hasLabel && !hasHref) {
      if (fields.button.required) issues.push({ item, field: 'button', code: 'CONTENT_FIELD_REQUIRED' });
    } else if (!hasLabel || !hasHref) {
      issues.push({ item, field: 'button', code: 'CONTENT_BUTTON_INCOMPLETE' });
    } else {
      issues.push(
        ...textIssues(
          block.buttonLabel,
          { max: fields.button.labelMax, required: true },
          { item, field: 'buttonLabel' },
        ),
      );
      if (!ctx.isAllowedHref(block.buttonHref!.trim())) {
        issues.push({
          item,
          field: 'buttonHref',
          code: 'CONTENT_HREF_NOT_ALLOWED',
          href: block.buttonHref!.slice(0, 200),
        });
      }
    }
  } else if (hasLabel || hasHref) notAllowed('button');

  if (fields.icon) {
    if (!block.icon) {
      if (fields.icon.required) issues.push({ item, field: 'icon', code: 'CONTENT_FIELD_REQUIRED' });
    } else if (!ctx.icons.includes(block.icon)) issues.push({ item, field: 'icon', code: 'CONTENT_ICON_UNKNOWN' });
  } else if (block.icon) notAllowed('icon');

  return issues;
}

export interface ContentSectionDraft {
  header: ContentBlockDraft;
  items: readonly ContentBlockDraft[];
}

/**
 * Wszystkie problemy zapisu sekcji (edytor pokazuje je naraz): pola nagłówka i elementów, liczba elementów
 * (`max` wszystkich, także szkiców; `min` opublikowanych, gdy sekcja jest opublikowana), elementy w bloku
 * pojedynczym. Stan sekcji wymaganej sprawdza `ensureSectionStatus`.
 */
export function contentSectionIssues(
  section: ContentSectionRules,
  draft: ContentSectionDraft,
  ctx: ContentRulesContext,
  mediaWidths: ReadonlyMap<string, number> = new Map(),
): ContentIssue[] {
  const issues = contentBlockIssues(section.header, draft.header, ctx, mediaWidths);
  if (section.kind === 'single' || !section.item || !section.items) {
    if (draft.items.length) issues.push({ item: null, field: 'items', code: 'CONTENT_FIELD_NOT_ALLOWED' });
    return issues;
  }
  const itemRules = section.item;
  draft.items.forEach((item, index) => issues.push(...contentBlockIssues(itemRules, item, ctx, mediaWidths, index)));
  const { min, max } = section.items;
  if (draft.items.length > max) {
    issues.push({ item: null, field: 'items', code: 'CONTENT_ITEMS_LIMIT', min, max, count: draft.items.length });
  }
  const published = draft.items.filter((item) => item.status === 'PUBLISHED').length;
  if (draft.header.status === 'PUBLISHED' && published < min) {
    issues.push({ item: null, field: 'items', code: 'CONTENT_ITEMS_LIMIT', min, max, count: published });
  }
  return issues;
}

/** Problemy jako jeden błąd domeny z pełną listą (`422 CONTENT_VALIDATION_FAILED`). */
export function ensureNoContentIssues(issues: readonly ContentIssue[]): void {
  if (issues.length) throw new DomainError('CONTENT_VALIDATION_FAILED', { issues: [...issues] });
}

/**
 * Przejścia stanu `DRAFT ↔ PUBLISHED ↔ ARCHIVED` działają w obie strony; sekcja wymagana (hero, ekran startowy)
 * zostaje opublikowana (`CONTENT_SECTION_REQUIRED`).
 */
export function ensureContentTransition(
  _from: ContentStatus,
  to: ContentStatus,
  options: { required?: boolean } = {},
): void {
  if (options.required && to !== 'PUBLISHED') throw new DomainError('CONTENT_SECTION_REQUIRED', { status: to });
}

/** Usunąć da się tylko szkic albo wpis z archiwum; opublikowany wpis trzeba najpierw zarchiwizować. */
export function ensureContentDeletable(status: ContentStatus): void {
  if (status === 'PUBLISHED') throw new DomainError('CONTENT_DELETE_PUBLISHED');
}

export interface SectionItemState {
  id: string;
  status: ContentStatus;
}

export interface SectionItemPlan {
  /** Indeksy nowych elementów w żądaniu. */
  created: number[];
  /** Istniejące elementy z nową pozycją (od 1). */
  kept: Array<{ id: string; position: number; index: number }>;
  /** Elementy, których nie ma w żądaniu. */
  deleted: string[];
}

/**
 * Plan zapisu elementów sekcji-listy: kolejność z tablicy żądania (pozycje od 1, unikalność `(key, position)`
 * w bazie jest odroczona), nowe elementy bez `id`, brakujące usunięte. Cudzy identyfikator daje `NOT_FOUND`,
 * powtórzony `VALIDATION_FAILED`, a usunięcie opublikowanego elementu `CONTENT_DELETE_PUBLISHED`.
 */
export function planSectionItems(
  current: readonly SectionItemState[],
  requested: ReadonlyArray<{ id?: string | null }>,
): SectionItemPlan {
  const byId = new Map(current.map((item) => [item.id, item]));
  const seen = new Set<string>();
  const plan: SectionItemPlan = { created: [], kept: [], deleted: [] };
  requested.forEach((item, index) => {
    if (!item.id) {
      plan.created.push(index);
      return;
    }
    if (!byId.has(item.id)) throw new DomainError('NOT_FOUND', { entity: 'content_block', id: item.id });
    if (seen.has(item.id)) throw new DomainError('VALIDATION_FAILED', { fields: ['items'], duplicate: item.id });
    seen.add(item.id);
    plan.kept.push({ id: item.id, position: index + 1, index });
  });
  for (const item of current) {
    if (seen.has(item.id)) continue;
    ensureContentDeletable(item.status);
    plan.deleted.push(item.id);
  }
  return plan;
}

/**
 * Zapis sekcji (`PUT /admin/content-sections/{key}`): blokada wersji nagłówka (ADR 0031), stan sekcji wymaganej
 * i wszystkie problemy treści naraz.
 */
export function ensureSectionSave(
  section: ContentSectionRules,
  draft: ContentSectionDraft & { version: number },
  current: { version: number; status: ContentStatus },
  ctx: ContentRulesContext,
  mediaWidths: ReadonlyMap<string, number> = new Map(),
): void {
  ensureVersion(draft.version, current.version);
  ensureContentTransition(current.status, draft.header.status, { required: section.required });
  ensureNoContentIssues(contentSectionIssues(section, draft, ctx, mediaWidths));
}

/**
 * Jawna kolejność (FAQ w kategorii, kategorie FAQ): ten sam zbiór wierszy co w bazie (`ORDER_MISMATCH` z brakującymi
 * i nadmiarowymi) i zgodne wersje każdego przestawianego wiersza (`CONFLICT`). Zwraca identyfikatory w kolejności.
 */
export function ensureReorder(
  current: ReadonlyArray<{ id: string; version: number }>,
  requested: ReadonlyArray<{ id: string; version: number }>,
): string[] {
  const versions = new Map(current.map((row) => [row.id, row.version]));
  const ids = requested.map((row) => row.id);
  const missing = current.filter((row) => !ids.includes(row.id)).map((row) => row.id);
  const unexpected = ids.filter((id, index) => !versions.has(id) || ids.indexOf(id) !== index);
  if (missing.length || unexpected.length) throw new DomainError('ORDER_MISMATCH', { missing, unexpected });
  for (const row of requested) {
    const currentVersion = versions.get(row.id)!;
    if (currentVersion !== row.version) {
      throw new DomainError('CONFLICT', { id: row.id, expectedVersion: row.version, currentVersion });
    }
  }
  return ids;
}

/**
 * Dane wpisu dziennika audytu treści (historia z „Przywróć”, ADR 0062): pełny stan przed i po, wersje `[n, n+1]`
 * i wpis, z którego przywrócono stan.
 */
export function contentAuditData(
  before: Record<string, unknown> | null,
  after: Record<string, unknown> | null,
  versions: { from: number | null; to: number | null },
  restoredFrom: number | null = null,
): Record<string, unknown> {
  const data: Record<string, unknown> = { before, after, version: [versions.from, versions.to] };
  if (restoredFrom !== null) data.restoredFrom = restoredFrom;
  return data;
}

// --- FAQ ------------------------------------------------------------------------------------------

export const FAQ_LIMITS = { question: 120, answer: 2000, category: 60 } as const;

export interface FaqItemDraft {
  category: string;
  question: string;
  answerMd: string;
  showOnWeb: boolean;
  showInApp: boolean;
}

/** Pytanie FAQ: limity, odpowiedź w profilu `faq` (ADR 0063) i widoczność co najmniej w jednym kliencie. */
export function faqItemIssues(item: FaqItemDraft, ctx: Pick<ContentRulesContext, 'markdown'>): ContentIssue[] {
  const where = (field: string) => ({ item: null, field });
  const issues = [
    ...textIssues(item.category, { max: FAQ_LIMITS.category, required: true }, where('category')),
    ...textIssues(item.question, { max: FAQ_LIMITS.question, required: true }, where('question')),
    ...markdownIssues(
      item.answerMd,
      { max: FAQ_LIMITS.answer, required: true, profile: 'faq' },
      where('answerMd'),
      ctx,
    ),
  ];
  if (!item.showOnWeb && !item.showInApp) issues.push({ item: null, field: 'showOnWeb', code: 'FAQ_NO_CLIENT' });
  return issues;
}

/** Nazwa kategorii FAQ: przycięta, pojedyncze spacje; porównanie bez względu na wielkość liter jak w bazie. */
export const normalizeFaqCategory = (name: string): string => name.trim().replace(/\s+/g, ' ');
export const sameFaqCategory = (a: string, b: string): boolean =>
  normalizeFaqCategory(a).toLocaleLowerCase('pl') === normalizeFaqCategory(b).toLocaleLowerCase('pl');

/** Kategorię da się usunąć tylko bez pytań (także szkiców i archiwalnych). */
export function ensureFaqCategoryDeletable(itemCount: number): void {
  if (itemCount > 0) throw new DomainError('FAQ_CATEGORY_NOT_EMPTY', { itemCount });
}
