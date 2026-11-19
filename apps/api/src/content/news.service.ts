import {
  contentAuditData,
  DomainError,
  ensureContentDeletable,
  ensureNewsSlugChange,
  ensureNewsValid,
  ensureNoContentIssues,
  ensureVersion,
  NEWS_BOUNDARY_SINGLETON_SECONDS,
  newsBoundaryJobs,
  newsPublication,
  notFound,
  uniqueSlug,
  type ContentIssue,
} from '@hulajnogi/core';
import {
  type Database,
  type DbExecutor,
  DrizzleContentRepository,
  type NewsFields,
  type NewsRecord,
  toContentHistoryEntry,
} from '@hulajnogi/db';
import {
  headingId,
  type ContentHistoryEntry,
  type ListQuery,
  type ListResponse,
  type MediaRef,
  type NewsCreate,
  type NewsDetails,
  type NewsListItem,
  type NewsState,
  type NewsUpdate,
} from '@hulajnogi/shared';
import { Inject, Injectable } from '@nestjs/common';
import { AuditedTransaction } from '../audit/audited-transaction.js';
import { DB } from '../database/database.module.js';
import { JOBS, JobsService } from '../jobs/jobs.service.js';
import { CONTENT_RULES } from './content-rules.js';
import { ContentPublisher } from './content-publisher.service.js';

/** Długość slugu z tytułu (jak kotwice nagłówków, ADR 0063); przyrostek `-2` mieści się w limicie 100. */
const SLUG_FROM_TITLE_MAX = 90;

const date = (value: string | null): Date | null => (value ? new Date(value) : null);

/** Stan aktualności we wpisie dziennika (jak w danych startowych). */
const snapshot = (news: NewsFields): Record<string, unknown> => ({
  slug: news.slug,
  title: news.title,
  lead: news.lead,
  bodyMd: news.bodyMd,
  mediaId: news.mediaId,
  status: news.status,
  publishFrom: news.publishFrom?.toISOString() ?? null,
  publishTo: news.publishTo?.toISOString() ?? null,
});

function listItem(news: NewsRecord, media: ReadonlyMap<string, MediaRef>): NewsListItem {
  return {
    id: news.id,
    slug: news.slug,
    title: news.title,
    lead: news.lead,
    state: news.state,
    status: news.status,
    publishFrom: news.publishFrom?.toISOString() ?? null,
    publishTo: news.publishTo?.toISOString() ?? null,
    media: (news.mediaId && media.get(news.mediaId)) || null,
    version: news.version,
    updatedAt: news.updatedAt.toISOString(),
    updatedByName: news.updatedByName,
  };
}

/**
 * Aktualności (ADR 0062, ADR 0065): szkic, publikacja od–do i archiwum. Stan liczą core i widok z dat, a zapis
 * opublikowanej aktualności planuje w transakcji zadanie `content.news-boundary` na granicach w przyszłości, które
 * zwiększa licznik treści, odświeża stronę i wysyła `content.updated`. Adres (slug) powstaje z tytułu i nie zmienia
 * się po pierwszej publikacji.
 */
@Injectable()
export class NewsService {
  constructor(
    @Inject(DB) private readonly db: Database,
    private readonly audited: AuditedTransaction,
    private readonly publisher: ContentPublisher,
    private readonly jobs: JobsService,
  ) {}

  async list(query: ListQuery, db: DbExecutor = this.db): Promise<ListResponse<NewsListItem>> {
    const repo = new DrizzleContentRepository(db);
    const page = await repo.listNews(query);
    const media = await repo.mediaRefs(page.items.map((row) => row.mediaId as string | null));
    return {
      ...page,
      items: page.items.map((row) => ({
        id: row.id as string,
        slug: row.slug as string,
        title: row.title as string,
        lead: row.lead as string,
        state: row.state as NewsState,
        status: row.status as NewsListItem['status'],
        publishFrom: iso(row.publishFrom),
        publishTo: iso(row.publishTo),
        media: (typeof row.mediaId === 'string' && media.get(row.mediaId)) || null,
        version: Number(row.version),
        updatedAt: iso(row.updatedAt)!,
        updatedByName: (row.updatedByName as string | null) ?? null,
      })),
    };
  }

  async details(id: string, executor: DbExecutor = this.db): Promise<NewsDetails> {
    const repo = new DrizzleContentRepository(executor);
    const news = await repo.news(id);
    if (!news) throw notFound('news', id);
    const media = await repo.mediaRefs([news.mediaId]);
    return {
      ...listItem(news, media),
      bodyMd: news.bodyMd,
      firstPublishedAt: news.firstPublishedAt?.toISOString() ?? null,
    };
  }

  async history(id: string): Promise<ContentHistoryEntry[]> {
    const rows = await new DrizzleContentRepository(this.db).history('news', id);
    return rows.map((row) => toContentHistoryEntry(row));
  }

  async create(staffId: string, body: NewsCreate): Promise<NewsDetails> {
    const now = new Date();
    const id = await this.audited.run(staffId, async ({ tx, audit }) => {
      const repo = new DrizzleContentRepository(tx);
      const fields = await this.prepare(tx, body, now, null);
      const created = await repo.insertNews(fields, staffId);
      await audit({
        action: 'news.created',
        entityType: 'news',
        entityId: created,
        data: contentAuditData(null, snapshot(fields), { from: null, to: 1 }),
      });
      await this.scheduleBoundaries(tx, created, fields, now);
      await this.publisher.changed(tx, ['WEB']);
      return created;
    });
    await this.publisher.notify(['WEB']);
    return this.details(id);
  }

