import { decideRefund, ensureAdjustment, notFound, planPayout } from '@hulajnogi/core';
import { type Database, type DbExecutor, DrizzleCustomerRepository, DrizzlePaymentRepository } from '@hulajnogi/db';
import {
  paymentMethodsResource,
  paymentsResource,
  receiptsResource,
  refundsResource,
  walletLedgerResource,
  walletsResource,
  webhookEventsResource,
  type CustomerWalletAdmin,
  type ListQuery,
  type ListResponse,
  type PaymentAdminDetails,
  type PaymentListItem,
  type PaymentMethodAdminItem,
  type ReceiptAdminDetails,
  type ReceiptListItem,
  type RefundListItem,
  type RentalRefund,
  type ResourceDefinition,
  type WalletAdjustment,
  type WalletLedgerItem,
  type WalletListItem,
  type WalletPayoutResult,
  type WebhookEventItem,
} from '@hulajnogi/shared';
import { Inject, Injectable } from '@nestjs/common';
import { AuditedTransaction } from '../audit/audited-transaction.js';
import { StaffPermissionsService } from '../auth/staff-permissions.service.js';
import { listWithCustomerData, withoutCustomerData } from '../common/list-masking.js';
import { DB } from '../database/database.module.js';
import { PaymentEffects, PaymentsService } from './payments.service.js';

/**
 * Płatności w panelu (D5): listy tylko do odczytu na wzorcu listy (ADR 0031), zwrot za przejazd, korekta
 * salda i zwrot salda jako polecenia z wpisem w dzienniku audytu w tej samej transakcji (ADR 0054).
 */
@Injectable()
export class AdminPaymentsService {
  constructor(
    @Inject(DB) private readonly db: Database,
    private readonly payments: PaymentsService,
    private readonly audited: AuditedTransaction,
    private readonly permissions: StaffPermissionsService,
  ) {}

  private get repo() {
    return new DrizzlePaymentRepository(this.db);
  }

  /**
   * Listy płatności bez `users.read` są bez danych klienta (imię i nazwisko, telefon `null`, filtr i sortowanie po nich
   * `403`, wyszukiwanie je pomija), jak zgłoszenia i wydruki (ADR 0055, ADR 0068); ta sama ścieżka obsługuje eksport.
   */
  private async masked<T, D extends ResourceDefinition>(
    staffId: string,
    def: D,
    query: ListQuery,
    run: (query: ListQuery, def: D) => Promise<ListResponse<T>>,
  ): Promise<ListResponse<T>> {
    return listWithCustomerData(def, query, await this.seesCustomers(staffId), run);
  }

  async seesCustomers(staffId: string): Promise<boolean> {
    return (await this.permissions.get(staffId)).permissions.has('users.read');
  }

  listPayments(staffId: string, query: ListQuery, db: DbExecutor = this.db) {
    return this.masked<PaymentListItem, typeof paymentsResource>(staffId, paymentsResource, query, (q, def) =>
      new DrizzlePaymentRepository(db).listPayments(q, def),
    );
  }

  listLedger(staffId: string, query: ListQuery, db: DbExecutor = this.db) {
    return this.masked<WalletLedgerItem, typeof walletLedgerResource>(staffId, walletLedgerResource, query, (q, def) =>
      new DrizzlePaymentRepository(db).listLedger(q, def),
    );
  }

  listWallets(staffId: string, query: ListQuery, db: DbExecutor = this.db) {
    return this.masked<WalletListItem, typeof walletsResource>(staffId, walletsResource, query, (q, def) =>
      new DrizzlePaymentRepository(db).listWallets(q, def),
    );
  }

  listReceipts(staffId: string, query: ListQuery, db: DbExecutor = this.db) {
    return this.masked<ReceiptListItem, typeof receiptsResource>(staffId, receiptsResource, query, (q, def) =>
      new DrizzlePaymentRepository(db).listReceipts(q, def),
    );
  }

  listPaymentMethods(staffId: string, query: ListQuery, db: DbExecutor = this.db) {
    return this.masked<PaymentMethodAdminItem, typeof paymentMethodsResource>(
      staffId,
      paymentMethodsResource,
      query,
      (q, def) => new DrizzlePaymentRepository(db).listPaymentMethods(q, def),
    );
  }

