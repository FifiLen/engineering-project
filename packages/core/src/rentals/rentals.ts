import { DomainError } from '../errors.js';
import { COMMAND_ACK_TIMEOUT_MS, type CommandType } from '../fleet/commands.js';
import type { ScooterStatus } from '../fleet/fleet-status.js';
import { RentalStateMachine, type RentalAction, type RentalState } from './rental-state-machine.js';

/** Typ `rental_event_type`; zdarzenia bez zmiany stanu opisują przebieg przejazdu na osi czasu (ADR 0036). */
export const RENTAL_EVENT_TYPES = [
  'STATE_CHANGED',
  'ZONE_ENTERED',
  'ZONE_EXITED',
  'BATTERY_LOW',
  'CONNECTION_LOST',
  'CONNECTION_RESTORED',
  'PHOTO_UPLOADED',
  'END_REQUESTED',
  'PAUSE_FAILED',
  'RESUME_FAILED',
  'LOCK_FAILED',
  'ENDED_REMOTELY',
  'LATE_UNLOCK_LOCKED',
  // ADR 0056: koniec naliczania po 30 min bez łączności i ruch hulajnogi po żądaniu zakończenia offline.
  'BILLING_STOPPED',
  'MOVED_AFTER_END',
] as const;
export type RentalEventType = (typeof RENTAL_EVENT_TYPES)[number];

/**
 * Tryb zakończenia (`rentals.end_mode`, ADR 0056): klient przy hulajnodze online, klient przy hulajnodze offline
 * (zdjęcie wymagane), operator zdalnie, zakończenie bez potwierdzenia blokady po żądaniu offline.
 */
export const END_MODES = ['CUSTOMER', 'CUSTOMER_OFFLINE', 'REMOTE', 'UNCONFIRMED'] as const;
export type EndMode = (typeof END_MODES)[number];

/** Żądanie zakończenia bez łączności: `LOCK_FAILED` go nie unieważnia, a zdjęcie parkowania jest wymagane. */
export const isOfflineEndMode = (mode: EndMode | null | undefined): boolean =>
  mode === 'CUSTOMER_OFFLINE' || mode === 'UNCONFIRMED';

/** Promień i liczba hulajnóg na mapie w aplikacji (pytanie 9 w planie iteracji 3). */
export const NEARBY_RADIUS_M = 2000;
export const NEARBY_LIMIT = 50;

/** Powody zdalnego zakończenia z panelu; notatka operatora trafia tylko do dziennika audytu. */
export const REMOTE_END_REASONS = ['SCOOTER_NOT_RESPONDING', 'CUSTOMER_REQUEST', 'TERMS_VIOLATION', 'OTHER'] as const;
export type RemoteEndReason = (typeof REMOTE_END_REASONS)[number];

/** Wartości z wersji cennika potrzebne w przejeździe (ADR 0015); kwoty w groszach. */
export interface RentalTariff {
  id: string;
  version: number;
  unlockFee: number;
  minuteRate: number;
  pauseMinuteRate: number;
  freeReservationMinutes: number;
  minBatteryPct: number;
}

export interface RentableScooter {
  id: string;
  number: number;
  status: ScooterStatus;
  online: boolean;
  batteryPct: number | null;
  /** Pozycja w obszarze działania i poza strefą zakazu (`evaluatePosition(...).canRide`); `null`, gdy brak pozycji. */
  canRide?: boolean | null;
}

/** Otwarty przejazd (stan niekońcowy) z komendą, na którą czeka. */
export interface OpenRental {
  id: string;
  userId: string;
  scooterId: string;
  state: RentalState;
  reservationExpiresAt: Date | null;
  pendingCommand: CommandType | null;
}

export const UNAVAILABLE_REASONS = [
  'RESERVED',
  'IN_USE',
  'MAINTENANCE',
  'RETIRED',
  'OFFLINE',
  'OUT_OF_AREA',
  'LOW_BATTERY',
] as const;
export type UnavailableReason = (typeof UNAVAILABLE_REASONS)[number];

