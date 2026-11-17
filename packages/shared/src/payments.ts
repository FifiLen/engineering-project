/**
 * Kontrakt płatności między aplikacją a API (iteracja 5, ADR 0049–0052). Wartości wyliczeń są kopią
 * z packages/core; zgodność pilnuje test API.
 */
import { z } from 'zod';

export const PAYMENT_SOURCES = ['WALLET', 'CARD'] as const;
export type PaymentSource = (typeof PAYMENT_SOURCES)[number];

export const PAYMENT_STATUSES = ['PENDING', 'SUCCEEDED', 'FAILED', 'REFUNDED'] as const;
export type PaymentStatus = (typeof PAYMENT_STATUSES)[number];

export const PAYMENT_PURPOSES = ['TOPUP', 'RIDE'] as const;
export type PaymentPurpose = (typeof PAYMENT_PURPOSES)[number];

/** Karta zapisana u operatora albo BLIK jednorazowo (kod przy każdej płatności). */
export const PAYMENT_METHOD_KINDS = ['CARD', 'BLIK'] as const;
export type PaymentMethodKind = (typeof PAYMENT_METHOD_KINDS)[number];

/** Stan rozliczenia przejazdu (ADR 0049). */
export const RIDE_SETTLEMENTS = ['NONE', 'WALLET_PAID', 'CARD_PENDING', 'CARD_PAID', 'FAILED'] as const;
export type RideSettlement = (typeof RIDE_SETTLEMENTS)[number];

export const LEDGER_ENTRY_TYPES = ['TOPUP', 'RIDE_CHARGE', 'REFUND', 'ADJUSTMENT', 'PAYOUT'] as const;
export type LedgerEntryType = (typeof LEDGER_ENTRY_TYPES)[number];

export const ADJUSTMENT_REASONS = ['COMPLAINT', 'SYSTEM_ERROR', 'GOODWILL', 'OTHER'] as const;
export type AdjustmentReason = (typeof ADJUSTMENT_REASONS)[number];

export const REFUND_REASONS = ['SCOOTER_FAILURE', 'BILLING_ERROR', 'CUSTOMER_COMPLAINT', 'OTHER'] as const;
export type RefundReason = (typeof REFUND_REASONS)[number];
/** Powód zwrotu w bazie: zwrot za przejazd albo zwrot salda na kartę. */
export type RefundReasonCode = RefundReason | 'BALANCE_PAYOUT';

export const CARD_STATES = ['ACTIVE', 'EXPIRING', 'EXPIRED', 'REMOVED'] as const;
export type CardState = (typeof CARD_STATES)[number];

export const RECEIPT_KINDS = ['SALE', 'CORRECTION'] as const;
export type ReceiptKind = (typeof RECEIPT_KINDS)[number];

/** Kody pozycji paragonu; tekst pozycji z plików tłumaczeń (`receipt.items.<kod>`). */
export const RECEIPT_ITEM_CODES = ['UNLOCK', 'RIDE_MINUTES', 'PAUSE_MINUTES', 'REFUND'] as const;
export type ReceiptItemCode = (typeof RECEIPT_ITEM_CODES)[number];

/** Doładowanie (pytanie 3): kwoty z makiety i kwota własna w pełnych złotych (grosze). */
export const TOPUP_PRESETS = [2000, 5000, 10000] as const;
export const TOPUP_MIN = 1000;
export const TOPUP_MAX = 50000;

export type PaymentProviderName = 'fake' | 'stripe';

/** Konfiguracja płatności dla klienta: operator i klucz publiczny bez przebudowy aplikacji (ADR 0051). */
export interface PaymentsConfig {
  provider: PaymentProviderName;
  /** Klucz publiczny Stripe (`pk_test_…`); `null` przy atrapie. */
  publishableKey: string | null;
  blik: boolean;
  currency: 'PLN';
  topup: { presets: number[]; min: number; max: number };
}

export interface CardSummary {
  brand: string;
  last4: string;
}

// --- Metody płatności ------------------------------------------------------------------------

export interface PaymentMethodView extends CardSummary {
  id: string;
  expMonth: number;
  expYear: number;
  isDefault: boolean;
  state: CardState;
  createdAt: string;
}

/** SetupIntent: aplikacja potwierdza kartę u operatora, numer karty nie przechodzi przez API (D3). */
export interface SetupIntentResponse {
  setupIntentId: string;
  clientSecret: string;
  provider: PaymentProviderName;
}

// --- Płatności ---------------------------------------------------------------------------------

export const topupSchema = z.object({
  amount: z.number().int(),
  method: z.enum(PAYMENT_METHOD_KINDS),
  /** Karta przy `CARD`; bez niej karta domyślna. */
  paymentMethodId: z.uuid().nullable().default(null),
});
export type TopupRequest = z.infer<typeof topupSchema>;

/** Płatność z udziałem klienta (doładowanie, spłata kartą): potwierdzenie w aplikacji (karta, 3-D Secure, BLIK). */
export interface PaymentIntentResponse {
  paymentId: string;
  status: PaymentStatus;
  clientSecret: string | null;
  provider: PaymentProviderName;
  /** Karta, którą potwierdza się płatność (`CARD`); przy BLIK-u `null`. */
  providerPaymentMethodId: string | null;
}

export interface PaymentView {
  id: string;
  purpose: PaymentPurpose;
  method: PaymentMethodKind;
  amount: number;
  status: PaymentStatus;
  failureCode: string | null;
  failureReason: string | null;
  rentalId: string | null;
  createdAt: string;
  updatedAt: string;
}

// --- Portfel -----------------------------------------------------------------------------------