  listWebhooks(staffId: string, query: ListQuery, db: DbExecutor = this.db) {
    return this.masked<WebhookEventItem, typeof webhookEventsResource>(
      staffId,
      webhookEventsResource,
      query,
      (q, def) => new DrizzlePaymentRepository(db).listWebhooks(q, def),
    );
  }

  listRefunds(staffId: string, query: ListQuery, db: DbExecutor = this.db) {
    return this.masked<RefundListItem, typeof refundsResource>(staffId, refundsResource, query, (q, def) =>
      new DrizzlePaymentRepository(db).listRefunds(q, def),
    );
  }

  /** Szczegóły płatności; bez `users.read` bez danych klienta także w webhookach i zwrotach (jak lista). */
  async payment(staffId: string, id: string): Promise<PaymentAdminDetails> {
    const repo = this.repo;
    const item = await repo.paymentItem(id);
    if (!item) throw notFound('payment', id);
    const [webhooks, refunds, seesCustomers] = await Promise.all([
      repo.webhooksForPayment(id),
      repo.refundItems({ paymentId: id }),
      this.seesCustomers(staffId),
    ]);
    if (seesCustomers) return { ...item, webhooks, refunds };
    return {
      ...withoutCustomerData(item, ['userName', 'userPhone']),
      webhooks: webhooks.map((w) => withoutCustomerData(w, ['userName'])),
      refunds: refunds.map(refundWithoutCustomer),
    };
  }

  /** Paragon; bez `users.read` nabywca bez imienia i telefonu (dane sprzedawcy i pozycje zostają). */
  async receipt(staffId: string, id: string): Promise<ReceiptAdminDetails> {
    const [receipt, seesCustomers] = await Promise.all([this.repo.receipt(id), this.seesCustomers(staffId)]);
    if (!receipt) throw notFound('receipt', id);
    return seesCustomers ? receipt : { ...receipt, buyer: { ...receipt.buyer, name: null, phone: null } };
  }

  /** Portfel na karcie klienta (makieta `klient-portfel`). */
  async customerWallet(userId: string): Promise<CustomerWalletAdmin> {
    if (!(await new DrizzleCustomerRepository(this.db).findById(userId))) throw notFound('user', userId);
    const repo = this.repo;
    const [summary, cached, paymentMethods] = await Promise.all([
      this.payments.summary(userId),
      repo.cachedBalance(userId),
      repo.userPaymentMethods(userId),
    ]);
    return {
      userId,
      balance: summary.balance,
      cachedBalance: cached.cached,
      outOfSync: cached.outOfSync,
      minWalletBalance: summary.minWalletBalance,
      overdue: summary.overdue,
      paymentMethods,
    };
  }

  /**
   * Zwrot za przejazd (pytanie 11): z portfela od razu z korektą paragonu, na kartę jako zwrot `PENDING`
   * zlecony u operatora po zatwierdzeniu polecenia. `onRecorded` dopisuje w tej samej transakcji skutki poza
   * modułem Płatności (powiązanie z reklamacją, ADR 0055).
   */
  async refundRental(
    staffId: string,
    rentalId: string,
    body: RentalRefund,
    onRecorded?: (tx: DbExecutor, refundId: string) => Promise<void>,
  ): Promise<void> {
    const effects = new PaymentEffects();
    const result = await this.audited.run(staffId, async ({ tx, audit }) => {
      const repo = new DrizzlePaymentRepository(tx);
      const rental = await repo.settlementRental(rentalId, true);
      if (!rental) throw notFound('rental', rentalId);
      const base = await repo.rentalRefundBase(rentalId);
      const { source } = decideRefund({ ...base, amount: body.amount, reason: body.reason, note: body.note });
      const payment = source === 'CARD' ? await repo.succeededRidePayment(rentalId) : null;
      const refundId = await repo.recordRefund({
        userId: rental.userId,
        rentalId,
        paymentId: payment?.id ?? null,
        source,
        amount: body.amount,
        reason: body.reason,
        note: body.note,
        staffId,
        status: source === 'WALLET' ? 'SUCCEEDED' : 'PENDING',
      });
      await onRecorded?.(tx, refundId);
      if (source === 'WALLET') {
        await repo.post({ userId: rental.userId, type: 'REFUND', amount: body.amount, rentalId, refundId, staffId });
        await this.payments.issueCorrection(tx, refundId);
      }
      await audit({
        action: 'rental.refunded',
        entityType: 'rental',
        entityId: rentalId,
        data: {
          refundId,
          amount: body.amount,
          source,
          reason: body.reason,
          ...(body.note ? { note: body.note } : {}),
          ...(body.ticketId ? { ticketId: body.ticketId } : {}),
        },
      });
      effects.wallets.add(rental.userId);
      effects.rentals.add(rentalId);
      return { refundId, source };
    });
    if (result.source === 'CARD') await this.payments.executeProviderRefund(result.refundId);
    await this.payments.afterCommit(effects);
  }

