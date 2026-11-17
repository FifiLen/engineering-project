import type { PaymentMethodKind, PaymentProviderName } from '@hulajnogi/shared';

/** Status PaymentIntent u operatora (nazwy jak w Stripe). */
export type ProviderPaymentStatus =
  'requires_payment_method' | 'requires_confirmation' | 'requires_action' | 'processing' | 'succeeded' | 'canceled';

export interface ProviderPayment {
  id: string;
  status: ProviderPaymentStatus;
  /** Kod ostatniej odmowy (`card_declined`, `insufficient_funds`, `authentication_required` …). */
  failureCode: string | null;
  failureMessage: string | null;
  /** Identyfikator płatności w naszej bazie (`metadata.paymentId`). */
  paymentId: string | null;
}

export interface ProviderCard {
  ref: string;
  brand: string;
  last4: string;
  expMonth: number;
  expYear: number;
}

export interface ProviderSetup {
  id: string;
  status:
    'requires_payment_method' | 'requires_confirmation' | 'requires_action' | 'processing' | 'succeeded' | 'canceled';
  customerId: string | null;
  userId: string | null;
  card: ProviderCard | null;
}

export interface ProviderRefund {
  id: string;
  status: 'pending' | 'requires_action' | 'succeeded' | 'failed' | 'canceled';
  failureReason: string | null;
  /** Identyfikator zwrotu w naszej bazie (`metadata.refundId`). */
  refundId: string | null;
}

/** Zdarzenie webhooka po weryfikacji podpisu: rodzaj i identyfikator obiektu, którego dotyczy. */
export interface ProviderEvent {
  id: string;
  type: string;
  objectKind: 'setup_intent' | 'payment_intent' | 'refund' | 'charge' | 'other';
  objectId: string | null;
  /** PaymentIntent obiektu (`charge.payment_intent`, `refund.payment_intent`). */
  paymentIntentId: string | null;
  payload: unknown;
}

/**
 * Port operatora płatności (ADR 0050). Implementacje: Stripe w trybie testowym i atrapa w procesie.
 * Kwoty w groszach, waluta PLN. Odmowa obciążenia bez udziału klienta wraca jako wynik, a nie wyjątek.
 * Wyjątek `PAYMENT_FAILED` to trwała odmowa operatora (np. zwrot po terminie), a
 * `PAYMENT_PROVIDER_UNAVAILABLE` to niedostępność, po której sprawdzenie statusu ponawia operację.
 */
export interface PaymentProvider {
  readonly name: PaymentProviderName;
  readonly publishableKey: string | null;
  readonly blik: boolean;

  createCustomer(input: { userId: string }): Promise<string>;
  createSetupIntent(input: { customerId: string; userId: string }): Promise<{ id: string; clientSecret: string }>;
  retrieveSetupIntent(id: string): Promise<ProviderSetup | null>;
  /** Płatność z udziałem klienta (doładowanie, spłata): potwierdza ją aplikacja. */
  createPayment(input: {
    amount: number;
    customerId: string;
    method: PaymentMethodKind;
    paymentMethodRef: string | null;
    idempotencyKey: string;
    paymentId: string;
  }): Promise<{ id: string; clientSecret: string; status: ProviderPaymentStatus }>;
  /** Obciążenie zapisanej karty bez udziału klienta (przejazd kartą, ADR 0049). */
  chargeOffSession(input: {
    amount: number;
    customerId: string;
    paymentMethodRef: string;
    idempotencyKey: string;
    paymentId: string;
  }): Promise<ProviderPayment>;
  retrievePayment(id: string): Promise<ProviderPayment | null>;
  /**
   * Anulowanie PaymentIntent przed zapisaniem odmowy albo porzucenia: po odmowie Stripe pozwala potwierdzić
   * go ponownie, więc bez anulowania późniejszy sukces u operatora nie miałby odpowiednika w bazie.
   * Zwraca stan po anulowaniu (sukces, jeśli płatność zdążyła przejść).
   */
  cancelPayment(id: string): Promise<ProviderPayment>;
  refund(input: {
    paymentIntentId: string;
    amount: number;
    idempotencyKey: string;
    refundId: string;
  }): Promise<ProviderRefund>;
  retrieveRefund(id: string): Promise<ProviderRefund | null>;
  detachPaymentMethod(ref: string): Promise<void>;
  /** Weryfikacja podpisu na surowej treści żądania; zły podpis daje `WEBHOOK_SIGNATURE_INVALID`. */
  parseWebhook(rawBody: Buffer, signature: string | undefined): ProviderEvent;
}

export const PAYMENT_PROVIDER = Symbol('PAYMENT_PROVIDER');

/** Status u operatora jako status płatności w bazie; `null`, gdy płatność wciąż czeka (ADR 0050). */
export function paymentStatusFromProvider(
  payment: Pick<ProviderPayment, 'status' | 'failureCode'>,
): 'SUCCEEDED' | 'FAILED' | null {
  if (payment.status === 'succeeded') return 'SUCCEEDED';
  if (payment.status === 'canceled') return 'FAILED';
  // Po nieudanej próbie PaymentIntent wraca do `requires_payment_method` z kodem odmowy.
  if (payment.status === 'requires_payment_method' && payment.failureCode) return 'FAILED';
  return null;
}
