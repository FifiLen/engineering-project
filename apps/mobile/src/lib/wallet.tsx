/**
 * Portfel klienta (ADR 0049, D8): saldo, minimalne saldo i zaległości z `GET /me/wallet`, zapisane karty
 * z `GET /me/payment-methods`. Zmiany na żywo przez Socket.IO (`wallet.updated` w pokoju klienta;
 * gniazdo jest w `rental.tsx`): po doładowaniu, obciążeniu, spłacie, zwrocie, korekcie i zapisie karty.
 */
import type { CardSummary, PaymentMethodView, WalletSummary, WalletView } from '@hulajnogi/shared';
import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import { t } from '../i18n';
import { ApiError, api } from './api';
import { useSession } from './session';

type Listener = (summary: WalletSummary | null) => void;
const listeners = new Set<Listener>();

/** Wywołuje gniazdo po `wallet.updated` (z saldem) i po ponownym połączeniu (`null`: pobierz od nowa). */
export function notifyWalletUpdated(summary: WalletSummary | null): void {
  for (const listener of listeners) listener(summary);
}

/** Ekran reaguje na zmianę w portfelu (oczekiwanie na płatność, dodanie karty). */
export function useWalletEvents(listener: Listener): void {
  useEffect(() => {
    listeners.add(listener);
    return () => {
      listeners.delete(listener);
    };
  }, [listener]);
}

interface WalletValue {
  summary: WalletSummary | null;
  cards: PaymentMethodView[] | null;
  refresh(): Promise<void>;
  setCards(cards: PaymentMethodView[]): void;
}

const WalletContext = createContext<WalletValue | null>(null);

export function useWallet(): WalletValue {
  const value = useContext(WalletContext);
  if (!value) throw new Error('useWallet poza WalletProvider');
  return value;
}

/** Stan portfela należy do zalogowanego klienta (jak przejazd w `RentalProvider`). */
export function WalletProvider({ children }: { children: ReactNode }) {
  const { status, me } = useSession();
  const enabled = status === 'signedIn' && !!me && me.nextStep !== 'PROFILE' && me.nextStep !== 'BLOCKED';
  return (
    <WalletState key={enabled ? me!.id : 'off'} enabled={enabled}>
      {children}
    </WalletState>
  );
}

function WalletState({ enabled, children }: { enabled: boolean; children: ReactNode }) {
  const [summary, setSummary] = useState<WalletSummary | null>(null);
  const [cards, setCards] = useState<PaymentMethodView[] | null>(null);

  const apply = useCallback((next: WalletSummary) => {
    setSummary((previous) => (previous && Date.parse(next.asOf) < Date.parse(previous.asOf) ? previous : next));
  }, []);

  const loadCards = useCallback(
    () =>
      api<PaymentMethodView[]>('/me/payment-methods')
        .then(setCards)
        .catch(() => undefined),
    [],
  );

  const refresh = useCallback(async () => {
    await Promise.all([
      api<WalletView>('/me/wallet?limit=1')
        .then(({ entries: _entries, ...rest }) => apply(rest))
        .catch((e: unknown) => {
          if (!(e instanceof ApiError)) throw e;
        }),
      loadCards(),
    ]);
  }, [apply, loadCards]);

  useEffect(() => {
    if (enabled) void refresh();
  }, [enabled, refresh]);

  const onEvent = useCallback(
    (next: WalletSummary | null) => {
      if (!enabled) return;
      if (next) {
        apply(next);
        void loadCards();
      } else void refresh();
    },
    [enabled, apply, loadCards, refresh],
  );
  useWalletEvents(onEvent);

  const value = useMemo<WalletValue>(() => ({ summary, cards, refresh, setCards }), [summary, cards, refresh]);
  return <WalletContext.Provider value={value}>{children}</WalletContext.Provider>;
}

// --- Karty ---------------------------------------------------------------------------------------

/** Karta, którą można płacić (wygasła nie). */
export const isUsable = (card: PaymentMethodView): boolean => card.state === 'ACTIVE' || card.state === 'EXPIRING';

export const usableCards = (cards: PaymentMethodView[] | null): PaymentMethodView[] => (cards ?? []).filter(isUsable);

/** Karta domyślna, a gdy jej nie ma albo wygasła, pierwsza ważna. */
export function preferredCard(cards: PaymentMethodView[] | null): PaymentMethodView | null {
  const usable = usableCards(cards);
  return usable.find((c) => c.isDefault) ?? usable[0] ?? null;
}

/** „Karta •••• 4242”. */
export const cardTitle = (card: CardSummary): string => t('payment.card.title', { last4: card.last4 });

/** „Visa”, „Mastercard”; nieznana marka jako „Karta”. */
export const brandName = (brand: string): string =>
  t.has(`payment.brands.${brand}`) ? t.dynamic(`payment.brands.${brand}`) : t('payment.brands.other');

/** „08/28”. */
export const expiryText = (card: PaymentMethodView): string =>
  `${card.expMonth.toString().padStart(2, '0')}/${(card.expYear % 100).toString().padStart(2, '0')}`;

// --- Blokady startu (ADR 0049) -------------------------------------------------------------------

/** Przyczyna odrzucenia rezerwacji albo startu przez regułę płatności. */
export type PaymentBlock =
  | { kind: 'below'; balance: number; minimum: number; cardAvailable: boolean }
  | { kind: 'negative'; balance: number }
  | { kind: 'overdue'; rentalId: string | null }
  | { kind: 'cardRequired' };

export function paymentBlock(error: unknown): PaymentBlock | null {
  if (!(error instanceof ApiError)) return null;
  const d = error.details ?? {};
  if (error.code === 'INSUFFICIENT_BALANCE') {
    const balance = typeof d.balance === 'number' ? d.balance : 0;
    if (d.reason === 'NEGATIVE_BALANCE') return { kind: 'negative', balance };
    return {
      kind: 'below',
      balance,
      minimum: typeof d.minimum === 'number' ? d.minimum : 0,
      cardAvailable: d.cardAvailable === true,
    };
  }
  if (error.code === 'PAYMENT_OVERDUE') {
    const ids = Array.isArray(d.rentalIds) ? (d.rentalIds as unknown[]) : [];
    return { kind: 'overdue', rentalId: typeof ids[0] === 'string' ? ids[0] : null };
  }
  if (error.code === 'PAYMENT_METHOD_REQUIRED') return { kind: 'cardRequired' };
  return null;
}
