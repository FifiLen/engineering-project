import { DomainError } from '@hulajnogi/core';
import type { PaymentMethodKind } from '@hulajnogi/shared';
import Stripe from 'stripe';
import { parseStripeLikeEvent } from './fake-payment-provider.js';
import type {
  PaymentProvider,
  ProviderPayment,
  ProviderPaymentStatus,
  ProviderRefund,
  ProviderSetup,
} from './payment-provider.js';

/** Wersja API przypięta jawnie (ADR 0050): ta, z którą wydano bibliotekę `stripe` 23.1.0. */
export const STRIPE_API_VERSION = '2026-10-28.endive';

export interface StripeProviderOptions {
  secretKey: string;
  publishableKey: string;
  webhookSecret: string;
  blik: boolean;
}

/**
 * Błąd operatora jako błąd domeny: odrzucone żądanie (np. zwrot po terminie, nieprawidłowy obiekt) jest
 * trwałe (`PAYMENT_FAILED`), a błąd sieci, limitu albo usługi to niedostępność, po której ponawiamy (ADR 0050).
 */
function unavailable(error: unknown): never {
  if (error instanceof DomainError) throw error;
  const e = error as { type?: string; code?: string; decline_code?: string; message?: string };
  if (e.type === 'StripeInvalidRequestError' || e.type === 'StripeCardError') {
    throw new DomainError('PAYMENT_FAILED', { code: e.decline_code ?? e.code ?? 'request_rejected' });
  }
  throw new DomainError('PAYMENT_PROVIDER_UNAVAILABLE', { message: e.message });
}

const idOf = (value: string | { id: string } | null | undefined): string | null =>
  typeof value === 'string' ? value : (value?.id ?? null);

/**
 * Stripe w trybie testowym (ADR 0050). Kluczy nie ma w repozytorium; konfiguracja odrzuca klucze `live`.
 * Numer karty nie przechodzi przez API: kartę i płatność potwierdza aplikacja przez Stripe.js albo SDK
 * (ADR 0051), a stan płatności przychodzi webhookiem albo sprawdzeniem statusu.
 */
export class StripePaymentProvider implements PaymentProvider {
  readonly name = 'stripe' as const;
  readonly publishableKey: string;
  readonly blik: boolean;
  private readonly stripe: Stripe;

  constructor(private readonly options: StripeProviderOptions) {
    this.stripe = new Stripe(options.secretKey, { apiVersion: STRIPE_API_VERSION, maxNetworkRetries: 2 });
    this.publishableKey = options.publishableKey;
    this.blik = options.blik;
  }

  async createCustomer(input: { userId: string }): Promise<string> {
    try {
      // Bez danych osobowych: identyfikator klienta wystarcza do powiązania (minimalizacja danych).
      const customer = await this.stripe.customers.create(
        { metadata: { userId: input.userId } },
        { idempotencyKey: `customer-${input.userId}` },
      );
      return customer.id;
    } catch (error) {
      unavailable(error);
    }
  }

  async createSetupIntent(input: {
    customerId: string;
    userId: string;
  }): Promise<{ id: string; clientSecret: string }> {
    try {
      const setup = await this.stripe.setupIntents.create({
        customer: input.customerId,
        allowed_payment_method_types: ['card'],
        usage: 'off_session',
        metadata: { userId: input.userId },
      });
      return { id: setup.id, clientSecret: setup.client_secret! };
    } catch (error) {
      unavailable(error);
    }
  }

  async retrieveSetupIntent(id: string): Promise<ProviderSetup | null> {
    try {
      const setup = await this.stripe.setupIntents.retrieve(id, { expand: ['payment_method'] });
      const method = setup.payment_method && typeof setup.payment_method !== 'string' ? setup.payment_method : null;
      return {
        id: setup.id,
        status: setup.status as ProviderSetup['status'],
        customerId: idOf(setup.customer),
        userId: setup.metadata?.userId ?? null,
        card: method?.card
          ? {
              ref: method.id,
              brand: method.card.brand,
              last4: method.card.last4,
              expMonth: method.card.exp_month,
              expYear: method.card.exp_year,
            }
          : null,
      };
    } catch (error) {
      if ((error as { code?: string }).code === 'resource_missing') return null;
      unavailable(error);
    }
  }

