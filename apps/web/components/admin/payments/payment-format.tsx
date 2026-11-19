'use client';

/**
 * Wspólne elementy modułu Płatności w panelu (iteracja 5, makiety 25-panel-platnosci): zakładki, etykiety
 * kart i kwot, stany płatności i rozliczenia, pola kwot w złotych i czas polski w polach daty.
 */
import {
  formatPln,
  type CardSummary,
  type PaymentSource,
  type PaymentStatus,
  type RefundStatus,
  type RideSettlement,
} from '@hulajnogi/shared';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useEffect, useState } from 'react';
import { api, errorMessage } from '../../../lib/api';
import { t } from '../../../lib/i18n';
import { useSession } from '../../../lib/session';

export const PAYMENTS_BASE = '/admin/platnosci';

/** Zakładki „Płatności” (makiety platnosci-lista, paragony-lista); wszystkie tylko do odczytu (D5). */
export function PaymentsTabs() {
  const pathname = usePathname();
  const tabs = [
    { href: PAYMENTS_BASE, label: t('payments.tabs.payments') },
    { href: `${PAYMENTS_BASE}/ksiega`, label: t('payments.tabs.ledger') },
    { href: `${PAYMENTS_BASE}/portfele`, label: t('payments.tabs.wallets') },
    { href: `${PAYMENTS_BASE}/paragony`, label: t('payments.tabs.receipts') },
    { href: `${PAYMENTS_BASE}/metody`, label: t('payments.tabs.methods') },
    { href: `${PAYMENTS_BASE}/webhooki`, label: t('payments.tabs.webhooks') },
    { href: `${PAYMENTS_BASE}/zwroty`, label: t('payments.tabs.refunds') },
    // Iteracja 8 (ADR 0076): powiązania klientów z operatorem płatności.
    { href: `${PAYMENTS_BASE}/klienci-operatora`, label: t('areas.payments.customers') },
  ];
  // Szczegóły płatności (`/admin/platnosci/{id}`) należą do pierwszej zakładki.
  const active = tabs.slice(1).find((tab) => pathname.startsWith(tab.href))?.href ?? PAYMENTS_BASE;
  return (
    <nav className="tabs" aria-label={t('admin.nav.payments')}>
      {tabs.map((tab) => (
        <Link key={tab.href} href={tab.href} className="tab" aria-current={tab.href === active ? 'page' : undefined}>
          {tab.label}
        </Link>
      ))}
    </nav>
  );
}

/** „visa” → „Visa”; nieznana marka z wielkiej litery. */
export function brandName(brand: string): string {
  const key = `payments.brands.${brand.toLowerCase()}`;
  return t.has(key) ? t.dynamic(key) : brand.charAt(0).toUpperCase() + brand.slice(1);
}

/** „Visa •••• 4242”. */
export const cardLabel = (card: CardSummary) => t('payments.card', { brand: brandName(card.brand), last4: card.last4 });

export function cardOf(brand: string | null, last4: string | null): CardSummary | null {
  return brand && last4 ? { brand, last4 } : null;
}

/** Oznaczenie karty jak w makiecie (VISA, MC). */
export function CardMark({ brand, small }: { brand: string; small?: boolean }) {
  const key = `payments.brandMarks.${brand.toLowerCase()}`;
  const label = t.has(key) ? t.dynamic(key) : brand.slice(0, 4).toUpperCase();
  const light = brand.toLowerCase() !== 'visa';
  return (
    <span className={['cardmark', light && 'light', small && 'sm'].filter(Boolean).join(' ')} aria-hidden="true">
      {label}
    </span>
  );
}

/** Źródło zapłaty: „Portfel” albo karta. */
export function sourceLabel(source: PaymentSource | null, card: CardSummary | null): string {
  if (source === 'CARD') return card ? cardLabel(card) : t('payments.source.CARD');
  if (source === 'WALLET') return t('payments.source.WALLET');
  return t('common.none');
}

/** Kwota ze znakiem: „+10,00 zł”, „−3,80 zł”. */
export function signedPln(amount: number): string {
  if (amount > 0) return `+${formatPln(amount)}`;
  if (amount < 0) return `−${formatPln(-amount)}`;
  return formatPln(0);
}

