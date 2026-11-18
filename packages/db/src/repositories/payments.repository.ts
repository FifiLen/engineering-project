import type {
  PaymentSource,
  PaymentStatus,
  ReceiptAmount,
  ReceiptItem,
  RideSettlement,
  SavedCard,
} from '@hulajnogi/core';
import {
  paymentMethodsResource,
  paymentsResource,
  receiptsResource,
  refundsResource,
  walletLedgerResource,
  walletsResource,
  webhookEventsResource,
  type AdjustmentReason,
  type CardSummary,
  type LedgerEntryType,
  type ListQuery,
  type ListResponse,
  type OverdueRental,
  type PaymentListItem,
  type PaymentMethodAdminItem,
  type PaymentMethodKind,
  type PaymentProviderName,
  type PaymentPurpose,
  type PaymentView,
  type ReceiptItemCode,
  type ReceiptListItem,
  type ReceiptParty,
  type ReceiptSummary,
  type ReceiptView,
  type RefundListItem,
  type RefundReasonCode,
  type RefundStatus,
  type RentalSettlementView,
  type WalletEntry,
  type WalletLedgerItem,
  type WalletListItem,
  type WebhookEventItem,
  type WebhookResult,
} from '@hulajnogi/shared';
import { sql } from 'drizzle-orm';
import { runListQuery, type ListSource } from '../admin/list-query.js';
import type { DbExecutor } from '../client.js';
import {
  vPaymentList,
  vPaymentMethods,
  vPaymentWebhookEvents,
  vReceiptList,
  vRefundList,
  vWalletBalances,
  vWalletLedger,
} from '../schema/schema.js';

type Row = Record<string, unknown>;
const iso = (v: unknown) => (v === null || v === undefined ? null : new Date(v as string).toISOString());
const num = (v: unknown) => (v === null || v === undefined ? null : Number(v));
const card = (brand: unknown, last4: unknown): CardSummary | null =>
  brand ? { brand: brand as string, last4: last4 as string } : null;

// --- Źródła list w panelu (ADR 0031) ---------------------------------------------------------------

type Fields<R extends { fields: object }> = keyof R['fields'] & string;

const paymentsSource: ListSource<Fields<typeof paymentsResource>> = {
  from: vPaymentList,
  id: vPaymentList.id,
  columns: {
    id: vPaymentList.id,
    createdAt: vPaymentList.createdAt,
    updatedAt: vPaymentList.updatedAt,
    status: vPaymentList.status,
    purpose: vPaymentList.purpose,
    method: vPaymentList.method,
    amount: vPaymentList.amount,
    provider: vPaymentList.provider,
    providerPaymentId: vPaymentList.providerPaymentId,
    idempotencyKey: vPaymentList.idempotencyKey,
    failureCode: vPaymentList.failureCode,
    failureReason: vPaymentList.failureReason,
    userId: vPaymentList.userId,
    userName: vPaymentList.userName,
    userPhone: vPaymentList.userPhone,
    rentalId: vPaymentList.rentalId,
    rentalNumber: vPaymentList.rentalNumber,
    cardBrand: vPaymentList.cardBrand,
    cardLast4: vPaymentList.cardLast4,
    refundedAmount: vPaymentList.refundedAmount,
    receiptId: vPaymentList.receiptId,
    receiptNumber: vPaymentList.receiptNumber,
    webhookEvents: vPaymentList.webhookEvents,
  },
};

const ledgerSource: ListSource<Fields<typeof walletLedgerResource>> = {
  from: vWalletLedger,
  id: vWalletLedger.id,
  columns: {
    id: vWalletLedger.id,
    createdAt: vWalletLedger.createdAt,
    userId: vWalletLedger.userId,
    userName: vWalletLedger.userName,
    userPhone: vWalletLedger.userPhone,
    type: vWalletLedger.type,
    amount: vWalletLedger.amount,
    balanceAfter: vWalletLedger.balanceAfter,
    reason: vWalletLedger.reason,
    note: vWalletLedger.note,
    rentalId: vWalletLedger.rentalId,
    rentalNumber: vWalletLedger.rentalNumber,
    paymentId: vWalletLedger.paymentId,
    paymentMethod: vWalletLedger.paymentMethod,
    providerPaymentId: vWalletLedger.providerPaymentId,
    cardBrand: vWalletLedger.cardBrand,
    cardLast4: vWalletLedger.cardLast4,
    refundId: vWalletLedger.refundId,
    refundReason: vWalletLedger.refundReason,
    staffId: vWalletLedger.staffId,
    staffName: vWalletLedger.staffName,
    receiptId: vWalletLedger.receiptId,
    receiptNumber: vWalletLedger.receiptNumber,
  },
};

const walletsSource: ListSource<Fields<typeof walletsResource>> = {
  from: vWalletBalances,
  id: vWalletBalances.userId,
  columns: {
    userId: vWalletBalances.userId,
    name: vWalletBalances.name,
    phone: vWalletBalances.phone,
    userStatus: vWalletBalances.userStatus,
    cachedBalance: vWalletBalances.cachedBalance,
    ledgerBalance: vWalletBalances.ledgerBalance,
    outOfSync: vWalletBalances.outOfSync,
    entries: vWalletBalances.entries,
    lastEntryAt: vWalletBalances.lastEntryAt,
  },
};

const receiptsSource: ListSource<Fields<typeof receiptsResource>> = {
  from: vReceiptList,
  id: vReceiptList.id,
  columns: {
    id: vReceiptList.id,
    number: vReceiptList.number,
    kind: vReceiptList.kind,
    issuedAt: vReceiptList.issuedAt,
    userId: vReceiptList.userId,
    buyerName: vReceiptList.buyerName,
    buyerPhone: vReceiptList.buyerPhone,
    rentalId: vReceiptList.rentalId,
    rentalNumber: vReceiptList.rentalNumber,
    paymentId: vReceiptList.paymentId,
    refundId: vReceiptList.refundId,
    paymentSource: vReceiptList.paymentSource,
    cardBrand: vReceiptList.cardBrand,
    cardLast4: vReceiptList.cardLast4,
    totalAmount: vReceiptList.totalAmount,
    vatAmount: vReceiptList.vatAmount,
    netAmount: vReceiptList.netAmount,
    vatRate: vReceiptList.vatRate,
    correctsReceiptId: vReceiptList.correctsReceiptId,
    correctsNumber: vReceiptList.correctsNumber,
    corrections: vReceiptList.corrections,
  },
};

