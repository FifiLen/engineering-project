/** Stany hulajnogi zapisywane w bazie (typ `scooter_status`). */
export const SCOOTER_STATUSES = ['AVAILABLE', 'RESERVED', 'IN_USE', 'MAINTENANCE', 'RETIRED'] as const;
export type ScooterStatus = (typeof SCOOTER_STATUSES)[number];

/**
 * Status floty widoczny dla operatora (szybkie filtry na liście i kolory na mapie): stan z bazy
 * uzupełniony o łączność i baterię. Ta sama reguła jest w bazie (`fn_fleet_status`, migracja 0003),
 * bo lista filtruje i liczy statusy w SQL; zgodność pilnuje test bazy.
 */
export const FLEET_STATUSES = [
  'AVAILABLE',
  'RESERVED',
  'IN_USE',
  'LOW_BATTERY',
  'MAINTENANCE',
  'OFFLINE',
  'RETIRED',
] as const;
export type FleetStatus = (typeof FLEET_STATUSES)[number];

export interface ScooterCondition {
  status: ScooterStatus;
  online: boolean;
  batteryPct: number | null;
}

/**
 * Kolejność ma znaczenie: wycofanie i serwis wygrywają ze wszystkim, brak łączności z przejazdem
 * (operator musi wiedzieć, że nie ma kontaktu z urządzeniem), a niska bateria dotyczy tylko
 * hulajnogi czekającej na wypożyczenie.
 *
 * @param lowBatteryThreshold minimalny poziom baterii do wypożyczenia z obowiązującego cennika
 */
export function deriveFleetStatus(scooter: ScooterCondition, lowBatteryThreshold: number): FleetStatus {
  if (scooter.status === 'RETIRED' || scooter.status === 'MAINTENANCE') return scooter.status;
  if (!scooter.online) return 'OFFLINE';
  if (scooter.status === 'RESERVED' || scooter.status === 'IN_USE') return scooter.status;
  if ((scooter.batteryPct ?? 0) < lowBatteryThreshold) return 'LOW_BATTERY';
  return 'AVAILABLE';
}

/** Szacowany zasięg przy obecnej baterii; `null`, gdy model nie ma podanego zasięgu albo brak odczytu baterii. */
export function estimateRangeKm(batteryPct: number | null, modelRangeKm: number | null): number | null {
  if (batteryPct === null || modelRangeKm === null) return null;
  return Math.round(((modelRangeKm * batteryPct) / 100) * 10) / 10;
}
