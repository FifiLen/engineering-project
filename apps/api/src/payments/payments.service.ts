import {
  cardState,
  correctionItems,
  DomainError,
  ensureCanPay,
  ensureCanPayDebt,
  ensureTopupAmount,
  isCardUsable,
  nextPaymentStatus,
  notFound,
  PAYMENT_RECONCILE_AFTER_MS,
  priceRental,
  RIDE_CHARGE_RETRY_MS,
  rideCharge,
  rideReceiptItems,
  rideWalletEntries,
  shouldRetryRideCharge,
  TOPUP_MAX,
  TOPUP_MIN,
  TOPUP_PRESETS,
  type PaymentSource,
} from '@hulajnogi/core';
import {
  type CardRecord,
  type Database,
  type DbExecutor,
  DrizzlePaymentRepository,
  DrizzleTariffRepository,
  type PaymentRecord,
  rethrowDatabaseRule,
  type SettlementRental,
} from '@hulajnogi/db';
import type {
  PayDebtRequest,
  PaymentIntentResponse,
  PaymentMethodView,
  PaymentsConfig,
  PaymentView,
  ReceiptParty,
  ReceiptSummary,
  ReceiptView,
  SetupIntentResponse,
  TopupRequest,
  WalletEntry,
  WalletSummary,
  WalletView,
} from '@hulajnogi/shared';
import { Inject, Injectable, Logger, type OnApplicationShutdown, type OnModuleInit } from '@nestjs/common';
import { CONFIG, type AppConfig } from '../config.js';
import { COMPANY_PROFILE, type CompanyProfileProvider } from '../content/company.service.js';
import { DB } from '../database/database.module.js';
import { JOBS, JobsService } from '../jobs/jobs.service.js';
import { NotificationsService } from '../notifications/notifications.service.js';
import { FleetGateway } from '../realtime/fleet.gateway.js';
import { FakePaymentProvider } from './provider/fake-payment-provider.js';
import {
  PAYMENT_PROVIDER,
  paymentStatusFromProvider,
  type PaymentProvider,
  type ProviderRefund,
} from './provider/payment-provider.js';

/** Płatność z udziałem klienta bez wyniku po tym czasie (porzucony BLIK, niedokończone 3-D Secure). */
const PAYMENT_ABANDON_AFTER_MS = 30 * 60_000;

/**
 * Przejścia przejazdu wywołane płatnością (ADR 0049) wykonuje moduł Wypożyczenia w transakcji płatności;
 * moduł Płatności nie zna maszyny stanów przejazdu.
 */
export interface RentalPaymentHandler {
  transition(
    tx: DbExecutor,
    rentalId: string,
    action: 'DECLINE_PAYMENT' | 'SETTLE_DEBT',
    data: Record<string, unknown>,
  ): Promise<void>;
  notify(rentalId: string): Promise<void>;
}

/** Skutki po zatwierdzeniu transakcji: zdarzenia `wallet.updated` i `rental.updated`. */
export class PaymentEffects {
  readonly wallets = new Set<string>();
  readonly rentals = new Set<string>();
}

/**
 * Moduł Płatności (ADR 0049–0052, ADR 0054): karty, doładowania, rozliczenie przejazdu, webhooki i sprawdzanie
 * statusu. Ruch środków to wpis w księdze (`sp_wallet_post`), a status płatności zmienia się tylko po wyniku
 * od operatora: webhooku albo sprawdzeniu statusu.
 */
@Injectable()
export class PaymentsService implements OnModuleInit, OnApplicationShutdown {
  private readonly logger = new Logger(PaymentsService.name);
  private rentalHandler: RentalPaymentHandler | null = null;

  constructor(
    @Inject(DB) private readonly db: Database,
    @Inject(PAYMENT_PROVIDER) private readonly provider: PaymentProvider,
    @Inject(CONFIG) private readonly config: AppConfig,
    private readonly jobs: JobsService,
    private readonly gateway: FleetGateway,
    private readonly notifications: NotificationsService,
    @Inject(COMPANY_PROFILE) private readonly company: CompanyProfileProvider,
  ) {}

  onModuleInit(): void {
    this.jobs.handle(JOBS.chargeRide, async ({ paymentId }) => this.chargeRide(paymentId as string));
    this.jobs.handle(JOBS.retryRideCharge, async ({ rentalId }) => this.retryRideCharge(rentalId as string));
    this.jobs.handle(JOBS.paymentsWebhook, async ({ eventId }) => this.processWebhook(Number(eventId)));
    this.jobs.handle(JOBS.paymentsReconcile, async () => this.reconcile());
  }

  onApplicationShutdown(): void {
    if (this.provider instanceof FakePaymentProvider) this.provider.stop();
  }

  attachRentalHandler(handler: RentalPaymentHandler): void {
    this.rentalHandler = handler;
  }

  paymentsConfig(): PaymentsConfig {
    return {
      provider: this.provider.name,
      publishableKey: this.provider.publishableKey,
      blik: this.provider.blik,
      currency: 'PLN',
      topup: { presets: [...TOPUP_PRESETS], min: TOPUP_MIN, max: TOPUP_MAX },
    };
  }

  /**
   * Dane sprzedawcy z chwili wystawienia paragonu (ADR 0052): z danych firmy modułu Treści przez port
   * `CompanyProfileProvider` (ADR 0062), w transakcji wystawienia; paragon kopiuje je do `receipts.seller`.
   */
  seller(executor: DbExecutor): Promise<ReceiptParty> {
    return this.company.seller(executor);
  }