  async update(staffId: string, id: string, body: NewsUpdate): Promise<NewsDetails> {
    const now = new Date();
    const changed = await this.audited.run(staffId, async ({ tx, audit }) => {
      const repo = new DrizzleContentRepository(tx);
      const current = await repo.news(id, { lock: true });
      if (!current) throw notFound('news', id);
      ensureVersion(body.version, current.version);
      if (body.restoredFrom !== null && !(await repo.auditEntryExists(body.restoredFrom, 'news'))) {
        throw new DomainError('VALIDATION_FAILED', { fields: ['restoredFrom'] });
      }
      const fields = await this.prepare(tx, body, now, current);
      const before = snapshot(current);
      const after = snapshot(fields);
      if (JSON.stringify(before) === JSON.stringify(after)) return false;
      if (!(await repo.updateNews(id, current.version, fields, staffId))) {
        throw new DomainError('CONFLICT', { expectedVersion: current.version });
      }
      await audit({
        action: body.restoredFrom === null ? 'news.updated' : 'news.restored',
        entityType: 'news',
        entityId: id,
        data: contentAuditData(before, after, { from: current.version, to: current.version + 1 }, body.restoredFrom),
      });
      await this.scheduleBoundaries(tx, id, fields, now);
      await this.publisher.changed(tx, ['WEB']);
      return true;
    });
    if (changed) await this.publisher.notify(['WEB']);
    return this.details(id);
  }

  /** Usunięcie szkicu albo aktualności z archiwum (opublikowaną trzeba najpierw zarchiwizować). */
  async remove(staffId: string, id: string, version: number): Promise<void> {
    await this.audited.run(staffId, async ({ tx, audit }) => {
      const repo = new DrizzleContentRepository(tx);
      const current = await repo.news(id, { lock: true });
      if (!current) throw notFound('news', id);
      ensureVersion(version, current.version);
      ensureContentDeletable(current.status);
      await repo.deleteNews(id);
      await audit({
        action: 'news.deleted',
        entityType: 'news',
        entityId: id,
        data: contentAuditData(snapshot(current), null, { from: current.version, to: null }),
      });
      await this.publisher.changed(tx, ['WEB']);
    });
    await this.publisher.notify(['WEB']);
  }

  /**
   * Pola zapisu: treść i daty z core (publikacja bez daty „od” dostaje czas zapisu), grafika z biblioteki, slug
   * z tytułu (unikalny z przyrostkiem) albo z żądania; po pierwszej publikacji slug zostaje (`NEWS_SLUG_LOCKED`).
   */
  private async prepare(tx: DbExecutor, body: NewsCreate, now: Date, current: NewsRecord | null): Promise<NewsFields> {
    const repo = new DrizzleContentRepository(tx);
    const schedule = { status: body.status, publishFrom: date(body.publishFrom), publishTo: date(body.publishTo) };
    ensureNewsValid({ ...body, ...schedule }, CONTENT_RULES);
    const published = newsPublication(schedule, now);
    if (body.mediaId && !(await repo.mediaRefs([body.mediaId])).has(body.mediaId)) {
      const issue: ContentIssue = { item: null, field: 'mediaId', code: 'MEDIA_NOT_FOUND' };
      ensureNoContentIssues([issue]);
    }
    let slug = body.slug ?? current?.slug ?? null;
    if (!slug) {
      const base = headingId(body.title, SLUG_FROM_TITLE_MAX);
      slug = uniqueSlug(base, await repo.slugsLike(base, current?.id ?? null));
    }
    if (current) {
      ensureNewsSlugChange({ firstPublishedAt: current.firstPublishedAt, currentSlug: current.slug, nextSlug: slug });
    }
    return {
      slug,
      title: body.title,
      lead: body.lead,
      bodyMd: body.bodyMd,
      mediaId: body.mediaId,
      status: published.status,
      publishFrom: published.publishFrom,
      publishTo: published.publishTo,
    };
  }

  /**
   * Zadania granic publikacji w przyszłości (`content.news-boundary`), w transakcji zapisu (ADR 0037). Kolejka
   * `standard` nie deduplikuje po samym kluczu, więc zadanie ma okno singletonu (doba) bez przesuwania do następnego
   * okna (`startAfter` zostaje granicą); obsługa pomija granicę, która już nie obowiązuje.
   */
  private async scheduleBoundaries(tx: DbExecutor, id: string, news: NewsFields, now: Date): Promise<void> {
    for (const job of newsBoundaryJobs({ id, ...news }, now)) {
      await this.jobs.sendInTransaction(
        tx,
        JOBS.newsBoundary,
        { newsId: id, boundary: job.boundary, at: job.startAfter.toISOString() },
        job.startAfter,
        {
          singletonKey: job.singletonKey,
          singletonSeconds: NEWS_BOUNDARY_SINGLETON_SECONDS,
          singletonNextSlot: false,
        },
      );
    }
  }
}

function iso(value: unknown): string | null {
  if (value === null || value === undefined) return null;
  return (value instanceof Date ? value : new Date(value as string)).toISOString();
}
