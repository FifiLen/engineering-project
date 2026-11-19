import { formatPln } from '@hulajnogi/shared';
import type { Metadata } from 'next';
import { notFound, permanentRedirect } from 'next/navigation';
import { StoreButtons } from '../../../../components/site/chrome';
import { MediaImage } from '../../../../components/site/media-image';
import { t } from '../../../../lib/i18n';
import { getContent, getPublicScooter, getTariff } from '../../../../lib/site/api';
import { formatLongDate } from '../../../../lib/site/format';

/** Render domyślny, gdy model nie ma zdjęcia (grafika systemowa z biblioteki, ADR 0064). */
const DEFAULT_RENDER = 'scooter.grafit.trzy';

/**
 * Odnośnik „Mam aplikację, otwórz hulajnogę” (ADR 0065): szablon `APP_SCOOTER_LINK` z `{numer}`, domyślnie schemat
 * aplikacji i trasa `hulajnoga/[number]`; w środowisku deweloperskim np. `http://localhost:8082/hulajnoga/{numer}`.
 */
const appLink = (number: string) =>
  (process.env.APP_SCOOTER_LINK || 'hulajnogi://hulajnoga/{numer}').replaceAll('{numer}', number);

function OpenIcon() {
  return (
    <svg
      width="18"
      height="18"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M14 4h6v6M20 4l-9 9M18 14v5a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V7a1 1 0 0 1 1-1h5" />
    </svg>
  );
}

/**
 * Strona pod adresem z kodu QR (makiety strona-hulajnoga i strona-hulajnoga-mobile, ADR 0041, ADR 0065): numer, model
 * i ceny, bez dostępności, baterii i położenia. `/h/7` przekierowuje na `/h/0007`, zły numer albo hulajnoga wycofana
 * daje 404.
 */
export default async function ScooterPage({ params }: { params: Promise<{ number: string }> }) {
  const { number } = await params;
  if (!/^\d{1,4}$/.test(number)) notFound();
  if (number.length < 4) permanentRedirect(`/h/${number.padStart(4, '0')}`);
  const [scooter, tariff, content] = await Promise.all([getPublicScooter(number), getTariff(), getContent()]);
  if (!scooter) notFound();
  const photo = scooter.model.photo ?? content.systemMedia[DEFAULT_RENDER] ?? null;
  const stores = content.sections['web.stores']?.items ?? [];
  const prices = tariff
    ? [
        { key: 'unlock', value: tariff.unlockFee },
        { key: 'minute', value: tariff.minuteRate },
        { key: 'pause', value: tariff.pauseMinuteRate },
      ]
    : [];
  return (
    <main className="site-wrap site-scooter">
      <div className="site-scooter-text">
        <span className="site-scooter-kicker">{t('site.scooter.kicker')}</span>
        <h1 className="site-scooter-no">{t('site.scooter.number', { number })}</h1>
        <p className="site-scooter-lead">
          {t('site.scooter.lead', { brand: t('site.brand') })} <span className="num">{number}</span>
          {t('site.scooter.leadEnd')}
        </p>
        <StoreButtons items={stores} />
        <a href={appLink(number)} className="site-open-app">
          <OpenIcon />
          {t('site.scooter.openApp')}
        </a>
        {prices.length > 0 && (
          <div className="site-scooter-prices">
            {prices.map((price) => (
              <div key={price.key}>
                <span>{t.dynamic(`site.pricing.${price.key}`)}</span>
                <b className="num">{formatPln(price.value)}</b>
              </div>
            ))}
          </div>
        )}
        {tariff && (
          <span className="site-scooter-note">
            {t('site.scooter.tariffNote', {
              date: formatLongDate(tariff.validFrom),
              minutes: tariff.freeReservationMinutes,
            })}
          </span>
        )}
      </div>
      <div className="site-scooter-card">
        {photo && <MediaImage media={photo} priority />}
        <span className="site-model">{scooter.model.name}</span>
      </div>
    </main>
  );
}

export async function generateMetadata({ params }: { params: Promise<{ number: string }> }): Promise<Metadata> {
  const { number } = await params;
  return /^\d{4}$/.test(number) ? { title: t('site.scooter.metaTitle', { number }), robots: { index: false } } : {};
}
