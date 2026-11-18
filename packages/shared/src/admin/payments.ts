/**
 * Zasoby panelu modułu Płatności (iteracja 5, ADR 0031, ADR 0053, ADR 0054): cennik z wersjami,
 * płatności, księga, portfele, paragony, metody płatności, webhooki i zwroty tylko do odczytu (D5);
 * zwrot, korekta i zwrot salda jako polecenia z dziennikiem audytu.
 */
import { z } from 'zod';
import {
  ADJUSTMENT_REASONS,
  CARD_STATES,
  LEDGER_ENTRY_TYPES,
  PAYMENT_METHOD_KINDS,
  PAYMENT_PURPOSES,
  PAYMENT_SOURCES,
  PAYMENT_STATUSES,
  RECEIPT_KINDS,
  REFUND_REASONS,
  type AdjustmentReason,
  type CardState,
  type LedgerEntryType,
  type OverdueRental,
  type PaymentMethodKind,
  type PaymentPurpose,
  type PaymentSource,
  type PaymentStatus,
  type ReceiptKind,
  type ReceiptView,
  type RefundReasonCode,
} from '../payments.js';
import type { ResourceDefinition } from './list.js';

export const TARIFF_STATES = ['CURRENT', 'SCHEDULED', 'ARCHIVED'] as const;
export type TariffState = (typeof TARIFF_STATES)[number];

export const REFUND_STATUSES = ['PENDING', 'SUCCEEDED', 'FAILED'] as const;
export type RefundStatus = (typeof REFUND_STATUSES)[number];

export const WEBHOOK_RESULTS = ['APPLIED', 'NO_CHANGE', 'IGNORED', 'FAILED'] as const;
export type WebhookResult = (typeof WEBHOOK_RESULTS)[number];

const REFUND_REASON_CODES = [...REFUND_REASONS, 'BALANCE_PAYOUT'] as const;
const money = z.number().int().min(0).max(1_000_000);

// --- Cennik ------------------------------------------------------------------------------------

/** Nowa wersja cennika (ADR 0053); `validFrom: null` oznacza „od teraz”. Limitu strefy nie ma (D6). */
export const newTariffSchema = z.object({
  unlockFee: money,
  minuteRate: money,
  pauseMinuteRate: money,
  outOfZoneFee: money,
  freeReservationMinutes: z.number().int(),
  minWalletBalance: money,
  minBatteryPct: z.number().int(),
  minUserAge: z.number().int(),
  vatRate: z.number(),
  validFrom: z.iso.datetime({ offset: true }).nullable().default(null),
});
export type NewTariff = z.infer<typeof newTariffSchema>;

export const tariffsResource = {
  name: 'tariffs',
  fields: {
    id: { type: 'uuid', filters: ['eq'] },
    version: { type: 'integer', filters: ['eq'], sortable: true },
    state: { type: 'enum', values: TARIFF_STATES, filters: ['eq'], facet: true },
    validFrom: { type: 'datetime', filters: ['gte', 'lte'], sortable: true },
    validTo: { type: 'datetime', sortable: true },
    unlockFee: { type: 'integer', sortable: true },
    minuteRate: { type: 'integer', sortable: true },
    pauseMinuteRate: { type: 'integer', sortable: true },
    outOfZoneFee: { type: 'integer' },
    freeReservationMinutes: { type: 'integer' },
    minWalletBalance: { type: 'integer' },
    minBatteryPct: { type: 'integer' },
    minUserAge: { type: 'integer' },
    vatRate: { type: 'decimal' },
    createdByName: { type: 'text' },
    createdAt: { type: 'datetime', sortable: true },
    rentalsCount: { type: 'integer', sortable: true },
  },
  search: ['version'],
  defaultSort: ['-version'],
  // Usunięcie tylko zaplanowanej, nieużytej wersji (`sp_delete_scheduled_tariff`).
  deleteMode: 'delete',
  permissions: { read: 'tariffs.read', write: 'tariffs.write', delete: 'tariffs.write' },
  createSchema: newTariffSchema,
} as const satisfies ResourceDefinition;

