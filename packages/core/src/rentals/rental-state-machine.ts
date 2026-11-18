import { DomainError } from '../errors.js';

/** Stany przejazdu; rezerwacja to pierwszy stan przejazdu (ADR 0013). */
export const RENTAL_STATES = [
  'RESERVED',
  'UNLOCKING',
  'ACTIVE',
  'PAUSED',
  'ENDING',
  'ENDED',
  'EXPIRED',
  'UNLOCK_FAILED',
  'UNPAID',
] as const;
export type RentalState = (typeof RENTAL_STATES)[number];

/** Stany niekońcowe: hulajnoga i użytkownik mogą mieć najwyżej jeden taki przejazd (indeksy częściowe w bazie). */
export const OPEN_RENTAL_STATES = [
  'RESERVED',
  'UNLOCKING',
  'ACTIVE',
  'PAUSED',
  'ENDING',
] as const satisfies readonly RentalState[];

/** Zdarzenia zmieniające stan; nazwy odpowiadają przejściom z diagramu w arc42 §6.1. */
export type RentalAction =
  | 'RESERVE'
  | 'START'
  | 'EXPIRE_RESERVATION'
  | 'CANCEL_RESERVATION'
  | 'CONFIRM_UNLOCK'
  | 'UNLOCK_TIMEOUT'
  | 'PAUSE'
  | 'RESUME'
  | 'REQUEST_END'
  | 'COMPLETE_END'
  | 'ABORT_END'
  | 'ABORT_END_PAUSED'
  | 'END_REMOTELY'
  | 'END_UNCONFIRMED'
  | 'DECLINE_PAYMENT'
  | 'SETTLE_DEBT';

/** `null` oznacza przejazd, który jeszcze nie istnieje. */
type From = RentalState | null;

const TRANSITIONS: Record<RentalAction, ReadonlyArray<readonly [From, RentalState]>> = {
  RESERVE: [[null, 'RESERVED']],
  START: [
    [null, 'UNLOCKING'],
    ['RESERVED', 'UNLOCKING'],
  ],
  EXPIRE_RESERVATION: [['RESERVED', 'EXPIRED']],
  CANCEL_RESERVATION: [['RESERVED', 'EXPIRED']],
  CONFIRM_UNLOCK: [['UNLOCKING', 'ACTIVE']],
  UNLOCK_TIMEOUT: [['UNLOCKING', 'UNLOCK_FAILED']],
  PAUSE: [['ACTIVE', 'PAUSED']],
  RESUME: [['PAUSED', 'ACTIVE']],
  REQUEST_END: [
    ['ACTIVE', 'ENDING'],
    ['PAUSED', 'ENDING'],
  ],
  COMPLETE_END: [['ENDING', 'ENDED']],
  // Hulajnoga nie potwierdziła blokady: przejazd wraca do stanu sprzed żądania zakończenia (ADR 0036).
  ABORT_END: [['ENDING', 'ACTIVE']],
  ABORT_END_PAUSED: [['ENDING', 'PAUSED']],
  // Operator kończy przejazd niezależnie od strefy i bez czekania na blokadę (decyzja D7).
  END_REMOTELY: [
    ['ACTIVE', 'ENDED'],
    ['PAUSED', 'ENDED'],
    ['ENDING', 'ENDED'],
  ],
  // Zakończenie bez łączności (ADR 0056): hulajnoga nie potwierdziła blokady w 10 min, a przejazd i tak się
  // kończy z naliczaniem do żądania klienta i zgłoszeniem automatycznym `OFFLINE`.
  END_UNCONFIRMED: [['ENDING', 'ENDED']],
  // Odmowa obciążenia karty po zakończeniu (ADR 0049 zmienia ADR 0013): przejazd kończy się od razu,
  // a zaległość jest osobnym stanem do spłaty. `UNPAID` nie jest stanem otwartym.
  DECLINE_PAYMENT: [['ENDED', 'UNPAID']],
  SETTLE_DEBT: [['UNPAID', 'ENDED']],
};

function next(from: From, action: RentalAction): RentalState | undefined {
  return TRANSITIONS[action].find(([source]) => source === from)?.[1];
}

/**
 * Maszyna stanów przejazdu: jedyne miejsce, które decyduje o dozwolonych przejściach (ADR 0013).
 * Warunki biznesowe przejścia (np. strefa parkowania przy REQUEST_END) sprawdzają wywołujące
 * je reguły; maszyna pilnuje tylko kolejności stanów.
 */
export const RentalStateMachine = {
  next,

  /** Stan po przejściu; niedozwolone przejście kończy się błędem `INVALID_RENTAL_TRANSITION`. */
  transition(from: From, action: RentalAction): RentalState {
    const to = next(from, action);
    if (!to) throw new DomainError('INVALID_RENTAL_TRANSITION', { from, action });
    return to;
  },

  isAllowed(from: From, to: RentalState): boolean {
    return Object.values(TRANSITIONS).some((pairs) =>
      pairs.some(([source, target]) => source === from && target === to),
    );
  },

  isOpen(state: RentalState): boolean {
    return (OPEN_RENTAL_STATES as readonly RentalState[]).includes(state);
  },
};
