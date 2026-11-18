/**
 * Zdarzenia Socket.IO (ADR 0012, arc42 §8.7). Stan źródłowy zawsze można pobrać przez REST;
 * zdarzenia tylko przyspieszają odświeżenie.
 */
import type { CommandView, FleetStatus } from './admin/fleet.js';
import type { RentalListItem } from './admin/rentals.js';
import type { NotificationView } from './notifications.js';
import type { WalletSummary } from './payments.js';
import type { RentalView } from './rentals.js';
import type { ServiceTaskStatus, ServiceTaskType, TaskPriority } from './service.js';
import type { SimulatorResult, SimulatorStatusView } from './simulator.js';
import type { AutoTicketKind, TicketSource, TicketStatus } from './tickets.js';

/** Pokój panelu z pozycjami całej floty. */
export const FLEET_ROOM = 'fleet';
/** Pokój panelu ze zmianami przejazdów (lista, szczegóły); wymaga `rentals.read` (ADR 0036). */
export const RENTALS_ROOM = 'rentals';
/** Pokój panelu ze zmianami zgłoszeń; wymaga `tickets.read` (ADR 0055). */
export const TICKETS_ROOM = 'tickets';
/** Pokój panelu ze zmianami zadań serwisowych; wymaga `service.read`. */
export const SERVICE_ROOM = 'service';
/** Pokój panelu ze stanem i wynikami poleceń symulatora; wymaga `simulator.manage` (ADR 0059). */
export const SIMULATOR_ROOM = 'simulator';
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
  /** Klient: saldo i zaległości po każdym ruchu w portfelu i zmianie płatności (ADR 0050, D8). */
  'wallet.updated': (wallet: WalletSummary) => void;
  /**
   * Panel (pokój `tickets`) i klient (pokój `user:{id}`, tylko jego zgłoszenia): zmiana statusu, przypisania
   * albo odpowiedzi. Treść bez nazwisk i notatek; szczegóły pobiera się przez REST.
   */
  'ticket.updated': (ticket: TicketUpdated) => void;
  /** Klient: powiadomienie po wysyłce; wersja web pokazuje baner, aplikacja natywna pomija (ADR 0058). */
  'notification.created': (notification: NotificationView) => void;
  /** Panel (pokój `service`): utworzenie zadania i każda zmiana statusu, przypisania albo części. */
  'service-task.updated': (task: ServiceTaskUpdated) => void;
  /** Panel (pokój `simulator`): stan z `simulator/status` przekazany przez API. */
  'simulator.status': (status: SimulatorStatusView) => void;
  /** Panel (pokój `simulator`): wynik polecenia z `simulator/control/result`. */
  'simulator.result': (result: SimulatorResult) => void;
}

export interface TicketUpdated {
  id: string;
  number: number;
  scooterId: string;
  source: TicketSource;
  autoKind: AutoTicketKind | null;
  status: TicketStatus;
  urgent: boolean;
  /** Tylko w pokoju `tickets` (panel); klient nie dostaje danych o operatorach (ADR 0055). */
  assigneeId?: string | null;
  /** Nowa odpowiedź dla klienta, jeszcze nieprzeczytana. */
  hasUnreadReply: boolean;
  updatedAt: string;
}

export interface ServiceTaskUpdated {
  id: string;
  number: number;
  scooterId: string;
  ticketId: string | null;
  type: ServiceTaskType;
  status: ServiceTaskStatus;
  priority: TaskPriority;
  assigneeId: string | null;
  updatedAt: string;
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
  /** Dołączenie do pokoju `tickets`; wymaga uprawnienia `tickets.read`. */
  'tickets.subscribe': (ack: (result: SubscribeAck) => void) => void;
  /** Dołączenie do pokoju `service`; wymaga uprawnienia `service.read`. */
  'service.subscribe': (ack: (result: SubscribeAck) => void) => void;
  /** Dołączenie do pokoju `simulator`; wymaga uprawnienia `simulator.manage`. */
  'simulator.subscribe': (ack: (result: SubscribeAck) => void) => void;
}