const methodsSource: ListSource<Fields<typeof paymentMethodsResource>> = {
  from: vPaymentMethods,
  id: vPaymentMethods.id,
  columns: {
    id: vPaymentMethods.id,
    userId: vPaymentMethods.userId,
    userName: vPaymentMethods.userName,
    userPhone: vPaymentMethods.userPhone,
    provider: vPaymentMethods.provider,
    brand: vPaymentMethods.brand,
    last4: vPaymentMethods.last4,
    expMonth: vPaymentMethods.expMonth,
    expYear: vPaymentMethods.expYear,
    isDefault: vPaymentMethods.isDefault,
    state: vPaymentMethods.state,
    createdAt: vPaymentMethods.createdAt,
    removedAt: vPaymentMethods.removedAt,
  },
};

const webhooksSource: ListSource<Fields<typeof webhookEventsResource>> = {
  from: vPaymentWebhookEvents,
  id: vPaymentWebhookEvents.id,
  columns: {
    id: vPaymentWebhookEvents.id,
    provider: vPaymentWebhookEvents.provider,
    providerEventId: vPaymentWebhookEvents.providerEventId,
    type: vPaymentWebhookEvents.type,
    objectId: vPaymentWebhookEvents.objectId,
    receivedAt: vPaymentWebhookEvents.receivedAt,
    lastReceivedAt: vPaymentWebhookEvents.lastReceivedAt,
    processedAt: vPaymentWebhookEvents.processedAt,
    deliveries: vPaymentWebhookEvents.deliveries,
    result: vPaymentWebhookEvents.result,
    error: vPaymentWebhookEvents.error,
    paymentId: vPaymentWebhookEvents.paymentId,
    paymentPurpose: vPaymentWebhookEvents.paymentPurpose,
    paymentAmount: vPaymentWebhookEvents.paymentAmount,
    userId: vPaymentWebhookEvents.userId,
    userName: vPaymentWebhookEvents.userName,
  },
};

const refundsSource: ListSource<Fields<typeof refundsResource>> = {
  from: vRefundList,
  id: vRefundList.id,
  columns: {
    id: vRefundList.id,
    createdAt: vRefundList.createdAt,
    updatedAt: vRefundList.updatedAt,
    status: vRefundList.status,
    source: vRefundList.source,
    amount: vRefundList.amount,
    reason: vRefundList.reason,
    note: vRefundList.note,
    userId: vRefundList.userId,
    userName: vRefundList.userName,
    userPhone: vRefundList.userPhone,
    rentalId: vRefundList.rentalId,
    rentalNumber: vRefundList.rentalNumber,
    paymentId: vRefundList.paymentId,
    paymentPurpose: vRefundList.paymentPurpose,
    providerRefundId: vRefundList.providerRefundId,
    failureReason: vRefundList.failureReason,
    staffId: vRefundList.staffId,
    staffName: vRefundList.staffName,
    receiptId: vRefundList.receiptId,
    receiptNumber: vRefundList.receiptNumber,
  },
};

const byId = (field: string, value: string | number): ListQuery => ({
  filters: [{ field, op: 'eq', values: [value] }],
  sort: [],
  page: 1,
  pageSize: 100,
  facets: [],
});

// --- Rekordy ---------------------------------------------------------------------------------------

export interface PaymentRecord {
  id: string;
  userId: string;
  purpose: PaymentPurpose;
  rentalId: string | null;
  method: PaymentMethodKind;
  paymentMethodId: string | null;
  amount: number;
  status: PaymentStatus;
  provider: PaymentProviderName;
  providerPaymentId: string | null;
  idempotencyKey: string;
  failureCode: string | null;
  failureReason: string | null;
  createdAt: Date;
  updatedAt: Date;
}

const paymentSql = sql`SELECT id, user_id, purpose, rental_id, method, payment_method_id, amount, status, provider,
                              provider_payment_id, idempotency_key, failure_code, failure_reason, created_at, updated_at
                       FROM payments`;
const toPayment = (r: Row): PaymentRecord => ({
  id: r.id as string,
  userId: r.user_id as string,
  purpose: r.purpose as PaymentPurpose,
  rentalId: (r.rental_id as string | null) ?? null,
  method: r.method as PaymentMethodKind,
  paymentMethodId: (r.payment_method_id as string | null) ?? null,
  amount: Number(r.amount),
  status: r.status as PaymentStatus,
  provider: r.provider as PaymentProviderName,
  providerPaymentId: (r.provider_payment_id as string | null) ?? null,
  idempotencyKey: r.idempotency_key as string,
  failureCode: (r.failure_code as string | null) ?? null,
  failureReason: (r.failure_reason as string | null) ?? null,
  createdAt: new Date(r.created_at as string),
  updatedAt: new Date(r.updated_at as string),
});

export interface CardRecord extends SavedCard {
  userId: string;
  provider: PaymentProviderName;
  providerRef: string;
  brand: string;
  last4: string;
  isDefault: boolean;
  createdAt: Date;
}

const cardSql = sql`SELECT id, user_id, provider, provider_ref, brand, last4, exp_month, exp_year, is_default, removed_at, created_at
                    FROM payment_methods`;
