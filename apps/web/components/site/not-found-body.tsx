import Link from 'next/link';
import { t } from '../../lib/i18n';

/** Treść strony 404 (makieta strona-404); nagłówek i stopkę dokłada układ strony. */
export function NotFoundBody() {
  return (
    <main className="site-404">
      <span className="site-404-code num" aria-hidden="true">
        {t('site.notFound.code')}
      </span>
      <h1>{t('site.notFound.title')}</h1>
      <p>{t('site.notFound.body')}</p>
      <div className="site-404-actions">
        <Link href="/" className="site-pbtn dark">
          {t('site.notFound.home')}
        </Link>
        <Link href="/aktualnosci" className="site-pbtn sec">
          {t('site.nav.news')}
        </Link>
      </div>
    </main>
  );
}
