/**
 * Nagłówek, stopka i komunikat strony promocyjnej (makiety 14-strona i 30-strona-tresci). Nawigacja i etykiety są
 * w pliku tłumaczeń, a treść stopki, dane firmy, komunikat i przyciski sklepów pochodzą z bazy (ADR 0065).
 */
import { isAllowedHref, type CompanyPublicView, type PublicContent, type PublicContentItem } from '@hulajnogi/shared';
import Link from 'next/link';
import { t } from '../../lib/i18n';
import { MarkdownInlineView } from '../markdown-view';
import { SiteNav } from './site-nav';

/** Dokumenty prawne strony (slugi `content_pages` z danych startowych, ADR 0065). */
export const LEGAL_PAGES = [
  { slug: 'regulamin', label: () => t('site.documents.regulamin') },
  { slug: 'polityka-prywatnosci', label: () => t('site.documents.polityka-prywatnosci') },
  { slug: 'zasady-jazdy', label: () => t('site.documents.zasady-jazdy') },
  { slug: 'polityka-cookies', label: () => t('site.documents.polityka-cookies') },
] as const;

export const isLegalSlug = (slug: string) => LEGAL_PAGES.some((page) => page.slug === slug);

export function BrandLogo({ size = 34 }: { size?: number }) {
  return (
    <span className="site-logo" style={{ width: size, height: size }}>
      <svg
        width={Math.round(size * 0.79)}
        height={Math.round(size * 0.79)}
        viewBox="0 0 1024 1024"
        fill="none"
        stroke="#FFFFFF"
        strokeWidth="72"
        strokeLinecap="round"
        strokeLinejoin="round"
        aria-hidden="true"
      >
        <circle cx="314" cy="668" r="88" />
        <circle cx="710" cy="668" r="88" />
        <path d="M402 668 H622M710 668 L614 268M534 268 H684" />
      </svg>
    </span>
  );
}

function MenuIcon() {
  return (
    <svg
      width="24"
      height="24"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      aria-hidden="true"
    >
      <path d="M8 6h13M8 12h13M8 18h13M3.5 6h.01M3.5 12h.01M3.5 18h.01" />
    </svg>
  );
}

export function SiteHeader() {
  return (
    <header className="site-header">
      <Link href="/" className="site-brand">
        <BrandLogo />
        <span>{t('site.brand')}</span>
      </Link>
      <SiteNav className="site-nav" />
      <Link href="/#aplikacja" className="site-cta">
        {t('site.download')}
      </Link>
      {/* Telefon: menu bez skryptu (`details`), jak na planszach w wersji 390 px. */}
      <details className="site-menu">
        <summary aria-label={t('site.nav.menu')}>
          <MenuIcon />
        </summary>
        <div className="site-menu-panel">
          <SiteNav className="site-menu-nav" />
          <Link href="/#aplikacja" className="site-cta">
            {t('site.download')}
          </Link>
        </div>
      </details>
    </header>
  );
}

/** Komunikat nad stroną (`web.notice`, sekcja opcjonalna). */
export function SiteNotice({ content }: { content: PublicContent | null }) {
  const notice = content?.sections['web.notice'];
  if (!notice?.bodyMd) return null;
  return (
    <div className="site-notice" role="note">
      <span>
        <MarkdownInlineView source={notice.bodyMd} />
      </span>
      {notice.buttonHref && notice.buttonLabel && isAllowedHref(notice.buttonHref) && (
        <Link href={notice.buttonHref}>{notice.buttonLabel}</Link>
      )}
    </div>
  );
}

function AppleIcon() {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
      <path d="M16.4 12.6c0-2.4 2-3.6 2.1-3.7-1.2-1.7-3-1.9-3.6-2-1.5-.2-3 .9-3.8.9-.8 0-2-.9-3.3-.9-1.7 0-3.3 1-4.2 2.5-1.8 3.1-.5 7.7 1.3 10.2.9 1.2 1.9 2.6 3.2 2.6 1.3-.1 1.8-.8 3.3-.8 1.6 0 2 .8 3.4.8 1.4 0 2.3-1.3 3.1-2.5 1-1.4 1.4-2.8 1.4-2.9 0 0-2.9-1.1-2.9-4.2ZM13.9 5.1c.7-.8 1.2-2 1-3.1-1 0-2.2.7-2.9 1.5-.6.7-1.2 1.9-1 3 1.1.1 2.2-.6 2.9-1.4Z" />
    </svg>
  );
}

function PlayIcon() {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
      <path d="M5 3.5v17a1 1 0 0 0 1.5.9l14.2-8.5a1 1 0 0 0 0-1.8L6.5 2.6A1 1 0 0 0 5 3.5Z" />
    </svg>
  );
}

