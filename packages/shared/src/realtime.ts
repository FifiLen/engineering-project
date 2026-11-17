/**
 * Zdarzenia Socket.IO (ADR 0012, arc42 §8.7). Stan źródłowy zawsze można pobrać przez REST;
 * zdarzenia tylko przyspieszają odświeżenie.
 */
import type { CommandView, FleetStatus } from './admin/fleet.js';
import type { RentalListItem } from './admin/rentals.js';
import type { RentalView } from './rentals.js';

/** Pokój panelu z pozycjami całej floty. */
export const FLEET_ROOM = 'fleet';
/** Pokój panelu ze zmianami przejazdów (lista, szczegóły); wymaga `rentals.read` (ADR 0036). */
export const RENTALS_ROOM = 'rentals';
/** Pokój klienta: jego przejazdy na wszystkich urządzeniach (ADR 0012). */
export const userRoom = (userId: string): string => `user:${userId}`;

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
  /** Panel: każda zmiana przejazdu (stan, komenda w toku, problem). */
  'rentals.changed': (rental: RentalListItem) => void;
  /** Wszyscy połączeni: strefy się zmieniły (panel, aplikacja); szczegóły pobiera się przez REST. */
  'zones.changed': (event: ZonesChanged) => void;
  /** Klient: pełny widok jego przejazdu po każdej zmianie (stan, komenda, komunikat, liczniki). */
  'rental.updated': (rental: RentalView) => void;
}

export interface ZonesChanged {
  zoneIds: string[];
  at: string;
}

/** Odpowiedź na dołączenie do pokoju (potwierdzenie Socket.IO). */
export type SubscribeAck = { ok: true } | { ok: false; code: 'UNAUTHENTICATED' | 'FORBIDDEN' };

/**
 * Połączenie wymaga tokenu dostępowego operatora albo klienta w `auth.token` (ADR 0035); bez niego
 * serwer rozłącza klienta. Klient trafia do pokoju `user:{id}` od razu po połączeniu.
 */
export interface ClientToServerEvents {
  /** Dołączenie do pokoju `fleet`; wymaga uprawnienia `scooters.read`. */
  'fleet.subscribe': (ack: (result: SubscribeAck) => void) => void;
  /** Dołączenie do pokoju `rentals`; wymaga uprawnienia `rentals.read`. */
  'rentals.subscribe': (ack: (result: SubscribeAck) => void) => void;
}
