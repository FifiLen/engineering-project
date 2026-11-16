import { t } from '../../lib/i18n';

// Strona promocyjna (szkielet). Treści z bazy i panelu: iteracja 7 (ADR 0027); do tego czasu z pliku tłumaczeń.
export default function HomePage() {
  return (
    <main style={{ maxWidth: 960, margin: '0 auto', padding: '96px 24px' }}>
      <h1
        style={{
          fontSize: 'clamp(48px, 8vw, 96px)',
          fontWeight: 600,
          letterSpacing: '-0.045em',
          lineHeight: 1,
          margin: 0,
        }}
      >
        {t('marketing.headline')}
      </h1>
      <p style={{ fontSize: 21, color: 'var(--muted)', marginTop: 24 }}>{t('marketing.lead')}</p>
      <p style={{ fontSize: 14, color: 'var(--muted)' }}>{t('marketing.pending')}</p>
    </main>
  );
}
