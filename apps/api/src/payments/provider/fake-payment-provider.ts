import { randomUUID } from 'node:crypto';
import { DomainError } from '@hulajnogi/core';
import type { FakeConfirmResult, PaymentMethodKind } from '@hulajnogi/shared';
import { Logger } from '@nestjs/common';
import type {
  PaymentProvider,
  ProviderCard,
  ProviderEvent,
  ProviderPayment,
  ProviderPaymentStatus,
  ProviderRefund,
  ProviderSetup,
} from './payment-provider.js';
import { signWebhook, verifyWebhookSignature } from './webhook-signature.js';

/** Czas na potwierdzenie BLIK-u w banku (dokumentacja Stripe); kod `999999` go przekracza. */
const BLIK_TIMEOUT_MS = 60_000;

interface FakeCard extends ProviderCard {
  number: string;
  customerId: string;
}

interface FakeSetup {
  id: string;
  secret: string;
  customerId: string;
  userId: string;
  status: ProviderSetup['status'];
  card: FakeCard | null;
  pendingCard: FakeCard | null;
}

interface FakeIntent {
  id: string;
  secret: string;
  amount: number;
  customerId: string;
  method: PaymentMethodKind;
  cardRef: string | null;
  status: ProviderPaymentStatus;
  failureCode: string | null;
  failureMessage: string | null;
  paymentId: string;
  chargeId: string;
}

interface FakeRefund {
  id: string;
  paymentIntentId: string;
  chargeId: string;
  amount: number;
  status: ProviderRefund['status'];
  refundId: string;
}

export interface FakeWebhook {
  body: string;
  signature: string;
}

export interface FakeProviderOptions {
  secret: string;
  delivery: 'http' | 'manual';
  delayMs: number;
  url: string;
}

const newId = (prefix: string) => `${prefix}_fake_${randomUUID().replaceAll('-', '').slice(0, 20)}`;

/** Suma kontrolna Luhna numeru karty. */
function luhn(number: string): boolean {
  let sum = 0;
  for (let i = 0; i < number.length; i++) {
    let d = Number(number[number.length - 1 - i]);
    if (i % 2 === 1) d = d * 2 > 9 ? d * 2 - 9 : d * 2;
    sum += d;
  }
  return sum % 10 === 0;
}

const brandOf = (number: string) =>
  number.startsWith('4') ? 'visa' : /^5[1-5]/.test(number) || /^2[2-7]/.test(number) ? 'mastercard' : 'unknown';

/** Zachowanie kart testowych Stripe (ADR 0050): końcówka numeru wybiera scenariusz. */
const CARD_RULES = {
  declineOnSetup: '4000000000000002',
  requiresAction: '4000000000003220',
  declineOnCharge: '4000000000000341',
  insufficientFunds: '4000000000009995',
};

/**
 * Atrapa operatora płatności w procesie API (D1, ADR 0050): te same przepływy, statusy i kody odmów co
 * karty testowe Stripe, a zdarzenia idą przez ten sam punkt webhooka z podpisem HMAC. Stan jest w pamięci:
 * po restarcie API płatności atrapy w toku rozstrzyga sprawdzenie statusu (nieznany obiekt to odmowa).
 */
export class FakePaymentProvider implements PaymentProvider {
  readonly name = 'fake' as const;
  readonly publishableKey = null;
  readonly blik = true;

  private readonly logger = new Logger('FakePaymentProvider');
  private readonly customers = new Set<string>();
  private readonly cards = new Map<string, FakeCard>();
  private readonly setups = new Map<string, FakeSetup>();
  private readonly intents = new Map<string, FakeIntent>();
  private readonly refunds = new Map<string, FakeRefund>();
  private readonly idempotency = new Map<string, string>();
  private readonly outbox: FakeWebhook[] = [];
  private readonly timers = new Set<NodeJS.Timeout>();

  constructor(private readonly options: FakeProviderOptions) {}