/** Dlaczego klient nie wypożyczy hulajnogi; `null`, gdy może. Kolejność odpowiada `deriveFleetStatus`. */
export function unavailableReason(
  scooter: RentableScooter,
  tariff: Pick<RentalTariff, 'minBatteryPct'>,
): UnavailableReason | null {
  if (scooter.status === 'RETIRED' || scooter.status === 'MAINTENANCE') return scooter.status;
  if (scooter.status === 'RESERVED' || scooter.status === 'IN_USE') return scooter.status;
  if (!scooter.online) return 'OFFLINE';
  // Strefa zakazu albo poza obszarem działania: hulajnoga czeka na serwis (pytanie 4 w planie iteracji 4).
  if (scooter.canRide === false) return 'OUT_OF_AREA';
  if ((scooter.batteryPct ?? 0) < tariff.minBatteryPct) return 'LOW_BATTERY';
  return null;
}

function ensureRentable(scooter: RentableScooter, tariff: RentalTariff): void {
  const reason = unavailableReason(scooter, tariff);
  if (reason) throw new DomainError('SCOOTER_UNAVAILABLE', { reason, scooterNumber: scooter.number });
}

export function reservationExpiresAt(now: Date, tariff: Pick<RentalTariff, 'freeReservationMinutes'>): Date {
  return new Date(now.getTime() + tariff.freeReservationMinutes * 60_000);
}

export interface RentalRequest {
  userId: string;
  scooter: RentableScooter;
  tariff: RentalTariff;
  /** Otwarty przejazd klienta i otwarty przejazd hulajnogi, odczytane z blokadą wierszy. */
  userRental: OpenRental | null;
  scooterRental: OpenRental | null;
  now: Date;
}

/** Wynik żądania: istniejący przejazd (ponowione żądanie) albo przejście z akcją maszyny stanów. */
export type RentalDecision =
  | { kind: 'EXISTING'; rentalId: string }
  | { kind: 'TRANSITION'; action: RentalAction; from: RentalState | null; to: RentalState; rentalId: string | null };

function ensureNoOtherRental(request: RentalRequest): void {
  if (request.userRental && request.userRental.scooterId !== request.scooter.id) {
    throw new DomainError('RENTAL_ALREADY_OPEN', { rentalId: request.userRental.id });
  }
  if (request.scooterRental && request.scooterRental.userId !== request.userId) {
    const reason: UnavailableReason = request.scooterRental.state === 'RESERVED' ? 'RESERVED' : 'IN_USE';
    throw new DomainError('SCOOTER_UNAVAILABLE', { reason, scooterNumber: request.scooter.number });
  }
}

/** Rezerwacja z karty hulajnogi (decyzja D3). Powtórzona rezerwacja tej samej hulajnogi zwraca istniejącą. */
export function decideReservation(request: RentalRequest): RentalDecision {
  ensureNoOtherRental(request);
  if (request.userRental) {
    if (request.userRental.state === 'RESERVED') return { kind: 'EXISTING', rentalId: request.userRental.id };
    throw new DomainError('RENTAL_ALREADY_OPEN', { rentalId: request.userRental.id });
  }
  ensureRentable(request.scooter, request.tariff);
  return {
    kind: 'TRANSITION',
    action: 'RESERVE',
    from: null,
    to: RentalStateMachine.transition(null, 'RESERVE'),
    rentalId: null,
  };
}

/**
 * Start przejazdu: z własnej rezerwacji albo od razu po skanie. Ponowione żądanie tej samej hulajnogi
 * zwraca otwarty przejazd zamiast drugiego (idempotencja przez indeksy jednego otwartego przejazdu, ADR 0036).
 */
export function decideStart(request: RentalRequest): RentalDecision {
  ensureNoOtherRental(request);
  const own = request.userRental;
  if (own && own.state !== 'RESERVED') return { kind: 'EXISTING', rentalId: own.id };
  if (own) {
    if (own.reservationExpiresAt && own.reservationExpiresAt <= request.now) {
      throw new DomainError('RESERVATION_EXPIRED', { rentalId: own.id });
    }
    // Własna rezerwacja: hulajnoga ma status RESERVED, ale musi być online i mieć baterię.
    ensureRentable({ ...request.scooter, status: 'AVAILABLE' }, request.tariff);
    return {
      kind: 'TRANSITION',
      action: 'START',
      from: 'RESERVED',
      to: RentalStateMachine.transition('RESERVED', 'START'),
      rentalId: own.id,
    };
  }
  ensureRentable(request.scooter, request.tariff);
  return {
    kind: 'TRANSITION',
    action: 'START',
    from: null,
    to: RentalStateMachine.transition(null, 'START'),
    rentalId: null,
  };
}

