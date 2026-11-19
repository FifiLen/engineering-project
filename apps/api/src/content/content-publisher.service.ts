import { isNewsBoundaryCurrent } from '@hulajnogi/core';
import { type Database, type DbExecutor, DrizzleContentRepository } from '@hulajnogi/db';
import type { ContentClient } from '@hulajnogi/shared';
import { Inject, Injectable, Logger, type OnModuleInit } from '@nestjs/common';
import { CONFIG, type AppConfig } from '../config.js';
import { DB } from '../database/database.module.js';
import { JOBS, JobsService } from '../jobs/jobs.service.js';
import { FleetGateway } from '../realtime/fleet.gateway.js';

/**
 * Tagi cache strony (ADR 0065): `content` dla treści, aktualności, dokumentów, modeli i danych firmy, `tariff` dla
 * cennika, `scooters` dla stron `/h/{numer}`. Route Handler strony przyjmuje tylko tagi z tej listy.
 */
export const SITE_TAGS = ['content', 'tariff', 'scooters'] as const;
export type SiteTag = (typeof SITE_TAGS)[number];

/** Okno singletonu odświeżenia: seria zapisów w panelu daje jedno wywołanie strony. */
export const SITE_REVALIDATE_WINDOW_SECONDS = 5;
/** Ponowienia wywołania strony z rosnącym odstępem (od 5 s); błąd nie cofa zapisu w panelu. */
export const SITE_REVALIDATE_RETRIES = 3;
const SITE_REVALIDATE_TIMEOUT_MS = 5000;

/**
 * Publikacja zmian treści (ADR 0062, ADR 0065): w transakcji zmiany planuje zadanie `site.revalidate` z tagiem
 * strony, a po zatwierdzeniu wysyła `content.updated` z rewizją do wszystkich połączonych. Obsługuje też zadanie
 * `content.news-boundary` na granicach publikacji aktualności, które tylko zwiększa licznik treści.
 */
@Injectable()
export class ContentPublisher implements OnModuleInit {
  private readonly logger = new Logger(ContentPublisher.name);

  constructor(
    @Inject(DB) private readonly db: Database,
    @Inject(CONFIG) private readonly config: AppConfig,
    private readonly jobs: JobsService,
    private readonly gateway: FleetGateway,
  ) {}

  onModuleInit(): void {
    this.jobs.handle(JOBS.siteRevalidate, async ({ tag }) => this.revalidate(tag as SiteTag));
    this.jobs.handle(JOBS.newsBoundary, async (data) => this.newsBoundary(data));
  }

  /**
   * Odświeżenie strony po zatwierdzeniu zmiany: zadanie w transakcji zmiany z kluczem singletonu na tag. Bez
   * `SITE_REVALIDATE_URL` (testy, CI) nic nie planuje: strona odświeży się po czasie zapasowym (5 min).
   */
  async revalidateSite(tx: DbExecutor, tags: readonly SiteTag[]): Promise<void> {
    if (!this.config.SITE_REVALIDATE_URL) return;
    for (const tag of new Set(tags)) {
      await this.jobs.sendInTransaction(tx, JOBS.siteRevalidate, { tag }, new Date(), {
        singletonKey: `site:${tag}`,
        singletonSeconds: SITE_REVALIDATE_WINDOW_SECONDS,
        retryLimit: SITE_REVALIDATE_RETRIES,
        retryDelaySeconds: 5,
      });
    }
  }

  /** Zmiana treści klientów w transakcji: strona dostaje odświeżenie tagu `content`, gdy zmiana dotyczy strony. */
  async changed(tx: DbExecutor, clients: readonly ContentClient[]): Promise<void> {
    if (clients.includes('WEB')) await this.revalidateSite(tx, ['content']);
  }

  /** `content.updated` po zatwierdzeniu: rewizja z bazy, klienci, czas (kontrakt Socket.IO 1.5.0). */
  async notify(clients: readonly ContentClient[]): Promise<void> {
    if (!clients.length) return;
    const revision = await new DrizzleContentRepository(this.db).revision();
    this.gateway.contentUpdated({ revision, clients: [...new Set(clients)], at: new Date().toISOString() });
  }

  /**
   * Zadanie `site.revalidate`: `POST {SITE_REVALIDATE_URL}` z sekretem i tagiem. Błąd HTTP albo sieci kończy
   * zadanie błędem, więc pg-boss je ponawia; zapis w panelu jest już zatwierdzony.
   */
  async revalidate(tag: SiteTag): Promise<void> {
    const url = this.config.SITE_REVALIDATE_URL as string | undefined;
    if (!url) return;
    const response = await fetch(url, {
      method: 'POST',
      headers: {
        authorization: `Bearer ${this.config.SITE_REVALIDATE_SECRET as string}`,
        'content-type': 'application/json',
      },
      body: JSON.stringify({ tags: [tag] }),
      signal: AbortSignal.timeout(SITE_REVALIDATE_TIMEOUT_MS),
    }).catch((error: unknown) => {
      this.logger.warn(`Odświeżenie strony (${tag}) nie powiodło się: ${(error as Error).message}`);
      throw error;
    });
    if (!response.ok) {
      this.logger.warn(`Odświeżenie strony (${tag}) zwróciło HTTP ${response.status}`);
      throw new Error(`site.revalidate: HTTP ${response.status}`);
    }
  }

  /**
   * Zadanie `content.news-boundary` (ADR 0062): aktualność weszła albo wygasła o czasie. Licznik treści rośnie bez
   * zmiany wiersza, strona dostaje odświeżenie, a aplikacja `content.updated`. Zadanie z granicą, która już nie
   * obowiązuje (zmiana dat, archiwum, usunięcie; `isNewsBoundaryCurrent`), niczego nie robi; zadanie sprzed zapisu
   * czasu granicy w danych (`at`) działa jak dotąd.
   */
  async newsBoundary(data: Record<string, unknown> = {}): Promise<void> {
    const at = typeof data.at === 'string' ? new Date(data.at) : null;
    if (at && typeof data.newsId === 'string' && (data.boundary === 'from' || data.boundary === 'to')) {
      const news = await new DrizzleContentRepository(this.db).news(data.newsId);
      if (!isNewsBoundaryCurrent(news, { boundary: data.boundary, at })) return;
    }
    await this.db.transaction(async (tx) => {
      await new DrizzleContentRepository(tx).bumpRevision();
      await this.revalidateSite(tx, ['content']);
    });
    await this.notify(['WEB']);
  }
}
