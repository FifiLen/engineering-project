import { distanceM } from '../geo.js';
import { MIN_MOVE_M } from '../telemetry/telemetry.js';
import type { GeoPoint } from '../zones/zones.js';

/**
 * Reguły przejazdu przy utracie łączności poza naliczaniem (ADR 0056); naliczanie liczy `rentalCounters`,
 * a warunek zakończenia `canEndOffline`.
 */

/** Ruch po żądaniu zakończenia offline, od którego przejazd dostaje zdarzenie `MOVED_AFTER_END`. */
export const MOVED_AFTER_END_DISTANCE_M = 200;

/**
 * Droga hulajnogi po żądaniu zakończenia z punktów telemetrii (także dosłanych z bufora) zapisanych później niż
 * żądanie, od pozycji z chwili żądania. Przesunięcia poniżej `MIN_MOVE_M` to szum GPS stojącej hulajnogi.
 */
export function distanceAfterEnd(input: {
  endRequestedAt: Date;
  origin: GeoPoint | null;
  readings: ReadonlyArray<{ recordedAt: Date; position: GeoPoint }>;
}): number {
  const after = input.readings
    .filter((r) => r.recordedAt > input.endRequestedAt)
    .sort((a, b) => a.recordedAt.getTime() - b.recordedAt.getTime());
  let anchor = input.origin ?? after[0]?.position ?? null;
  let total = 0;
  for (const { position } of after) {
    if (!anchor) break;
    const step = distanceM(anchor, position);
    if (step < MIN_MOVE_M) continue;
    total += step;
    anchor = position;
  }
  return Math.round(total);
}

/** Dyspozytor widzi `MOVED_AFTER_END` na osi czasu i decyduje o korekcie; kwota nie zmienia się sama. */
export const isMovedAfterEnd = (distanceAfterEndM: number): boolean => distanceAfterEndM > MOVED_AFTER_END_DISTANCE_M;

/** Po odrzuconej albo niepotwierdzonej blokadzie systemu kolejna próba najwcześniej po 5 min (bez pętli komend). */
export const IDLE_LOCK_RETRY_MS = 5 * 60_000;

/**
 * Hulajnoga bez otwartego przejazdu zgłasza się odblokowana (np. po zakończeniu offline, `END_UNCONFIRMED` albo
 * zdalnym zakończeniu bez łączności): system wysyła `lock` bez `rental_id` (ADR 0056), także w `MAINTENANCE`
 * i `RETIRED`, bo zakończenie przejazdu może od razu wyłączyć hulajnogę z ruchu (zadanie `RELOCATION` albo
 * `BATTERY_SWAP`). Wyjątek: operator świadomie odblokował hulajnogę z panelu (ostatnia potwierdzona komenda
 * `lock`/`unlock` bez przejazdu to `unlock` nowszy niż koniec ostatniego przejazdu). Po odrzuconej albo
 * niepotwierdzonej blokadzie systemu kolejna próba czeka `IDLE_LOCK_RETRY_MS`.
 */
export function shouldLockIdleScooter(input: {
  hasOpenRental: boolean;
  locked: boolean;
  lockPending: boolean;
  lastEndedAt: Date | null;
  /** Ostatnia potwierdzona komenda `lock`/`unlock` bez przejazdu (panel albo system). */
  lastManualCommand: { type: 'LOCK' | 'UNLOCK'; at: Date } | null;
  /** Ostatnia odrzucona albo niepotwierdzona blokada systemu (bez przejazdu). */
  lastLockFailedAt: Date | null;
  now: Date;
}): boolean {
  if (input.hasOpenRental || input.locked || input.lockPending) return false;
  const manual = input.lastManualCommand;
  if (manual?.type === 'UNLOCK' && (!input.lastEndedAt || manual.at > input.lastEndedAt)) return false;
  if (input.lastLockFailedAt && input.now.getTime() - input.lastLockFailedAt.getTime() < IDLE_LOCK_RETRY_MS) {
    return false;
  }
  return true;
}