const toCard = (r: Row): CardRecord => ({
  id: r.id as string,
  userId: r.user_id as string,
  provider: r.provider as PaymentProviderName,
  providerRef: r.provider_ref as string,
  brand: r.brand as string,
  last4: r.last4 as string,
  expMonth: r.exp_month as number,
  expYear: r.exp_year as number,
  isDefault: r.is_default as boolean,
  removedAt: r.removed_at ? new Date(r.removed_at as string) : null,
  createdAt: new Date(r.created_at as string),
});

export interface RefundRecord {
  id: string;
  userId: string;
  rentalId: string | null;
  paymentId: string | null;
  source: PaymentSource;
  amount: number;
  reason: RefundReasonCode;
  status: RefundStatus;
  providerRefundId: string | null;
  createdAt: Date;
}

const refundSql = sql`SELECT id, user_id, rental_id, payment_id, source, amount, reason, status, provider_refund_id, created_at FROM refunds`;
const toRefund = (r: Row): RefundRecord => ({
  id: r.id as string,
  userId: r.user_id as string,
  rentalId: (r.rental_id as string | null) ?? null,
  paymentId: (r.payment_id as string | null) ?? null,
  source: r.source as PaymentSource,
  amount: Number(r.amount),
  reason: r.reason as RefundReasonCode,
  status: r.status as RefundStatus,
  providerRefundId: (r.provider_refund_id as string | null) ?? null,
  createdAt: new Date(r.created_at as string),
});

/** Przejazd z polami potrzebnymi do rozliczenia (bez osi czasu). */
export interface SettlementRental {
  id: string;
  number: number;
  userId: string;
  state: string;
  tariffId: string;
  paymentSource: PaymentSource;
  paymentMethodId: string | null;
  totalAmount: number | null;
  /** Opłata za odholowanie w `total_amount` (ADR 0060); `null` bez opłaty. */
  towingFee: number | null;
  rideSeconds: number;
  pauseSeconds: number;
  startedAt: Date | null;
  endedAt: Date | null;
}

export interface LedgerPost {
  userId: string;
  type: LedgerEntryType;
  amount: number;
  rentalId?: string | null;
  paymentId?: string | null;
  refundId?: string | null;
  staffId?: string | null;
  reason?: AdjustmentReason | null;
  note?: string | null;
}

export interface WebhookRecord {
  id: number;
  provider: PaymentProviderName;
  providerEventId: string;
  type: string;
  objectId: string | null;
  processedAt: Date | null;
  result: WebhookResult | null;
  /** Obiekt zdarzenia (`data.object`) w formacie operatora. */
  object: Record<string, unknown>;
}

export interface NewPayment {
  userId: string;
  purpose: PaymentPurpose;
  rentalId: string | null;
  method: PaymentMethodKind;
  paymentMethodId: string | null;
  amount: number;
  provider: PaymentProviderName;
}

/**
 * Moduł Płatności (ADR 0049, ADR 0050, ADR 0054). Ruch środków idzie wyłącznie przez `sp_wallet_post`
 * (blokada portfela, saldo po operacji z księgi), zwrot przez `sp_record_refund`, paragon przez
 * `sp_issue_receipt`. Repozytorium nie decyduje o regułach: serwis w API wywołuje packages/core
 * i zapisuje wynik w jednej transakcji.
 */
export class DrizzlePaymentRepository {
  constructor(private readonly db: DbExecutor) {}

  private async rows(query: ReturnType<typeof sql>): Promise<Row[]> {
    return (await this.db.execute<Row>(query)).rows;
  }

  private async one(query: ReturnType<typeof sql>): Promise<Row | null> {
    return (await this.rows(query))[0] ?? null;
  }

  // --- Portfel i księga -----------------------------------------------------------------------

  /** Blokada portfela (reguła startu i spłaty); zwraca saldo z księgi. */
  async lockWallet(userId: string): Promise<number> {
    await this.db.execute(sql`SELECT 1 FROM wallets WHERE user_id = ${userId} FOR UPDATE`);
    return this.balance(userId);
  }

  async balance(userId: string): Promise<number> {
    const row = await this.one(sql`SELECT fn_wallet_balance(${userId}) AS balance`);
    return Number(row?.balance ?? 0);
  }

  async cachedBalance(userId: string): Promise<{ cached: number; ledger: number; outOfSync: boolean }> {
    const row = await this.one(
      sql`SELECT cached_balance, ledger_balance, out_of_sync FROM v_wallet_balances WHERE user_id = ${userId}`,
    );
    return {
      cached: Number(row?.cached_balance ?? 0),
      ledger: Number(row?.ledger_balance ?? 0),
      outOfSync: (row?.out_of_sync as boolean | undefined) ?? false,
    };
  }

  async post(entry: LedgerPost): Promise<{ entryId: number; balanceAfter: number }> {
    const row = await this.one(sql`
      CALL sp_wallet_post(${entry.userId}, ${entry.type}::ledger_entry_type, ${entry.amount}, ${entry.rentalId ?? null},
                          ${entry.paymentId ?? null}, ${entry.refundId ?? null}, ${entry.staffId ?? null},
                          ${entry.reason ?? null}, ${entry.note ?? null}, NULL, NULL)`);
    return { entryId: Number(row!.entry_id), balanceAfter: Number(row!.balance_after) };
  }

  async walletEntries(userId: string, limit: number, before?: number): Promise<WalletEntry[]> {
    const rows = await this.rows(sql`
      SELECT id, created_at, type, amount, balance_after, rental_id, rental_number, payment_method, card_brand, card_last4,
             reason, refund_reason, receipt_id
      FROM v_wallet_ledger WHERE user_id = ${userId} ${before ? sql`AND id < ${before}` : sql``}
      ORDER BY id DESC LIMIT ${limit}`);
    return rows.map((r) => ({
      id: Number(r.id),
      createdAt: iso(r.created_at)!,
      type: r.type as LedgerEntryType,
      amount: Number(r.amount),
      balanceAfter: Number(r.balance_after),
      rentalId: (r.rental_id as string | null) ?? null,
      rentalNumber: num(r.rental_number),
      paymentMethod: (r.payment_method as PaymentMethodKind | null) ?? null,
      card: card(r.card_brand, r.card_last4),
      reason: (r.reason as AdjustmentReason | null) ?? null,
      refundReason: (r.refund_reason as RefundReasonCode | null) ?? null,
      receiptId: (r.receipt_id as string | null) ?? null,
    }));
  }

