import { DomainError } from '../errors.js';
import type { ServiceTaskStatus } from './service-tasks.js';

/**
 * Magazyn części (ADR 0055): stan zmienia się tylko razem z ruchem w `spare_part_movements` przez procedury
 * z blokadą wiersza; `CHECK (stock_qty >= 0)` w bazie odrzuca zużycie ponad stan także przy równoległych zapisach.
 */
export const PART_MOVEMENT_KINDS = ['RECEIPT', 'ADJUSTMENT', 'USE', 'RETURN'] as const;
export type PartMovementKind = (typeof PART_MOVEMENT_KINDS)[number];

/** Powód korekty stanu (`part_adjust_reason`); `OTHER` wymaga notatki. */
export const PART_ADJUST_REASONS = ['STOCKTAKE', 'DAMAGED', 'LOST', 'OTHER'] as const;
export type PartAdjustReason = (typeof PART_ADJUST_REASONS)[number];

const isPositiveInt = (v: number) => Number.isInteger(v) && v > 0;

/**
 * Części dodaje się i usuwa w zadaniu w toku (jak `sp_task_use_part` i `sp_task_return_part`); stan maleje przy
 * dodaniu, nie przy zakończeniu, a anulowanie zwraca wszystkie pozycje.
 */
export function ensureTaskAcceptsParts(status: ServiceTaskStatus): void {
  if (status !== 'IN_PROGRESS') throw new DomainError('TASK_NOT_IN_PROGRESS', { status });
}

/** Użycie części w zadaniu: część aktywna, ilość dodatnia i nie większa niż stan. */
export function ensurePartUse(input: { stockQty: number; quantity: number; active?: boolean }): void {
  if (!isPositiveInt(input.quantity)) throw new DomainError('VALIDATION_FAILED', { field: 'quantity' });
  if (input.active === false) throw new DomainError('PART_INACTIVE');
  if (input.quantity > input.stockQty) throw new DomainError('PART_OUT_OF_STOCK', { available: input.stockQty });
}

/** Zwrot części z zadania: bez ilości cała pozycja, inaczej najwyżej tyle, ile użyto. */
export function ensurePartReturn(input: { lineQuantity: number; quantity?: number | null }): number {
  const quantity = input.quantity ?? input.lineQuantity;
  if (!isPositiveInt(quantity)) throw new DomainError('VALIDATION_FAILED', { field: 'quantity' });
  if (quantity > input.lineQuantity) throw new DomainError('PART_RETURN_EXCEEDS', { used: input.lineQuantity });
  return quantity;
}

/** Przyjęcie dostawy: ilość dodatnia, opcjonalna nowa cena jednostkowa dla kolejnych użyć (grosze). */
export function ensurePartReceipt(input: { quantity: number; unitCost: number | null }): void {
  if (!isPositiveInt(input.quantity)) throw new DomainError('VALIDATION_FAILED', { field: 'quantity' });
  if (input.unitCost !== null && !(Number.isInteger(input.unitCost) && input.unitCost >= 0)) {
    throw new DomainError('VALIDATION_FAILED', { field: 'unitCost' });
  }
}

/**
 * Korekta stanu (`sp_part_adjust`): nowy stan policzony w magazynie, nieujemny i inny niż obecny, powód z listy,
 * a `OTHER` z notatką. Zmianę ilości zapisuje ruch `ADJUSTMENT`.
 */
export function ensureStockAdjustment(input: {
  stockQty: number;
  newQty: number;
  reason: PartAdjustReason;
  note: string | null;
}): void {
  if (!Number.isInteger(input.newQty) || input.newQty < 0) {
    throw new DomainError('VALIDATION_FAILED', { field: 'newQty' });
  }
  if (input.newQty === input.stockQty) throw new DomainError('PART_ADJUST_NO_CHANGE');
  if (input.reason === 'OTHER' && !input.note?.trim()) throw new DomainError('VALIDATION_FAILED', { field: 'note' });
}

/** Koszt części w zadaniu z kosztu jednostkowego z chwili użycia (grosze). */
export const partsCost = (items: ReadonlyArray<{ quantity: number; unitCost: number }>): number =>
  items.reduce((sum, item) => sum + item.quantity * item.unitCost, 0);

/**
 * „Poniżej minimum” jak lista magazynu (`v_spare_part_list.below_minimum`): stan mniejszy niż minimum.
 * Tę samą regułę ma od migracji 0013 widok `v_low_stock_parts` (wcześniej liczył też stan równy minimum).
 */
export const isBelowMinimum = (part: { stockQty: number; minStockQty: number }): boolean =>
  part.stockQty < part.minStockQty;
