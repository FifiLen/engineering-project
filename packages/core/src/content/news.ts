import { DomainError } from '../errors.js';
import {
  ensureNoContentIssues,
  markdownIssues,
  textIssues,
  type ContentIssue,
  type ContentRulesContext,
  type ContentStatus,
} from './content.js';

/**
 * Aktualności z planowaną publikacją (ADR 0062): stan liczony ze statusu i dat, jak w widoku `v_news_list`,
 * zadanie `content.news-boundary` na granicach `publish_from` i `publish_to` i adres stały po pierwszej publikacji.
 */
export const NEWS_STATES = ['DRAFT', 'SCHEDULED', 'PUBLISHED', 'EXPIRED', 'ARCHIVED'] as const;
export type NewsState = (typeof NEWS_STATES)[number];

export const NEWS_LIMITS = { title: 120, lead: 280, body: 20_000 } as const;

export interface NewsSchedule {
  status: ContentStatus;
  publishFrom: Date | null;
  publishTo: Date | null;
}

/**
 * Stan na liście i na stronie: opublikowana z `publishFrom` w przyszłości jest zaplanowana, po `publishTo` wygasła;
 * granica `publishFrom` należy już do publikacji, a `publishTo` już do wygaśnięcia.
 */
export function newsState(news: NewsSchedule, now: Date): NewsState {
  if (news.status !== 'PUBLISHED') return news.status;
  if (news.publishFrom && news.publishFrom.getTime() > now.getTime()) return 'SCHEDULED';
  if (news.publishTo && news.publishTo.getTime() <= now.getTime()) return 'EXPIRED';
  return 'PUBLISHED';
}

/** Widoczna na stronie (`v_published_news`): tylko w stanie `PUBLISHED`; zaplanowana i wygasła dają 404. */
export const isNewsVisible = (news: NewsSchedule, now: Date): boolean => newsState(news, now) === 'PUBLISHED';

export interface NewsDraft {
  title: string;
  lead: string;
  bodyMd: string;
}

/** Tytuł, wymagana zajawka (do 280 znaków) i treść w profilu `document`. */
export function newsIssues(
  news: NewsDraft & Partial<NewsSchedule>,
  ctx: Pick<ContentRulesContext, 'markdown'>,
): ContentIssue[] {
  const where = (field: string) => ({ item: null, field });
  const issues = [
    ...textIssues(news.title, { max: NEWS_LIMITS.title, required: true }, where('title')),
    ...textIssues(news.lead, { max: NEWS_LIMITS.lead, required: true }, where('lead'), false),
    ...markdownIssues(
      news.bodyMd,
      { max: NEWS_LIMITS.body, required: true, profile: 'document' },
      where('bodyMd'),
      ctx,
    ),
  ];
  if (news.publishFrom && news.publishTo && news.publishTo.getTime() <= news.publishFrom.getTime()) {
    issues.push({ item: null, field: 'publishTo', code: 'NEWS_DATES_INVALID' });
  }
  return issues;
}

/**
 * Daty zapisu: publikacja bez `publishFrom` dostaje czas zapisu („Opublikuj teraz”), a publikacja, która od razu
 * wygasa, jest błędem (`NEWS_DATES_INVALID`). Szkic i archiwum zachowują daty bez zmian.
 */
export function newsPublication(news: NewsSchedule, now: Date): NewsSchedule {
  if (news.status !== 'PUBLISHED') return news;
  const publishFrom = news.publishFrom ?? now;
  if (news.publishTo && news.publishTo.getTime() <= Math.max(publishFrom.getTime(), now.getTime())) {
    throw new DomainError('CONTENT_VALIDATION_FAILED', {
      issues: [{ item: null, field: 'publishTo', code: 'NEWS_DATES_INVALID' }],
    });
  }
  return { ...news, publishFrom };
}

/** Walidacja zapisu aktualności (wszystkie problemy naraz). */
export function ensureNewsValid(
  news: NewsDraft & Partial<NewsSchedule>,
  ctx: Pick<ContentRulesContext, 'markdown'>,
): void {
  ensureNoContentIssues(newsIssues(news, ctx));
}

/**
 * Adres aktualności nie zmienia się po pierwszej publikacji, żeby odnośniki nie przestały działać (ADR 0062);
 * zmiana daje `NEWS_SLUG_LOCKED`.
 */
export function ensureNewsSlugChange(input: {
  firstPublishedAt: Date | null;
  currentSlug: string;
  nextSlug: string;
}): void {
  if (input.firstPublishedAt && input.currentSlug !== input.nextSlug) {
    throw new DomainError('NEWS_SLUG_LOCKED', { slug: input.currentSlug });
  }
}

/** Slug unikalny: przy kolizji przyrostek `-2`, `-3` (bazowy slug z tytułu tworzy `headingId` z shared). */
export function uniqueSlug(base: string, taken: Iterable<string>): string {
  const used = new Set(taken);
  let slug = base;
  for (let n = 2; used.has(slug); n++) slug = `${base}-${n}`;
  return slug;
}

export type NewsBoundary = 'from' | 'to';

export interface NewsBoundaryJob {
  boundary: NewsBoundary;
  startAfter: Date;
  /**
   * Klucz singletonu pg-boss `news:{id}:{granica}:{czas}`. Kolejka `content.news-boundary` ma politykę `standard`,
   * w której sam klucz niczego nie deduplikuje: API wysyła go z oknem singletonu (`NEWS_BOUNDARY_SINGLETON_SECONDS`,
   * bez przesuwania do następnego okna), więc powtórny zapis tych samych dat w oknie nie tworzy drugiego zadania,
   * a zadanie z datą, która już nie obowiązuje, pomija `isNewsBoundaryCurrent`.
   */
  singletonKey: string;
}

/** Okno singletonu zadań granic (doba): zapisy tej samej aktualności z tymi samymi datami dają jedno zadanie. */
export const NEWS_BOUNDARY_SINGLETON_SECONDS = 24 * 60 * 60;

export const newsBoundaryKey = (id: string, boundary: NewsBoundary, at: Date): string =>
  `news:${id}:${boundary}:${at.toISOString()}`;

/**
 * Czy granica z zadania nadal obowiązuje: aktualność jest opublikowana, a `publishFrom` albo `publishTo` ma ten sam
 * czas co zadanie. Po zmianie dat, archiwizacji albo usunięciu stare zadanie niczego nie robi.
 */
export function isNewsBoundaryCurrent(
  news: (NewsSchedule & { id: string }) | null,
  job: { boundary: NewsBoundary; at: Date },
): boolean {
  if (!news || news.status !== 'PUBLISHED') return false;
  const value = job.boundary === 'from' ? news.publishFrom : news.publishTo;
  return value !== null && value.getTime() === job.at.getTime();
}

/**
 * Zadania odświeżenia o czasie dla opublikowanej aktualności: granice w przyszłości. Zadanie zwiększa licznik
 * treści tylko wtedy, gdy jego granica nadal obowiązuje (`isNewsBoundaryCurrent`).
 */
export function newsBoundaryJobs(news: NewsSchedule & { id: string }, now: Date): NewsBoundaryJob[] {
  if (news.status !== 'PUBLISHED') return [];
  const jobs: NewsBoundaryJob[] = [];
  const add = (boundary: NewsBoundary, at: Date | null) => {
    if (at && at.getTime() > now.getTime()) {
      jobs.push({ boundary, startAfter: at, singletonKey: newsBoundaryKey(news.id, boundary, at) });
    }
  };
  add('from', news.publishFrom);
  add('to', news.publishTo);
  return jobs;
}
