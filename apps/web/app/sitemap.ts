import type { MetadataRoute } from 'next';
import { connection } from 'next/server';
import { LEGAL_PAGES } from '../components/site/chrome';
import { getLegalVersions, getNewsPage } from '../lib/site/api';
import { siteUrl } from '../lib/site/url';

/** Strony aktualności pobierane do mapy strony (po 50, limit API). */
const PAGE_SIZE = 50;
const MAX_PAGES = 20;

/**
 * Mapa strony (ADR 0065): strona główna, dokumenty, aktualności i opublikowane artykuły z datą. Bez `/h/{numer}`
 * i wersji archiwalnych. Odczyt przy żądaniu (`connection()`), więc build nie woła API; awaria API daje mapę bez
 * artykułów zamiast błędu.
 */
export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  await connection();
  const base = siteUrl();
  const entries: MetadataRoute.Sitemap = [{ url: `${base}/`, changeFrequency: 'weekly', priority: 1 }];
  const docs = await Promise.all(LEGAL_PAGES.map((page) => getLegalVersions(page.slug).catch(() => null)));
  LEGAL_PAGES.forEach((page, i) => {
    const current = docs[i]?.find((v) => v.current);
    if (current) entries.push({ url: `${base}/${page.slug}`, lastModified: current.publishedAt, priority: 0.3 });
  });
  entries.push({ url: `${base}/aktualnosci`, changeFrequency: 'weekly', priority: 0.6 });
  for (let page = 1; page <= MAX_PAGES; page++) {
    const data = await getNewsPage(page, PAGE_SIZE).catch(() => null);
    if (!data) break;
    for (const item of data.items) {
      entries.push({ url: `${base}/aktualnosci/${item.slug}`, lastModified: item.publishedAt, priority: 0.5 });
    }
    if (page * PAGE_SIZE >= data.total) break;
  }
  return entries;
}