function ensureOwner(rental: OpenRental | null, userId: string): asserts rental is OpenRental {
  if (!rental || rental.userId !== userId) throw new DomainError('NOT_FOUND', { entity: 'rental' });
}

function ensureNoPendingCommand(rental: OpenRental): void {
  if (rental.pendingCommand) throw new DomainError('RENTAL_COMMAND_PENDING', { command: rental.pendingCommand });
}

export function decideCancelReservation(rental: OpenRental | null, userId: string): RentalState {
  ensureOwner(rental, userId);
  return RentalStateMachine.transition(rental.state, 'CANCEL_RESERVATION');
}

/** Komenda, którą wysyła operacja klienta w trakcie jazdy; stan zmienia dopiero jej potwierdzenie (ADR 0036). */
export interface RideCommandDecision {
  command: CommandType;
}

export function decidePause(rental: OpenRental | null, userId: string): RideCommandDecision {
  ensureOwner(rental, userId);
  RentalStateMachine.transition(rental.state, 'PAUSE');
  ensureNoPendingCommand(rental);
  return { command: 'LOCK' };
}

export function decideResume(rental: OpenRental | null, userId: string): RideCommandDecision {
  ensureOwner(rental, userId);
  RentalStateMachine.transition(rental.state, 'RESUME');
  ensureNoPendingCommand(rental);
  return { command: 'UNLOCK' };
}

/** Najbliższa strefa parkowania podawana w błędzie `OUTSIDE_PARKING` (mapa w aplikacji). */
export interface NearestParking {
  code: string;
  name: string;
  distanceM: number;
  lat: number;
  lon: number;
}

export interface EndDecision extends RideCommandDecision {
  to: RentalState;
  /** Stan, do którego przejazd wróci, jeśli hulajnoga nie potwierdzi blokady. */
  resumeState: 'ACTIVE' | 'PAUSED';
  /** `rentals.end_mode` zapisywany przy żądaniu; `CUSTOMER_OFFLINE` daje `END_REQUESTED` z `data.mode = 'OFFLINE'`. */
  endMode: Extract<EndMode, 'CUSTOMER' | 'CUSTOMER_OFFLINE'>;
}

/**
 * Zakończenie przez klienta tylko w strefie parkowania (pytanie 6: twarda blokada). `canPark` liczy
 * `evaluatePosition` dla ostatniej pozycji hulajnogi.
 */
export function decideEnd(
  rental: OpenRental | null,
  userId: string,
  position: { canPark: boolean; nearestParking: NearestParking | null },
): EndDecision {
  ensureOwner(rental, userId);
  const to = RentalStateMachine.transition(rental.state, 'REQUEST_END');
  ensureNoPendingCommand(rental);
  if (!position.canPark) throw new DomainError('OUTSIDE_PARKING', { nearestParking: position.nearestParking });
  return { command: 'LOCK', to, resumeState: rental.state === 'PAUSED' ? 'PAUSED' : 'ACTIVE', endMode: 'CUSTOMER' };
}

/** Najstarsza pozycja, z której klient zakończy przejazd przy hulajnodze offline (pytanie 1, ADR 0056). */
export const OFFLINE_END_POSITION_MAX_AGE_MS = 120_000;
/** Czas na potwierdzenie blokady po żądaniu offline: `expiresAt` komendy `lock` i zadanie `rental.offline-end-timeout`. */
export const OFFLINE_END_TIMEOUT_MS = 10 * 60_000;

/**
 * Warunek zakończenia bez łączności (ADR 0056): ostatnia pozycja z telemetrii ma najwyżej 120 s w chwili
 * żądania i leży w strefie parkowania poza strefą zakazu. Błąd `POSITION_STALE` albo `OUTSIDE_PARKING`.
 */
export function canEndOffline(input: {
  positionAt: Date | null;
  now: Date;
  inParking: boolean;
  inNoRide: boolean;
  nearestParking?: NearestParking | null;
}): void {
  const ageMs = input.positionAt ? input.now.getTime() - input.positionAt.getTime() : null;
  if (ageMs === null || ageMs > OFFLINE_END_POSITION_MAX_AGE_MS) {
    throw new DomainError('POSITION_STALE', {
      positionAt: input.positionAt?.toISOString() ?? null,
      maxAgeS: OFFLINE_END_POSITION_MAX_AGE_MS / 1000,
    });
  }
  if (!input.inParking || input.inNoRide) {
    throw new DomainError('OUTSIDE_PARKING', { nearestParking: input.nearestParking ?? null });
  }
}