  // --- Portfel ------------------------------------------------------------------------------------

  async summary(userId: string, executor: DbExecutor = this.db): Promise<WalletSummary> {
    // Zapytania po kolei: `executor` może być klientem transakcji, który nie przyjmuje równoległych zapytań.
    const repo = new DrizzlePaymentRepository(executor);
    const balance = await repo.balance(userId);
    const overdue = await repo.overdue(userId);
    const tariff = await new DrizzleTariffRepository(executor).current();
    return {
      balance,
      minWalletBalance: tariff?.minWalletBalance ?? 0,
      overdue: overdue.map(({ failedAt, ...o }) => ({
        ...o,
        // Jedno automatyczne ponowienie po pierwszej odmowie (pytanie 6).
        retryAt:
          o.failedAttempts === 1 && failedAt && !o.paymentPending
            ? new Date(failedAt.getTime() + RIDE_CHARGE_RETRY_MS).toISOString()
            : null,
      })),
      asOf: new Date().toISOString(),
    };
  }

  async wallet(userId: string, limit: number, before?: number): Promise<WalletView> {
    const [summary, entries] = await Promise.all([this.summary(userId), this.entries(userId, limit, before)]);
    return { ...summary, entries };
  }

  entries(userId: string, limit: number, before?: number): Promise<WalletEntry[]> {
    return new DrizzlePaymentRepository(this.db).walletEntries(userId, limit, before);
  }

  async notifyWallet(userId: string): Promise<void> {
    this.gateway.walletUpdated(userId, await this.summary(userId));
  }

  // --- Karty -------------------------------------------------------------------------------------

  async cards(userId: string): Promise<PaymentMethodView[]> {
    const now = new Date();
    return (await new DrizzlePaymentRepository(this.db).cards(userId)).map((c) => ({
      id: c.id,
      brand: c.brand,
      last4: c.last4,
      expMonth: c.expMonth,
      expYear: c.expYear,
      isDefault: c.isDefault,
      state: cardState(c, now),
      createdAt: c.createdAt.toISOString(),
    }));
  }

  /** Zapis karty (ADR 0050): SetupIntent, potwierdzenie w aplikacji, karta w bazie po webhooku. */
  async setupCard(userId: string): Promise<SetupIntentResponse> {
    const customerId = await this.ensureCustomer(userId);
    const setup = await this.provider.createSetupIntent({ customerId, userId });
    return { setupIntentId: setup.id, clientSecret: setup.clientSecret, provider: this.provider.name };
  }

  async setDefaultCard(userId: string, id: string): Promise<PaymentMethodView[]> {
    const ok = await this.db.transaction((tx) => new DrizzlePaymentRepository(tx).setDefaultCard(userId, id));
    if (!ok) throw notFound('payment_method', id);
    return this.cards(userId);
  }

  /** Usunięcie karty: nie przy przejeździe w toku ani zaległości z tą kartą; u operatora `detach`. */
  async removeCard(userId: string, id: string): Promise<PaymentMethodView[]> {
    const card = await this.db.transaction(async (tx) => {
      const repo = new DrizzlePaymentRepository(tx);
      // Blokada portfela przed sprawdzeniem, jak przy starcie kartą: start i usunięcie karty bez wyścigu.
      await repo.lockWallet(userId);
      const found = await repo.card(id);
      if (!found || found.userId !== userId || found.removedAt) throw notFound('payment_method', id);
      if (await repo.cardInUse(id)) throw new DomainError('PAYMENT_METHOD_IN_USE');
      await repo.removeCard(userId, id);
      return found;
    });
    if (card.provider === this.provider.name) {
      await this.provider.detachPaymentMethod(card.providerRef).catch((error: Error) => {
        this.logger.warn(`Nie odłączono karty ${card.id} u operatora: ${error.message}`);
      });
    }
    await this.notifyWallet(userId);
    return this.cards(userId);
  }

  private async ensureCustomer(userId: string): Promise<string> {
    const repo = new DrizzlePaymentRepository(this.db);
    const existing = await repo.providerCustomer(userId, this.provider.name);
    if (existing) return existing;
    return repo.saveProviderCustomer(userId, this.provider.name, await this.provider.createCustomer({ userId }));
  }

  /** Karta wybrana przez klienta (własna, niewyrejestrowana, u bieżącego operatora) albo domyślna. */
  private async chooseCard(repo: DrizzlePaymentRepository, userId: string, id: string | null | undefined) {
    const card = id ? await repo.card(id) : await repo.defaultCard(userId);
    return card && card.userId === userId && !card.removedAt && card.provider === this.provider.name ? card : null;
  }

  // --- Doładowanie i płatność z udziałem klienta ---------------------------------------------------

  async topup(userId: string, body: TopupRequest): Promise<PaymentIntentResponse> {
    ensureTopupAmount(body.amount);
    const repo = new DrizzlePaymentRepository(this.db);
    let card: CardRecord | null = null;
    if (body.method === 'CARD') {
      card = await this.chooseCard(repo, userId, body.paymentMethodId);
      if (!isCardUsable(card, new Date())) throw new DomainError('PAYMENT_METHOD_REQUIRED');
    } else if (!this.provider.blik) {
      throw new DomainError('VALIDATION_FAILED', { field: 'method' });
    }
    return this.startCustomerPayment(userId, { purpose: 'TOPUP', rentalId: null, amount: body.amount, card });
  }

