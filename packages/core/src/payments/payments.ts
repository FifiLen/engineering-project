import { DomainError } from '../errors.js';

/** Status płatności u operatora (`payment_status`); zmiany są monotoniczne (ADR 0050). */
export const PAYMENT_STATUSES = ['PENDING', 'SUCCEEDED', 'FAILED', 'REFUNDED'] as const;
export type PaymentStatus = (typeof PAYMENT_STATUSES)[number];

export const PAYMENT_SOURCES = ['WALLET', 'CARD'] as const;
export type PaymentSource = (typeof PAYMENT_SOURCES)[number];

/** Stan rozliczenia przejazdu liczony przez widok z księgi i płatności (ADR 0049). */
export const RIDE_SETTLEMENTS = ['NONE', 'WALLET_PAID', 'CARD_PENDING', 'CARD_PAID', 'FAILED'] as const;
export type RideSettlement = (typeof RIDE_SETTLEMENTS)[number];

/** Doładowanie (pytanie 3): kwoty z makiety i kwota własna w pełnych złotych od 10 do 500 zł. */
export const TOPUP_PRESETS = [2000, 5000, 10000] as const;
export const TOPUP_MIN = 1000;
export const TOPUP_MAX = 50000;

/** Jedno automatyczne ponowienie obciążenia karty po odmowie (pytanie 6). */
export const RIDE_CHARGE_RETRY_MS = 24 * 3600_000;

/** Płatność bez wyniku po tym czasie: sprawdzenie statusu u operatora (`payments.reconcile`, ADR 0050). */
export const PAYMENT_RECONCILE_AFTER_MS = 2 * 60_000;

export function ensureTopupAmount(amount: number): void {
  if (!Number.isInteger(amount) || amount % 100 !== 0 || amount < TOPUP_MIN || amount > TOPUP_MAX) {
    throw new DomainError('TOPUP_AMOUNT_INVALID', { min: TOPUP_MIN, max: TOPUP_MAX });
  }
}

/** Zapisana karta (`payment_methods`); ważna do końca miesiąca `expMonth/expYear`. */
export interface SavedCard {
  id: string;
  expMonth: number;
  expYear: number;
  removedAt: Date | null;
}

export type CardState = 'ACTIVE' | 'EXPIRING' | 'EXPIRED' | 'REMOVED';

/** Rok i miesiąc w strefie operatora (Polska): karta wygasa z końcem miesiąca ważności. */
function localMonth(now: Date): number {
  const parts = new Intl.DateTimeFormat('en-GB', { timeZone: 'Europe/Warsaw', year: 'numeric', month: 'numeric' })
    .formatToParts(now)
    .reduce<Record<string, string>>((acc, p) => ({ ...acc, [p.type]: p.value }), {});
  return Number(parts.year) * 12 + Number(parts.month) - 1;
}

/** „Wygasa”: ważność kończy się w bieżącym albo następnym miesiącu (makieta `metody-platnosci`). */
export function cardState(card: SavedCard, now: Date): CardState {
  if (card.removedAt) return 'REMOVED';
  const expires = card.expYear * 12 + card.expMonth - 1;
  const current = localMonth(now);
  if (expires < current) return 'EXPIRED';
  return expires <= current + 1 ? 'EXPIRING' : 'ACTIVE';
}

export const isCardUsable = (card: SavedCard | null, now: Date): card is SavedCard =>
  card !== null && ['ACTIVE', 'EXPIRING'].includes(cardState(card, now));

export interface PaymentCheck {
  source: PaymentSource;
  /** Saldo z księgi odczytane pod blokadą portfela. */
  balance: number;
  minWalletBalance: number;
  /** Przejazdy klienta w stanie `UNPAID`. */
  overdueRentalIds: readonly string[];
  /** Karta wybrana przez klienta albo domyślna; `null`, gdy klient nie ma karty. */
  card: SavedCard | null;
  now: Date;
}

/**
 * Reguła rezerwacji i startu (ADR 0049, pytania 2, 4, 5, 6): zaległość i ujemne saldo blokują także jazdę
 * kartą, minimalne saldo dotyczy tylko portfela, a jazda kartą wymaga ważnej zapisanej karty.
 */
