import type { Metadata } from 'next';
import { SiteFooter, SiteHeader } from '../components/site/chrome';
import { NotFoundBody } from '../components/site/not-found-body';
import { t } from '../lib/i18n';
import './(marketing)/site.css';

export const metadata: Metadata = { title: t('site.notFound.metaTitle') };

/**
 * Strona 404 dla adresów spoza tras (makieta strona-404, ADR 0065). Bez odczytu API: główny `not-found` jest częścią
 * drzewa każdej trasy, więc odczyt przy żądaniu (`connection()`) wyłączyłby statyczne strony panelu. Stopka jest więc
 * bez danych firmy; 404 stron z treścią (nieznany dokument, aktualność, numer hulajnogi) pokazuje `(marketing)/
 * not-found.tsx` w pełnym układzie strony.
 */
export default function NotFound() {
  return (
    <div className="site">
      <SiteHeader />
      <NotFoundBody />
      <SiteFooter content={null} />
    </div>
  );
}
