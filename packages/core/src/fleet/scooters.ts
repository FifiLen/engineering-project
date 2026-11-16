import { DomainError } from '../errors.js';
import type { ScooterStatus } from './fleet-status.js';

export const SCOOTER_VARIANTS = ['GRAFIT', 'BETON', 'KOBALT'] as const;
export type ScooterVariant = (typeof SCOOTER_VARIANTS)[number];

/** Numer hulajnogi jest w tematach MQTT jako cztery cyfry (kontrakt AsyncAPI), więc nie przekracza 9999. */
export const SCOOTER_NUMBER_MIN = 1;
export const SCOOTER_NUMBER_MAX = 9999;

/**
 * Statusy, które operator ustawia w panelu. Rezerwację i jazdę ustawia wyłącznie proces
 * wypożyczenia (ADR 0013), żeby stan hulajnogi zawsze odpowiadał otwartemu przejazdowi.
 */
export const OPERATOR_STATUSES = ['AVAILABLE', 'MAINTENANCE', 'RETIRED'] as const satisfies readonly ScooterStatus[];

export function isOperatorStatus(status: ScooterStatus): status is (typeof OPERATOR_STATUSES)[number] {
  return (OPERATOR_STATUSES as readonly ScooterStatus[]).includes(status);
}

/**
 * Zmiana statusu z panelu. Wycofaną hulajnogę można przywrócić tylko do serwisu: przed powrotem do
 * floty musi przejść przegląd.
 */
export function ensureOperatorStatusChange(from: ScooterStatus, to: ScooterStatus, hasOpenRental: boolean): void {
  if (from === to) return;
  if (!isOperatorStatus(to)) throw new DomainError('STATUS_MANAGED_BY_RENTAL', { status: to });
  if (hasOpenRental) throw new DomainError('SCOOTER_HAS_OPEN_RENTAL');
  if (from === 'RETIRED' && to !== 'MAINTENANCE') throw new DomainError('SCOOTER_RETIRED');
}

/**
 * Hulajnoga ma historię (telemetria, przejazdy, komendy), więc „usunięcie” w panelu to wycofanie
 * z floty (ADR 0031, klasa encji operacyjnych).
 */
export function planScooterRemoval(status: ScooterStatus, hasOpenRental: boolean): 'RETIRE' {
  ensureOperatorStatusChange(status, 'RETIRED', hasOpenRental);
  return 'RETIRE';
}

export interface AssignableModel {
  code: string;
  active: boolean;
}

/** Nową hulajnogę albo zmianę modelu można przypisać tylko do modelu w ofercie. */
export function ensureModelAssignable(model: AssignableModel): void {
  if (!model.active) throw new DomainError('MODEL_INACTIVE', { model: model.code });
}

/** Model bez hulajnóg usuwamy; model z hulajnogami (także wycofanymi) archiwizujemy, bo wskazuje go historia. */
export function planModelRemoval(scootersTotal: number): 'DELETE' | 'ARCHIVE' {
  return scootersTotal === 0 ? 'DELETE' : 'ARCHIVE';
}