export interface TariffVersionItem {
  id: string;
  version: number;
  state: TariffState;
  validFrom: string;
  validTo: string | null;
  unlockFee: number;
  minuteRate: number;
  pauseMinuteRate: number;
  outOfZoneFee: number;
  freeReservationMinutes: number;
  minWalletBalance: number;
  minBatteryPct: number;
  minUserAge: number;
  vatRate: number;
  createdByName: string | null;
  createdAt: string;
  rentalsCount: number;
}

// --- Płatności ---------------------------------------------------------------------------------

export const paymentsResource = {
  name: 'payments',
  fields: {
    id: { type: 'uuid', filters: ['eq'] },
    createdAt: { type: 'datetime', filters: ['gte', 'lte'], sortable: true },
    updatedAt: { type: 'datetime', sortable: true },
    status: { type: 'enum', values: PAYMENT_STATUSES, filters: ['eq'], facet: true, sortable: true },
    purpose: { type: 'enum', values: PAYMENT_PURPOSES, filters: ['eq'], facet: true },
    method: { type: 'enum', values: PAYMENT_METHOD_KINDS, filters: ['eq'], facet: true },
    amount: { type: 'integer', filters: ['gte', 'lte'], sortable: true },
    provider: { type: 'text', filters: ['eq'] },
    providerPaymentId: { type: 'text', filters: ['eq'] },
    idempotencyKey: { type: 'text' },
    failureCode: { type: 'text', filters: ['eq'] },
    failureReason: { type: 'text' },
    userId: { type: 'uuid', filters: ['eq'] },
    userName: { type: 'text', sortable: true },
    userPhone: { type: 'text', filters: ['contains'] },
    rentalId: { type: 'uuid', filters: ['eq'] },
    rentalNumber: { type: 'integer', filters: ['eq'], sortable: true },
    cardBrand: { type: 'text' },
    cardLast4: { type: 'text' },
    refundedAmount: { type: 'integer', sortable: true },
    receiptId: { type: 'uuid' },
    receiptNumber: { type: 'text', filters: ['eq'] },
    webhookEvents: { type: 'integer' },
  },
  search: ['userName', 'userPhone', 'rentalNumber', 'providerPaymentId'],
  defaultSort: ['-createdAt'],
  deleteMode: 'none',
  permissions: { read: 'payments.read' },
} as const satisfies ResourceDefinition;

export interface PaymentListItem {
  id: string;
  createdAt: string;
  updatedAt: string;
  status: PaymentStatus;
  purpose: PaymentPurpose;
  method: PaymentMethodKind;
  amount: number;
  provider: string;
  providerPaymentId: string | null;
  idempotencyKey: string;
  failureCode: string | null;
  failureReason: string | null;
  userId: string;
  userName: string | null;
  userPhone: string | null;
  rentalId: string | null;
  rentalNumber: number | null;
  cardBrand: string | null;
  cardLast4: string | null;
  refundedAmount: number;
  receiptId: string | null;
  receiptNumber: string | null;
  webhookEvents: number;
}

export interface PaymentAdminDetails extends PaymentListItem {
  webhooks: WebhookEventItem[];
  refunds: RefundListItem[];
}

// --- Księga i portfele ---------------------------------------------------------------------------

export const walletLedgerResource = {
  name: 'wallet-ledger',
  fields: {
    id: { type: 'integer', filters: ['eq'], sortable: true },
    createdAt: { type: 'datetime', filters: ['gte', 'lte'], sortable: true },
    userId: { type: 'uuid', filters: ['eq'] },
    userName: { type: 'text', sortable: true },
    userPhone: { type: 'text', filters: ['contains'] },
    type: { type: 'enum', values: LEDGER_ENTRY_TYPES, filters: ['eq'], facet: true },
    amount: { type: 'integer', filters: ['gte', 'lte'], sortable: true },
    balanceAfter: { type: 'integer', sortable: true },
    reason: { type: 'enum', values: ADJUSTMENT_REASONS, filters: ['eq'] },
    note: { type: 'text' },
    rentalId: { type: 'uuid', filters: ['eq'] },
    rentalNumber: { type: 'integer', filters: ['eq'] },
    paymentId: { type: 'uuid', filters: ['eq'] },
    paymentMethod: { type: 'enum', values: PAYMENT_METHOD_KINDS },
    providerPaymentId: { type: 'text' },
    cardBrand: { type: 'text' },
    cardLast4: { type: 'text' },
    refundId: { type: 'uuid' },
    refundReason: { type: 'enum', values: REFUND_REASON_CODES },
    staffId: { type: 'uuid', filters: ['eq'] },
    staffName: { type: 'text' },
    receiptId: { type: 'uuid' },
    receiptNumber: { type: 'text' },
  },
  search: ['userName', 'userPhone', 'rentalNumber'],
  defaultSort: ['-id'],
  deleteMode: 'none',
  permissions: { read: 'payments.read', write: 'wallet.adjust' },
} as const satisfies ResourceDefinition;

