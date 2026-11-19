import {
  formatPln,
  isAllowedHref,
  markdownPlainText,
  parseMarkdown,
  type PublicContent,
  type PublicContentSection,
  type TariffDetailsView,
} from '@hulajnogi/shared';
import type { Metadata } from 'next';
import Link from 'next/link';
import { ContentIconView } from '../../components/content-icon';
import { MarkdownInlineView, MarkdownView } from '../../components/markdown-view';
import { StoreButtons } from '../../components/site/chrome';
import { MediaImage } from '../../components/site/media-image';
import { t } from '../../lib/i18n';
import { getContent, getTariff, mediaSrc } from '../../lib/site/api';

/** Opis strony dla wyszukiwarek z `web.meta` (ADR 0065); bez sekcji zostają etykiety domyślne. */
export async function generateMetadata(): Promise<Metadata> {
  const content = await getContent().catch(() => null);
  const meta = content?.sections['web.meta'];
  if (!meta) return {};
  const description = meta.bodyMd ? markdownPlainText(parseMarkdown(meta.bodyMd, 'inline').blocks) : undefined;
  const image = meta.media ?? content?.sections['web.hero']?.media ?? null;
  return {
    title: { absolute: meta.title ?? t('meta.title') },
    description,
    openGraph: {
      title: meta.title ?? undefined,
      description,
      type: 'website',
      images: image ? [{ url: mediaSrc(image.url), width: image.width, height: image.height, alt: image.altText }] : [],
    },
  };
}

const sectionOf = (content: PublicContent, key: keyof PublicContent['sections']) => content.sections[key] ?? null;

function Hero({ hero, stores }: { hero: PublicContentSection; stores: PublicContentSection | null }) {
  return (
    <section className="site-hero">
      <h1>{hero.title}</h1>
      {hero.bodyMd && (
        <p className="site-hero-lead">
          <MarkdownInlineView source={hero.bodyMd} />
        </p>
      )}
      {stores?.items.length ? (
        <StoreButtons items={stores.items} />
      ) : (
        hero.buttonHref &&
        hero.buttonLabel &&
        isAllowedHref(hero.buttonHref) && (
          <Link href={hero.buttonHref} className="site-pbtn dark site-hero-btn">
            {hero.buttonLabel}
          </Link>
        )
      )}
      {hero.media && <MediaImage media={hero.media} className="site-hero-img" priority />}
    </section>
  );
}

function Steps({ steps }: { steps: PublicContentSection }) {
  return (
    <section id="jak-to-dziala" className="site-section white">
      <div className="site-steps-head">
        <h2 className="site-h2">{steps.title}</h2>
        {steps.bodyMd && (
          <p className="site-lead">
            <MarkdownInlineView source={steps.bodyMd} />
          </p>
        )}
      </div>
      <div className="site-steps">
        {steps.items.map((item, i) => (
          <div key={item.id} className="site-step">
            <span className="site-step-no">{i + 1}</span>
            <span className="site-step-title">{item.title}</span>
            <span className="site-step-body">
              <MarkdownInlineView source={item.bodyMd} />
            </span>
          </div>
        ))}
      </div>
    </section>
  );
}

function Design({ design, content }: { design: PublicContentSection; content: PublicContent }) {
  // Parametry z pierwszego aktywnego modelu (kolejność po kodzie, ADR 0065).
  const model = content.models?.[0] ?? null;
  const image = design.media ?? model?.photo ?? null;
  return (
    <section className="site-section site-design">
      <div className="site-design-text">
        <h2 className="site-h2">{design.title}</h2>
        {design.bodyMd && (
          <p className="site-lead">
            <MarkdownInlineView source={design.bodyMd} />
          </p>
        )}
        {model && (
          <div className="site-specs">
            {model.rangeKm !== null && (
              <div className="site-spec">
                <b className="num">{t('site.design.range', { value: model.rangeKm })}</b>
                <span>{t('site.design.rangeLabel')}</span>
              </div>
            )}
            {model.maxSpeedKmh !== null && (
              <div className="site-spec">
                <b className="num">{t('site.design.speed', { value: model.maxSpeedKmh })}</b>
                <span>{t('site.design.speedLabel')}</span>
              </div>
            )}
            <div className="site-spec">
              <b className="num">{t('site.design.riders')}</b>
              <span>{t('site.design.ridersLabel')}</span>
            </div>
          </div>
        )}
      </div>
      {image && <MediaImage media={image} className="site-design-img" />}
    </section>
  );
}