  private async startCustomerPayment(
    userId: string,
    input: { purpose: 'TOPUP' | 'RIDE'; rentalId: string | null; amount: number; card: CardRecord | null },
  ): Promise<PaymentIntentResponse> {
    const customerId = await this.ensureCustomer(userId);
    let payment: PaymentRecord;
    try {
      payment = await this.insertCustomerPayment(new DrizzlePaymentRepository(this.db), userId, input);
    } catch (error) {
      rethrowDatabaseRule(error);
    }
    return this.openIntent(payment, customerId, input.card);
  }

  private insertCustomerPayment(
    repo: DrizzlePaymentRepository,
    userId: string,
    input: { purpose: 'TOPUP' | 'RIDE'; rentalId: string | null; amount: number; card: CardRecord | null },
  ): Promise<PaymentRecord> {
    return repo.insertPayment({
      userId,
      purpose: input.purpose,
      rentalId: input.rentalId,
      method: input.card ? 'CARD' : 'BLIK',
      paymentMethodId: input.card?.id ?? null,
      amount: input.amount,
      provider: this.provider.name,
    });
  }

  /** PaymentIntent u operatora dla zapisanej płatności `PENDING`; bez operatora płatność kończy się odmową. */
  private async openIntent(
    payment: PaymentRecord,
    customerId: string,
    card: CardRecord | null,
  ): Promise<PaymentIntentResponse> {
    try {
      const intent = await this.provider.createPayment({
        amount: payment.amount,
        customerId,
        method: payment.method,
        paymentMethodRef: card?.providerRef ?? null,
        idempotencyKey: payment.idempotencyKey,
        paymentId: payment.id,
      });
      await new DrizzlePaymentRepository(this.db).setProviderPayment(payment.id, intent.id);
      return {
        paymentId: payment.id,
        status: 'PENDING',
        clientSecret: intent.clientSecret,
        provider: this.provider.name,
        providerPaymentMethodId: card?.providerRef ?? null,
      };
    } catch (error) {
      await this.applyPaymentResult(payment.id, 'FAILED', { code: 'provider_unavailable', reason: null });
      throw error;
    }
  }

  async payment(userId: string, id: string): Promise<PaymentView> {
    const repo = new DrizzlePaymentRepository(this.db);
    const payment = await repo.payment(id);
    if (!payment || payment.userId !== userId) throw notFound('payment', id);
    return repo.paymentView(payment);
  }

  // --- Reguła startu i rozliczenie przejazdu (ADR 0049) --------------------------------------------

  /**
   * Reguła rezerwacji i startu w transakcji przejazdu, pod blokadą portfela. Zwraca źródło płatności i kartę,
   * które zapamięta przejazd.
   */
  async ensureCanPay(
    tx: DbExecutor,
    userId: string,
    input: { source: PaymentSource; paymentMethodId?: string | null; tariffId: string },
  ): Promise<{ source: PaymentSource; paymentMethodId: string | null }> {
    const repo = new DrizzlePaymentRepository(tx);
    const balance = await repo.lockWallet(userId);
    const overdue = await repo.unpaidRentalIds(userId);
    const tariff = await new DrizzleTariffRepository(tx).details(input.tariffId);
    const card = await this.chooseCard(repo, userId, input.source === 'CARD' ? input.paymentMethodId : null);
    ensureCanPay({
      source: input.source,
      balance,
      minWalletBalance: tariff?.minWalletBalance ?? 0,
      overdueRentalIds: overdue,
      card,
      now: new Date(),
    });
    return { source: input.source, paymentMethodId: input.source === 'CARD' ? card!.id : null };
  }

  /**
   * Rozliczenie w transakcji `ENDED` (D4): portfel od razu z paragonem, karta jako płatność `PENDING`
   * z zadaniem obciążenia. Kwota 0 bez obciążenia. Zwraca sposób rozliczenia (powiadomienie `ride_ended`
   * przy karcie wysyła dopiero wynik płatności).
   */
  async settleRide(tx: DbExecutor, rentalId: string, effects: PaymentEffects): Promise<'NONE' | 'WALLET' | 'CARD'> {
    const repo = new DrizzlePaymentRepository(tx);
    const rental = (await repo.settlementRental(rentalId))!;
    const charge = rideCharge(rental.totalAmount ?? 0, rental.paymentSource);
    if (charge.kind === 'NONE') return 'NONE';
    if (charge.kind === 'WALLET') {
      // Opłata za odholowanie to osobny wpis w tej samej transakcji; saldo może spaść poniżej zera (ADR 0060).
      await this.postRideCharges(repo, rental);
      await this.issueRideReceipt(tx, rental, 'WALLET', null);
      effects.wallets.add(rental.userId);
      return 'WALLET';
    }
    const payment = await repo.insertPayment({
      userId: rental.userId,
      purpose: 'RIDE',
      rentalId,
      method: 'CARD',
      paymentMethodId: rental.paymentMethodId,
      amount: charge.amount,
      provider: this.provider.name,
    });
    await this.jobs.sendInTransaction(tx, JOBS.chargeRide, { paymentId: payment.id }, new Date());
    return 'CARD';
  }

