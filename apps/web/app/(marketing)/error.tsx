'use client';

import { t } from '../../lib/i18n';

/**
 * Awaria API przy odczycie treści (ADR 0065): po wygaszeniu cache i niedostępnym API strona pokazuje komunikat
 * z ponowieniem zamiast pustej treści. Nagłówek i stopka zostają z układu.
 */
export default function SiteError({ reset }: { error: Error; reset: () => void }) {
  return (
    <main className="site-404">
      <h1>{t('site.error.title')}</h1>
      <p>{t('site.error.body')}</p>
      <div className="site-404-actions">
        <button type="button" className="site-pbtn dark" onClick={() => reset()}>
          {t('site.error.retry')}
        </button>
      </div>
    </main>
  );
}
