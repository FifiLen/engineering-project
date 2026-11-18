import { decideRefund, ensureAdjustment, notFound, planPayout } from '@hulajnogi/core';
import { type Database, type DbExecutor, DrizzleCustomerRepository, DrizzlePaymentRepository } from '@hulajnogi/db';
import type {
  CustomerWalletAdmin,
  ListQuery,
  PaymentAdminDetails,
  ReceiptAdminDetails,
  RentalRefund,
  WalletAdjustment,
  WalletPayoutResult,
} from '@hulajnogi/shared';
import { Inject, Injectable } from '@nestjs/common';
import { AuditedTransaction } from '../audit/audited-transaction.js';
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
  ) {}

  private get repo() {
    return new DrizzlePaymentRepository(this.db);
  }

  listPayments(query: ListQuery) {
    return this.repo.listPayments(query);
  }

  listLedger(query: ListQuery) {
    return this.repo.listLedger(query);
  }

  listWallets(query: ListQuery) {
    return this.repo.listWallets(query);
  }

  listReceipts(query: ListQuery) {
    return this.repo.listReceipts(query);
  }

  listPaymentMethods(query: ListQuery) {
    return this.repo.listPaymentMethods(query);
  }

  listWebhooks(query: ListQuery) {
    return this.repo.listWebhooks(query);
  }

  listRefunds(query: ListQuery) {
    return this.repo.listRefunds(query);
  }

  async payment(id: string): Promise<PaymentAdminDetails> {
    const repo = this.repo;
    const item = await repo.paymentItem(id);
    if (!item) throw notFound('payment', id);
    const [webhooks, refunds] = await Promise.all([repo.webhooksForPayment(id), repo.refundItems({ paymentId: id })]);
    return { ...item, webhooks, refunds };
  }

  async receipt(id: string): Promise<ReceiptAdminDetails> {
    const receipt = await this.repo.receipt(id);
    if (!receipt) throw notFound('receipt', id);
    return receipt;
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