  /** Zadanie `payment.charge-ride`: obciążenie zapisanej karty bez udziału klienta (ADR 0050). */
  async chargeRide(paymentId: string): Promise<void> {
    const repo = new DrizzlePaymentRepository(this.db);
    const payment = await repo.payment(paymentId);
    if (payment?.status !== 'PENDING' || payment.purpose !== 'RIDE') return;
    const card = payment.paymentMethodId ? await repo.card(payment.paymentMethodId) : null;
    const customerId = await repo.providerCustomer(payment.userId, this.provider.name);
    if (!card || card.removedAt || card.provider !== this.provider.name || !customerId) {
      await this.applyPaymentResult(paymentId, 'FAILED', { code: 'payment_method_unavailable', reason: null });
      return;
    }
    let result;
    try {
      result = await this.provider.chargeOffSession({
        amount: payment.amount,
        customerId,
        paymentMethodRef: card.providerRef,
        idempotencyKey: payment.idempotencyKey,
        paymentId,
      });
    } catch (error) {
      if (error instanceof DomainError && error.code === 'PAYMENT_FAILED') {
        // Trwała odmowa operatora (np. nieprawidłowa karta u operatora): zaległość zamiast ponawiania.
        await this.applyPaymentResult(paymentId, 'FAILED', { code: String(error.details?.code), reason: null });
        return;
      }
      // Operator niedostępny: płatność czeka, sprawdzenie statusu ponowi zadanie z tym samym kluczem.
      this.logger.warn(`Obciążenie ${paymentId} nie doszło do operatora: ${(error as Error).message}`);
      return;
    }
    if (result.id) await repo.setProviderPayment(paymentId, result.id);
    // Odmowa (402) od razu; sukces przychodzi webhookiem (ADR 0050).
    if (paymentStatusFromProvider(result) === 'FAILED') {
      await this.failPayment(paymentId, { code: result.failureCode, reason: result.failureMessage });
    }
  }

  /**
   * Odmowa albo porzucenie płatności: najpierw anulowanie PaymentIntent u operatora, żeby nie dało się go
   * potwierdzić później (ponowne potwierdzenie po odmowie, spóźniony klient). Jeśli płatność zdążyła przejść,
   * zapisujemy sukces; jeśli operator jest niedostępny albo płatność się przetwarza, zostaje `PENDING`.
   */
  private async failPayment(
    paymentId: string,
    failure: { code: string | null; reason: string | null },
  ): Promise<boolean> {
    const payment = await new DrizzlePaymentRepository(this.db).payment(paymentId);
    if (payment?.status !== 'PENDING') return false;
    if (!payment.providerPaymentId) return this.applyPaymentResult(paymentId, 'FAILED', failure);
    let state;
    try {
      state = await this.provider.cancelPayment(payment.providerPaymentId);
    } catch (error) {
      if (!(error instanceof DomainError && error.code === 'PAYMENT_FAILED')) {
        this.logger.warn(`Nie anulowano płatności ${paymentId}: ${(error as Error).message}`);
        return false;
      }
      return this.applyPaymentResult(paymentId, 'FAILED', failure);
    }
    if (state.status === 'succeeded')
      return this.applyPaymentResult(paymentId, 'SUCCEEDED', { code: null, reason: null });
    if (state.status === 'processing') return false;
    return this.applyPaymentResult(paymentId, 'FAILED', failure);
  }

  /** Zadanie `payment.retry-ride` po 24 h (pytanie 6): spłata przed ponowieniem kończy sprawę. */
  async retryRideCharge(rentalId: string): Promise<void> {
    const paymentId = await this.db.transaction(async (tx) => {
      const repo = new DrizzlePaymentRepository(tx);
      const rental = await repo.settlementRental(rentalId, true);
      if (rental?.state !== 'UNPAID' || (await repo.pendingRidePayment(rentalId))) return null;
      const card = await this.chooseCard(repo, rental.userId, rental.paymentMethodId);
      const usable = isCardUsable(card, new Date()) ? card : await this.chooseCard(repo, rental.userId, null);
      if (!isCardUsable(usable, new Date())) return null;
      return (
        await repo.insertPayment({
          userId: rental.userId,
          purpose: 'RIDE',
          rentalId,
          method: 'CARD',
          paymentMethodId: usable.id,
          amount: rental.totalAmount ?? 0,
          provider: this.provider.name,
        })
      ).id;
    });
    if (paymentId) await this.chargeRide(paymentId);
  }