function Pricing({ pricing, tariff }: { pricing: PublicContentSection; tariff: TariffDetailsView | null }) {
  const prices = tariff
    ? [
        { key: 'unlock', value: tariff.unlockFee },
        { key: 'minute', value: tariff.minuteRate },
        { key: 'pause', value: tariff.pauseMinuteRate },
      ]
    : [];
  return (
    <section id="cennik" className="site-section site-pricing">
      <h2 className="site-h2">{pricing.title}</h2>
      <p className="site-lead">
        {pricing.bodyMd && <MarkdownInlineView source={pricing.bodyMd} />}
        {tariff && tariff.freeReservationMinutes > 0 && (
          <> {t('site.pricing.reservation', { minutes: tariff.freeReservationMinutes })}</>
        )}
      </p>
      {prices.length > 0 && (
        <div className="site-prices">
          {prices.map((price) => (
            <div key={price.key} className="site-price">
              <span className="k">{t.dynamic(`site.pricing.${price.key}`)}</span>
              <b className="num">{formatPln(price.value)}</b>
              <span className="d">{t.dynamic(`site.pricing.${price.key}Note`)}</span>
            </div>
          ))}
        </div>
      )}
    </section>
  );
}

/** Znacznik strefy jak na mapie aplikacji (parking, wolna jazda, zakaz); inne ikony z listy rysunkiem. */
function ZoneMark({ icon }: { icon: PublicContentSection['icon'] }) {
  if (icon === 'parking')
    return (
      <span className="site-zone-mark parking" aria-hidden="true">
        {t('site.zones.parkingMark')}
      </span>
    );
  if (icon === 'zone-slow' || icon === 'zone-no-ride')
    return <span className={`site-zone-mark ${icon}`} aria-hidden="true" />;
  return <span className="site-zone-mark">{icon && <ContentIconView icon={icon} />}</span>;
}

/**
 * Ilustracja stref z makiety 14-strona, gdy sekcja nie ma grafiki z biblioteki: rysunek ozdobny bez tekstu
 * (kolory stref jak na mapie aplikacji), więc nie jest treścią do edycji.
 */
function ZonesIllustration() {
  return (
    <svg viewBox="0 0 560 420" width="100%" height="100%" preserveAspectRatio="xMidYMid slice" aria-hidden="true">
      <rect width="560" height="420" fill="#EFEFEC" />
      <rect x="360" y="40" width="150" height="120" rx="18" fill="#E5E8E1" />
      <path d="M-20 300 C 150 260 300 360 580 320" stroke="#DFE3E8" strokeWidth="30" fill="none" />
      <path
        d="M0 70 L560 50 M120 0 L140 420 M0 210 L560 190 M420 0 L440 420 M270 0 L285 420"
        stroke="#FAFAF8"
        strokeWidth="6"
        fill="none"
      />
      <path d="M0 140 L560 112 M200 0 L230 420" stroke="#FFFFFF" strokeWidth="12" fill="none" />
      <path
        d="M300 60 L520 40 L530 200 L310 220 Z"
        fill="#8F5500"
        fillOpacity="0.12"
        stroke="#8F5500"
        strokeWidth="2"
        strokeDasharray="7 5"
      />
      <path
        d="M40 330 L190 320 L196 405 L46 412 Z"
        fill="#C62F2F"
        fillOpacity="0.12"
        stroke="#C62F2F"
        strokeWidth="2"
      />
      <rect
        x="90"
        y="160"
        width="56"
        height="38"
        rx="10"
        fill="#2B3FF5"
        fillOpacity="0.16"
        stroke="#2B3FF5"
        strokeWidth="2"
      />
      <rect
        x="330"
        y="250"
        width="56"
        height="38"
        rx="10"
        fill="#2B3FF5"
        fillOpacity="0.16"
        stroke="#2B3FF5"
        strokeWidth="2"
      />
      <path
        d="M113 186v-14h6a4 4 0 0 1 0 8h-6M353 276v-14h6a4 4 0 0 1 0 8h-6"
        stroke="#2B3FF5"
        strokeWidth="2.5"
        fill="none"
      />
      {[
        [110, 230],
        [240, 90],
        [400, 300],
        [480, 260],
        [60, 120],
        [300, 170],
      ].map(([cx, cy]) => (
        <circle key={`${cx}-${cy}`} cx={cx} cy={cy} r="7" fill="#16181D" stroke="#FFFFFF" strokeWidth="2.5" />
      ))}
    </svg>
  );
}

