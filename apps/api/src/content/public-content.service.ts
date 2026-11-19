import { createHash } from 'node:crypto';
import { notFound } from '@hulajnogi/core';
import { type Database, type DbExecutor, DrizzleContentRepository, type PublicNewsRecord } from '@hulajnogi/db';
import {
  contentSection,
  isContentSectionKey,
  type ContentEtag,
  type ContentSectionKey,
  type MediaRef,
  type NewsPageQuery,
  type PublicContent,
  type PublicContentClient,
  type PublicContentItem,
  type PublicContentSection,
  type PublicFaqCategory,
  type PublicLegalVersionItem,
  type PublicLegalVersionView,
  type PublicNewsArticle,
  type PublicNewsListItem,
  type PublicNewsPage,
  type PublicScooterView,
} from '@hulajnogi/shared';
import { Inject, Injectable } from '@nestjs/common';
import { DB } from '../database/database.module.js';
import { CompanyService } from './company.service.js';

/** `ETag` publicznych treści ze skrótu treści (`PublicContent.hash`), nie z licznika (ADR 0062, poprawka C1). */
export const contentEtag = (hash: string): ContentEtag => `"content-${hash}"`;

/** Skrót SHA-256 treści bez `revision` i `hash` (32 znaki): zmiana samego licznika nie zmienia skrótu. */
export function contentHash(content: Omit<PublicContent, 'hash'>): string {
  const json = JSON.stringify({ ...content, revision: undefined });
  return createHash('sha256').update(json).digest('hex').slice(0, 32);
}

const newsItem = (news: PublicNewsRecord, media: ReadonlyMap<string, MediaRef>): PublicNewsListItem => ({
  slug: news.slug,
  title: news.title,
  lead: news.lead,
  publishedAt: news.publishFrom.toISOString(),
  media: (news.mediaId && media.get(news.mediaId)) || null,
});

/**
 * Publiczne odczyty strony i aplikacji (ADR 0062, ADR 0064, ADR 0065): treści klienta jedną odpowiedzią z `ETag`,
 * aktualności, wersje dokumentów prawnych i okrojony odczyt hulajnogi dla `/h/{numer}`. Bez stanu floty i bez
 * treści w szkicu lub archiwum; widoki publiczne w bazie filtrują to samo.
 */
@Injectable()
export class PublicContentService {
  constructor(
    @Inject(DB) private readonly db: Database,
    private readonly company: CompanyService,
  ) {}

  /**
   * `GET /content/{client}`: opublikowane sekcje klienta z opublikowanymi elementami, FAQ widoczne dla klienta,
   * dane firmy, grafiki systemowe i (dla strony) aktywne modele. Wszystkie zapytania w jednej transakcji
   * `REPEATABLE READ` tylko do odczytu (jedna migawka), a `ETag` to skrót tej treści, więc nigdy nie jest nowszy niż
   * dane: licznik `fn_content_revision()` czyta sekwencję, która rośnie już w niezatwierdzonej transakcji.
   */
  content(client: PublicContentClient): Promise<PublicContent> {
    return this.db.transaction((tx) => this.read(tx, client), {
      isolationLevel: 'repeatable read',
      accessMode: 'read only',
    });
  }

  private async read(tx: DbExecutor, client: PublicContentClient): Promise<PublicContent> {
    const repo = new DrizzleContentRepository(tx);
    const revision = await repo.revision();
    const blocks = await repo.publicBlocks(client === 'web' ? 'WEB' : 'MOBILE');
    const faq = await repo.publicFaq(client);
    const models = client === 'web' ? await repo.activeModels() : [];
    const system = await repo.systemMedia();
    const media = await repo.mediaRefs([
      ...blocks.map((block) => block.mediaId),
      ...models.map((model) => model.photoMediaId),
    ]);

    const sections: Partial<Record<ContentSectionKey, PublicContentSection>> = {};
    for (const block of blocks) {
      if (!isContentSectionKey(block.key)) continue;
      const item: PublicContentItem = {
        id: block.id,
        title: block.title,
        bodyMd: block.bodyMd,
        media: (block.mediaId && media.get(block.mediaId)) || null,
        buttonLabel: block.buttonLabel,
        buttonHref: block.buttonHref,
        icon: block.icon,
      };
      if (block.position === 0) {
        sections[block.key] = {
          key: block.key,
          title: item.title,
          bodyMd: item.bodyMd,
          media: item.media,
          buttonLabel: item.buttonLabel,
          buttonHref: item.buttonHref,
          icon: item.icon,
          items: sections[block.key]?.items ?? [],
        };
      } else if (contentSection(block.key).kind === 'list') {
        const section = sections[block.key];
        if (section) section.items.push(item);
      }
    }

    const categories: PublicFaqCategory[] = [];
    for (const row of faq) {
      let category = categories.at(-1);
      if (category?.id !== row.categoryId) {
        category = { id: row.categoryId, name: row.categoryName, items: [] };
        categories.push(category);
      }
      category.items.push({ id: row.id, question: row.question, answerMd: row.answerMd });
    }

    const content: Omit<PublicContent, 'hash'> = {
      client,
      revision,
      sections,
      faq: categories,
      company: await this.company.publicView(tx),
      systemMedia: Object.fromEntries(system.map((ref) => [ref.key, ref])),
    };
    if (client === 'web') {
      content.models = models.map((model) => ({
        code: model.code,
        name: model.name,
        rangeKm: model.rangeKm,
        maxSpeedKmh: model.maxSpeedKmh,
        photo: (model.photoMediaId && media.get(model.photoMediaId)) || null,
      }));
    }
    return { ...content, hash: contentHash(content) };
  }