  /** Spłata zaległości (ADR 0049): z portfela całą kwotą od razu albo kartą z udziałem klienta. */
  async payDebt(userId: string, rentalId: string, body: PayDebtRequest): Promise<PaymentIntentResponse | null> {
    const effects = new PaymentEffects();
    // Klient u operatora przed transakcją (wywołanie sieciowe); płatność kartą powstaje pod blokadą przejazdu,
    // więc równoległa spłata z portfela widzi ją jako płatność w toku.
    const customerId = body.source === 'CARD' ? await this.ensureCustomer(userId) : null;
    const result = await this.transaction(effects, async (tx) => {
      const repo = new DrizzlePaymentRepository(tx);
      const rental = await repo.settlementRental(rentalId, true);
      if (!rental || rental.userId !== userId) throw notFound('rental', rentalId);
      if (rental.state !== 'UNPAID') throw new DomainError('RENTAL_NOT_UNPAID', { state: rental.state });
      const balance = await repo.lockWallet(userId);
      const card = await this.chooseCard(repo, userId, body.source === 'CARD' ? body.paymentMethodId : null);
      ensureCanPayDebt({
        source: body.source,
        amount: rental.totalAmount ?? 0,
        balance,
        card,
        paymentPending: (await repo.pendingRidePayment(rentalId)) !== null,
        now: new Date(),
      });
      if (body.source === 'CARD') {
        const payment = await this.insertCustomerPayment(repo, userId, {
          purpose: 'RIDE',
          rentalId,
          amount: rental.totalAmount ?? 0,
          card,
        });
        return { payment, card: card! };
      }
      await this.postRideCharges(repo, rental);
      await this.requireHandler().transition(tx, rentalId, 'SETTLE_DEBT', { source: 'WALLET' });
      await this.issueRideReceipt(tx, rental, 'WALLET', null);
      effects.wallets.add(userId);
      effects.rentals.add(rentalId);
      return null;
    });
    if (!result) return null;
    return this.openIntent(result.payment, customerId!, result.card);
  }

  // --- Wynik płatności od operatora ------------------------------------------------------------------

  /**
   * Zmiana statusu płatności z wyniku operatora (webhook, sprawdzenie statusu, odmowa przy obciążeniu).
   * Powtórzony albo spóźniony wynik nic nie zmienia (`nextPaymentStatus`); zwraca, czy coś się zmieniło.
   */
  async applyPaymentResult(
    paymentId: string,
    status: 'SUCCEEDED' | 'FAILED',
    failure: { code: string | null; reason: string | null },
  ): Promise<boolean> {
    const effects = new PaymentEffects();
    return this.transaction(effects, async (tx) => {
      const repo = new DrizzlePaymentRepository(tx);
      const payment = await repo.lockPayment(paymentId);
      if (!payment) return false;
      const next = nextPaymentStatus(payment.status, status);
      if (!next) return false;
      await repo.setPaymentStatus(paymentId, next, next === 'FAILED' ? failure : { code: null, reason: null });
      effects.wallets.add(payment.userId);
      if (payment.purpose === 'TOPUP') {
        if (next === 'SUCCEEDED') {
          await repo.post({ userId: payment.userId, type: 'TOPUP', amount: payment.amount, paymentId });
        }
        return true;
      }
      const rental = (await repo.settlementRental(payment.rentalId!, true))!;
      effects.rentals.add(rental.id);
      if (next === 'SUCCEEDED') {
        if (rental.state === 'UNPAID') {
          await this.requireHandler().transition(tx, rental.id, 'SETTLE_DEBT', { source: 'CARD', paymentId });
        }
        if (!(await repo.saleReceipt(rental.id))) {
          await this.issueRideReceipt(tx, rental, 'CARD', paymentId);
          // `ride_ended` przejazdu kartą po paragonie (ADR 0058); spłata zaległości kartą też ma paragon.
          await this.notifications.rideEnded(tx, rental, true);
        }
        return true;
      }
      // Odmowa tylko wtedy, gdy przejazd nie jest opłacony inaczej (portfel, inna płatność kartą).
      if (rental.state === 'ENDED' && (await repo.rentalRefundBase(rental.id)).settlement === 'FAILED') {
        await this.requireHandler().transition(tx, rental.id, 'DECLINE_PAYMENT', {
          paymentId,
          failureCode: failure.code,
        });
        // `payment_failed` (ADR 0058): zaległość do spłaty w aplikacji; jedno na przejazd.
        await this.notifications.paymentFailed(tx, rental);
        if (shouldRetryRideCharge(await repo.failedRideAttempts(rental.id))) {
          await this.jobs.sendInTransaction(
            tx,
            JOBS.retryRideCharge,
            { rentalId: rental.id },
            new Date(Date.now() + RIDE_CHARGE_RETRY_MS),
          );
        }
      }
      return true;
    });
  }

  /** Obciążenie portfela za przejazd: `RIDE_CHARGE` i osobny `TOWING_FEE` przez `sp_wallet_post` (ADR 0060). */
  private async postRideCharges(repo: DrizzlePaymentRepository, rental: SettlementRental): Promise<void> {
    for (const entry of rideWalletEntries(rental.totalAmount ?? 0, rental.towingFee)) {
      await repo.post({ userId: rental.userId, type: entry.type, amount: -entry.amount, rentalId: rental.id });
    }
  }

  /** Paragon przejazdu z pozycjami z wyceny i stawką VAT z wersji cennika przejazdu; odholowanie poza VAT (ADR 0052, 0060, 0061). */
  private async issueRideReceipt(
    tx: DbExecutor,
    rental: SettlementRental,
    source: PaymentSource,
    paymentId: string | null,
  ): Promise<void> {
    const tariff = (await new DrizzleTariffRepository(tx).details(rental.tariffId))!;
    const price = priceRental(tariff, rental, { towingFee: rental.towingFee });
    if (price.total !== rental.totalAmount) {
      this.logger.warn(
        `Paragon przejazdu ${rental.number}: wycena ${price.total} różna od kwoty ${rental.totalAmount}`,
      );
    }
    await new DrizzlePaymentRepository(tx).issueReceipt({
      userId: rental.userId,
      kind: 'SALE',
      rentalId: rental.id,
      paymentId,
      refundId: null,
      correctsReceiptId: null,
      paymentSource: source,
      seller: await this.seller(tx),
      items: rideReceiptItems(price, tariff, tariff.vatRate),
    });
  }