export interface WalletLedgerItem {
  id: number;
  createdAt: string;
  userId: string;
  userName: string | null;
  userPhone: string | null;
  type: LedgerEntryType;
  amount: number;
  balanceAfter: number;
  reason: AdjustmentReason | null;
  note: string | null;
  rentalId: string | null;
  rentalNumber: number | null;
  paymentId: string | null;
  paymentMethod: PaymentMethodKind | null;
  providerPaymentId: string | null;
  cardBrand: string | null;
  cardLast4: string | null;
  refundId: string | null;
  refundReason: RefundReasonCode | null;
  staffId: string | null;
  staffName: string | null;
  receiptId: string | null;
  receiptNumber: string | null;
}

export const walletsResource = {
  name: 'wallets',
  fields: {
    userId: { type: 'uuid', filters: ['eq'] },
    name: { type: 'text', sortable: true },
    phone: { type: 'text', filters: ['contains'] },
    userStatus: { type: 'text', filters: ['eq'] },
    cachedBalance: { type: 'integer', filters: ['gte', 'lte'], sortable: true },
    ledgerBalance: { type: 'integer', filters: ['gte', 'lte'], sortable: true },
    outOfSync: { type: 'boolean', filters: ['eq'], facet: true },
    entries: { type: 'integer', sortable: true },
    lastEntryAt: { type: 'datetime', filters: ['gte', 'lte'], sortable: true },
  },
  search: ['name', 'phone'],
  defaultSort: ['-lastEntryAt'],
  deleteMode: 'none',
  permissions: { read: 'payments.read', write: 'wallet.adjust' },
} as const satisfies ResourceDefinition;

export interface WalletListItem {
  userId: string;
  name: string | null;
  phone: string | null;
  userStatus: string;
  cachedBalance: number;
  ledgerBalance: number;
  outOfSync: boolean;
  entries: number;
  lastEntryAt: string | null;
}

/** Portfel na karcie klienta w panelu (makieta `klient-portfel`). */
export interface CustomerWalletAdmin {
  userId: string;
  balance: number;
  cachedBalance: number;
  outOfSync: boolean;
  minWalletBalance: number;
  overdue: OverdueRental[];
  paymentMethods: PaymentMethodAdminItem[];
}

export const walletAdjustmentSchema = z.object({
  amount: z
    .number()
    .int()
    .refine((v) => v !== 0)
    .refine((v) => Math.abs(v) <= 1_000_000),
  reason: z.enum(ADJUSTMENT_REASONS),
  note: z.string().trim().max(500).nullable().default(null),
});
export type WalletAdjustment = z.infer<typeof walletAdjustmentSchema>;

/** Wynik zwrotu salda: zlecone zwroty u operatora i część do rozliczenia korektą (ADR 0054). */
export interface WalletPayoutResult {
  refunds: RefundListItem[];
  remainder: number;
  wallet: CustomerWalletAdmin;
}

// --- Paragony ----------------------------------------------------------------------------------

