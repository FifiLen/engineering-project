import type { ScooterStatus } from '../fleet/fleet-status.js';

/**
 * Kategorie czasu hulajnogi i wskaźniki wykorzystania i dostępności (ADR 0074): jedna definicja dla pulpitu, karty
 * hulajnogi („Historia stanów”) i raportu „Wykorzystanie floty”. Ta sama reguła kategorii jest w bazie
 * (`fn_scooter_time_category`, migracja 0013), bo raport sumuje przedziały w SQL; zgodność pilnuje test bazy.
 *
 * Kategorie są rozłączne, a ich suma to czas okresu (poza `RETIRED`, które nie liczy się do floty w ruchu):
 * - w przejeździe: `IN_USE`, także bez łączności (przejazd trwa i jest rozliczany, ADR 0056);
 * - serwis: `MAINTENANCE`, także bez łączności;
 * - rezerwacja: `RESERVED` z łącznością; dostępna: `AVAILABLE` z łącznością;
 * - bez łączności: `AVAILABLE` albo `RESERVED` bez łączności.
 */
export const SCOOTER_TIME_CATEGORIES = ['IN_RIDE', 'RESERVED', 'AVAILABLE', 'SERVICE', 'OFFLINE', 'RETIRED'] as const;
export type ScooterTimeCategory = (typeof SCOOTER_TIME_CATEGORIES)[number];

export function scooterTimeCategory(status: ScooterStatus, online: boolean): ScooterTimeCategory {
  if (status === 'IN_USE') return 'IN_RIDE';
  if (status === 'MAINTENANCE') return 'SERVICE';
  if (status === 'RETIRED') return 'RETIRED';
  if (!online) return 'OFFLINE';
  return status === 'RESERVED' ? 'RESERVED' : 'AVAILABLE';
}

/** Sekundy w każdej kategorii (np. z `fn_report_fleet_usage_*` albo z przedziałów historii przyciętych do okresu). */
export type ScooterTimeTotals = Record<ScooterTimeCategory, number>;

export const emptyTimeTotals = (): ScooterTimeTotals => ({
  IN_RIDE: 0,
  RESERVED: 0,
  AVAILABLE: 0,
  SERVICE: 0,
  OFFLINE: 0,
  RETIRED: 0,
});

export interface ScooterUsageIndicators {
  /** Wykorzystanie = czas w przejeździe ÷ czas okresu (0–1); `null`, gdy okres ma zerową długość. */
  utilization: number | null;
  /** Dostępność = (dostępna + rezerwacja + w przejeździe) ÷ czas okresu. */
  availability: number | null;
  /** Udział każdej kategorii w czasie okresu (do paska udziałów i tabeli). */
  shares: Record<ScooterTimeCategory, number | null>;
}

const ratio = (part: number, whole: number): number | null => (whole > 0 ? part / whole : null);

/**
 * Wskaźniki z sekund w kategoriach i czasu okresu (w sekundach, w strefie Europe/Warsaw: październik 2026 ma 745 h).
 * Czas okresu floty to suma czasów okresu hulajnóg (`period_seconds` × liczba hulajnóg w raporcie, albo suma
 * kategorii, gdy cały okres jest objęty historią).
 */
export function scooterUsageIndicators(totals: ScooterTimeTotals, periodSeconds: number): ScooterUsageIndicators {
  const shares = Object.fromEntries(
    SCOOTER_TIME_CATEGORIES.map((category) => [category, ratio(totals[category], periodSeconds)]),
  ) as Record<ScooterTimeCategory, number | null>;
  return {
    utilization: ratio(totals.IN_RIDE, periodSeconds),
    availability: ratio(totals.AVAILABLE + totals.RESERVED + totals.IN_RIDE, periodSeconds),
    shares,
  };
}

/** Przedział historii stanów (`scooter_status_history`): `validTo` `null` to przedział otwarty (do teraz). */
export interface StatusInterval {
  status: ScooterStatus;
  online: boolean;
  validFrom: Date;
  validTo: Date | null;
}

/**
 * Sekundy w kategoriach z przedziałów przyciętych do okresu `[from, to)`; przedział otwarty kończy się w `now`
 * (karta hulajnogi i pulpit liczą to w core, raport w SQL tą samą regułą). Okres w przyszłości liczy się do `now`.
 */
export function timeTotalsFromIntervals(
  intervals: readonly StatusInterval[],
  period: { from: Date; to: Date },
  now: Date,
): ScooterTimeTotals {
  const totals = emptyTimeTotals();
  const end = Math.min(period.to.getTime(), now.getTime());
  for (const interval of intervals) {
    const from = Math.max(interval.validFrom.getTime(), period.from.getTime());
    const to = Math.min((interval.validTo ?? now).getTime(), end);
    if (to > from) totals[scooterTimeCategory(interval.status, interval.online)] += (to - from) / 1000;
  }
  return totals;
}

/** Czas okresu do wskaźników: do teraz, gdy okres trwa (`period_seconds` w funkcjach raportowych). */
export const elapsedPeriodSeconds = (period: { from: Date; to: Date }, now: Date): number =>
  Math.max(0, Math.round((Math.min(period.to.getTime(), now.getTime()) - period.from.getTime()) / 1000));
