import type { RentalState } from './rental-state-machine.js';
import { isOfflineEndMode, type EndMode, type RentalEventType, type RentalTariff } from './rentals.js';

/** Wpis osi czasu potrzebny do liczników: zmiany stanu i zdarzenia końca naliczania. */
export interface TimelineEvent {
  type: RentalEventType;
  toState: RentalState | null;
  at: Date;
  /** `data.mode` zdarzenia `END_REQUESTED`: `OFFLINE` przy zakończeniu bez łączności (ADR 0056). */
  mode?: 'OFFLINE' | null;
}

export interface RentalCountersOptions {
  /**
   * `rentals.end_mode` (ADR 0056). Tryb offline (`CUSTOMER_OFFLINE`, `UNCONFIRMED`) dotyczy ostatniego żądania
   * zakończenia, gdy zdarzenie nie ma `mode`; wcześniejsze żądania unieważnione przez `LOCK_FAILED` zostają online.
   */
  endMode?: EndMode | null;
}

export interface RentalCounters {
  rideSeconds: number;
  pauseSeconds: number;
  /** Potwierdzone odblokowanie; `null`, gdy przejazd się nie zaczął. */
  startedAt: Date | null;
  /** Koniec naliczania: żądanie zakończenia albo zdalne zakończenie; `null`, gdy naliczanie trwa. */
  billedUntil: Date | null;
  /**
   * Naliczanie zatrzymane po `OFFLINE_BILLING_CAP_MS` bez łączności (ADR 0056); `null`, gdy łączność jest albo
   * odcinek bez niej jest krótszy. Aplikacja nie dolicza wtedy czasu lokalnie.
   */
  billingStoppedAt: Date | null;
}

/** Najdłuższy płatny odcinek bez łączności (pytanie 1 planu iteracji 6); po nim naliczanie stoi do powrotu łączności. */
export const OFFLINE_BILLING_CAP_MS = 30 * 60_000;

const seconds = (from: Date, to: Date) => Math.max(0, Math.floor((to.getTime() - from.getTime()) / 1000));

/**
 * Czas jazdy i pauzy z osi czasu (ADR 0042). Jazda zaczyna się od potwierdzonego odblokowania, a pauza
 * trwa od potwierdzonej blokady do potwierdzonego wznowienia; oczekiwanie na komendę liczy się do
 * poprzedniego trybu, bo hulajnoga jest jeszcze w poprzednim stanie. Naliczanie kończy się przy żądaniu
 * zakończenia (unieważnionym przez `LOCK_FAILED`, chyba że żądanie było offline) albo przy zdalnym
 * zakończeniu, a jeśli klient poprosił o zakończenie wcześniej, liczy się jego żądanie.
 *
 * ADR 0056 zmienia ADR 0042 w dwóch sprawach: odcinek od `CONNECTION_LOST` do `CONNECTION_RESTORED` (albo do
 * końca naliczania) liczy się najwyżej przez `OFFLINE_BILLING_CAP_MS`, a `LOCK_FAILED` po żądaniu offline nie
 * przywraca naliczania.
 */
export function rentalCounters(
  events: readonly TimelineEvent[],
  now: Date,
  options: RentalCountersOptions = {},
): RentalCounters {
  const sorted = [...events].sort((a, b) => a.at.getTime() - b.at.getTime());
  const lastRequest = sorted.findLastIndex((e) => e.type === 'END_REQUESTED');
  let mode: 'RIDE' | 'PAUSE' | null = null;
  let since: Date | null = null;
  let startedAt: Date | null = null;
  let endRequestedAt: Date | null = null;
  let offlineRequest = false;
  let billedUntil: Date | null = null;
  let offlineSince: Date | null = null;
  let frozenAt: Date | null = null;
  let ride = 0;
  let pause = 0;

  const close = (at: Date) => {
    if (mode && since && !frozenAt) {
      if (mode === 'RIDE') ride += seconds(since, at);
      else pause += seconds(since, at);
    }
  };
  const switchTo = (next: 'RIDE' | 'PAUSE', at: Date) => {
    if (mode === next) return;
    close(at);
    mode = next;
    since = at;
  };
  // Odcinek bez łączności dłuższy niż limit: czas do chwili limitu się liczy, dalej już nie.
  const applyCap = (at: Date) => {
    if (!offlineSince || frozenAt) return;
    const cap = new Date(offlineSince.getTime() + OFFLINE_BILLING_CAP_MS);
    if (at < cap) return;
    close(cap);
    frozenAt = cap;
  };

  for (const [index, event] of sorted.entries()) {
    if (billedUntil) break;
    applyCap(event.at);
    if (event.type === 'STATE_CHANGED' && event.toState === 'ACTIVE') {
      startedAt ??= event.at;
      switchTo('RIDE', event.at);
    } else if (event.type === 'STATE_CHANGED' && event.toState === 'PAUSED') {
      switchTo('PAUSE', event.at);
    } else if (event.type === 'CONNECTION_LOST') {
      offlineSince ??= event.at;
    } else if (event.type === 'CONNECTION_RESTORED') {
      if (frozenAt) since = event.at;
      offlineSince = null;
      frozenAt = null;
    } else if (event.type === 'END_REQUESTED') {
      endRequestedAt = event.at;
      offlineRequest = event.mode === 'OFFLINE' || (index === lastRequest && isOfflineEndMode(options.endMode));
    } else if (event.type === 'LOCK_FAILED') {
      if (!offlineRequest) endRequestedAt = null;
    } else if (event.type === 'ENDED_REMOTELY') {
      billedUntil = endRequestedAt ?? event.at;
    } else if (event.type === 'STATE_CHANGED' && event.toState === 'ENDED') {
      billedUntil = endRequestedAt ?? event.at;
    }
  }
  // Przejazd w ENDING: naliczanie wstrzymane na czas oczekiwania na blokadę.
  const until = billedUntil ?? endRequestedAt ?? now;
  if (startedAt) {
    applyCap(until);
    close(until);
  }
  return {
    rideSeconds: ride,
    pauseSeconds: pause,
    startedAt,
    billedUntil: billedUntil ?? endRequestedAt,
    billingStoppedAt: startedAt ? frozenAt : null,
  };
}

