import { distanceM } from '../geo.js';
import type { GeoPoint } from '../zones/zones.js';

/** Odczyt z hulajnogi po walidacji kontraktu MQTT. */
export interface TelemetryReading {
  recordedAt: Date;
  position: GeoPoint;
  batteryPct: number;
  speedKmh: number;
  locked: boolean;
  /** Punkt dosłany z bufora po odzyskaniu łączności. */
  buffered: boolean;
}

/** Ostatni znany stan hulajnogi, względem którego oceniamy nowy odczyt. */
export interface ScooterTrack {
  lastSeenAt: Date | null;
  position: GeoPoint | null;
}

/** Dopuszczalna różnica zegara hulajnogi i serwera. */
export const MAX_CLOCK_SKEW_MS = 60_000;
/**
 * Prędkość, powyżej której przesunięcie uznajemy za skok GPS albo przewóz hulajnogi, a nie jazdę
 * (hulajnogi są ograniczone do 20 km/h, zapas na niedokładność pomiaru).
 */
export const MAX_RIDE_SPEED_KMH = 45;
/** Przesunięcia poniżej tej wartości to szum GPS stojącej hulajnogi. */
export const MIN_MOVE_M = 3;

export type TelemetryDecision =
  | { accepted: false; reason: 'FROM_FUTURE' }
  | {
      accepted: true;
      /** Odczyt nowszy od ostatniego: zmienia pozycję, baterię i czas ostatniego sygnału hulajnogi. */
      updatesCurrentState: boolean;
      /** Przyrost przebiegu w metrach. */
      odometerIncrementM: number;
    };

/**
 * Każdy poprawny odczyt trafia do historii (trasy przejazdów), ale stan bieżący zmienia tylko odczyt
 * nowszy od ostatniego. Punkty dosłane z bufora po odzyskaniu łączności przychodzą w kolejności,
 * więc też przesuwają stan, jeśli są nowsze.
 */
export function evaluateTelemetry(track: ScooterTrack, reading: TelemetryReading, now: Date): TelemetryDecision {
  if (reading.recordedAt.getTime() - now.getTime() > MAX_CLOCK_SKEW_MS)
    return { accepted: false, reason: 'FROM_FUTURE' };
  if (track.lastSeenAt && reading.recordedAt <= track.lastSeenAt) {
    return { accepted: true, updatesCurrentState: false, odometerIncrementM: 0 };
  }
  return { accepted: true, updatesCurrentState: true, odometerIncrementM: odometerIncrement(track, reading) };
}

function odometerIncrement(track: ScooterTrack, reading: TelemetryReading): number {
  if (!track.position || !track.lastSeenAt) return 0;
  const meters = distanceM(track.position, reading.position);
  if (meters < MIN_MOVE_M) return 0;
  const seconds = (reading.recordedAt.getTime() - track.lastSeenAt.getTime()) / 1000;
  const kmh = (meters / seconds) * 3.6;
  return kmh > MAX_RIDE_SPEED_KMH ? 0 : Math.round(meters);
}