  async createPayment(input: {
    amount: number;
    customerId: string;
    method: PaymentMethodKind;
    paymentMethodRef: string | null;
    idempotencyKey: string;
    paymentId: string;
  }): Promise<{ id: string; clientSecret: string; status: ProviderPaymentStatus }> {
    try {
      const intent = await this.stripe.paymentIntents.create(
        {
          amount: input.amount,
          currency: 'pln',
          customer: input.customerId,
          allowed_payment_method_types: [input.method === 'BLIK' ? 'blik' : 'card'],
          ...(input.method === 'CARD' && input.paymentMethodRef ? { payment_method: input.paymentMethodRef } : {}),
          metadata: { paymentId: input.paymentId },
        },
        { idempotencyKey: input.idempotencyKey },
      );
      return { id: intent.id, clientSecret: intent.client_secret!, status: intent.status as ProviderPaymentStatus };
    } catch (error) {
      unavailable(error);
    }
  }

  async chargeOffSession(input: {
    amount: number;
    customerId: string;
    paymentMethodRef: string;
    idempotencyKey: string;
    paymentId: string;
  }): Promise<ProviderPayment> {
    try {
      const intent = await this.stripe.paymentIntents.create(
        {
          amount: input.amount,
          currency: 'pln',
          customer: input.customerId,
          payment_method: input.paymentMethodRef,
          allowed_payment_method_types: ['card'],
          off_session: true,
          confirm: true,
          metadata: { paymentId: input.paymentId },
        },
        { idempotencyKey: input.idempotencyKey },
      );
      return this.view(intent);
    } catch (error) {
      // Odmowa karty (402): PaymentIntent zostaje w `requires_payment_method` z kodem odmowy.
      const raw = error as { type?: string; code?: string; decline_code?: string; message?: string; raw?: unknown };
      const intent = (error as { payment_intent?: Stripe.PaymentIntent }).payment_intent;
      if (raw.type === 'StripeCardError' || intent) {
        return {
          id: intent?.id ?? '',
          status: 'requires_payment_method',
          failureCode: raw.decline_code ?? raw.code ?? 'card_declined',
          failureMessage: raw.message ?? null,
          paymentId: input.paymentId,
        };
      }
      unavailable(error);
    }
  }

  async retrievePayment(id: string): Promise<ProviderPayment | null> {
    try {
      return this.view(await this.stripe.paymentIntents.retrieve(id));
    } catch (error) {
      if ((error as { code?: string }).code === 'resource_missing') return null;
      unavailable(error);
    }
  }

  async cancelPayment(id: string): Promise<ProviderPayment> {
    try {
      return this.view(await this.stripe.paymentIntents.cancel(id));
    } catch (error) {
      // Płatność już rozstrzygnięta (sukces albo przetwarzanie): stan od operatora decyduje.
      if ((error as { code?: string }).code === 'payment_intent_unexpected_state') {
        return this.view(await this.stripe.paymentIntents.retrieve(id));
      }
      unavailable(error);
    }
  }

  async refund(input: {
    paymentIntentId: string;
    amount: number;
    idempotencyKey: string;
    refundId: string;
  }): Promise<ProviderRefund> {
    try {
      const refund = await this.stripe.refunds.create(
        { payment_intent: input.paymentIntentId, amount: input.amount, metadata: { refundId: input.refundId } },
        { idempotencyKey: input.idempotencyKey },
      );
      return this.refundView(refund);
    } catch (error) {
      unavailable(error);
    }
  }

  async retrieveRefund(id: string): Promise<ProviderRefund | null> {
    try {
      return this.refundView(await this.stripe.refunds.retrieve(id));
    } catch (error) {
      if ((error as { code?: string }).code === 'resource_missing') return null;
      unavailable(error);
    }
  }

  async detachPaymentMethod(ref: string): Promise<void> {
    try {
      await this.stripe.paymentMethods.detach(ref);
    } catch (error) {
      if ((error as { code?: string }).code === 'resource_missing') return;
      unavailable(error);
    }
  }

  parseWebhook(rawBody: Buffer, signature: string | undefined): ReturnType<PaymentProvider['parseWebhook']> {
    try {
      this.stripe.webhooks.constructEvent(rawBody, signature ?? '', this.options.webhookSecret);
    } catch {
      throw new DomainError('WEBHOOK_SIGNATURE_INVALID');
    }
    return parseStripeLikeEvent(rawBody);
  }

  private view(intent: Stripe.PaymentIntent): ProviderPayment {
    const error = intent.last_payment_error;
    return {
      id: intent.id,
      status: intent.status as ProviderPaymentStatus,
      failureCode: error ? (error.decline_code ?? error.code ?? 'payment_failed') : null,
      failureMessage: error?.message ?? null,
      paymentId: intent.metadata?.paymentId ?? null,
    };
  }

  private refundView(refund: Stripe.Refund): ProviderRefund {
    return {
      id: refund.id,
      status: (refund.status ?? 'pending') as ProviderRefund['status'],
      failureReason: refund.failure_reason ?? null,
      refundId: refund.metadata?.refundId ?? null,
    };
  }
}