  // --- Port --------------------------------------------------------------------------------------

  createCustomer(): Promise<string> {
    const id = newId('cus');
    this.customers.add(id);
    return Promise.resolve(id);
  }

  createSetupIntent(input: { customerId: string; userId: string }): Promise<{ id: string; clientSecret: string }> {
    const id = newId('seti');
    const setup: FakeSetup = {
      id,
      secret: `${id}_secret_${randomUUID().slice(0, 8)}`,
      customerId: input.customerId,
      userId: input.userId,
      status: 'requires_payment_method',
      card: null,
      pendingCard: null,
    };
    this.setups.set(id, setup);
    return Promise.resolve({ id, clientSecret: setup.secret });
  }

  retrieveSetupIntent(id: string): Promise<ProviderSetup | null> {
    const s = this.setups.get(id);
    return Promise.resolve(
      s
        ? {
            id: s.id,
            status: s.status,
            customerId: s.customerId,
            userId: s.userId,
            card: s.card && this.public(s.card),
          }
        : null,
    );
  }

  createPayment(input: {
    amount: number;
    customerId: string;
    method: PaymentMethodKind;
    paymentMethodRef: string | null;
    idempotencyKey: string;
    paymentId: string;
  }): Promise<{ id: string; clientSecret: string; status: ProviderPaymentStatus }> {
    const intent = this.intentFor(input.idempotencyKey, () => ({
      amount: input.amount,
      customerId: input.customerId,
      method: input.method,
      cardRef: input.paymentMethodRef,
      status: input.method === 'CARD' ? 'requires_confirmation' : 'requires_payment_method',
      paymentId: input.paymentId,
    }));
    return Promise.resolve({ id: intent.id, clientSecret: intent.secret, status: intent.status });
  }

  chargeOffSession(input: {
    amount: number;
    customerId: string;
    paymentMethodRef: string;
    idempotencyKey: string;
    paymentId: string;
  }): Promise<ProviderPayment> {
    const existing = this.idempotency.get(input.idempotencyKey);
    const intent = this.intentFor(input.idempotencyKey, () => ({
      amount: input.amount,
      customerId: input.customerId,
      method: 'CARD',
      cardRef: input.paymentMethodRef,
      status: 'requires_confirmation',
      paymentId: input.paymentId,
    }));
    if (!existing) {
      // Karta uwierzytelniona przy zapisie (SetupIntent `off_session`), więc 3-D Secure nie jest potrzebne.
      const card = this.cards.get(input.paymentMethodRef);
      const failure = !card
        ? 'resource_missing'
        : card.number === CARD_RULES.declineOnCharge
          ? 'card_declined'
          : card.number === CARD_RULES.insufficientFunds
            ? 'insufficient_funds'
            : null;
      this.settle(intent, failure);
    }
    return Promise.resolve(this.view(intent));
  }

  retrievePayment(id: string): Promise<ProviderPayment | null> {
    const intent = this.intents.get(id);
    return Promise.resolve(intent ? this.view(intent) : null);
  }

  cancelPayment(id: string): Promise<ProviderPayment> {
    const intent = this.intents.get(id);
    if (!intent) throw new DomainError('PAYMENT_FAILED', { code: 'resource_missing' });
    if (intent.status !== 'succeeded' && intent.status !== 'processing') intent.status = 'canceled';
    return Promise.resolve(this.view(intent));
  }

  refund(input: {
    paymentIntentId: string;
    amount: number;
    idempotencyKey: string;
    refundId: string;
  }): Promise<ProviderRefund> {
    const known = this.idempotency.get(input.idempotencyKey);
    if (known) return Promise.resolve(this.refundView(this.refunds.get(known)!));
    const intent = this.intents.get(input.paymentIntentId);
    if (!intent || intent.status !== 'succeeded')
      throw new DomainError('PAYMENT_FAILED', { code: 'charge_not_refundable' });
    const refund: FakeRefund = {
      id: newId('re'),
      paymentIntentId: intent.id,
      chargeId: intent.chargeId,
      amount: input.amount,
      status: 'succeeded',
      refundId: input.refundId,
    };
    this.refunds.set(refund.id, refund);
    this.idempotency.set(input.idempotencyKey, refund.id);
    this.emit('refund.updated', this.refundObject(refund));
    return Promise.resolve(this.refundView(refund));
  }

