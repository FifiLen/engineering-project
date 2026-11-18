/**
 * Niska bateria w trakcie jazdy (pytanie 2 planu iteracji 6, ADR 0056). Próg `LOW` to `min_battery_pct` z wersji
 * cennika przejazdu, a `CRITICAL` to stała 5%. Każdy próg daje na przejazd jedno zdarzenie `BATTERY_LOW`
 * z `data.threshold`, więc szum odczytu przy progu nie powtarza komunikatu.
 */
export const BATTERY_THRESHOLDS = ['LOW', 'CRITICAL'] as const;
export type BatteryThreshold = (typeof BATTERY_THRESHOLDS)[number];

export const BATTERY_CRITICAL_PCT = 5;
/** Limit prędkości przy krytycznej baterii do końca przejazdu (`speed_limit` z `params.kmh`). */
export const BATTERY_CRITICAL_SPEED_KMH = 10;

/**
 * Odczyt osiągnął próg: `LOW` poniżej `min_battery_pct` (wypożyczenie wymaga baterii co najmniej na progu, więc
 * start dokładnie na progu nie daje od razu komunikatu), `CRITICAL` na 5% albo poniżej (pytanie 2: „przy 5%
 * hulajnoga zwalnia”).
 */
export function reachesBatteryThreshold(
  threshold: BatteryThreshold,
  batteryPct: number,
  minBatteryPct: number,
): boolean {
  return threshold === 'LOW' ? batteryPct < minBatteryPct : batteryPct <= BATTERY_CRITICAL_PCT;
}

/**
 * Progi przekroczone po raz pierwszy w przejeździe: odczyt bieżący (nie z bufora), który osiągnął próg
 * (`reachesBatteryThreshold`), pominięte progi już zapisane w przejeździe. Spadek z 20% do 3% daje oba progi
 * naraz, w kolejności `LOW`, `CRITICAL`.
 */
export function newBatteryThresholds(input: {
  batteryPct: number | null;
  buffered?: boolean;
  minBatteryPct: number;
  reached: readonly BatteryThreshold[];
}): BatteryThreshold[] {
  if (input.batteryPct === null || input.buffered) return [];
  const pct = input.batteryPct;
  return BATTERY_THRESHOLDS.filter(
    (threshold) => !input.reached.includes(threshold) && reachesBatteryThreshold(threshold, pct, input.minBatteryPct),
  );
}

/** Komunikat baterii w widoku przejazdu: najpoważniejszy osiągnięty próg albo `null`. */
export function batteryAlert(reached: readonly BatteryThreshold[]): BatteryThreshold | null {
  if (reached.includes('CRITICAL')) return 'CRITICAL';
  return reached.includes('LOW') ? 'LOW' : null;
}
