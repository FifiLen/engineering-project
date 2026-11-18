import { DomainError } from '../errors.js';
import type { ScooterStatus } from '../fleet/fleet-status.js';
import { ensureOperatorStatusChange } from '../fleet/scooters.js';

/**
 * Wyłączenie z ruchu i powrót do floty (ADR 0055, pytania 4 i 5). Przyczyna stanu (`scooters.status_reason`)
 * jest widoczna w panelu przy `MAINTENANCE` i `RETIRED`.
 */
export const SCOOTER_STATUS_REASONS = [
  'URGENT_TICKET',
  'SERVICE_TASK',
  'BATTERY_BELOW_THRESHOLD',
  'OFFLINE',
  'THEFT',
  'DAMAGE',
  'END_OF_LIFE',
  'OTHER',
] as const;
export type ScooterStatusReason = (typeof SCOOTER_STATUS_REASONS)[number];

/** Powody „Wyłącz z ruchu” (`RETIRED`). */
export const RETIRE_REASONS = [
  'THEFT',
  'DAMAGE',
  'END_OF_LIFE',
  'OTHER',
] as const satisfies readonly ScooterStatusReason[];
export type RetireReason = (typeof RETIRE_REASONS)[number];

/**
 * Przeszkody w powrocie do floty. Te same kody i ta sama kolejność zwraca `fn_scooter_return_blockers` w bazie
 * (test zgodności w packages/db).
 */
export const RETURN_BLOCKERS = ['URGENT_TICKET', 'OPEN_TASKS', 'OFFLINE', 'BATTERY_BELOW_THRESHOLD'] as const;
export type ReturnBlocker = (typeof RETURN_BLOCKERS)[number];

/**
 * Reguła powrotu: bez otwartego pilnego zgłoszenia (hamulce, koło, kierownica: pytanie 4), bez otwartych zadań,
 * online i z baterią co najmniej `min_battery_pct` z obowiązującego cennika.
 */
export function returnToFleetBlockers(input: {
  openUrgentTickets: number;
  openTasks: number;
  online: boolean;
  batteryPct: number | null;
  minBatteryPct: number;
}): ReturnBlocker[] {
  const blockers: ReturnBlocker[] = [];
  if (input.openUrgentTickets > 0) blockers.push('URGENT_TICKET');
  if (input.openTasks > 0) blockers.push('OPEN_TASKS');
  if (!input.online) blockers.push('OFFLINE');
  if ((input.batteryPct ?? 0) < input.minBatteryPct) blockers.push('BATTERY_BELOW_THRESHOLD');
  return blockers;
}

const BLOCKER_REASON: Record<ReturnBlocker, ScooterStatusReason> = {
  URGENT_TICKET: 'URGENT_TICKET',
  OPEN_TASKS: 'SERVICE_TASK',
  OFFLINE: 'OFFLINE',
  BATTERY_BELOW_THRESHOLD: 'BATTERY_BELOW_THRESHOLD',
};

export type ScooterServiceStatus =
  { status: 'AVAILABLE'; reason: null } | { status: 'MAINTENANCE'; reason: ScooterStatusReason };

/**
 * Stan po zakończeniu ostatniego zadania: bez przeszkód hulajnoga wraca do `AVAILABLE` w tej samej transakcji,
 * inaczej zostaje w `MAINTENANCE` z przyczyną pierwszej przeszkody.
 */
export function statusAfterService(blockers: readonly ReturnBlocker[]): ScooterServiceStatus {
  const first = blockers[0];
  return first ? { status: 'MAINTENANCE', reason: BLOCKER_REASON[first] } : { status: 'AVAILABLE', reason: null };
}

/**
 * Ręczne `RESOLVED` pilnego zgłoszenia (np. fałszywy alarm) bez zadań: ADR 0055 przewiduje automatyczny powrót
 * tylko po ostatnim zadaniu, więc hulajnoga zostaje w `MAINTENANCE`, ale z przyczyną zgodną z regułą powrotu
 * (inne pilne zgłoszenie, zadanie, łączność, bateria), a bez przeszkód z `OTHER` i gotowym „Przywróć do floty”.
 */
export function reasonAfterUrgentTicketResolved(blockers: readonly ReturnBlocker[]): ScooterStatusReason {
  const first = blockers[0];
  return first ? BLOCKER_REASON[first] : 'OTHER';
}

/** „Przywróć do floty” na karcie hulajnogi: ta sama reguła, błąd `RETURN_TO_FLEET_BLOCKED` z listą przeszkód. */
export function ensureCanReturnToFleet(status: ScooterStatus, blockers: readonly ReturnBlocker[]): void {
  if (status !== 'MAINTENANCE') throw new DomainError('SCOOTER_NOT_IN_MAINTENANCE', { status });
  if (blockers.length) throw new DomainError('RETURN_TO_FLEET_BLOCKED', { blockers: [...blockers] });
}