  /** Korekta salda (pytanie 10): kwota ze znakiem, powód widoczny dla klienta, notatka tylko w panelu. */
  async adjustWallet(staffId: string, userId: string, body: WalletAdjustment): Promise<CustomerWalletAdmin> {
    ensureAdjustment(body);
    if (!(await new DrizzleCustomerRepository(this.db).findById(userId))) throw notFound('user', userId);
    await this.audited.run(staffId, async ({ tx, audit }) => {
      const entry = await new DrizzlePaymentRepository(tx).post({
        userId,
        type: 'ADJUSTMENT',
        amount: body.amount,
        staffId,
        reason: body.reason,
        note: body.note,
      });
      await audit({
        action: 'wallet.adjusted',
        entityType: 'user',
        entityId: userId,
        data: {
          amount: body.amount,
          reason: body.reason,
          ...(body.note ? { note: body.note } : {}),
          balanceAfter: entry.balanceAfter,
          entryId: entry.entryId,
        },
      });
    });
    await this.payments.notifyWallet(userId);
    return this.customerWallet(userId);
  }

  /**
   * Zwrot salda na kartę (pytanie 9): zwroty z najnowszych doładowań do kwoty salda, wpis `PAYOUT` przy
   * zleceniu, a reszta bez doładowania do rozliczenia korektą (ADR 0054).
   */
  async payout(staffId: string, userId: string): Promise<WalletPayoutResult> {
    if (!(await new DrizzleCustomerRepository(this.db).findById(userId))) throw notFound('user', userId);
    const { refundIds, remainder } = await this.audited.run(staffId, async ({ tx, audit }) => {
      const repo = new DrizzlePaymentRepository(tx);
      const balance = await repo.lockWallet(userId);
      const plan = planPayout(balance, await repo.refundableTopups(userId));
      const ids: string[] = [];
      for (const item of plan.refunds) {
        const refundId = await repo.recordRefund({
          userId,
          rentalId: null,
          paymentId: item.paymentId,
          source: 'CARD',
          amount: item.amount,
          reason: 'BALANCE_PAYOUT',
          note: null,
          staffId,
          status: 'PENDING',
        });
        await repo.post({ userId, type: 'PAYOUT', amount: -item.amount, paymentId: item.paymentId, refundId, staffId });
        ids.push(refundId);
      }
      await audit({
        action: 'wallet.paid_out',
        entityType: 'user',
        entityId: userId,
        data: { balance, refunds: plan.refunds, remainder: plan.remainder },
      });
      return { refundIds: ids, remainder: plan.remainder };
    });
    for (const id of refundIds) await this.payments.executeProviderRefund(id);
    await this.payments.notifyWallet(userId);
    return {
      refunds: await this.repo.refundItems({ ids: refundIds }),
      remainder,
      wallet: await this.customerWallet(userId),
    };
  }
}

/** Zwrot bez danych klienta (szczegóły płatności i przejazdu dla operatora bez `users.read`). */
export function refundWithoutCustomer(refund: RefundListItem): RefundListItem {
  return withoutCustomerData(refund, ['userName', 'userPhone']);
}