export const receiptsResource = {
  name: 'receipts',
  fields: {
    id: { type: 'uuid', filters: ['eq'] },
    number: { type: 'text', filters: ['eq', 'contains'], sortable: true },
    kind: { type: 'enum', values: RECEIPT_KINDS, filters: ['eq'], facet: true },
    issuedAt: { type: 'datetime', filters: ['gte', 'lte'], sortable: true },
    userId: { type: 'uuid', filters: ['eq'] },
    buyerName: { type: 'text', sortable: true },
    buyerPhone: { type: 'text', filters: ['contains'] },
    rentalId: { type: 'uuid', filters: ['eq'] },
    rentalNumber: { type: 'integer', filters: ['eq'], sortable: true },
    paymentId: { type: 'uuid', filters: ['eq'] },
    refundId: { type: 'uuid' },
    paymentSource: { type: 'enum', values: PAYMENT_SOURCES, filters: ['eq'], facet: true },
    cardBrand: { type: 'text' },
    cardLast4: { type: 'text' },
    totalAmount: { type: 'integer', filters: ['gte', 'lte'], sortable: true },
    vatAmount: { type: 'integer', sortable: true },
    netAmount: { type: 'integer', sortable: true },
    vatRate: { type: 'decimal' },
    correctsReceiptId: { type: 'uuid', filters: ['eq'] },
    correctsNumber: { type: 'text' },
    corrections: { type: 'integer' },
  },
  search: ['number', 'buyerName', 'buyerPhone', 'rentalNumber'],
  defaultSort: ['-issuedAt'],
  deleteMode: 'none',
  permissions: { read: 'payments.read' },
} as const satisfies ResourceDefinition;

export interface ReceiptListItem {
  id: string;
  number: string;
  kind: ReceiptKind;
  issuedAt: string;
  userId: string;
  buyerName: string | null;
  buyerPhone: string | null;
  rentalId: string | null;
  rentalNumber: number | null;
  paymentId: string | null;
  refundId: string | null;
  paymentSource: PaymentSource | null;
  cardBrand: string | null;
  cardLast4: string | null;
  totalAmount: number;
  vatAmount: number;
  netAmount: number;
  vatRate: number | null;
  correctsReceiptId: string | null;
  correctsNumber: string | null;
  corrections: number;
}

export interface ReceiptAdminDetails extends ReceiptView {
  userId: string;
  paymentId: string | null;
  refundId: string | null;
}

// --- Metody płatności i webhooki -----------------------------------------------------------------

export const paymentMethodsResource = {
  name: 'payment-methods',
  fields: {
    id: { type: 'uuid', filters: ['eq'] },
    userId: { type: 'uuid', filters: ['eq'] },
    userName: { type: 'text', sortable: true },
    userPhone: { type: 'text', filters: ['contains'] },
    provider: { type: 'text', filters: ['eq'] },
    brand: { type: 'text', filters: ['eq'], facet: true },
    last4: { type: 'text', filters: ['eq'] },
    expMonth: { type: 'integer' },
    expYear: { type: 'integer', sortable: true },
    isDefault: { type: 'boolean', filters: ['eq'] },
    state: { type: 'enum', values: CARD_STATES, filters: ['eq'], facet: true },
    createdAt: { type: 'datetime', filters: ['gte', 'lte'], sortable: true },
    removedAt: { type: 'datetime', sortable: true },
  },
  search: ['userName', 'userPhone', 'last4'],
  defaultSort: ['-createdAt'],
  deleteMode: 'none',
  permissions: { read: 'payments.read' },
} as const satisfies ResourceDefinition;

export interface PaymentMethodAdminItem {
  id: string;
  userId: string;
  userName: string | null;
  userPhone: string | null;
  provider: string;
  brand: string;
  last4: string;
  expMonth: number;
  expYear: number;
  isDefault: boolean;
  state: CardState;
  createdAt: string;
  removedAt: string | null;
}

