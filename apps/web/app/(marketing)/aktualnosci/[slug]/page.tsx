import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { MarkdownView } from '../../../../components/markdown-view';
import { MediaImage } from '../../../../components/site/media-image';
import { t } from '../../../../lib/i18n';
import { getArticle, getNewsPage, mediaSrc } from '../../../../lib/site/api';
import { formatLongDate } from '../../../../lib/site/format';

const SLUG = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
/** Pozycje w „Inne aktualności” (makieta strona-aktualnosc). */
const OTHERS = 3;

const load = (slug: string) => (SLUG.test(slug) && slug.length <= 100 ? getArticle(slug) : Promise.resolve(null));

export async function generateMetadata({ params }: { params: Promise<{ slug: string }> }): Promise<Metadata> {
  const { slug } = await params;
  const article = await load(slug).catch(() => null);
  if (!article) return {};
  return {
    title: article.title,
    description: article.lead,
    alternates: { canonical: `/aktualnosci/${article.slug}` },
    openGraph: {
      type: 'article',
      title: article.title,
      description: article.lead,
      publishedTime: article.publishedAt,
      images: article.media
        ? [
            {
              url: mediaSrc(article.media.url),
              width: article.media.width,
              height: article.media.height,
              alt: article.media.altText,
            },
          ]
        : [],
    },
  };
}

function BackIcon() {
  return (
    <svg
      width="16"
      height="16"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="m15 18-6-6 6-6" />
    </svg>
  );
}

/** Artykuł (makieta strona-aktualnosc): zaplanowana, wygasła albo nieznana aktualność daje 404 (API). */
export default async function ArticlePage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const [article, latest] = await Promise.all([load(slug), getNewsPage(1, OTHERS + 1)]);
  if (!article) notFound();
  const others = (latest?.items ?? []).filter((item) => item.slug !== article.slug).slice(0, OTHERS);
  return (
    <main className="site-wrap site-article">
      <Link href="/aktualnosci" className="site-back">
        <BackIcon />
        {t('site.nav.news')}
      </Link>
      <div className={article.media ? 'site-article-head' : 'site-article-head no-media'}>
        <div className="site-article-title">
          <span className="site-date num">{formatLongDate(article.publishedAt)}</span>
          <h1>{article.title}</h1>
          <p>{article.lead}</p>
        </div>
        {article.media && (
          <figure>
            <div className="ph">
              <MediaImage media={article.media} priority />
            </div>
            {article.media.caption && <figcaption>{article.media.caption}</figcaption>}
          </figure>
        )}
      </div>
      <div className="site-article-body">
        <MarkdownView source={article.bodyMd} profile="document" className="site-md article" />
        {others.length > 0 && (
          <aside className="site-others">
            <span className="site-side-label" style={{ marginBottom: 8 }}>
              {t('site.news.others')}
            </span>
            {others.map((item) => (
              <Link key={item.slug} href={`/aktualnosci/${item.slug}`}>
                <b>{item.title}</b>
                <small className="num">{formatLongDate(item.publishedAt)}</small>
              </Link>
            ))}
          </aside>
        )}
      </div>
    </main>
  );
}