  /** Zaległości klienta (`v_unpaid_rentals`); termin ponowienia liczy serwis. */
  async overdue(userId: string): Promise<Array<Omit<OverdueRental, 'retryAt'> & { failedAt: Date | null }>> {
    const rows = await this.rows(sql`
      SELECT rental_id, number, ended_at, total_amount, card_brand, card_last4, failure_reason, failure_code, failed_at,
             failed_attempts, payment_pending
      FROM v_unpaid_rentals WHERE user_id = ${userId} ORDER BY ended_at`);
    return rows.map((r) => ({
      rentalId: r.rental_id as string,
      number: Number(r.number),
      amount: Number(r.total_amount ?? 0),
      endedAt: iso(r.ended_at),
      failureCode: (r.failure_code as string | null) ?? null,
      failureReason: (r.failure_reason as string | null) ?? null,
      card: card(r.card_brand, r.card_last4),
      failedAttempts: r.failed_attempts as number,
      paymentPending: r.payment_pending as boolean,
      failedAt: r.failed_at ? new Date(r.failed_at as string) : null,
    }));
  }

  async unpaidRentalIds(userId: string): Promise<string[]> {
    const rows = await this.rows(
      sql`SELECT id FROM rentals WHERE user_id = ${userId} AND state = 'UNPAID' ORDER BY ended_at`,
    );
    return rows.map((r) => r.id as string);
  }

  // --- Klient u operatora i karty ------------------------------------------------------------------

  async providerCustomer(userId: string, provider: PaymentProviderName): Promise<string | null> {
    const row = await this.one(
      sql`SELECT provider_customer_id FROM payment_customers WHERE user_id = ${userId} AND provider = ${provider}`,
    );
    return (row?.provider_customer_id as string | undefined) ?? null;
  }

  async userByProviderCustomer(provider: PaymentProviderName, customerId: string): Promise<string | null> {
    const row = await this.one(
      sql`SELECT user_id FROM payment_customers WHERE provider = ${provider} AND provider_customer_id = ${customerId}`,
    );
    return (row?.user_id as string | undefined) ?? null;
  }

  /** Zapis klienta u operatora; równoległe żądanie wygrywa, a drugie odczytuje jego identyfikator. */
  async saveProviderCustomer(userId: string, provider: PaymentProviderName, customerId: string): Promise<string> {
    await this.db.execute(sql`
      INSERT INTO payment_customers (user_id, provider, provider_customer_id) VALUES (${userId}, ${provider}, ${customerId})
      ON CONFLICT (user_id, provider) DO NOTHING`);
    return (await this.providerCustomer(userId, provider))!;
  }

  async cards(userId: string): Promise<CardRecord[]> {
    const rows = await this.rows(
      sql`${cardSql} WHERE user_id = ${userId} AND removed_at IS NULL ORDER BY is_default DESC, created_at DESC`,
    );
    return rows.map(toCard);
  }

  async card(id: string): Promise<CardRecord | null> {
    const row = await this.one(sql`${cardSql} WHERE id = ${id}`);
    return row ? toCard(row) : null;
  }

  async defaultCard(userId: string): Promise<CardRecord | null> {
    const row = await this.one(sql`${cardSql} WHERE user_id = ${userId} AND removed_at IS NULL AND is_default`);
    return row ? toCard(row) : null;
  }

  /** Karta z webhooka `setup_intent.succeeded`; powtórzony webhook nic nie dopisuje, pierwsza karta jest domyślna. */
  async saveCard(input: {
    userId: string;
    provider: PaymentProviderName;
    providerRef: string;
    brand: string;
    last4: string;
    expMonth: number;
    expYear: number;
  }): Promise<{ id: string; created: boolean }> {
    await this.db.execute(sql`SELECT 1 FROM wallets WHERE user_id = ${input.userId} FOR UPDATE`);
    const row = await this.one(sql`
      INSERT INTO payment_methods (user_id, provider, provider_ref, brand, last4, exp_month, exp_year, is_default)
      VALUES (${input.userId}, ${input.provider}, ${input.providerRef}, ${input.brand}, ${input.last4}, ${input.expMonth},
              ${input.expYear},
              NOT EXISTS (SELECT 1 FROM payment_methods WHERE user_id = ${input.userId} AND removed_at IS NULL AND is_default))
      ON CONFLICT (provider_ref) DO NOTHING
      RETURNING id`);
    if (row) return { id: row.id as string, created: true };
    const existing = await this.one(sql`SELECT id FROM payment_methods WHERE provider_ref = ${input.providerRef}`);
    return { id: existing!.id as string, created: false };
  }

  async setDefaultCard(userId: string, id: string): Promise<boolean> {
    await this.db.execute(sql`SELECT 1 FROM wallets WHERE user_id = ${userId} FOR UPDATE`);
    const { rowCount } = await this.db.execute(sql`
      UPDATE payment_methods SET is_default = (id = ${id})
      WHERE user_id = ${userId} AND removed_at IS NULL
        AND EXISTS (SELECT 1 FROM payment_methods WHERE id = ${id} AND user_id = ${userId} AND removed_at IS NULL)`);
    return (rowCount ?? 0) > 0;
  }