export const webhookEventsResource = {
  name: 'payment-webhook-events',
  fields: {
    id: { type: 'integer', filters: ['eq'], sortable: true },
    provider: { type: 'text', filters: ['eq'], facet: true },
    providerEventId: { type: 'text', filters: ['eq'] },
    type: { type: 'text', filters: ['eq'], facet: true },
    objectId: { type: 'text', filters: ['eq'] },
    receivedAt: { type: 'datetime', filters: ['gte', 'lte'], sortable: true },
    lastReceivedAt: { type: 'datetime', sortable: true },
    processedAt: { type: 'datetime', sortable: true },
    deliveries: { type: 'integer', filters: ['gte'], sortable: true },
    result: { type: 'enum', values: WEBHOOK_RESULTS, filters: ['eq'], facet: true },
    error: { type: 'text' },
    paymentId: { type: 'uuid', filters: ['eq'] },
    paymentPurpose: { type: 'enum', values: PAYMENT_PURPOSES },
    paymentAmount: { type: 'integer' },
    userId: { type: 'uuid', filters: ['eq'] },
    userName: { type: 'text' },
  },
  search: ['providerEventId', 'objectId'],
  defaultSort: ['-receivedAt'],
  deleteMode: 'none',
  permissions: { read: 'payments.read' },
} as const satisfies ResourceDefinition;

export interface WebhookEventItem {
  id: number;
  provider: string;
  providerEventId: string;
  type: string;
  objectId: string | null;
  receivedAt: string;
  lastReceivedAt: string;
  processedAt: string | null;
  deliveries: number;
  result: WebhookResult | null;
  error: string | null;
  paymentId: string | null;
  paymentPurpose: PaymentPurpose | null;
  paymentAmount: number | null;
  userId: string | null;
  userName: string | null;
}

// --- Zwroty ------------------------------------------------------------------------------------

export const refundsResource = {
  name: 'refunds',
  fields: {
    id: { type: 'uuid', filters: ['eq'] },
    createdAt: { type: 'datetime', filters: ['gte', 'lte'], sortable: true },
    updatedAt: { type: 'datetime', sortable: true },
    status: { type: 'enum', values: REFUND_STATUSES, filters: ['eq'], facet: true },
    source: { type: 'enum', values: PAYMENT_SOURCES, filters: ['eq'], facet: true },
    amount: { type: 'integer', filters: ['gte', 'lte'], sortable: true },
    reason: { type: 'enum', values: REFUND_REASON_CODES, filters: ['eq'], facet: true },
    note: { type: 'text' },
    userId: { type: 'uuid', filters: ['eq'] },
    userName: { type: 'text', sortable: true },
    userPhone: { type: 'text', filters: ['contains'] },
    rentalId: { type: 'uuid', filters: ['eq'] },
    rentalNumber: { type: 'integer', filters: ['eq'], sortable: true },
    paymentId: { type: 'uuid', filters: ['eq'] },
    paymentPurpose: { type: 'enum', values: PAYMENT_PURPOSES },
    providerRefundId: { type: 'text', filters: ['eq'] },
    failureReason: { type: 'text' },
    staffId: { type: 'uuid', filters: ['eq'] },
    staffName: { type: 'text' },
    receiptId: { type: 'uuid' },
    receiptNumber: { type: 'text' },
  },
  search: ['userName', 'userPhone', 'rentalNumber', 'providerRefundId'],
  defaultSort: ['-createdAt'],
  deleteMode: 'none',
  permissions: { read: 'payments.read', write: 'rentals.manage' },
} as const satisfies ResourceDefinition;

export interface RefundListItem {
  id: string;
  createdAt: string;
  updatedAt: string;
  status: RefundStatus;
  source: PaymentSource;
  amount: number;
  reason: RefundReasonCode;
  note: string | null;
  userId: string;
  userName: string | null;
  userPhone: string | null;
  rentalId: string | null;
  rentalNumber: number | null;
  paymentId: string | null;
  paymentPurpose: PaymentPurpose | null;
  providerRefundId: string | null;
  failureReason: string | null;
  staffId: string | null;
  staffName: string | null;
  receiptId: string | null;
  receiptNumber: string | null;
}

/**
 * Zwrot za przejazd (pytanie 11): kwota w groszach, powód z listy, notatka do dziennika audytu; `ticketId` wiąże
 * zwrot z reklamacją (`refunds.ticket_id`, ADR 0055), żeby trafił na oś czasu zgłoszenia.
 */
export const rentalRefundSchema = z.object({
  amount: z.number().int().positive(),
  reason: z.enum(REFUND_REASONS),
  note: z.string().trim().max(500).nullable().default(null),
  ticketId: z.uuid().nullable().default(null),
});
export type RentalRefund = z.infer<typeof rentalRefundSchema>;
