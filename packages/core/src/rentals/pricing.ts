import type { RentalState } from './rental-state-machine.js';
import type { RentalEventType, RentalTariff } from './rentals.js';

/** Wpis osi czasu potrzebny do liczników: zmiany stanu i zdarzenia końca naliczania. */
export interface TimelineEvent {
  type: RentalEventType;
  toState: RentalState | null;
  at: Date;
}

export interface RentalCounters {
  rideSeconds: number;
  pauseSeconds: number;
  /** Potwierdzone odblokowanie; `null`, gdy przejazd się nie zaczął. */
  startedAt: Date | null;
  /** Koniec naliczania: żądanie zakończenia albo zdalne zakończenie; `null`, gdy naliczanie trwa. */
  billedUntil: Date | null;
}

const seconds = (from: Date, to: Date) => Math.max(0, Math.floor((to.getTime() - from.getTime()) / 1000));

/**
 * Czas jazdy i pauzy z osi czasu (ADR 0042). Jazda zaczyna się od potwierdzonego odblokowania, a pauza
 * trwa od potwierdzonej blokady do potwierdzonego wznowienia; oczekiwanie na komendę liczy się do
 * poprzedniego trybu, bo hulajnoga jest jeszcze w poprzednim stanie. Naliczanie kończy się przy żądaniu
 * zakończenia (unieważnionym przez `LOCK_FAILED`) albo przy zdalnym zakończeniu, a jeśli klient poprosił
 * o zakończenie wcześniej, liczy się jego żądanie.
 */
export function rentalCounters(events: readonly TimelineEvent[], now: Date): RentalCounters {
  const sorted = [...events].sort((a, b) => a.at.getTime() - b.at.getTime());
  let mode: 'RIDE' | 'PAUSE' | null = null;
  let since: Date | null = null;
  let startedAt: Date | null = null;
  let endRequestedAt: Date | null = null;
  let billedUntil: Date | null = null;
  let ride = 0;
  let pause = 0;

  const close = (at: Date) => {
    if (mode && since) {
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

  for (const event of sorted) {
    if (billedUntil) break;
    if (event.type === 'STATE_CHANGED' && event.toState === 'ACTIVE') {
      startedAt ??= event.at;
      switchTo('RIDE', event.at);
    } else if (event.type === 'STATE_CHANGED' && event.toState === 'PAUSED') {
      switchTo('PAUSE', event.at);
    } else if (event.type === 'END_REQUESTED') {
      endRequestedAt = event.at;
    } else if (event.type === 'LOCK_FAILED') {
      endRequestedAt = null;
    } else if (event.type === 'ENDED_REMOTELY') {
      billedUntil = endRequestedAt ?? event.at;
    } else if (event.type === 'STATE_CHANGED' && event.toState === 'ENDED') {
      billedUntil = endRequestedAt ?? event.at;
    }
  }
  // Przejazd w ENDING: naliczanie wstrzymane na czas oczekiwania na blokadę.
  const until = billedUntil ?? endRequestedAt ?? now;
  if (startedAt) close(until);
  return { rideSeconds: ride, pauseSeconds: pause, startedAt, billedUntil: billedUntil ?? endRequestedAt };
}

export interface RentalPrice {
  unlockFee: number;
  rideMinutes: number;
  rideAmount: number;
  pauseMinutes: number;
  pauseAmount: number;
  total: number;
}

const FREE: RentalPrice = { unlockFee: 0, rideMinutes: 0, rideAmount: 0, pauseMinutes: 0, pauseAmount: 0, total: 0 };

/**
 * Wycena przejazdu w groszach (ADR 0042): opłata za odblokowanie, każda rozpoczęta minuta jazdy (co
 * najmniej jedna) i każda rozpoczęta minuta pauzy według wersji cennika zapisanej w przejeździe.
 * Przejazd bez potwierdzonego odblokowania nic nie kosztuje.
 */
export function priceRental(
  tariff: Pick<RentalTariff, 'unlockFee' | 'minuteRate' | 'pauseMinuteRate'>,
  counters: Pick<RentalCounters, 'rideSeconds' | 'pauseSeconds' | 'startedAt'>,
): RentalPrice {
  if (!counters.startedAt) return FREE;
  const rideMinutes = Math.max(1, Math.ceil(counters.rideSeconds / 60));
  const pauseMinutes = Math.ceil(counters.pauseSeconds / 60);
  const rideAmount = rideMinutes * tariff.minuteRate;
  const pauseAmount = pauseMinutes * tariff.pauseMinuteRate;
  return {
    unlockFee: tariff.unlockFee,
    rideMinutes,
    rideAmount,
    pauseMinutes,
    pauseAmount,
    total: tariff.unlockFee + rideAmount + pauseAmount,
  };
}