  retrieveRefund(id: string): Promise<ProviderRefund | null> {
    const refund = this.refunds.get(id);
    return Promise.resolve(refund ? this.refundView(refund) : null);
  }

  detachPaymentMethod(ref: string): Promise<void> {
    this.cards.delete(ref);
    return Promise.resolve();
  }

  parseWebhook(rawBody: Buffer, signature: string | undefined): ProviderEvent {
    verifyWebhookSignature(rawBody, signature, this.options.secret);
    return parseStripeLikeEvent(rawBody);
  }

  // --- Potwierdzenia z aplikacji (formularz atrapy, ADR 0051) ------------------------------------

  confirmSetup(
    clientSecret: string,
    card: { cardNumber: string; expMonth: number; expYear: number },
  ): FakeConfirmResult {
    const setup = [...this.setups.values()].find((s) => s.secret === clientSecret);
    if (!setup) throw new DomainError('NOT_FOUND', { entity: 'setup_intent' });
    if (setup.status === 'succeeded') return { status: 'succeeded', failureCode: null };
    if (!luhn(card.cardNumber)) return { status: 'failed', failureCode: 'incorrect_number' };
    if (card.cardNumber === CARD_RULES.declineOnSetup) {
      setup.status = 'requires_payment_method';
      this.emit('setup_intent.setup_failed', this.setupObject(setup, 'card_declined'));
      return { status: 'failed', failureCode: 'card_declined' };
    }
    const saved: FakeCard = {
      ref: newId('pm'),
      number: card.cardNumber,
      brand: brandOf(card.cardNumber),
      last4: card.cardNumber.slice(-4),
      expMonth: card.expMonth,
      expYear: card.expYear,
      customerId: setup.customerId,
    };
    if (card.cardNumber === CARD_RULES.requiresAction) {
      setup.pendingCard = saved;
      setup.status = 'requires_action';
      return { status: 'requires_action', failureCode: null };
    }
    this.completeSetup(setup, saved);
    return { status: 'succeeded', failureCode: null };
  }

  confirmPayment(clientSecret: string, blikCode?: string): FakeConfirmResult {
    const intent = [...this.intents.values()].find((i) => i.secret === clientSecret);
    if (!intent) throw new DomainError('NOT_FOUND', { entity: 'payment_intent' });
    if (intent.status === 'succeeded' || intent.status === 'processing') return this.confirmResult(intent);
    // Anulowanej płatności (po odmowie albo porzuceniu) nie da się potwierdzić, jak w Stripe.
    if (intent.status === 'canceled') return { status: 'failed', failureCode: 'payment_intent_unexpected_state' };
    if (intent.method === 'BLIK') {
      if (!blikCode) return { status: 'failed', failureCode: 'invalid_blik_code' };
      intent.status = 'processing';
      if (blikCode === '000000') this.later(() => this.settle(intent, 'payment_method_provider_decline'));
      else if (blikCode === '999999')
        this.later(() => this.settle(intent, 'payment_intent_payment_attempt_expired'), BLIK_TIMEOUT_MS);
      else this.later(() => this.settle(intent, null));
      return this.confirmResult(intent);
    }
    const card = intent.cardRef ? this.cards.get(intent.cardRef) : undefined;
    if (!card) {
      this.settle(intent, 'resource_missing');
    } else if (card.number === CARD_RULES.requiresAction) {
      intent.status = 'requires_action';
    } else {
      this.settle(
        intent,
        card.number === CARD_RULES.declineOnCharge
          ? 'card_declined'
          : card.number === CARD_RULES.insufficientFunds
            ? 'insufficient_funds'
            : null,
      );
    }
    return this.confirmResult(intent);
  }