/**
 * Przyciski sklepów z sekcji-listy `web.stores`: nazwa sklepu to tytuł elementu, a pełny podpis przycisku jest etykietą
 * dostępności. Ikona po adresie (App Store albo Google Play), inne sklepy bez ikony.
 */
export function StoreButtons({ items, className = 'site-stores' }: { items: PublicContentItem[]; className?: string }) {
  if (!items.length) return null;
  return (
    <div className={className}>
      {items.map((item) =>
        // Adres sprawdzony ponownie przy renderowaniu (ADR 0063): wiersz sprzed CHECK z migracji 0012 albo
        // `/\host` z dawnego wzorca nie trafi do przycisku.
        item.buttonHref && isAllowedHref(item.buttonHref) ? (
          <a
            key={item.id}
            href={item.buttonHref}
            className="site-store"
            aria-label={item.buttonLabel ?? item.title ?? undefined}
            {...(item.buttonHref.startsWith('https:') ? { target: '_blank', rel: 'noopener noreferrer' } : {})}
          >
            {item.buttonHref.includes('apple.com') ? (
              <AppleIcon />
            ) : item.buttonHref.includes('google.com') ? (
              <PlayIcon />
            ) : null}
            <span className="site-store-text">
              <span className="s1">{t('site.storePrefix')}</span>
              <span className="s2">{item.title}</span>
            </span>
          </a>
        ) : null,
      )}
    </div>
  );
}

const capital = new Intl.NumberFormat('pl-PL', { style: 'currency', currency: 'PLN', maximumFractionDigits: 0 });

/** Dane rejestrowe w stopce: KRS, sąd i kapitał tylko, gdy są wypełnione (ADR 0062, art. 206 § 1 KSH). */
function CompanyLines({ company }: { company: CompanyPublicView }) {
  return (
    <span className="site-company">
      {company.name && <span>{company.name}</span>}
      {company.street && (
        <span>
          {t('site.footer.address', { street: company.street, postalCode: company.postalCode, city: company.city })}
        </span>
      )}
      {company.taxId && <span>{t('site.footer.taxId', { taxId: company.taxId })}</span>}
      {company.regon && <span>{t('site.footer.regon', { regon: company.regon })}</span>}
      {company.krs && (
        <span>
          {t('site.footer.krs', { krs: company.krs, court: company.registryCourt ?? '' })}
          {company.shareCapitalGrosze !== null &&
            ` · ${t('site.footer.capital', { amount: capital.format(company.shareCapitalGrosze / 100) })}`}
        </span>
      )}
    </span>
  );
}

export function SiteFooter({ content }: { content: PublicContent | null }) {
  const company = content?.company ?? null;
  const footer = content?.sections['web.footer'];
  return (
    <footer className="site-footer">
      <div className="site-footer-cols">
        <div className="site-footer-col brand">
          <Link href="/" className="site-brand on-dark">
            <BrandLogo size={32} />
            <span>{t('site.brand')}</span>
          </Link>
          {footer?.bodyMd && (
            <span className="site-footer-lead">
              <MarkdownInlineView source={footer.bodyMd} />
            </span>
          )}
          {company && <CompanyLines company={company} />}
        </div>
        <div className="site-footer-col">
          <b>{t('site.footer.service')}</b>
          <Link href="/#jak-to-dziala">{t('site.nav.how')}</Link>
          <Link href="/#cennik">{t('site.nav.pricing')}</Link>
          <Link href="/#strefy">{t('site.footer.zones')}</Link>
          <Link href="/aktualnosci">{t('site.nav.news')}</Link>
          <Link href="/#aplikacja">{t('site.download')}</Link>
        </div>
        <div className="site-footer-col">
          <b>{t('site.footer.help')}</b>
          <Link href="/#pytania">{t('site.nav.faq')}</Link>
          {company?.supportPhone && (
            <a href={`tel:${company.supportPhone.replace(/[^\d+]/g, '')}`}>{company.supportPhone}</a>
          )}
          {company?.supportEmail && <a href={`mailto:${company.supportEmail}`}>{company.supportEmail}</a>}
          {company?.supportHours && <span>{company.supportHours}</span>}
        </div>
        <div className="site-footer-col">
          <b>{t('site.footer.documents')}</b>
          {LEGAL_PAGES.map((page) => (
            <Link key={page.slug} href={`/${page.slug}`}>
              {page.label()}
            </Link>
          ))}
        </div>
      </div>
      <div className="site-footer-bar">
        <span>{t('site.footer.copyright', { year: new Date().getFullYear(), brand: t('site.brand') })}</span>
        <span>{t('site.footer.note')}</span>
      </div>
    </footer>
  );
}
