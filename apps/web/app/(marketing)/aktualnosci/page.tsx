import { NEWS_PAGE_SIZE, type PublicNewsListItem } from '@hulajnogi/shared';
import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { MediaImage } from '../../../components/site/media-image';
import { t } from '../../../lib/i18n';
import { getNewsPage } from '../../../lib/site/api';
import { formatLongDate } from '../../../lib/site/format';

export const metadata: Metadata = {
  title: t('site.news.title'),
  description: t('site.news.lead'),
  alternates: { canonical: '/aktualnosci' },
};

function Thumb({ item }: { item: PublicNewsListItem }) {
  return <div className="ph">{item.media && <MediaImage media={item.media} />}</div>;
}

/**
 * Aktualności (makieta strona-aktualnosci, ADR 0065): opublikowane od najnowszej, po 12 na stronę (`?strona=2`),
 * data z `publish_from`. Zaplanowane i wygasłe API pomija.
 */
export default async function NewsPage({ searchParams }: { searchParams: Promise<{ strona?: string }> }) {
  const { strona } = await searchParams;
  const page = strona === undefined ? 1 : /^\d{1,4}$/.test(strona) ? Number(strona) : 0;
  if (page < 1) notFound();
  const data = await getNewsPage(page, NEWS_PAGE_SIZE);
  if (!data) notFound();
  const pages = Math.max(1, Math.ceil(data.total / data.pageSize));
  if (page > pages) notFound();
  const [lead, ...rest] = page === 1 ? data.items : [undefined, ...data.items];
  return (
    <main className="site-wrap site-news">
      <div className="site-news-head">
        <h1>{t('site.news.title')}</h1>
        <p>{t('site.news.lead')}</p>
      </div>
      {data.total === 0 && <p className="site-empty">{t('site.news.empty')}</p>}
      {lead && (
        <Link href={`/aktualnosci/${lead.slug}`} className="site-news-lead">
          <Thumb item={lead} />
          <div className="site-news-lead-text">
            <span className="site-date num">{formatLongDate(lead.publishedAt)}</span>
            <span className="t">{lead.title}</span>
            <span className="l">{lead.lead}</span>
            <span className="site-news-more">{t('site.news.readMore')}</span>
          </div>
        </Link>
      )}
      {rest.length > 0 && (
        <div className="site-news-grid">
          {rest.map((item) =>
            item ? (
              <Link key={item.slug} href={`/aktualnosci/${item.slug}`} className="site-news-card">
                <Thumb item={item} />
                <span className="site-date num">{formatLongDate(item.publishedAt)}</span>
                <span className="t">{item.title}</span>
                <span className="l">{item.lead}</span>
              </Link>
            ) : null,
          )}
        </div>
      )}
      {pages > 1 && (
        <nav className="site-pager" aria-label={t('site.news.pages')}>
          {Array.from({ length: pages }, (_, i) => i + 1).map((p) => (
            <Link
              key={p}
              href={p === 1 ? '/aktualnosci' : `/aktualnosci?strona=${p}`}
              aria-current={p === page ? 'page' : undefined}
              className="num"
            >
              {p}
            </Link>
          ))}
        </nav>
      )}
    </main>
  );
}