  /** Okno 3-D Secure w atrapie: akceptacja kończy zapis karty albo płatność, odrzucenie daje odmowę. */
  authenticate(clientSecret: string, approve: boolean): FakeConfirmResult {
    const setup = [...this.setups.values()].find((s) => s.secret === clientSecret);
    if (setup) {
      if (setup.status !== 'requires_action' || !setup.pendingCard)
        return { status: 'failed', failureCode: 'unexpected_state' };
      if (!approve) {
        setup.status = 'requires_payment_method';
        setup.pendingCard = null;
        this.emit('setup_intent.setup_failed', this.setupObject(setup, 'authentication_failed'));
        return { status: 'failed', failureCode: 'authentication_failed' };
      }
      this.completeSetup(setup, setup.pendingCard);
      return { status: 'succeeded', failureCode: null };
    }
    const intent = [...this.intents.values()].find((i) => i.secret === clientSecret);
    if (!intent) throw new DomainError('NOT_FOUND', { entity: 'payment_intent' });
    if (intent.status !== 'requires_action') return this.confirmResult(intent);
    this.settle(intent, approve ? null : 'authentication_failed');
    return this.confirmResult(intent);
  }

  /** Webhooki czekające na wysłanie (tryb `manual`: testy wysyłają je same przez punkt webhooka). */
  takeOutbox(): FakeWebhook[] {
    return this.outbox.splice(0);
  }

  /** Zdarzenie wysłane jeszcze raz (powtórzone dostarczenie, scenariusz demo krok 4). */
  resign(body: string): FakeWebhook {
    return { body, signature: signWebhook(body, this.options.secret) };
  }

  stop(): void {
    for (const timer of this.timers) clearTimeout(timer);
    this.timers.clear();
  }

  // --- Wewnętrzne ---------------------------------------------------------------------------------

  private intentFor(
    idempotencyKey: string,
    create: () => Omit<FakeIntent, 'id' | 'secret' | 'failureCode' | 'failureMessage' | 'chargeId'>,
  ): FakeIntent {
    const known = this.idempotency.get(idempotencyKey);
    if (known) return this.intents.get(known)!;
    const id = newId('pi');
    const intent: FakeIntent = {
      ...create(),
      id,
      secret: `${id}_secret_${randomUUID().slice(0, 8)}`,
      failureCode: null,
      failureMessage: null,
      chargeId: newId('ch'),
    };
    this.intents.set(id, intent);
    this.idempotency.set(idempotencyKey, id);
    return intent;
  }

  private completeSetup(setup: FakeSetup, card: FakeCard): void {
    this.cards.set(card.ref, card);
    setup.card = card;
    setup.pendingCard = null;
    setup.status = 'succeeded';
    this.emit('setup_intent.succeeded', this.setupObject(setup, null));
  }

  private settle(intent: FakeIntent, failureCode: string | null): void {
    if (intent.status === 'succeeded' || intent.status === 'canceled') return;
    intent.status = failureCode ? 'requires_payment_method' : 'succeeded';
    intent.failureCode = failureCode;
    intent.failureMessage = failureCode ? `Atrapa: ${failureCode}` : null;
    this.emit(failureCode ? 'payment_intent.payment_failed' : 'payment_intent.succeeded', this.intentObject(intent));
  }

  private later(work: () => void, ms = this.options.delayMs): void {
    if (this.options.delivery === 'manual') return work();
    const timer = setTimeout(() => {
      this.timers.delete(timer);
      work();
    }, ms);
    this.timers.add(timer);
  }

  private emit(type: string, object: Record<string, unknown>): void {
    const body = JSON.stringify({
      id: newId('evt'),
      object: 'event',
      type,
      created: Math.floor(Date.now() / 1000),
      data: { object },
    });
    if (this.options.delivery === 'manual') {
      this.outbox.push({ body, signature: signWebhook(body, this.options.secret) });
      return;
    }
    this.later(() => void this.deliver(body));
  }