export interface OfflineEndDecision extends EndDecision {
  endMode: 'CUSTOMER_OFFLINE';
  /** Ważność komendy `lock`: broker dostarczy ją z sesji trwałej po powrocie hulajnogi. */
  commandTtlMs: number;
}

/**
 * Zakończenie przez klienta przy hulajnodze offline (ADR 0056): to samo przejście co `decideEnd`, ale
 * z warunkiem ostatniej pozycji, blokadą ważną 10 min i trybem `CUSTOMER_OFFLINE`. Hulajnoga online
 * kończy przejazd przez `decideEnd`.
 */
export function decideOfflineEnd(
  rental: OpenRental | null,
  userId: string,
  position: Parameters<typeof canEndOffline>[0],
): OfflineEndDecision {
  ensureOwner(rental, userId);
  const to = RentalStateMachine.transition(rental.state, 'REQUEST_END');
  ensureNoPendingCommand(rental);
  canEndOffline(position);
  return {
    command: 'LOCK',
    to,
    resumeState: rental.state === 'PAUSED' ? 'PAUSED' : 'ACTIVE',
    endMode: 'CUSTOMER_OFFLINE',
    commandTtlMs: OFFLINE_END_TIMEOUT_MS,
  };
}

export interface RemoteEndDecision {
  to: RentalState;
  endMode: Extract<EndMode, 'REMOTE'>;
  /** `null`: blokada już czeka na potwierdzenie (przejazd w ENDING), więc druga komenda nie jest potrzebna. */
  command: CommandType | null;
  /**
   * Ważność blokady: hulajnoga offline dostaje ją z sesji trwałej brokera po powrocie łączności, więc czeka 10 min
   * jak przy zakończeniu klienta offline (ADR 0056); online 10 s (ADR 0038).
   */
  commandTtlMs: number;
}

/** Zdalne zakończenie przez operatora (D7): niezależnie od strefy, z powodem. */
export function decideRemoteEnd(
  rental: OpenRental | null,
  reason: RemoteEndReason,
  note: string | null,
  scooter: { online: boolean } = { online: true },
): RemoteEndDecision {
  if (!rental) throw new DomainError('NOT_FOUND', { entity: 'rental' });
  if (reason === 'OTHER' && !note?.trim()) throw new DomainError('VALIDATION_FAILED', { field: 'note' });
  const to = RentalStateMachine.transition(rental.state, 'END_REMOTELY');
  // Odblokowanie w toku (wznowienie) zablokowałoby indeks jednej komendy; operator ponawia po limicie potwierdzenia.
  if (rental.pendingCommand === 'UNLOCK') throw new DomainError('RENTAL_COMMAND_PENDING', { command: 'UNLOCK' });
  return {
    to,
    endMode: 'REMOTE',
    command: rental.pendingCommand === 'LOCK' ? null : 'LOCK',
    commandTtlMs: scooter.online ? COMMAND_ACK_TIMEOUT_MS : OFFLINE_END_TIMEOUT_MS,
  };
}

/** Wynik komendy przejazdu: potwierdzona albo nie (odmowa hulajnogi lub brak potwierdzenia w limicie). */
export type CommandResult = 'CONFIRMED' | 'FAILED';

export interface CommandOutcome {
  action: RentalAction | null;
  event: Exclude<RentalEventType, 'STATE_CHANGED'> | null;
  /** Spóźnione odblokowanie, na które nikt nie czeka: backend od razu blokuje hulajnogę (ADR 0038). */
  compensateLock: boolean;
}

const NO_OUTCOME: CommandOutcome = { action: null, event: null, compensateLock: false };

/**
 * Co zmienia wynik komendy przejazdu. `late` oznacza komendę, która nie ma już statusu SENT (przekroczony
 * limit albo powtórzone potwierdzenie): taka komenda nie zmienia stanu przejazdu.
 */
