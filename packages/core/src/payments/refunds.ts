import { DomainError } from '../errors.js';
import type { PaymentSource, RideSettlement } from './payments.js';

/** Powody zwrotu za przejazd (ADR 0054); `OTHER` wymaga notatki. */
export const REFUND_REASONS = ['SCOOTER_FAILURE', 'BILLING_ERROR', 'CUSTOMER_COMPLAINT', 'OTHER'] as const;
export type RefundReason = (typeof REFUND_REASONS)[number];

/** Powody korekty salda (`ledger_reason`); etykietę widzi klient, notatkę tylko panel. */
export const ADJUSTMENT_REASONS = ['COMPLAINT', 'SYSTEM_ERROR', 'GOODWILL', 'OTHER'] as const;
export type AdjustmentReason = (typeof ADJUSTMENT_REASONS)[number];

const requireNote = (reason: string, note: string | null | undefined) => {
  if (reason === 'OTHER' && !note?.trim()) throw new DomainError('VALIDATION_FAILED', { field: 'note' });
};

export interface RefundRequest {
  settlement: RideSettlement;
  /** Zapłacona kwota przejazdu (obciążenie portfela albo udana płatność kartą). */
  paid: number;
  /** Suma zwrotów udanych i w toku. */
  refunded: number;
  amount: number;
  reason: RefundReason;
  note: string | null;
}

/**
 * Zwrot za przejazd (pytanie 11): według źródła płatności, częściowy dozwolony, suma zwrotów nie większa
 * niż zapłacona kwota. Tę samą sumę sprawdza `sp_record_refund` pod blokadą przejazdu.
 */
export function decideRefund(request: RefundRequest): { source: PaymentSource } {
  if (request.settlement !== 'WALLET_PAID' && request.settlement !== 'CARD_PAID') {
    throw new DomainError('RENTAL_NOT_REFUNDABLE', { settlement: request.settlement });
  }
  if (!Number.isInteger(request.amount) || request.amount <= 0) {
    throw new DomainError('VALIDATION_FAILED', { field: 'amount' });
  }
  requireNote(request.reason, request.note);
  const remaining = request.paid - request.refunded;
  if (request.amount > remaining) throw new DomainError('REFUND_EXCEEDS_PAYMENT', { remaining });
  return { source: request.settlement === 'WALLET_PAID' ? 'WALLET' : 'CARD' };
}

/** Korekta salda (pytanie 10): kwota ze znakiem różna od zera, bez limitu, powód z listy. */
export function ensureAdjustment(input: { amount: number; reason: AdjustmentReason; note: string | null }): void {
  if (!Number.isInteger(input.amount) || input.amount === 0) {
    throw new DomainError('VALIDATION_FAILED', { field: 'amount' });
  }
  requireNote(input.reason, input.note);
}

export interface RefundableTopup {
  paymentId: string;
  amount: number;
  /** Suma zwrotów z tego doładowania (udanych i w toku). */
  refunded: number;
}

export interface PayoutPlan {
  refunds: Array<{ paymentId: string; amount: number }>;
  /** Część salda bez doładowania do zwrotu; operator rozlicza ją korektą (ADR 0054). */
  remainder: number;
}

/**
 * Zwrot salda na kartę (pytanie 9): z udanych doładowań od najnowszego, każde najwyżej do kwoty
 * jeszcze niezwróconej, aż do kwoty salda.
 */
export function planPayout(balance: number, topupsNewestFirst: readonly RefundableTopup[]): PayoutPlan {
  if (balance <= 0) throw new DomainError('NOTHING_TO_PAY_OUT', { balance });
  let left = balance;
  const refunds: PayoutPlan['refunds'] = [];
  for (const topup of topupsNewestFirst) {
    if (left === 0) break;
    const amount = Math.min(left, topup.amount - topup.refunded);
    if (amount <= 0) continue;
    refunds.push({ paymentId: topup.paymentId, amount });
    left -= amount;
  }
  return { refunds, remainder: left };
}