  /**
   * Korekta paragonu po udanym zwrocie za przejazd (ADR 0052): zwrot dzielony między grupy stawek paragonu
   * proporcjonalnie do kwot pozostałych po wcześniejszych korektach (ADR 0061).
   */
  async issueCorrection(tx: DbExecutor, refundId: string): Promise<void> {
    const repo = new DrizzlePaymentRepository(tx);
    const refund = (await repo.refund(refundId))!;
    const sale = refund.rentalId ? await repo.saleReceipt(refund.rentalId) : null;
    if (!sale) return;
    await repo.issueReceipt({
      userId: refund.userId,
      kind: 'CORRECTION',
      rentalId: refund.rentalId,
      paymentId: null,
      refundId,
      correctsReceiptId: sale.id,
      paymentSource: refund.source,
      seller: await this.seller(tx),
      items: correctionItems(refund.amount, sale.items, sale.corrected),
    });
  }

  // --- Zwroty u operatora -----------------------------------------------------------------------------

  /** Zlecenie zwrotu u operatora po zatwierdzeniu polecenia; klucz idempotencji z identyfikatora zwrotu. */
  async executeProviderRefund(refundId: string): Promise<void> {
    const repo = new DrizzlePaymentRepository(this.db);
    const refund = await repo.refund(refundId);
    if (refund?.status !== 'PENDING') return;
    const payment = refund.paymentId ? await repo.payment(refund.paymentId) : null;
    if (!payment?.providerPaymentId || payment.provider !== this.provider.name) {
      await this.applyRefundResult(refundId, 'FAILED', 'payment_not_refundable');
      return;
    }
    let result: ProviderRefund;
    try {
      result = await this.provider.refund({
        paymentIntentId: payment.providerPaymentId,
        amount: refund.amount,
        idempotencyKey: `refund-${refund.id}`,
        refundId: refund.id,
      });
    } catch (error) {
      if (error instanceof DomainError && error.code === 'PAYMENT_FAILED') {
        await this.applyRefundResult(refundId, 'FAILED', String(error.details?.code ?? 'refund_failed'));
        return;
      }
      // Niedostępny operator: sprawdzenie statusu ponowi zlecenie z tym samym kluczem.
      this.logger.warn(`Zwrot ${refundId} nie doszedł do operatora: ${(error as Error).message}`);
      return;
    }
    await repo.setRefundProvider(refundId, result.id);
  }

  /**
   * Wynik zwrotu od operatora (ADR 0054): sukces daje korektę paragonu i status `REFUNDED` przy zwrocie
   * całości, odmowa zwrotu salda dopisuje wpis odwracający `PAYOUT`.
   */
  async applyRefundResult(
    refundId: string,
    status: 'SUCCEEDED' | 'FAILED',
    failureReason: string | null,
  ): Promise<boolean> {
    const effects = new PaymentEffects();
    return this.transaction(effects, async (tx) => {
      const repo = new DrizzlePaymentRepository(tx);
      const refund = await repo.lockRefund(refundId);
      if (refund?.status !== 'PENDING') return false;
      await repo.setRefundStatus(refundId, status, status === 'FAILED' ? failureReason : null);
      effects.wallets.add(refund.userId);
      if (refund.rentalId) effects.rentals.add(refund.rentalId);
      if (status === 'SUCCEEDED') {
        if (refund.rentalId) await this.issueCorrection(tx, refundId);
        const payment = refund.paymentId ? await repo.lockPayment(refund.paymentId) : null;
        if (payment && (await repo.refundedTotal(payment.id)) >= payment.amount) {
          const next = nextPaymentStatus(payment.status, 'REFUNDED');
          if (next) await repo.setPaymentStatus(payment.id, next);
        }
      } else if (refund.reason === 'BALANCE_PAYOUT') {
        await repo.post({
          userId: refund.userId,
          type: 'PAYOUT',
          amount: refund.amount,
          refundId,
          paymentId: refund.paymentId,
          note: `provider_refund_failed:${failureReason ?? 'unknown'}`,
        });
      }
      return true;
    });
  }

  private async applyProviderRefund(refund: ProviderRefund): Promise<boolean> {
    const repo = new DrizzlePaymentRepository(this.db);
    const ours = refund.refundId ? await repo.refund(refund.refundId) : await repo.refundByProviderId(refund.id);
    if (!ours) return false;
    await repo.setRefundProvider(ours.id, refund.id);
    if (refund.status === 'succeeded') return this.applyRefundResult(ours.id, 'SUCCEEDED', null);
    if (refund.status === 'failed' || refund.status === 'canceled') {
      return this.applyRefundResult(ours.id, 'FAILED', refund.failureReason);
    }
    return false;
  }

  // --- Webhooki (ADR 0050) -----------------------------------------------------------------------------

