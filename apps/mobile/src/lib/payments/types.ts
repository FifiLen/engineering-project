/**
 * Wspólny interfejs płatności w aplikacji (ADR 0051). Trzy implementacje: Stripe.js w wersji web
 * (`payments.web.tsx`), natywny SDK Stripe w development build (`payments.tsx`) i atrapa operatora
 * (`payments.fake.tsx`, gdy `GET /payments/config` zwraca `provider: 'fake'`). Ekrany znają tylko ten
 * interfejs; wynik płatności i tak rozstrzyga webhook w API (saldo, stan przejazdu).
 */
import type { Ref } from 'react';

/**
 * Wynik potwierdzenia po stronie klienta: `succeeded` (operator przyjął), `processing` (czekamy na bank,
 * np. BLIK) albo `failed` z kodem operatora (`card_declined`, `insufficient_funds`, `authentication_failed`…).
 */
export interface ConfirmResult {
  status: 'succeeded' | 'processing' | 'failed';
  failureCode: string | null;
}

export interface PaymentActions {
  /** Płatność zapisaną kartą (doładowanie, spłata) z 3-D Secure, jeśli bank go wymaga. */
  confirmCardPayment(clientSecret: string, providerPaymentMethodId: string | null): Promise<ConfirmResult>;
  /** Płatność kodem BLIK; wynik `processing` oznacza oczekiwanie na potwierdzenie w aplikacji banku. */
  confirmBlik(clientSecret: string, code: string): Promise<ConfirmResult>;
  /** Implementacja obsługuje BLIK (natywny SDK 0.81 nie ma BLIK-u w `confirmPayment`). */
  blik: boolean;
}

/** Stan pola karty do podglądu na ekranie „Dodaj kartę”; pełny numer zna tylko atrapa. */
export interface CardEntryState {
  complete: boolean;
  brand: string | null;
  /** Wpisane cyfry numeru (tylko atrapa; Stripe nie udostępnia numeru aplikacji). */
  digits: string | null;
  /** „MM/RR” (tylko atrapa). */
  expiry: string | null;
}

export interface CardEntryHandle {
  /** Zapis karty: potwierdzenie SetupIntent danymi z pola karty (z 3-D Secure, jeśli trzeba). */
  collectCard(clientSecret: string, holderName: string): Promise<ConfirmResult>;
}

export interface CardEntryProps {
  ref: Ref<CardEntryHandle | null>;
  onChange(state: CardEntryState): void;
}

export const EMPTY_CARD: CardEntryState = { complete: false, brand: null, digits: null, expiry: null };