  /** Usunięcie karty (`removed_at`); domyślną zostaje najnowsza z pozostałych. */
  async removeCard(userId: string, id: string): Promise<boolean> {
    await this.db.execute(sql`SELECT 1 FROM wallets WHERE user_id = ${userId} FOR UPDATE`);
    const { rowCount } = await this.db.execute(sql`
      UPDATE payment_methods SET removed_at = now(), is_default = false
      WHERE id = ${id} AND user_id = ${userId} AND removed_at IS NULL`);
    if (!rowCount) return false;
    await this.db.execute(sql`
      UPDATE payment_methods SET is_default = true
      WHERE id = (SELECT id FROM payment_methods WHERE user_id = ${userId} AND removed_at IS NULL ORDER BY created_at DESC LIMIT 1)
        AND NOT EXISTS (SELECT 1 FROM payment_methods WHERE user_id = ${userId} AND removed_at IS NULL AND is_default)`);
    return true;
  }

  /** Przejazd w toku, zaległość albo płatność w toku z tą kartą: karty nie usuwa się do rozliczenia. */
  async cardInUse(id: string): Promise<boolean> {
    const row = await this.one(sql`
      SELECT EXISTS (SELECT 1 FROM rentals WHERE payment_method_id = ${id}
                     AND state IN ('RESERVED', 'UNLOCKING', 'ACTIVE', 'PAUSED', 'ENDING', 'UNPAID'))
          OR EXISTS (SELECT 1 FROM payments WHERE payment_method_id = ${id} AND status = 'PENDING') AS used`);
    return row!.used as boolean;
  }

  // --- Płatności -------------------------------------------------------------------------------

  /** Płatność `PENDING`; klucz idempotencji u operatora to identyfikator płatności (ADR 0050). */
  async insertPayment(input: NewPayment): Promise<PaymentRecord> {
    const row = await this.one(sql`
      WITH k AS (SELECT gen_random_uuid() AS id)
      INSERT INTO payments (id, user_id, purpose, rental_id, method, payment_method_id, amount, provider, idempotency_key)
      SELECT k.id, ${input.userId}, ${input.purpose}, ${input.rentalId}, ${input.method}, ${input.paymentMethodId},
             ${input.amount}, ${input.provider}, k.id::text
      FROM k RETURNING id`);
    return (await this.payment(row!.id as string))!;
  }

  async payment(id: string): Promise<PaymentRecord | null> {
    const row = await this.one(sql`${paymentSql} WHERE id = ${id}`);
    return row ? toPayment(row) : null;
  }

  async lockPayment(id: string): Promise<PaymentRecord | null> {
    const row = await this.one(sql`${paymentSql} WHERE id = ${id} FOR UPDATE`);
    return row ? toPayment(row) : null;
  }

  async paymentByProviderId(providerPaymentId: string): Promise<PaymentRecord | null> {
    const row = await this.one(sql`${paymentSql} WHERE provider_payment_id = ${providerPaymentId}`);
    return row ? toPayment(row) : null;
  }

  async setProviderPayment(id: string, providerPaymentId: string): Promise<void> {
    await this.db.execute(sql`
      UPDATE payments SET provider_payment_id = ${providerPaymentId}, updated_at = now()
      WHERE id = ${id} AND provider_payment_id IS NULL`);
  }

  async setPaymentStatus(
    id: string,
    status: PaymentStatus,
    failure: { code: string | null; reason: string | null } = { code: null, reason: null },
  ): Promise<void> {
    await this.db.execute(sql`
      UPDATE payments SET status = ${status}, failure_code = ${failure.code}, failure_reason = ${failure.reason}, updated_at = now()
      WHERE id = ${id}`);
  }

  async pendingPayments(createdBefore: Date, limit = 50): Promise<string[]> {
    const rows = await this.rows(sql`
      SELECT id FROM payments WHERE status = 'PENDING' AND created_at < ${createdBefore} ORDER BY updated_at LIMIT ${limit}`);
    return rows.map((r) => r.id as string);
  }

  /** Płatność sprawdzona bez wyniku idzie na koniec kolejki sprawdzania statusu. */
  async touchPendingPayment(id: string): Promise<void> {
    await this.db.execute(sql`UPDATE payments SET updated_at = now() WHERE id = ${id} AND status = 'PENDING'`);
  }

  async touchPendingRefund(id: string): Promise<void> {
    await this.db.execute(sql`UPDATE refunds SET updated_at = now() WHERE id = ${id} AND status = 'PENDING'`);
  }

  async pendingRidePayment(rentalId: string): Promise<PaymentRecord | null> {
    const row = await this.one(
      sql`${paymentSql} WHERE rental_id = ${rentalId} AND purpose = 'RIDE' AND status = 'PENDING'`,
    );
    return row ? toPayment(row) : null;
  }

  async succeededRidePayment(rentalId: string): Promise<PaymentRecord | null> {
    const row = await this.one(sql`
      ${paymentSql} WHERE rental_id = ${rentalId} AND purpose = 'RIDE' AND status IN ('SUCCEEDED', 'REFUNDED')
      ORDER BY created_at DESC LIMIT 1`);
    return row ? toPayment(row) : null;
  }

  async failedRideAttempts(rentalId: string): Promise<number> {
    const row = await this.one(
      sql`SELECT count(*)::int AS n FROM payments WHERE rental_id = ${rentalId} AND purpose = 'RIDE' AND status = 'FAILED'`,
    );
    return row!.n as number;
  }

  paymentView(p: PaymentRecord): PaymentView {
    return {
      id: p.id,
      purpose: p.purpose,
      method: p.method,
      amount: p.amount,
      status: p.status,
      failureCode: p.failureCode,
      failureReason: p.failureReason,
      rentalId: p.rentalId,
      createdAt: p.createdAt.toISOString(),
      updatedAt: p.updatedAt.toISOString(),
    };
  }

  // --- Rozliczenie przejazdu ----------------------------------------------------------------------

