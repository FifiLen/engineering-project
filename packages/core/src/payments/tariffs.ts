import { DomainError } from '../errors.js';

/** Stan wersji cennika z daty obowiązywania (ADR 0053). */
export const TARIFF_STATES = ['CURRENT', 'SCHEDULED', 'ARCHIVED'] as const;
export type TariffState = (typeof TARIFF_STATES)[number];

/** Pola nowej wersji cennika; kwoty w groszach, VAT w procentach (D6: bez limitu strefy). */
export interface TariffInput {
  unlockFee: number;
  minuteRate: number;
  pauseMinuteRate: number;
  /** Opłata za odholowanie przez serwis (`out_of_zone_fee`, pytanie 7). */
  outOfZoneFee: number;
  freeReservationMinutes: number;
  minWalletBalance: number;
  minBatteryPct: number;
  minUserAge: number;
  vatRate: number;
  /** `null`: wersja obowiązuje od chwili zapisu. */
  validFrom: Date | null;
}

export const TARIFF_FIELDS = [
  'unlockFee',
  'minuteRate',
  'pauseMinuteRate',
  'outOfZoneFee',
  'freeReservationMinutes',
  'minWalletBalance',
  'minBatteryPct',
  'minUserAge',
  'vatRate',
] as const satisfies ReadonlyArray<keyof TariffInput>;
export type TariffField = (typeof TARIFF_FIELDS)[number];

/** Zapas na opóźnienie między formularzem a zapisem: „od teraz” wysłane chwilę temu nie jest przeszłością. */
export const TARIFF_PAST_TOLERANCE_MS = 10_000;

const isAmount = (v: number) => Number.isInteger(v) && v >= 0;
const inRange = (v: number, min: number, max: number) => Number.isInteger(v) && v >= min && v <= max;

/**
 * Walidacja nowej wersji (ADR 0053): kwoty nieujemne w groszach, rezerwacja 0–60 min, bateria 0–100%,
 * wiek 13–99, VAT 0–99,99 z dokładnością do setnych, data obowiązywania nie w przeszłości.
 */
export function validateTariffInput(input: TariffInput, now: Date): { validFrom: Date } {
  const invalid: Array<TariffField | 'validFrom'> = [];
  for (const field of ['unlockFee', 'minuteRate', 'pauseMinuteRate', 'outOfZoneFee', 'minWalletBalance'] as const) {
    if (!isAmount(input[field])) invalid.push(field);
  }
  if (!inRange(input.freeReservationMinutes, 0, 60)) invalid.push('freeReservationMinutes');
  if (!inRange(input.minBatteryPct, 0, 100)) invalid.push('minBatteryPct');
  if (!inRange(input.minUserAge, 13, 99)) invalid.push('minUserAge');
  if (
    !(input.vatRate >= 0 && input.vatRate < 100) ||
    Math.abs(input.vatRate * 100 - Math.round(input.vatRate * 100)) > 1e-6
  ) {
    invalid.push('vatRate');
  }
  if (input.validFrom && input.validFrom.getTime() < now.getTime() - TARIFF_PAST_TOLERANCE_MS)
    invalid.push('validFrom');
  if (invalid.length) throw new DomainError('TARIFF_INVALID', { fields: invalid });
  return { validFrom: input.validFrom && input.validFrom > now ? input.validFrom : now };
}

/** Najwyżej jedna zaplanowana wersja; dopóki jest, nie powstaje nowa (ADR 0053, wyzwalacz w bazie). */
export function ensureNoScheduledTariff(scheduled: { version: number } | null): void {
  if (scheduled) throw new DomainError('TARIFF_ALREADY_SCHEDULED', { version: scheduled.version });
}

/** Różnica nowej wersji względem obowiązującej do dziennika audytu. */
export function tariffChanges(
  current: Record<TariffField, number> | null,
  next: Record<TariffField, number>,
): Partial<Record<TariffField, { from: number | null; to: number }>> {
  const changes: Partial<Record<TariffField, { from: number | null; to: number }>> = {};
  for (const field of TARIFF_FIELDS) {
    if (current?.[field] !== next[field]) changes[field] = { from: current?.[field] ?? null, to: next[field] };
  }
  return changes;
}
