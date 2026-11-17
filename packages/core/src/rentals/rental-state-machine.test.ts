import { describe, expect, it } from 'vitest';
import { DomainError } from '../errors.js';
import { OPEN_RENTAL_STATES, RENTAL_STATES, RentalStateMachine } from './rental-state-machine.js';

describe('maszyna stanów przejazdu', () => {
  it('prowadzi przejazd od rezerwacji do zakończenia', () => {
    let state = RentalStateMachine.transition(null, 'RESERVE');
    for (const action of ['START', 'CONFIRM_UNLOCK', 'PAUSE', 'RESUME', 'REQUEST_END', 'COMPLETE_END'] as const) {
      state = RentalStateMachine.transition(state, action);
    }
    expect(state).toBe('ENDED');
  });

  it('pozwala zacząć bez rezerwacji i spłacić zaległość po odmowie płatności', () => {
    expect(RentalStateMachine.transition(null, 'START')).toBe('UNLOCKING');
    expect(RentalStateMachine.transition('ENDED', 'DECLINE_PAYMENT')).toBe('UNPAID');
    expect(RentalStateMachine.transition('UNPAID', 'SETTLE_DEBT')).toBe('ENDED');
  });

  it('odrzuca niedozwolone przejście błędem domeny z kodem', () => {
    expect(() => RentalStateMachine.transition('ENDED', 'START')).toThrow(DomainError);
    expect(() => RentalStateMachine.transition('RESERVED', 'PAUSE')).toThrow(
      expect.objectContaining({ code: 'INVALID_RENTAL_TRANSITION', details: { from: 'RESERVED', action: 'PAUSE' } }),
    );
  });

  it('nie pozwala zakończyć przejazdu, który się nie rozpoczął', () => {
    expect(RentalStateMachine.next('UNLOCKING', 'REQUEST_END')).toBeUndefined();
    expect(RentalStateMachine.next('RESERVED', 'REQUEST_END')).toBeUndefined();
  });

  it('stany końcowe nie mają przejść wychodzących, a ENDED tylko odmowę płatności (ADR 0049)', () => {
    for (const terminal of ['EXPIRED', 'UNLOCK_FAILED'] as const) {
      expect(RENTAL_STATES.some((to) => RentalStateMachine.isAllowed(terminal, to))).toBe(false);
      expect(RentalStateMachine.isOpen(terminal)).toBe(false);
    }
    expect(RENTAL_STATES.filter((to) => RentalStateMachine.isAllowed('ENDED', to))).toEqual(['UNPAID']);
    expect(RentalStateMachine.next('ENDING', 'DECLINE_PAYMENT')).toBeUndefined();
  });

  it('stany otwarte blokują hulajnogę, a zaległość w płatności już nie', () => {
    expect(OPEN_RENTAL_STATES.every((s) => RentalStateMachine.isOpen(s))).toBe(true);
    expect(RentalStateMachine.isOpen('UNPAID')).toBe(false);
  });
});
