import type { ReactNode } from 'react';
import { SiteFooter, SiteHeader, SiteNotice } from '../../components/site/chrome';
import { getContentSafe } from '../../lib/site/api';
import './site.css';

/**
 * Strona promocyjna (ADR 0065): nagłówek, komunikat `web.notice` i stopka z danymi firmy z `GET /content/web`
 * (cache z tagiem `content`). Awaria API nie wyłącza nagłówka i stopki; treść strony pokazuje wtedy `error.tsx`.
 */
export default async function SiteLayout({ children }: { children: ReactNode }) {
  const content = await getContentSafe();
  return (
    <div className="site">
      <SiteNotice content={content} />
      <SiteHeader />
      {children}
      <SiteFooter content={content} />
    </div>
  );
}