export function rentalCommandOutcome(input: {
  state: RentalState;
  command: CommandType;
  result: CommandResult;
  late: boolean;
  resumeState?: 'ACTIVE' | 'PAUSED';
  /** Tryb żądania zakończenia; przy zakończeniu offline brak blokady kończy przejazd zamiast go wznawiać (ADR 0056). */
  endMode?: EndMode | null;
}): CommandOutcome {
  const { state, command, result, late } = input;
  if (late) {
    return command === 'UNLOCK' && result === 'CONFIRMED' && state !== 'ACTIVE' && state !== 'UNLOCKING'
      ? { action: null, event: 'LATE_UNLOCK_LOCKED', compensateLock: true }
      : NO_OUTCOME;
  }
  const ok = result === 'CONFIRMED';
  if (state === 'UNLOCKING' && command === 'UNLOCK')
    return { ...NO_OUTCOME, action: ok ? 'CONFIRM_UNLOCK' : 'UNLOCK_TIMEOUT' };
  if (state === 'ACTIVE' && command === 'LOCK')
    return ok ? { ...NO_OUTCOME, action: 'PAUSE' } : { ...NO_OUTCOME, event: 'PAUSE_FAILED' };
  if (state === 'PAUSED' && command === 'UNLOCK')
    return ok ? { ...NO_OUTCOME, action: 'RESUME' } : { ...NO_OUTCOME, event: 'RESUME_FAILED' };
  if (state === 'ENDING' && command === 'LOCK') {
    if (ok) return { ...NO_OUTCOME, action: 'COMPLETE_END' };
    // Odrzucenie albo wygaśnięcie blokady po 10 min: przejazd kończy się z naliczaniem do żądania klienta.
    if (isOfflineEndMode(input.endMode))
      return { action: 'END_UNCONFIRMED', event: 'LOCK_FAILED', compensateLock: false };
    return {
      action: input.resumeState === 'PAUSED' ? 'ABORT_END_PAUSED' : 'ABORT_END',
      event: 'LOCK_FAILED',
      compensateLock: false,
    };
  }
  // Komenda bez przejazdu, na który czeka (np. blokada po zdalnym zakończeniu): zmienia się tylko jej status.
  return NO_OUTCOME;
}

/**
 * Potwierdzenie z hulajnogi. `ALREADY_IN_STATE` przy blokadzie i odblokowaniu też jest sukcesem: hulajnoga
 * jest w stanie, o który prosiliśmy (np. kończenie z pauzy, hulajnoga zostawiona odblokowana).
 */
/** Komendy stanu: hulajnoga już w docelowym stanie to sukces (blokada, odblokowanie, zatrzymanie, napęd). */
const STATE_COMMANDS: readonly CommandType[] = ['LOCK', 'UNLOCK', 'STOP_GRADUALLY', 'RELEASE_STOP'];

export function commandResultFromAck(command: CommandType, ok: boolean, reason?: string): CommandResult {
  if (ok) return 'CONFIRMED';
  return STATE_COMMANDS.includes(command) && reason === 'ALREADY_IN_STATE' ? 'CONFIRMED' : 'FAILED';
}

/** Dzwonek z aplikacji (decyzja D5): przy własnej rezerwacji albo przy wolnej hulajnodze, gdy klient nie ma przejazdu. */
export function ensureCanRing(scooter: RentableScooter, userRental: OpenRental | null): void {
  if (!scooter.online)
    throw new DomainError('SCOOTER_UNAVAILABLE', { reason: 'OFFLINE', scooterNumber: scooter.number });
  if (userRental) {
    if (userRental.scooterId === scooter.id && userRental.state === 'RESERVED') return;
    throw new DomainError('RING_NOT_ALLOWED');
  }
  if (scooter.status !== 'AVAILABLE') throw new DomainError('RING_NOT_ALLOWED');
}

/**
 * Usunięcie konta (pytanie 7): bez otwartego przejazdu, bez zaległości (ADR 0049), bez płatności i zwrotów
 * w toku i z saldem 0 (zwrot salda robi operator, ADR 0054); baza sprawdza przejazd i saldo także
 * w `sp_anonymize_user`.
 */
export function ensureCanDeleteAccount(input: {
  hasOpenRental: boolean;
  balance: number;
  unpaidRentals?: number;
  pendingPayments?: number;
}): void {
  if (input.hasOpenRental) throw new DomainError('USER_HAS_OPEN_RENTAL');
  if (input.unpaidRentals) throw new DomainError('PAYMENT_OVERDUE', { count: input.unpaidRentals });
  if (input.pendingPayments) throw new DomainError('PAYMENT_IN_PROGRESS', { count: input.pendingPayments });
  if (input.balance !== 0) throw new DomainError('WALLET_BALANCE_NOT_ZERO', { balance: input.balance });
}