  /** Zapis zdarzenia przed przetworzeniem i odpowiedź od razu; przetwarzanie w zadaniu `payments.webhook`. */
  async receiveWebhook(rawBody: Buffer | undefined, signature: string | undefined): Promise<void> {
    if (!rawBody) throw new DomainError('WEBHOOK_SIGNATURE_INVALID');
    const event = this.provider.parseWebhook(rawBody, signature);
    await this.db.transaction(async (tx) => {
      const recorded = await new DrizzlePaymentRepository(tx).recordWebhook({
        provider: this.provider.name,
        providerEventId: event.id,
        type: event.type,
        objectId: event.objectId,
        payload: event.payload,
      });
      // Powtórzone dostarczenie zdarzenia, którego nie udało się przetworzyć, przetwarza je jeszcze raz.
      if (recorded.inserted || !recorded.processed) {
        await this.jobs.sendInTransaction(tx, JOBS.paymentsWebhook, { eventId: recorded.id }, new Date());
      }
    });
  }

  /**
   * Przetworzenie zdarzenia: obiekt pobrany od operatora decyduje o stanie, więc kolejność zdarzeń nie ma
   * znaczenia, a drugie przetworzenie tego samego obiektu nic nie zmienia.
   */
  async processWebhook(eventId: number): Promise<void> {
    const repo = new DrizzlePaymentRepository(this.db);
    const webhook = await repo.webhook(eventId);
    if (!webhook || webhook.processedAt) return;
    const object = webhook.object;
    try {
      const kind = object.object as string | undefined;
      const outcome =
        kind === 'payment_intent' && webhook.objectId
          ? await this.syncPayment(webhook.objectId)
          : kind === 'setup_intent' && webhook.objectId
            ? { result: (await this.syncSetup(webhook.objectId)) ? 'APPLIED' : 'NO_CHANGE', paymentId: null }
            : kind === 'refund' && webhook.objectId
              ? await this.syncRefund(webhook.objectId)
              : kind === 'charge' && typeof object.payment_intent === 'string'
                ? await this.syncRefundsOfPayment(object.payment_intent)
                : { result: 'IGNORED', paymentId: null };
      await repo.markWebhook(
        eventId,
        outcome as { result: 'APPLIED' | 'NO_CHANGE' | 'IGNORED'; paymentId: string | null },
      );
    } catch (error) {
      // Zdarzenie zostaje nieprzetworzone: ponowi je pg-boss albo kolejne dostarczenie od operatora.
      this.logger.error(`Webhook ${webhook.providerEventId}: ${(error as Error).message}`);
      await repo.markWebhookFailed(eventId, (error as Error).message);
      throw error;
    }
  }

  private async syncPayment(providerPaymentId: string): Promise<{ result: string; paymentId: string | null }> {
    const intent = await this.provider.retrievePayment(providerPaymentId);
    if (!intent) return { result: 'IGNORED', paymentId: null };
    const repo = new DrizzlePaymentRepository(this.db);
    const payment = intent.paymentId
      ? await repo.payment(intent.paymentId)
      : await repo.paymentByProviderId(providerPaymentId);
    if (!payment) return { result: 'IGNORED', paymentId: null };
    await repo.setProviderPayment(payment.id, intent.id);
    const status = paymentStatusFromProvider(intent);
    const failure = { code: intent.failureCode, reason: intent.failureMessage };
    const changed =
      status === 'SUCCEEDED'
        ? await this.applyPaymentResult(payment.id, status, failure)
        : status === 'FAILED' && (await this.failPayment(payment.id, failure));
    return { result: changed ? 'APPLIED' : 'NO_CHANGE', paymentId: payment.id };
  }

  /** Karta zapisana po `setup_intent.succeeded`; pierwsza karta zostaje domyślną. */
  private async syncSetup(setupIntentId: string): Promise<boolean> {
    const setup = await this.provider.retrieveSetupIntent(setupIntentId);
    if (setup?.status !== 'succeeded' || !setup.card) return false;
    const repo = new DrizzlePaymentRepository(this.db);
    const userId =
      setup.userId ??
      (setup.customerId ? await repo.userByProviderCustomer(this.provider.name, setup.customerId) : null);
    if (!userId) return false;
    const saved = await this.db.transaction((tx) =>
      new DrizzlePaymentRepository(tx).saveCard({
        userId,
        provider: this.provider.name,
        providerRef: setup.card!.ref,
        ...setup.card!,
      }),
    );
    if (saved.created) await this.notifyWallet(userId);
    return saved.created;
  }

  private async syncRefund(providerRefundId: string): Promise<{ result: string; paymentId: string | null }> {
    const refund = await this.provider.retrieveRefund(providerRefundId);
    if (!refund) return { result: 'IGNORED', paymentId: null };
    const changed = await this.applyProviderRefund(refund);
    const ours = await new DrizzlePaymentRepository(this.db).refundByProviderId(providerRefundId);
    return { result: changed ? 'APPLIED' : 'NO_CHANGE', paymentId: ours?.paymentId ?? null };
  }

  /** `charge.refunded`: zwroty w toku tej płatności pobrane od operatora. */
  private async syncRefundsOfPayment(providerPaymentId: string): Promise<{ result: string; paymentId: string | null }> {
    const repo = new DrizzlePaymentRepository(this.db);
    const payment = await repo.paymentByProviderId(providerPaymentId);
    if (!payment) return { result: 'IGNORED', paymentId: null };
    let changed = false;
    for (const refund of await repo.refundsForPayment(payment.id)) {
      if (refund.status !== 'PENDING' || !refund.providerRefundId) continue;
      const remote = await this.provider.retrieveRefund(refund.providerRefundId);
      if (remote) changed = (await this.applyProviderRefund(remote)) || changed;
    }
    return { result: changed ? 'APPLIED' : 'NO_CHANGE', paymentId: payment.id };
  }

