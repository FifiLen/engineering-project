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
export const OPEN_RENTAL_STATES = ['RESERVED', 'UNLOCKING', 'ACTIVE', 'PAUSED', 'ENDING'] as const satisfies readonly RentalState[];

/** Zdarzenia zmieniające stan; nazwy odpowiadają przejściom z diagramu w arc42 §6.1. */
export type RentalAction =
  | 'RESERVE'
  | 'START'
  | 'EXPIRE_RESERVATION'
  | 'CONFIRM_UNLOCK'
  | 'UNLOCK_TIMEOUT'
  | 'PAUSE'
  | 'RESUME'
  | 'REQUEST_END'
  | 'COMPLETE_END'
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
  CONFIRM_UNLOCK: [['UNLOCKING', 'ACTIVE']],
  UNLOCK_TIMEOUT: [['UNLOCKING', 'UNLOCK_FAILED']],
  PAUSE: [['ACTIVE', 'PAUSED']],
  RESUME: [['PAUSED', 'ACTIVE']],
  REQUEST_END: [
    ['ACTIVE', 'ENDING'],
    ['PAUSED', 'ENDING'],
  ],
  COMPLETE_END: [['ENDING', 'ENDED']],
  DECLINE_PAYMENT: [['ENDING', 'UNPAID']],
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
    return Object.values(TRANSITIONS).some((pairs) => pairs.some(([source, target]) => source === from && target === to));
  },

  isOpen(state: RentalState): boolean {
    return (OPEN_RENTAL_STATES as readonly RentalState[]).includes(state);
  },
};