  async settlementRental(rentalId: string, lock = false): Promise<SettlementRental | null> {
    if (lock) await this.db.execute(sql`SELECT 1 FROM rentals WHERE id = ${rentalId} FOR UPDATE`);
    const row = await this.one(sql`
      SELECT id, number, user_id, state, tariff_id, payment_source, payment_method_id, total_amount, towing_fee,
             ride_seconds, pause_seconds, started_at, ended_at
      FROM rentals WHERE id = ${rentalId}`);
    if (!row) return null;
    return {
      id: row.id as string,
      number: Number(row.number),
      userId: row.user_id as string,
      state: row.state as string,
      tariffId: row.tariff_id as string,
      paymentSource: row.payment_source as PaymentSource,
      paymentMethodId: (row.payment_method_id as string | null) ?? null,
      totalAmount: num(row.total_amount),
      towingFee: num(row.towing_fee),
      rideSeconds: row.ride_seconds as number,
      pauseSeconds: row.pause_seconds as number,
      startedAt: row.started_at ? new Date(row.started_at as string) : null,
      endedAt: row.ended_at ? new Date(row.ended_at as string) : null,
    };
  }

  /** Rozliczenie z `v_rental_details` (stan liczony z księgi i płatności, ADR 0049). */
  async settlement(rentalId: string): Promise<RentalSettlementView> {
    const row = await this.one(sql`
      SELECT settlement, payment_source, card_brand, card_last4, paid_amount, refunded_amount, receipt_id, receipt_number,
             card_payment_id, card_payment_status, card_failure_reason,
             (SELECT failure_code FROM payments WHERE id = card_payment_id) AS failure_code
      FROM v_rental_details WHERE id = ${rentalId}`);
    return {
      state: (row?.settlement as RideSettlement | undefined) ?? 'NONE',
      source: (row?.payment_source as PaymentSource | undefined) ?? 'WALLET',
      // Przejazd opłacony z portfela (także spłata po odmowie karty) nie pokazuje karty ani odmowy.
      card: row?.settlement === 'WALLET_PAID' ? null : card(row?.card_brand, row?.card_last4),
      paidAmount: Number(row?.paid_amount ?? 0),
      refundedAmount: Number(row?.refunded_amount ?? 0),
      receiptId: (row?.receipt_id as string | null | undefined) ?? null,
      receiptNumber: (row?.receipt_number as string | null | undefined) ?? null,
      paymentId: (row?.card_payment_id as string | null | undefined) ?? null,
      failureCode: row?.settlement === 'FAILED' ? ((row.failure_code as string | null) ?? null) : null,
      failureReason: row?.settlement === 'FAILED' ? ((row.card_failure_reason as string | null) ?? null) : null,
    };
  }

  /** Zapłacona kwota i suma zwrotów udanych i w toku (reguła zwrotu w core). */
  async rentalRefundBase(rentalId: string): Promise<{ settlement: RideSettlement; paid: number; refunded: number }> {
    const row = await this.one(sql`
      SELECT fn_rental_settlement(${rentalId}) AS settlement, fn_rental_paid_amount(${rentalId}) AS paid,
             (SELECT COALESCE(sum(amount), 0) FROM refunds WHERE rental_id = ${rentalId} AND status <> 'FAILED') AS refunded`);
    return {
      settlement: row!.settlement as RideSettlement,
      paid: Number(row!.paid),
      refunded: Number(row!.refunded),
    };
  }

  // --- Webhooki --------------------------------------------------------------------------------------

  /** Zapis zdarzenia przed przetworzeniem; powtórzone zwiększa licznik dostarczeń (ADR 0050). */
  async recordWebhook(input: {
    provider: PaymentProviderName;
    providerEventId: string;
    type: string;
    objectId: string | null;
    payload: unknown;
  }): Promise<{ id: number; inserted: boolean; processed: boolean }> {
    const row = await this.one(sql`
      INSERT INTO payment_webhook_events (provider, provider_event_id, type, object_id, payload)
      VALUES (${input.provider}, ${input.providerEventId}, ${input.type}, ${input.objectId}, ${JSON.stringify(input.payload)}::jsonb)
      ON CONFLICT (provider_event_id) DO UPDATE
        SET deliveries = payment_webhook_events.deliveries + 1, last_received_at = now()
      RETURNING id, (xmax = 0) AS inserted, processed_at IS NOT NULL AS processed`);
    return { id: Number(row!.id), inserted: row!.inserted as boolean, processed: row!.processed as boolean };
  }

  async webhook(id: number): Promise<WebhookRecord | null> {
    const row = await this.one(sql`
      SELECT id, provider, provider_event_id, type, object_id, processed_at, result, payload->'data'->'object' AS object
      FROM payment_webhook_events WHERE id = ${id}`);
    return row
      ? {
          id: Number(row.id),
          provider: row.provider as PaymentProviderName,
          providerEventId: row.provider_event_id as string,
          type: row.type as string,
          objectId: (row.object_id as string | null) ?? null,
          processedAt: row.processed_at ? new Date(row.processed_at as string) : null,
          result: (row.result as WebhookResult | null) ?? null,
          object: (row.object as Record<string, unknown> | null) ?? {},
        }
      : null;
  }

  /** Błąd przetworzenia bez `processed_at`: zdarzenie zostaje do ponowienia. */
  async markWebhookFailed(id: number, error: string): Promise<void> {
    await this.db.execute(sql`UPDATE payment_webhook_events SET result = 'FAILED', error = ${error} WHERE id = ${id}`);
  }

  async markWebhook(
    id: number,
    outcome: { result: WebhookResult; error?: string | null; paymentId?: string | null },
  ): Promise<void> {
    await this.db.execute(sql`
      UPDATE payment_webhook_events
      SET processed_at = now(), result = ${outcome.result}, error = ${outcome.error ?? null},
          payment_id = COALESCE(${outcome.paymentId ?? null}::uuid, payment_id)
      WHERE id = ${id}`);
  }

  // --- Zwroty ----------------------------------------------------------------------------------------