  private async deliver(body: string): Promise<void> {
    try {
      const response = await fetch(this.options.url, {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'stripe-signature': signWebhook(body, this.options.secret) },
        body,
      });
      if (!response.ok) this.logger.warn(`Webhook atrapy odrzucony: ${response.status}`);
    } catch (error) {
      // Bez dostarczenia płatność rozstrzygnie sprawdzenie statusu po 2 min (ADR 0050).
      this.logger.warn(`Nie wysłano webhooka atrapy: ${(error as Error).message}`);
    }
  }

  private confirmResult(intent: FakeIntent): FakeConfirmResult {
    const status =
      intent.status === 'succeeded'
        ? 'succeeded'
        : intent.status === 'requires_action'
          ? 'requires_action'
          : intent.status === 'processing'
            ? 'processing'
            : 'failed';
    return { status, failureCode: intent.failureCode };
  }

  private public(card: FakeCard): ProviderCard {
    return { ref: card.ref, brand: card.brand, last4: card.last4, expMonth: card.expMonth, expYear: card.expYear };
  }

  private view(intent: FakeIntent): ProviderPayment {
    return {
      id: intent.id,
      status: intent.status,
      failureCode: intent.failureCode,
      failureMessage: intent.failureMessage,
      paymentId: intent.paymentId,
    };
  }

  private refundView(refund: FakeRefund): ProviderRefund {
    return { id: refund.id, status: refund.status, failureReason: null, refundId: refund.refundId };
  }

  private intentObject(intent: FakeIntent): Record<string, unknown> {
    return {
      id: intent.id,
      object: 'payment_intent',
      amount: intent.amount,
      currency: 'pln',
      status: intent.status,
      customer: intent.customerId,
      latest_charge: intent.chargeId,
      last_payment_error: intent.failureCode ? { code: intent.failureCode, message: intent.failureMessage } : null,
      metadata: { paymentId: intent.paymentId },
    };
  }

  private setupObject(setup: FakeSetup, failureCode: string | null): Record<string, unknown> {
    return {
      id: setup.id,
      object: 'setup_intent',
      status: setup.status,
      customer: setup.customerId,
      payment_method: setup.card?.ref ?? null,
      last_setup_error: failureCode ? { code: failureCode } : null,
      metadata: { userId: setup.userId },
    };
  }

  private refundObject(refund: FakeRefund): Record<string, unknown> {
    return {
      id: refund.id,
      object: 'refund',
      amount: refund.amount,
      status: refund.status,
      charge: refund.chargeId,
      payment_intent: refund.paymentIntentId,
      metadata: { refundId: refund.refundId },
    };
  }
}

/** Zdarzenie w formacie Stripe (`data.object`) jako rodzaj i identyfikator obiektu. */
export function parseStripeLikeEvent(rawBody: Buffer): ProviderEvent {
  let event: { id?: string; type?: string; data?: { object?: Record<string, unknown> } };
  try {
    event = JSON.parse(rawBody.toString('utf8')) as typeof event;
  } catch {
    throw new DomainError('WEBHOOK_SIGNATURE_INVALID');
  }
  if (!event.id || !event.type) throw new DomainError('WEBHOOK_SIGNATURE_INVALID');
  const object = event.data?.object ?? {};
  const kind = object.object as string | undefined;
  return {
    id: event.id,
    type: event.type,
    objectKind:
      kind === 'setup_intent' || kind === 'payment_intent' || kind === 'refund' || kind === 'charge' ? kind : 'other',
    objectId: (object.id as string | undefined) ?? null,
    paymentIntentId:
      kind === 'payment_intent'
        ? ((object.id as string | undefined) ?? null)
        : ((object.payment_intent as string | null) ?? null),
    payload: event,
  };
}