function Zones({ zones }: { zones: PublicContentSection }) {
  return (
    <section id="strefy" className="site-section white site-zones">
      <div className="site-zones-media">{zones.media ? <MediaImage media={zones.media} /> : <ZonesIllustration />}</div>
      <div className="site-zones-list">
        <h2 className="site-h2 sm">{zones.title}</h2>
        {zones.bodyMd && (
          <p className="site-lead">
            <MarkdownInlineView source={zones.bodyMd} />
          </p>
        )}
        {zones.items.map((item) => (
          <div key={item.id} className="site-zone">
            <ZoneMark icon={item.icon} />
            <div className="site-zone-text">
              <b>{item.title}</b>
              <span>
                <MarkdownInlineView source={item.bodyMd} />
              </span>
            </div>
          </div>
        ))}
      </div>
    </section>
  );
}

function AppSection({ app, stores }: { app: PublicContentSection; stores: PublicContentSection | null }) {
  return (
    <section id="aplikacja" className="site-section site-app">
      <div className="site-app-text">
        <h2 className="site-h2">{app.title}</h2>
        {app.bodyMd && (
          <p className="site-lead">
            <MarkdownInlineView source={app.bodyMd} />
          </p>
        )}
        {stores && <StoreButtons items={stores.items} />}
      </div>
      {app.media && <MediaImage media={app.media} className="site-app-img" />}
    </section>
  );
}

function Faq({ faq, content }: { faq: PublicContentSection; content: PublicContent }) {
  const categories = content.faq.filter((category) => category.items.length > 0);
  return (
    <section id="pytania" className="site-section white site-faq">
      <div>
        <h2 className="site-h2 sm">{faq.title}</h2>
        {faq.bodyMd && (
          <p className="site-lead" style={{ marginTop: 16 }}>
            <MarkdownInlineView source={faq.bodyMd} />
          </p>
        )}
      </div>
      <div>
        {categories.map((category, ci) => (
          <div key={category.id}>
            {categories.length > 1 && <div className="site-faq-cat">{category.name}</div>}
            {category.items.map((item, i) => (
              <details key={item.id} open={ci === 0 && i === 0}>
                <summary>{item.question}</summary>
                <MarkdownView source={item.answerMd} profile="faq" className="site-faq-answer" />
              </details>
            ))}
          </div>
        ))}
      </div>
    </section>
  );
}

/**
 * Strona główna (makieta 14-strona, ADR 0065): sekcje w kolejności z kodu, treść z rejestru sekcji. Sekcja w szkicu
 * albo archiwum nie trafia do `GET /content/web`, więc znika ze strony.
 */
export default async function HomePage() {
  const [content, tariff] = await Promise.all([getContent(), getTariff()]);
  const hero = sectionOf(content, 'web.hero');
  const steps = sectionOf(content, 'web.steps');
  const design = sectionOf(content, 'web.design');
  const pricing = sectionOf(content, 'web.pricing');
  const zones = sectionOf(content, 'web.zones');
  const app = sectionOf(content, 'web.app');
  const stores = sectionOf(content, 'web.stores');
  const faq = sectionOf(content, 'web.faq');
  return (
    <main>
      {hero && <Hero hero={hero} stores={stores} />}
      {steps && <Steps steps={steps} />}
      {design && <Design design={design} content={content} />}
      {pricing && <Pricing pricing={pricing} tariff={tariff} />}
      {zones && <Zones zones={zones} />}
      {app && <AppSection app={app} stores={stores} />}
      {faq && <Faq faq={faq} content={content} />}
    </main>
  );
}
