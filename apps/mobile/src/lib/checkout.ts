/**
 * Płatność z udziałem klienta (doładowanie, spłata zaległości kartą; ADR 0050, ADR 0051): API zakłada
 * płatność `PENDING` i zwraca PaymentIntent, aplikacja potwierdza go u operatora (karta z 3-D Secure albo
 * BLIK), a wynik rozstrzyga webhook. Ekran `/platnosc/[id]` czeka na wynik (`wallet.updated`
 * i odpytywanie `GET /payments/{id}`).
 */
import type { CardSummary, PaymentIntentResponse } from '@hulajnogi/shared';
import { router } from 'expo-router';
import type { PaymentActions } from './payments';

export interface ConfirmHow {
  /** Kod BLIK; bez niego płatność kartą z `providerPaymentMethodId`. */
  blikCode?: string;
  /** Karta do opisu na ekranie oczekiwania i wyniku. */
  card?: CardSummary | null;
}

/** Potwierdza płatność u operatora i otwiera ekran oczekiwania albo od razu odmowy. */
export async function confirmAndOpen(
  actions: PaymentActions,
  intent: PaymentIntentResponse,
  how: ConfirmHow,
  options: { replace?: boolean } = {},
): Promise<void> {
  const startedAt = Date.now();
  const result = !intent.clientSecret
    ? null
    : how.blikCode
      ? await actions.confirmBlik(intent.clientSecret, how.blikCode)
      : await actions.confirmCardPayment(intent.clientSecret, intent.providerPaymentMethodId);
  const params: Record<string, string> = { id: intent.paymentId };
  if (result?.status === 'failed') params.failure = result.failureCode ?? 'card_declined';
  if (how.blikCode) params.at = String(startedAt);
  if (how.card) {
    params.card = how.card.last4;
    params.brand = how.card.brand;
  }
  const target = { pathname: '/platnosc/[id]' as const, params: params as { id: string } };
  if (options.replace) router.replace(target);
  else router.push(target);
}