export function ensureCanPay(check: PaymentCheck): void {
  if (check.overdueRentalIds.length) {
    throw new DomainError('PAYMENT_OVERDUE', { rentalIds: [...check.overdueRentalIds] });
  }
  const cardAvailable = isCardUsable(check.card, check.now);
  if (check.balance < 0) {
    throw new DomainError('INSUFFICIENT_BALANCE', {
      reason: 'NEGATIVE_BALANCE',
      balance: check.balance,
      minimum: check.minWalletBalance,
      cardAvailable,
    });
  }
  if (check.source === 'WALLET' && check.balance < check.minWalletBalance) {
    throw new DomainError('INSUFFICIENT_BALANCE', {
      reason: 'BELOW_MINIMUM',
      balance: check.balance,
      minimum: check.minWalletBalance,
      cardAvailable,
    });
  }
  if (check.source === 'CARD' && !cardAvailable) throw new DomainError('PAYMENT_METHOD_REQUIRED');
}

/**
 * Przejście statusu płatności po wyniku od operatora; `null`, gdy nic się nie zmienia (powtórzone albo
 * spóźnione zdarzenie). Kolejność zdarzeń nie ma znaczenia, bo status nie wraca do wcześniejszego.
 */
export function nextPaymentStatus(current: PaymentStatus, incoming: PaymentStatus): PaymentStatus | null {
  if (current === 'PENDING' && (incoming === 'SUCCEEDED' || incoming === 'FAILED')) return incoming;
  if (current === 'SUCCEEDED' && incoming === 'REFUNDED') return incoming;
  return null;
}

export type RideCharge = { kind: 'NONE' } | { kind: 'WALLET'; amount: number } | { kind: 'CARD'; amount: number };

/** Rozliczenie przy `ENDED` (D4): portfel w tej samej transakcji, karta zadaniem; kwota 0 bez obciążenia. */
export function rideCharge(total: number, source: PaymentSource): RideCharge {
  if (total <= 0) return { kind: 'NONE' };
  return source === 'CARD' ? { kind: 'CARD', amount: total } : { kind: 'WALLET', amount: total };
}

/**
 * Wpisy księgi za przejazd opłacony z portfela (ADR 0060): wycena przejazdu jako `RIDE_CHARGE` i opłata za
 * odholowanie jako osobny `TOWING_FEE` w tej samej transakcji; karta dostaje jedną płatność na sumę. Kwoty
 * dodatnie (obciążenie zapisuje się ze znakiem minus); pozycja 0 zł nie daje wpisu.
 */
export function rideWalletEntries(
  total: number,
  towingFee: number | null,
): Array<{ type: 'RIDE_CHARGE' | 'TOWING_FEE'; amount: number }> {
  const fee = Math.min(Math.max(towingFee ?? 0, 0), Math.max(total, 0));
  const ride = Math.max(total, 0) - fee;
  return [
    ...(ride > 0 ? [{ type: 'RIDE_CHARGE' as const, amount: ride }] : []),
    ...(fee > 0 ? [{ type: 'TOWING_FEE' as const, amount: fee }] : []),
  ];
}

/** Automatyczne ponowienie tylko po pierwszej odmowie (pytanie 6). */
export const shouldRetryRideCharge = (failedAttempts: number): boolean => failedAttempts === 1;

export interface DebtPaymentCheck {
  source: PaymentSource;
  amount: number;
  balance: number;
  card: SavedCard | null;
  /** Płatność za ten przejazd czeka na wynik (zadanie, ponowienie albo wcześniejsza spłata). */
  paymentPending: boolean;
  now: Date;
}

/** Spłata zaległości (ADR 0049): z portfela tylko całą kwotą, kartą tylko ważną kartą. */
export function ensureCanPayDebt(check: DebtPaymentCheck): void {
  if (check.paymentPending) throw new DomainError('PAYMENT_IN_PROGRESS');
  if (check.source === 'WALLET' && check.balance < check.amount) {
    throw new DomainError('INSUFFICIENT_BALANCE', {
      reason: 'DEBT_NOT_COVERED',
      balance: check.balance,
      minimum: check.amount,
      cardAvailable: isCardUsable(check.card, check.now),
    });
  }
  if (check.source === 'CARD' && !isCardUsable(check.card, check.now)) {
    throw new DomainError('PAYMENT_METHOD_REQUIRED');
  }
}