  // --- Sprawdzanie statusu bez webhooka (`payments.reconcile`, makieta tech-doladowanie) ----------------

  async reconcile(now = new Date()): Promise<void> {
    const repo = new DrizzlePaymentRepository(this.db);
    const before = new Date(now.getTime() - PAYMENT_RECONCILE_AFTER_MS);
    // Kolejka od najdawniej sprawdzanych: nierozstrzygnięty rekord idzie na koniec i nie blokuje nowszych.
    for (const id of await repo.pendingPayments(before)) {
      try {
        await this.reconcilePayment(id, now);
      } catch (error) {
        this.logger.warn(`Sprawdzenie płatności ${id}: ${(error as Error).message}`);
      }
      await repo.touchPendingPayment(id);
    }
    for (const id of await repo.pendingRefunds(before)) {
      await repo.touchPendingRefund(id);
      try {
        const refund = (await repo.refund(id))!;
        if (!refund.providerRefundId) {
          await this.executeProviderRefund(id);
          continue;
        }
        const remote = await this.provider.retrieveRefund(refund.providerRefundId);
        if (remote) await this.applyProviderRefund(remote);
        else await this.applyRefundResult(id, 'FAILED', 'provider_unknown');
      } catch (error) {
        this.logger.warn(`Sprawdzenie zwrotu ${id}: ${(error as Error).message}`);
      }
    }
  }

  private async reconcilePayment(id: string, now: Date): Promise<void> {
    const repo = new DrizzlePaymentRepository(this.db);
    const payment = (await repo.payment(id))!;
    const abandoned = now.getTime() - payment.createdAt.getTime() > PAYMENT_ABANDON_AFTER_MS;
    if (!payment.providerPaymentId) {
      // Zadanie obciążenia się zgubiło (np. restart API): ponowienie z tym samym kluczem idempotencji.
      if (payment.purpose === 'RIDE' && !payment.paymentMethodId) {
        await this.applyPaymentResult(id, 'FAILED', { code: 'payment_method_unavailable', reason: null });
      } else if (payment.purpose === 'RIDE' && payment.method === 'CARD') {
        await this.chargeRide(id);
      } else if (abandoned) {
        await this.applyPaymentResult(id, 'FAILED', { code: 'expired', reason: null });
      }
      return;
    }
    // Odmowa i porzucenie przez `failPayment`: anulowanie u operatora przed zapisaniem odmowy.
    const intent = await this.provider.retrievePayment(payment.providerPaymentId);
    if (!intent) {
      await this.applyPaymentResult(id, 'FAILED', { code: 'provider_unknown', reason: null });
      return;
    }
    const status = paymentStatusFromProvider(intent);
    if (status === 'SUCCEEDED') {
      await this.applyPaymentResult(id, status, { code: null, reason: null });
    } else if (status === 'FAILED') {
      await this.failPayment(id, { code: intent.failureCode, reason: intent.failureMessage });
    } else if (abandoned && intent.status !== 'processing') {
      await this.failPayment(id, { code: 'expired', reason: null });
    }
  }

  // --- Paragony klienta ----------------------------------------------------------------------------

  receipts(userId: string, limit: number): Promise<ReceiptSummary[]> {
    return new DrizzlePaymentRepository(this.db).receiptsForUser(userId, limit);
  }

  async receipt(userId: string, id: string): Promise<ReceiptView> {
    const receipt = await new DrizzlePaymentRepository(this.db).receipt(id);
    if (!receipt || receipt.userId !== userId) throw notFound('receipt', id);
    return {
      id: receipt.id,
      number: receipt.number,
      kind: receipt.kind,
      issuedAt: receipt.issuedAt,
      rentalId: receipt.rentalId,
      rentalNumber: receipt.rentalNumber,
      totalAmount: receipt.totalAmount,
      paymentSource: receipt.paymentSource,
      card: receipt.card,
      items: receipt.items,
      vatRate: receipt.vatRate,
      vatAmount: receipt.vatAmount,
      vatGroups: receipt.vatGroups,
      netAmount: receipt.netAmount,
      seller: receipt.seller,
      buyer: receipt.buyer,
      correctsReceiptId: receipt.correctsReceiptId,
      correctsNumber: receipt.correctsNumber,
      corrections: receipt.corrections,
    };
  }

  // --- Wspólne -------------------------------------------------------------------------------------------

  /** Transakcja płatności z błędami bazy jako błędami domeny i zdarzeniami po zatwierdzeniu. */
  async transaction<T>(effects: PaymentEffects, work: (tx: DbExecutor) => Promise<T>): Promise<T> {
    let result: T;
    try {
      result = await this.db.transaction(work);
    } catch (error) {
      if (error instanceof DomainError) throw error;
      rethrowDatabaseRule(error);
    }
    await this.afterCommit(effects);
    return result;
  }

  async afterCommit(effects: PaymentEffects): Promise<void> {
    for (const userId of effects.wallets) await this.notifyWallet(userId);
    for (const rentalId of effects.rentals) await this.rentalHandler?.notify(rentalId);
  }

  private requireHandler(): RentalPaymentHandler {
    if (!this.rentalHandler) throw new Error('Moduł Wypożyczenia nie zarejestrował obsługi płatności');
    return this.rentalHandler;
  }
}