/** Zaległość: przejazd `UNPAID` po odmowie obciążenia karty (mapa, spłata). */
export interface OverdueRental {
  rentalId: string;
  number: number;
  amount: number;
  endedAt: string | null;
  failureCode: string | null;
  failureReason: string | null;
  card: CardSummary | null;
  failedAttempts: number;
  /** Termin automatycznego ponowienia po pierwszej odmowie (pytanie 6); `null`, gdy nie będzie ponowienia. */
  retryAt: string | null;
  paymentPending: boolean;
}

/** Saldo i zaległości; to samo w `GET /me/wallet` i w zdarzeniu `wallet.updated`. */
export interface WalletSummary {
  balance: number;
  /** Minimalne saldo do jazdy z portfela z obowiązującej wersji cennika. */
  minWalletBalance: number;
  overdue: OverdueRental[];
  asOf: string;
}

/** Wpis historii portfela; etykieta powodu korekty jest widoczna, notatka operatora nie (ADR 0054). */
export interface WalletEntry {
  id: number;
  createdAt: string;
  type: LedgerEntryType;
  amount: number;
  balanceAfter: number;
  rentalId: string | null;
  rentalNumber: number | null;
  paymentMethod: PaymentMethodKind | null;
  card: CardSummary | null;
  reason: AdjustmentReason | null;
  refundReason: RefundReasonCode | null;
  receiptId: string | null;
}

export interface WalletView extends WalletSummary {
  entries: WalletEntry[];
}

export const walletHistoryQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(100).default(30),
  /** Wpisy starsze niż podany identyfikator (kolejna strona). */
  before: z.coerce.number().int().positive().optional(),
});
export type WalletHistoryQuery = z.infer<typeof walletHistoryQuerySchema>;

// --- Przejazd ----------------------------------------------------------------------------------

export const payDebtSchema = z.object({
  source: z.enum(PAYMENT_SOURCES),
  paymentMethodId: z.uuid().nullable().default(null),
});
export type PayDebtRequest = z.infer<typeof payDebtSchema>;

/** Rozliczenie przejazdu w widoku klienta i panelu. */
export interface RentalSettlementView {
  state: RideSettlement;
  source: PaymentSource;
  card: CardSummary | null;
  /** Zapłacona kwota (obciążenie portfela albo udana płatność kartą). */
  paidAmount: number;
  refundedAmount: number;
  receiptId: string | null;
  receiptNumber: string | null;
  /** Ostatnia płatność kartą za przejazd (w toku, udana albo odrzucona). */
  paymentId: string | null;
  failureCode: string | null;
  failureReason: string | null;
}

// --- Paragony ----------------------------------------------------------------------------------

export interface ReceiptSummary {
  id: string;
  number: string;
  kind: ReceiptKind;
  issuedAt: string;
  rentalId: string | null;
  rentalNumber: number | null;
  totalAmount: number;
  paymentSource: PaymentSource | null;
  card: CardSummary | null;
}

export interface ReceiptItemView {
  lineNo: number;
  description: ReceiptItemCode;
  quantity: number;
  unitPrice: number;
  vatRate: number;
  amount: number;
}

export interface ReceiptParty {
  name: string | null;
  address?: string | null;
  taxId?: string | null;
  phone?: string | null;
}

export interface ReceiptView extends ReceiptSummary {
  items: ReceiptItemView[];
  vatRate: number | null;
  vatAmount: number;
  netAmount: number;
  seller: ReceiptParty;
  buyer: ReceiptParty;
  correctsReceiptId: string | null;
  correctsNumber: string | null;
  /** Korekty paragonu sprzedaży po zwrotach (ADR 0052). */
  corrections: ReceiptSummary[];
}

export const receiptsQuerySchema = z.object({ limit: z.coerce.number().int().min(1).max(100).default(30) });

// --- Cennik ------------------------------------------------------------------------------------

/** Obowiązująca wersja cennika w aplikacji (`GET /tariff`, ekran `platnosci-cennik`). */
export interface TariffDetailsView {
  id: string;
  version: number;
  unlockFee: number;
  minuteRate: number;
  pauseMinuteRate: number;
  freeReservationMinutes: number;
  /** Opłata za odholowanie przez serwis (pytanie 7). */
  outOfZoneFee: number;
  minWalletBalance: number;
  minBatteryPct: number;
  minUserAge: number;
  vatRate: number;
  validFrom: string;
}

// --- Atrapa operatora (ADR 0050, ADR 0051) -----------------------------------------------------

/** Formularz karty atrapy: tylko numery kart testowych, tylko przy `provider: 'fake'`. */
export const fakeSetupConfirmSchema = z.object({
  clientSecret: z.string().min(1),
  cardNumber: z.string().regex(/^\d{16}$/),
  expMonth: z.number().int().min(1).max(12),
  expYear: z.number().int().min(2000).max(2099),
  cvc: z.string().regex(/^\d{3}$/),
});
export type FakeSetupConfirm = z.infer<typeof fakeSetupConfirmSchema>;

export const fakePaymentConfirmSchema = z.object({
  clientSecret: z.string().min(1),
  blikCode: z
    .string()
    .regex(/^\d{6}$/)
    .optional(),
});
export type FakePaymentConfirm = z.infer<typeof fakePaymentConfirmSchema>;

/** Potwierdzenie 3-D Secure w atrapie (akceptacja albo odrzucenie w oknie banku). */
export const fakeAuthenticateSchema = z.object({ clientSecret: z.string().min(1), approve: z.boolean() });
export type FakeAuthenticate = z.infer<typeof fakeAuthenticateSchema>;

export interface FakeConfirmResult {
  status: 'succeeded' | 'processing' | 'requires_action' | 'failed';
  failureCode: string | null;
}
