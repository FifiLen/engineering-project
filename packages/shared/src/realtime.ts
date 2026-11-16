/**
 * Zdarzenia Socket.IO (ADR 0012, arc42 §8.7). Stan źródłowy zawsze można pobrać przez REST;
 * zdarzenia tylko przyspieszają odświeżenie.
 */
import type { CommandView, FleetStatus } from './admin/fleet.js';

/** Pokój panelu z pozycjami całej floty. */
export const FLEET_ROOM = 'fleet';

/** Hulajnoga na mapie floty: punkt początkowy z `GET /admin/fleet/map` i aktualizacje na żywo. */
export interface FleetMapScooter {
  id: string;
  number: number;
  lat: number | null;
  lon: number | null;
  batteryPct: number | null;
  fleetStatus: FleetStatus;
  online: boolean;
  lastSeenAt: string | null;
  speedKmh: number | null;
  locked: boolean | null;
}

export interface ServerToClientEvents {
  /** Zmiany pozycji, baterii i statusu zebrane w krótkim oknie (jedno zdarzenie zamiast setek). */
  'fleet.updates': (updates: FleetMapScooter[]) => void;
  /** Wysłanie komendy i każda zmiana jej statusu (potwierdzenie, odrzucenie, przekroczenie czasu). */
  'fleet.command': (command: CommandView) => void;
}

/** Odpowiedź na dołączenie do pokoju (potwierdzenie Socket.IO). */
export type SubscribeAck = { ok: true } | { ok: false; code: 'UNAUTHENTICATED' | 'FORBIDDEN' };

/**
 * Połączenie wymaga tokenu dostępowego operatora w `auth.token` (ADR 0035); bez niego serwer
 * rozłącza klienta.
 */
export interface ClientToServerEvents {
  /** Dołączenie do pokoju `fleet`; wymaga uprawnienia `scooters.read`. */
  'fleet.subscribe': (ack: (result: SubscribeAck) => void) => void;
}