  async recordRefund(input: {
    userId: string;
    rentalId: string | null;
    paymentId: string | null;
    source: PaymentSource;
    amount: number;
    reason: RefundReasonCode;
    note: string | null;
    staffId: string | null;
    status: RefundStatus;
  }): Promise<string> {
    const row = await this.one(sql`
      CALL sp_record_refund(${input.userId}, ${input.rentalId}, ${input.paymentId}, ${input.source}::payment_source,
                            ${input.amount}, ${input.reason}::refund_reason, ${input.note}, ${input.staffId},
                            ${input.status}::refund_status, NULL)`);
    return row!.refund_id as string;
  }

  async refund(id: string): Promise<RefundRecord | null> {
    const row = await this.one(sql`${refundSql} WHERE id = ${id}`);
    return row ? toRefund(row) : null;
  }

  async lockRefund(id: string): Promise<RefundRecord | null> {
    const row = await this.one(sql`${refundSql} WHERE id = ${id} FOR UPDATE`);
    return row ? toRefund(row) : null;
  }

  async refundByProviderId(providerRefundId: string): Promise<RefundRecord | null> {
    const row = await this.one(sql`${refundSql} WHERE provider_refund_id = ${providerRefundId}`);
    return row ? toRefund(row) : null;
  }

  async setRefundProvider(id: string, providerRefundId: string): Promise<void> {
    await this.db.execute(sql`
      UPDATE refunds SET provider_refund_id = ${providerRefundId}, updated_at = now()
      WHERE id = ${id} AND provider_refund_id IS NULL`);
  }

  async setRefundStatus(id: string, status: RefundStatus, failureReason: string | null = null): Promise<void> {
    await this.db.execute(sql`
      UPDATE refunds SET status = ${status}, failure_reason = ${failureReason}, updated_at = now() WHERE id = ${id}`);
  }

  async pendingRefunds(createdBefore: Date, limit = 50): Promise<string[]> {
    const rows = await this.rows(sql`
      SELECT id FROM refunds WHERE status = 'PENDING' AND created_at < ${createdBefore} ORDER BY updated_at LIMIT ${limit}`);
    return rows.map((r) => r.id as string);
  }

  async refundsForPayment(paymentId: string): Promise<RefundRecord[]> {
    return (await this.rows(sql`${refundSql} WHERE payment_id = ${paymentId} ORDER BY created_at`)).map(toRefund);
  }

  /** Suma udanych zwrotów płatności (stan `REFUNDED` przy zwrocie całości). */
  async refundedTotal(paymentId: string): Promise<number> {
    const row = await this.one(
      sql`SELECT COALESCE(sum(amount), 0) AS total FROM refunds WHERE payment_id = ${paymentId} AND status = 'SUCCEEDED'`,
    );
    return Number(row!.total);
  }

  /** Udane doładowania od najnowszego z sumą zwrotów (zwrot salda, ADR 0054). */
  async refundableTopups(userId: string): Promise<Array<{ paymentId: string; amount: number; refunded: number }>> {
    const rows = await this.rows(sql`
      SELECT p.id, p.amount,
             (SELECT COALESCE(sum(f.amount), 0) FROM refunds f WHERE f.payment_id = p.id AND f.status <> 'FAILED') AS refunded
      FROM payments p
      WHERE p.user_id = ${userId} AND p.purpose = 'TOPUP' AND p.status IN ('SUCCEEDED', 'REFUNDED')
      ORDER BY p.created_at DESC`);
    return rows.map((r) => ({ paymentId: r.id as string, amount: Number(r.amount), refunded: Number(r.refunded) }));
  }

  async refundItems(
    filter: { rentalId: string } | { paymentId: string } | { ids: string[] },
  ): Promise<RefundListItem[]> {
    const [field, values] =
      'rentalId' in filter
        ? ['rentalId', [filter.rentalId]]
        : 'paymentId' in filter
          ? ['paymentId', [filter.paymentId]]
          : ['id', filter.ids];
    if (!values.length) return [];
    const result = await this.listRefunds({
      filters: [{ field, op: 'eq', values }],
      sort: [{ field: 'createdAt', desc: false }],
      page: 1,
      pageSize: 100,
      facets: [],
    });
    return result.items;
  }

  // --- Paragony ----------------------------------------------------------------------------------------

  async issueReceipt(input: {
    userId: string;
    kind: 'SALE' | 'CORRECTION';
    rentalId: string | null;
    paymentId: string | null;
    refundId: string | null;
    correctsReceiptId: string | null;
    paymentSource: PaymentSource | null;
    seller: ReceiptParty;
    items: readonly ReceiptItem[];
  }): Promise<{ id: string; number: string }> {
    const row = await this.one(sql`
      CALL sp_issue_receipt(${input.userId}, ${input.kind}::receipt_kind, ${input.rentalId}, ${input.paymentId},
                            ${input.refundId}, ${input.correctsReceiptId}, ${input.paymentSource}::payment_source,
                            ${JSON.stringify(input.seller)}::jsonb, ${JSON.stringify(input.items)}::jsonb, NULL, NULL)`);
    return { id: row!.receipt_id as string, number: row!.receipt_number as string };
  }

  /**
   * Paragon sprzedaży przejazdu z kwotami pozycji i wcześniejszych korekt do podziału kolejnej korekty
   * (`correctionItems`, ADR 0061). Blokuje paragon, więc równoległa korekta czeka i liczy od aktualnych kwot.
   */
  async saleReceipt(
    rentalId: string,
  ): Promise<{ id: string; items: ReceiptAmount[]; corrected: ReceiptAmount[] } | null> {
    const row = await this.one(sql`
      SELECT r.id FROM receipts r WHERE r.rental_id = ${rentalId} AND r.kind = 'SALE' FOR UPDATE`);
    if (!row) return null;
    const rows = await this.rows(sql`
      SELECT r.kind, i.vat_rate, i.amount
      FROM receipt_items i JOIN receipts r ON r.id = i.receipt_id
      WHERE r.id = ${row.id as string} OR r.corrects_receipt_id = ${row.id as string}
      ORDER BY r.issued_at, r.number, i.line_no`);
    const amount = (r: Row): ReceiptAmount => ({ vatRate: num(r.vat_rate), amount: Number(r.amount) });
    return {
      id: row.id as string,
      items: rows.filter((r) => r.kind === 'SALE').map(amount),
      corrected: rows.filter((r) => r.kind === 'CORRECTION').map(amount),
    };
  }

