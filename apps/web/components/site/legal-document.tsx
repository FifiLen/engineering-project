import {
  parseMarkdown,
  tableOfContents,
  type PublicLegalVersionItem,
  type PublicLegalVersionView,
} from '@hulajnogi/shared';
import Link from 'next/link';
import { t } from '../../lib/i18n';
import { formatLongDate, formatShortDate } from '../../lib/site/format';
import { MarkdownView } from '../markdown-view';
import { LEGAL_PAGES } from './chrome';

function versionRange(v: PublicLegalVersionItem): string {
  return v.supersededAt
    ? t('site.document.range', { from: formatShortDate(v.publishedAt), to: formatShortDate(v.supersededAt) })
    : t('site.document.since', { date: formatShortDate(v.publishedAt) });
}

const versionHref = (slug: string, v: PublicLegalVersionItem) =>
  v.current ? `/${slug}` : `/${slug}/wersja/${v.versionNo}`;

function Versions({ slug, versions, shown }: { slug: string; versions: PublicLegalVersionItem[]; shown: number }) {
  return (
    <div className="site-vers">
      {versions.map((v) =>
        v.versionNo === shown ? (
          <div key={v.versionNo} className="site-ver" aria-current="page">
            <span>
              {v.current
                ? t('site.document.versionCurrent', { no: v.versionNo })
                : t('site.document.version', { no: v.versionNo })}
            </span>
            <small className="num">{versionRange(v)}</small>
          </div>
        ) : (
          <Link key={v.versionNo} href={versionHref(slug, v)} className="site-ver">
            <span>
              {v.current
                ? t('site.document.versionCurrent', { no: v.versionNo })
                : t('site.document.version', { no: v.versionNo })}
            </span>
            <small className="num">{versionRange(v)}</small>
          </Link>
        ),
      )}
    </div>
  );
}

/**
 * Dokument prawny na stronie (makiety strona-dokument i strona-dokument-mobile, ADR 0065): spis treści z nagłówków
 * `##`, wersje opublikowane i archiwalne, data obowiązywania z `published_at` i baner wersji archiwalnej.
 */
export function LegalDocument({
  slug,
  versions,
  version,
}: {
  slug: string;
  versions: PublicLegalVersionItem[];
  version: PublicLegalVersionView;
}) {
  const parsed = parseMarkdown(version.bodyMd, 'document');
  const toc = tableOfContents(parsed);
  const others = versions.filter((v) => v.versionNo !== version.versionNo);
  const current = versions.find((v) => v.current);
  return (
    <main className="site-wrap site-doc">
      <aside className="site-doc-side" aria-label={t('site.document.sideLabel')}>
        {toc.length > 0 && (
          <>
            <div className="site-side-label">{t('site.document.toc')}</div>
            <nav className="site-toc">
              {toc.map((h) => (
                <a key={h.id} href={`#${h.id}`}>
                  {h.text}
                </a>
              ))}
            </nav>
          </>
        )}
        <div className="site-side-label" style={{ marginTop: toc.length ? 28 : 0 }}>
          {t('site.document.versions')}
        </div>
        <Versions slug={slug} versions={versions} shown={version.versionNo} />
      </aside>
      <article>
        <nav className="site-pill-row" aria-label={t('site.footer.documents')}>
          {LEGAL_PAGES.map((page) => (
            <Link
              key={page.slug}
              href={`/${page.slug}`}
              className="site-pill"
              aria-current={page.slug === slug ? 'page' : undefined}
            >
              {page.label()}
            </Link>
          ))}
        </nav>
        <h1>{version.title}</h1>
        <p className="site-doc-meta">
          {version.current
            ? t('site.document.meta', { no: version.versionNo, date: formatLongDate(version.publishedAt) })
            : t('site.document.metaArchived', { no: version.versionNo })}
        </p>
        {!version.current && (
          <div className="site-archive" role="note">
            <span>
              {version.supersededAt
                ? t('site.document.archived', {
                    from: formatLongDate(version.publishedAt),
                    to: formatLongDate(version.supersededAt),
                  })
                : t('site.document.archivedOpen', { from: formatLongDate(version.publishedAt) })}
            </span>
            {current && <Link href={`/${slug}`}>{t('site.document.toCurrent', { no: current.versionNo })}</Link>}
          </div>
        )}
        <div className="site-doc-mobile site-card">
          {toc.length > 0 && (
            <details>
              <summary>
                <span>{t('site.document.tocMobile')}</span>
                <span className="site-muted">{t('site.document.parts', { count: toc.length })}</span>
              </summary>
              <nav className="site-toc">
                {toc.map((h) => (
                  <a key={h.id} href={`#${h.id}`}>
                    {h.text}
                  </a>
                ))}
              </nav>
            </details>
          )}
          {others.length > 0 && (
            <details>
              <summary>
                <span>{t('site.document.previous')}</span>
                <span className="site-muted num">{others.length}</span>
              </summary>
              <Versions slug={slug} versions={versions} shown={version.versionNo} />
            </details>
          )}
        </div>
        {version.changeSummary && (
          <div className="site-card site-change">
            <span>{t('site.document.changes')}</span>
            <span>{version.changeSummary}</span>
          </div>
        )}
        <MarkdownView blocks={parsed.blocks} className="site-md site-doc-body" />
      </article>
    </main>
  );
}