  /** `GET /news`: opublikowane aktualności (bez zaplanowanych i wygasłych) od najnowszej daty publikacji. */
  async news(query: NewsPageQuery): Promise<PublicNewsPage> {
    const repo = new DrizzleContentRepository(this.db);
    const { items, total } = await repo.publishedNews(query.page, query.pageSize);
    const media = await repo.mediaRefs(items.map((item) => item.mediaId));
    return { items: items.map((item) => newsItem(item, media)), page: query.page, pageSize: query.pageSize, total };
  }

  /** `GET /news/{slug}`: zaplanowana, wygasła, w szkicu albo nieznana daje 404. */
  async article(slug: string): Promise<PublicNewsArticle> {
    const repo = new DrizzleContentRepository(this.db);
    const news = await repo.publishedArticle(slug);
    if (!news) throw notFound('news', slug);
    const media = await repo.mediaRefs([news.mediaId]);
    return { ...newsItem(news, media), bodyMd: news.bodyMd, updatedAt: news.updatedAt.toISOString() };
  }

  /** `GET /legal/{slug}/versions`: wersje opublikowane i archiwalne od najnowszej, nigdy robocze. */
  async legalVersions(slug: string): Promise<PublicLegalVersionItem[]> {
    const versions = await new DrizzleContentRepository(this.db).publicDocumentVersions(slug);
    if (!versions.length) throw notFound('legalDocument', slug);
    return versions.map((version) => ({
      versionNo: version.versionNo,
      title: version.title,
      publishedAt: version.publishedAt.toISOString(),
      supersededAt: version.validTo?.toISOString() ?? null,
      changeSummary: version.changeSummary,
      current: version.isCurrent,
    }));
  }

  /** `GET /legal/{slug}/versions/{n}`: wersja archiwalna albo obowiązująca; robocza i nieznana dają 404. */
  async legalVersion(slug: string, versionNo: number): Promise<PublicLegalVersionView> {
    const version = (await new DrizzleContentRepository(this.db).publicDocumentVersions(slug)).find(
      (v) => v.versionNo === versionNo,
    );
    if (!version) throw notFound('documentVersion', `${slug}/${versionNo}`);
    return {
      slug: version.slug,
      versionNo: version.versionNo,
      title: version.title,
      bodyMd: version.bodyMd,
      publishedAt: version.publishedAt.toISOString(),
      supersededAt: version.validTo?.toISOString() ?? null,
      changeSummary: version.changeSummary,
      current: version.isCurrent,
    };
  }

  /**
   * `GET /public/scooters/{number}` (ADR 0065): numer i model ze zdjęciem hulajnogi, która nie jest wycofana.
   * Bez dostępności, baterii, położenia i łączności, bo strona trafia do cache, a numer jest na naklejce.
   */
  async scooter(number: number): Promise<PublicScooterView> {
    const repo = new DrizzleContentRepository(this.db);
    const scooter = await repo.publicScooter(number);
    if (!scooter) throw notFound('scooter', String(number));
    const media = await repo.mediaRefs([scooter.photoMediaId]);
    return {
      number: scooter.number,
      model: {
        code: scooter.modelCode,
        name: scooter.modelName,
        photo: (scooter.photoMediaId && media.get(scooter.photoMediaId)) || null,
      },
    };
  }
}