  private toSummary(r: Row): ReceiptSummary {
    return {
      id: r.id as string,
      number: r.number as string,
      kind: r.kind as ReceiptSummary['kind'],
      issuedAt: iso(r.issued_at)!,
      rentalId: (r.rental_id as string | null) ?? null,
      rentalNumber: num(r.rental_number),
      totalAmount: Number(r.total_amount),
      paymentSource: (r.payment_source as PaymentSource | null) ?? null,
      card: card(r.card_brand, r.card_last4),
    };
  }

  async receiptsForUser(userId: string, limit: number): Promise<ReceiptSummary[]> {
    const rows = await this.rows(sql`
      SELECT id, number, kind, issued_at, rental_id, rental_number, total_amount, payment_source, card_brand, card_last4
      FROM v_receipt_list WHERE user_id = ${userId} ORDER BY issued_at DESC LIMIT ${limit}`);
    return rows.map((r) => this.toSummary(r));
  }

  async receipt(
    id: string,
  ): Promise<(ReceiptView & { userId: string; paymentId: string | null; refundId: string | null }) | null> {
    const row = await this.one(sql`
      SELECT l.*, r.seller, r.buyer_name AS b_name, r.buyer_phone AS b_phone
      FROM v_receipt_list l JOIN receipts r ON r.id = l.id WHERE l.id = ${id}`);
    if (!row) return null;
    const [items, vatGroups, corrections] = await Promise.all([
      this.rows(sql`
        SELECT line_no, description, quantity, unit_price, vat_rate, amount FROM receipt_items
        WHERE receipt_id = ${id} ORDER BY line_no`),
      // VAT grupami stawek jak w `v_receipt_list` (ADR 0061), w kolejności pierwszej pozycji grupy.
      this.rows(sql`
        SELECT vat_rate, sum(amount)::bigint AS gross, COALESCE(fn_vat_from_gross(sum(amount)::bigint, vat_rate), 0) AS vat
        FROM receipt_items WHERE receipt_id = ${id} GROUP BY vat_rate ORDER BY min(line_no)`),
      this.rows(sql`
        SELECT id, number, kind, issued_at, rental_id, rental_number, total_amount, payment_source, card_brand, card_last4
        FROM v_receipt_list WHERE corrects_receipt_id = ${id} ORDER BY issued_at`),
    ]);
    const seller = (row.seller as ReceiptParty | null) ?? { name: null };
    return {
      ...this.toSummary(row),
      userId: row.user_id as string,
      paymentId: (row.payment_id as string | null) ?? null,
      refundId: (row.refund_id as string | null) ?? null,
      items: items.map((i) => ({
        lineNo: i.line_no as number,
        description: i.description as ReceiptItemCode,
        quantity: Number(i.quantity),
        unitPrice: Number(i.unit_price),
        vatRate: num(i.vat_rate),
        amount: Number(i.amount),
      })),
      vatRate: num(row.vat_rate),
      vatAmount: Number(row.vat_amount),
      vatGroups: vatGroups.map((g) => ({ vatRate: num(g.vat_rate), gross: Number(g.gross), vat: Number(g.vat) })),
      netAmount: Number(row.net_amount),
      seller,
      buyer: { name: (row.b_name as string | null) ?? null, phone: (row.b_phone as string | null) ?? null },
      correctsReceiptId: (row.corrects_receipt_id as string | null) ?? null,
      correctsNumber: (row.corrects_number as string | null) ?? null,
      corrections: corrections.map((c) => this.toSummary(c)),
    };
  }

  // --- Listy w panelu ------------------------------------------------------------------------------------

  listPayments(query: ListQuery): Promise<ListResponse<PaymentListItem>> {
    return runListQuery(this.db, paymentsResource, paymentsSource, query);
  }

  async paymentItem(id: string): Promise<PaymentListItem | null> {
    return (await this.listPayments(byId('id', id))).items[0] ?? null;
  }

  listLedger(query: ListQuery): Promise<ListResponse<WalletLedgerItem>> {
    return runListQuery(this.db, walletLedgerResource, ledgerSource, query);
  }

  listWallets(query: ListQuery): Promise<ListResponse<WalletListItem>> {
    return runListQuery(this.db, walletsResource, walletsSource, query);
  }

  listReceipts(query: ListQuery): Promise<ListResponse<ReceiptListItem>> {
    return runListQuery(this.db, receiptsResource, receiptsSource, query);
  }

  listPaymentMethods(query: ListQuery): Promise<ListResponse<PaymentMethodAdminItem>> {
    return runListQuery(this.db, paymentMethodsResource, methodsSource, query);
  }

  async userPaymentMethods(userId: string): Promise<PaymentMethodAdminItem[]> {
    const result = await this.listPaymentMethods({
      ...byId('userId', userId),
      sort: [{ field: 'createdAt', desc: true }],
    });
    return result.items.filter((m) => m.state !== 'REMOVED');
  }

  listWebhooks(query: ListQuery): Promise<ListResponse<WebhookEventItem>> {
    return runListQuery(this.db, webhookEventsResource, webhooksSource, query);
  }

  async webhooksForPayment(paymentId: string): Promise<WebhookEventItem[]> {
    return (await this.listWebhooks({ ...byId('paymentId', paymentId), sort: [{ field: 'receivedAt', desc: false }] }))
      .items;
  }

  listRefunds(query: ListQuery): Promise<ListResponse<RefundListItem>> {
    return runListQuery(this.db, refundsResource, refundsSource, query);
  }
}