export const PAYMENT_STATUS_PILL: Record<PaymentStatus, string> = {
  PENDING: 'pill accent',
  SUCCEEDED: 'pill',
  FAILED: 'pill danger',
  REFUNDED: 'pill muted',
};

export const REFUND_STATUS_PILL: Record<RefundStatus, string> = {
  PENDING: 'pill accent',
  SUCCEEDED: 'pill',
  FAILED: 'pill danger',
};

export const SETTLEMENT_PILL: Record<RideSettlement, string> = {
  NONE: 'pill muted',
  WALLET_PAID: 'pill',
  CARD_PENDING: 'pill accent',
  CARD_PAID: 'pill',
  FAILED: 'pill danger',
};

/** Operator płatności: Stripe albo atrapa (ADR 0050). */
export function providerLabel(provider: string): string {
  const key = `payments.providers.${provider}`;
  return t.has(key) ? t.dynamic(key) : provider;
}

// ---------------------------------------------------------------------------------------------
// Pola kwot i dat
// ---------------------------------------------------------------------------------------------

/** Kwota wpisana w złotych („10”, „10,5”, „10.50”) w groszach; `null`, gdy to nie jest kwota. */
export function parseZloty(input: string): number | null {
  const value = input.replace(/\s/g, '').replace(/^\+/, '').replace(',', '.');
  if (!/^\d+(\.\d{0,2})?$/.test(value)) return null;
  return Math.round(Number(value) * 100);
}

/** Grosze jako wartość pola: „10,00”. */
export const zlotyInput = (grosze: number) => (grosze / 100).toFixed(2).replace('.', ',');

/** Przesunięcie strefy Europe/Warsaw w chwili `date`, np. `+01:00`. */
function warsawOffset(date: Date): string {
  const name =
    new Intl.DateTimeFormat('en-US', { timeZone: 'Europe/Warsaw', timeZoneName: 'longOffset' })
      .formatToParts(date)
      .find((p) => p.type === 'timeZoneName')?.value ?? 'GMT';
  return name === 'GMT' ? '+00:00' : name.slice(3);
}

/** Wartość pola `datetime-local` jako czas polski (niezależnie od strefy przeglądarki) w ISO UTC. */
export function warsawLocalToIso(value: string): string | null {
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(value)) return null;
  const guess = new Date(`${value}:00Z`);
  const date = new Date(`${value}:00${warsawOffset(guess)}`);
  // Zmiana czasu między zgadniętym a właściwym przesunięciem: drugie przybliżenie.
  const fixed = new Date(`${value}:00${warsawOffset(date)}`);
  return Number.isNaN(fixed.getTime()) ? null : fixed.toISOString();
}

/** Chwila jako wartość pola `datetime-local` w czasie polskim. */
export function isoToWarsawLocal(iso: string): string {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Europe/Warsaw',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(new Date(iso));
  const get = (type: string) => parts.find((p) => p.type === type)?.value ?? '00';
  return `${get('year')}-${get('month')}-${get('day')}T${get('hour')}:${get('minute')}`;
}

// ---------------------------------------------------------------------------------------------
// Wczytywanie szczegółów
// ---------------------------------------------------------------------------------------------

/** Szczegóły z API z odświeżeniem po `revision`; błąd jako komunikat dla operatora. */
export function useApiRecord<T>(path: string | null, revision = 0) {
  const [state, setState] = useState<{ data: T | null; error: string | null }>({ data: null, error: null });
  useEffect(() => {
    if (!path) return;
    const controller = new AbortController();
    api<T>(path, { signal: controller.signal })
      .then((data) => setState({ data, error: null }))
      .catch((e: unknown) => {
        if ((e as Error).name !== 'AbortError') setState((s) => ({ ...s, error: errorMessage(e) }));
      });
    return () => controller.abort();
  }, [path, revision]);
  return { ...state, setData: (data: T) => setState({ data, error: null }) };
}

/** Odnośnik do karty klienta, gdy operator ma `users.read`; inaczej sam tekst. */
export function CustomerLink({ id, name, tab }: { id: string; name: string; tab?: 'portfel' }) {
  const { can } = useSession();
  if (!can('users.read')) return <>{name}</>;
  return (
    <Link className="link" href={`/admin/klienci/${id}${tab ? `/${tab}` : ''}`}>
      {name}
    </Link>
  );
}