export type MaintenanceEffect =
  { kind: 'NOW'; reason: 'URGENT_TICKET' | 'SERVICE_TASK' } | { kind: 'AFTER_RENTAL' } | { kind: 'NONE' };

/**
 * Pilne zgłoszenie albo otwarte zadanie: wolna hulajnoga przechodzi do `MAINTENANCE` od razu, w rezerwacji albo
 * przejeździe przy jego zakończeniu (`scooterStatusAfterRental`), a w serwisie albo wycofana zostaje bez zmian.
 */
export function maintenanceEffect(status: ScooterStatus, reason: 'URGENT_TICKET' | 'SERVICE_TASK'): MaintenanceEffect {
  if (status === 'AVAILABLE') return { kind: 'NOW', reason };
  if (status === 'RESERVED' || status === 'IN_USE') return { kind: 'AFTER_RENTAL' };
  return { kind: 'NONE' };
}

/**
 * Stan hulajnogi po stanie końcowym przejazdu: otwarte pilne zgłoszenia i zadania wybierają `MAINTENANCE` zamiast
 * `AVAILABLE`, bez osobnej flagi „do serwisu”.
 */
export function scooterStatusAfterRental(input: {
  openUrgentTickets: number;
  openTasks: number;
}): ScooterServiceStatus {
  if (input.openUrgentTickets > 0) return { status: 'MAINTENANCE', reason: 'URGENT_TICKET' };
  if (input.openTasks > 0) return { status: 'MAINTENANCE', reason: 'SERVICE_TASK' };
  return { status: 'AVAILABLE', reason: null };
}

/**
 * „Wyłącz z ruchu” (`RETIRED`, wymaga `scooters.write`): niedostępne w przejeździe i przy otwartych zadaniach;
 * powód `OTHER` wymaga notatki, jak inne powody `OTHER` w panelu.
 */
export function ensureCanRetire(input: {
  status: ScooterStatus;
  hasOpenRental: boolean;
  openTasks: number;
  reason: RetireReason;
  note: string | null;
}): void {
  if (input.status === 'RETIRED') throw new DomainError('SCOOTER_RETIRED');
  if (input.hasOpenRental) throw new DomainError('SCOOTER_HAS_OPEN_RENTAL');
  if (input.openTasks > 0) throw new DomainError('SCOOTER_HAS_OPEN_TASKS', { openTasks: input.openTasks });
  if (input.reason === 'OTHER' && !input.note?.trim()) throw new DomainError('VALIDATION_FAILED', { field: 'note' });
}

/**
 * Zmiana stanu z formularza floty (PATCH i DELETE, ADR 0031) z regułami obiegu serwisowego (ADR 0055), żeby
 * formularz nie omijał przeszkód ani przyczyny stanu (`scooters_status_reason_matches`):
 * - `MAINTENANCE → AVAILABLE` tylko według reguły powrotu do floty (`RETURN_TO_FLEET_BLOCKED` z przeszkodami);
 * - `→ MAINTENANCE` z przyczyną z `fn_scooter_service_hold` albo `OTHER` (także przywrócenie wycofanej);
 * - `→ RETIRED` (także „usunięcie”) jak „Wyłącz z ruchu”: nie przy otwartych zadaniach, z powodem `OTHER`
 *   (formularz nie pyta o powód; kradzież i zniszczenie zapisuje okno „Wyłącz z ruchu” na karcie hulajnogi).
 * `null`: bez zmiany stanu.
 */
export function fleetFormStatusChange(input: {
  from: ScooterStatus;
  to: ScooterStatus;
  hasOpenRental: boolean;
  openTasks: number;
  blockers: readonly ReturnBlocker[];
  serviceHold: 'URGENT_TICKET' | 'SERVICE_TASK' | null;
}): { status: ScooterStatus; reason: ScooterStatusReason | null } | null {
  if (input.from === input.to) return null;
  ensureOperatorStatusChange(input.from, input.to, input.hasOpenRental);
  if (input.to === 'AVAILABLE') {
    ensureCanReturnToFleet(input.from, input.blockers);
    return { status: 'AVAILABLE', reason: null };
  }
  if (input.to === 'MAINTENANCE') return { status: 'MAINTENANCE', reason: input.serviceHold ?? 'OTHER' };
  if (input.openTasks > 0) throw new DomainError('SCOOTER_HAS_OPEN_TASKS', { openTasks: input.openTasks });
  return { status: 'RETIRED', reason: 'OTHER' };
}