export interface RentalPrice {
  unlockFee: number;
  rideMinutes: number;
  rideAmount: number;
  pauseMinutes: number;
  pauseAmount: number;
  /** Opłata za odholowanie (ADR 0060): osobna pozycja, 0 bez opłaty. */
  towingFee: number;
  /** Suma pozycji razem z opłatą za odholowanie (`rentals.total_amount`). */
  total: number;
}

const FREE: RentalPrice = {
  unlockFee: 0,
  rideMinutes: 0,
  rideAmount: 0,
  pauseMinutes: 0,
  pauseAmount: 0,
  towingFee: 0,
  total: 0,
};

/**
 * Wycena przejazdu w groszach (ADR 0042): opłata za odblokowanie, każda rozpoczęta minuta jazdy (co
 * najmniej jedna) i każda rozpoczęta minuta pauzy według wersji cennika zapisanej w przejeździe.
 * Przejazd bez potwierdzonego odblokowania nic nie kosztuje. Opłata za odholowanie (`rentals.towing_fee`,
 * ADR 0060) jest osobną pozycją wliczoną do sumy; `null` albo brak oznacza przejazd bez opłaty.
 */
export function priceRental(
  tariff: Pick<RentalTariff, 'unlockFee' | 'minuteRate' | 'pauseMinuteRate'>,
  counters: Pick<RentalCounters, 'rideSeconds' | 'pauseSeconds' | 'startedAt'>,
  extras: { towingFee?: number | null } = {},
): RentalPrice {
  if (!counters.startedAt) return FREE;
  const rideMinutes = Math.max(1, Math.ceil(counters.rideSeconds / 60));
  const pauseMinutes = Math.ceil(counters.pauseSeconds / 60);
  const rideAmount = rideMinutes * tariff.minuteRate;
  const pauseAmount = pauseMinutes * tariff.pauseMinuteRate;
  const towingFee = extras.towingFee ?? 0;
  return {
    unlockFee: tariff.unlockFee,
    rideMinutes,
    rideAmount,
    pauseMinutes,
    pauseAmount,
    towingFee,
    total: tariff.unlockFee + rideAmount + pauseAmount + towingFee,
  };
}

/** Stany końcowe przejazdu: liczniki i kwota są zapisane w wierszu przejazdu przy zakończeniu. */
export const SETTLED_RENTAL_STATES = [
  'ENDED',
  'UNPAID',
  'EXPIRED',
  'UNLOCK_FAILED',
] as const satisfies readonly RentalState[];

export const isSettledRentalState = (state: RentalState): boolean =>
  (SETTLED_RENTAL_STATES as readonly RentalState[]).includes(state);

/**
 * Liczniki i wycena w widokach przejazdu. Otwarty przejazd liczy się z osi czasu na chwilę `now`, a zakończony
 * pokazuje wartości zapisane przy zakończeniu (`ride_seconds`, `pause_seconds`, `total_amount`, `towing_fee`):
 * zmiana reguł naliczania (np. limit 30 min bez łączności z ADR 0056) nie zmienia kwoty przejazdu już
 * rozliczonego według reguł z chwili zakończenia.
 */
export function rentalFigures(
  tariff: Pick<RentalTariff, 'unlockFee' | 'minuteRate' | 'pauseMinuteRate'>,
  events: readonly TimelineEvent[],
  now: Date,
  rental: {
    state: RentalState;
    endMode: EndMode | null;
    rideSeconds: number;
    pauseSeconds: number;
    totalAmount: number | null;
    towingFee: number | null;
  },
): { counters: RentalCounters; price: RentalPrice } {
  const live = rentalCounters(events, now, { endMode: rental.endMode });
  if (!isSettledRentalState(rental.state)) {
    return { counters: live, price: priceRental(tariff, live, { towingFee: rental.towingFee }) };
  }
  const counters = { ...live, rideSeconds: rental.rideSeconds, pauseSeconds: rental.pauseSeconds };
  const price = priceRental(tariff, counters, { towingFee: rental.towingFee });
  return { counters, price: rental.totalAmount === null ? price : { ...price, total: rental.totalAmount } };
}
