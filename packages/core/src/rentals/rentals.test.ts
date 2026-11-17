import { describe, expect, it } from 'vitest';
import { priceRental, rentalCounters, type TimelineEvent } from './pricing.js';
import { RentalStateMachine } from './rental-state-machine.js';
import {
  commandResultFromAck,
  decideCancelReservation,
  decideEnd,
  decidePause,
  decideRemoteEnd,
  decideReservation,
  decideResume,
  decideStart,
  ensureCanDeleteAccount,
  ensureCanRing,
  rentalCommandOutcome,
  reservationExpiresAt,
  unavailableReason,
  type OpenRental,
  type RentableScooter,
  type RentalRequest,
  type RentalTariff,
} from './rentals.js';

const tariff: RentalTariff = {
  id: 't1',
  version: 1,
  unlockFee: 300,
  minuteRate: 80,
  pauseMinuteRate: 30,
  freeReservationMinutes: 10,
  minBatteryPct: 15,
};
const now = new Date('2026-11-16T12:00:00Z');
const scooter: RentableScooter = { id: 's1', number: 27, status: 'AVAILABLE', online: true, batteryPct: 87 };
const rental = (overrides: Partial<OpenRental> = {}): OpenRental => ({
  id: 'r1',
  userId: 'u1',
  scooterId: 's1',
  state: 'ACTIVE',
  reservationExpiresAt: null,
  pendingCommand: null,
  ...overrides,
});
const request = (overrides: Partial<RentalRequest> = {}): RentalRequest => ({
  userId: 'u1',
  scooter,
  tariff,
  userRental: null,
  scooterRental: null,
  now,
  ...overrides,
});
const code = (fn: () => unknown) => {
  try {
    fn();
  } catch (error) {
    return (error as { code: string; details?: unknown }).code;
  }
  return null;
};

describe('dostępność hulajnogi', () => {
  it('podaje przyczynę niedostępności w kolejności: serwis, zajęta, offline, bateria', () => {
    expect(unavailableReason(scooter, tariff)).toBeNull();
    expect(unavailableReason({ ...scooter, status: 'MAINTENANCE', online: false }, tariff)).toBe('MAINTENANCE');
    expect(unavailableReason({ ...scooter, status: 'IN_USE', online: false }, tariff)).toBe('IN_USE');
    expect(unavailableReason({ ...scooter, online: false, batteryPct: 3 }, tariff)).toBe('OFFLINE');
    expect(unavailableReason({ ...scooter, batteryPct: 14 }, tariff)).toBe('LOW_BATTERY');
    expect(unavailableReason({ ...scooter, batteryPct: 15 }, tariff)).toBeNull();
    expect(unavailableReason({ ...scooter, batteryPct: null }, tariff)).toBe('LOW_BATTERY');
  });
});

describe('rezerwacja', () => {
  it('rezerwuje wolną hulajnogę na czas z wersji cennika', () => {
    expect(decideReservation(request())).toEqual({
      kind: 'TRANSITION',
      action: 'RESERVE',
      from: null,
      to: 'RESERVED',
      rentalId: null,
    });
    expect(reservationExpiresAt(now, tariff)).toEqual(new Date('2026-11-16T12:10:00Z'));
  });

  it('powtórzona rezerwacja tej samej hulajnogi zwraca istniejącą', () => {
    const own = rental({ state: 'RESERVED' });
    expect(decideReservation(request({ userRental: own, scooterRental: own }))).toEqual({
      kind: 'EXISTING',
      rentalId: 'r1',
    });
  });

  it('odmawia, gdy klient ma inny otwarty przejazd albo hulajnoga jest zajęta lub ma słabą baterię', () => {
    expect(code(() => decideReservation(request({ userRental: rental({ scooterId: 's2' }) })))).toBe(
      'RENTAL_ALREADY_OPEN',
    );
    expect(code(() => decideReservation(request({ userRental: rental(), scooterRental: rental() })))).toBe(
      'RENTAL_ALREADY_OPEN',
    );
    expect(() => decideReservation(request({ scooterRental: rental({ userId: 'u2', state: 'RESERVED' }) }))).toThrow(
      expect.objectContaining({ code: 'SCOOTER_UNAVAILABLE', details: { reason: 'RESERVED', scooterNumber: 27 } }),
    );
    expect(() => decideReservation(request({ scooter: { ...scooter, batteryPct: 10 } }))).toThrow(
      expect.objectContaining({ details: { reason: 'LOW_BATTERY', scooterNumber: 27 } }),
    );
  });

  it('anulować może tylko właściciel i tylko rezerwację', () => {
    expect(decideCancelReservation(rental({ state: 'RESERVED' }), 'u1')).toBe('EXPIRED');
    expect(code(() => decideCancelReservation(rental({ state: 'RESERVED' }), 'u2'))).toBe('NOT_FOUND');
    expect(code(() => decideCancelReservation(rental(), 'u1'))).toBe('INVALID_RENTAL_TRANSITION');
    expect(code(() => decideCancelReservation(null, 'u1'))).toBe('NOT_FOUND');
  });
});

describe('start przejazdu', () => {
  it('zaczyna od razu po skanie albo z własnej rezerwacji', () => {
    expect(decideStart(request())).toMatchObject({ kind: 'TRANSITION', from: null, to: 'UNLOCKING' });
    const own = rental({ state: 'RESERVED', reservationExpiresAt: new Date('2026-11-16T12:05:00Z') });
    const reserved = { ...scooter, status: 'RESERVED' as const };
    expect(decideStart(request({ scooter: reserved, userRental: own, scooterRental: own }))).toEqual({
      kind: 'TRANSITION',
      action: 'START',
      from: 'RESERVED',
      to: 'UNLOCKING',
      rentalId: 'r1',
    });
  });

  it('ponowione żądanie zwraca otwarty przejazd zamiast drugiego', () => {
    const open = rental({ state: 'UNLOCKING' });
    expect(decideStart(request({ userRental: open, scooterRental: open }))).toEqual({
      kind: 'EXISTING',
      rentalId: 'r1',
    });
  });

  it('odmawia po wygaśnięciu rezerwacji, przy cudzej rezerwacji i przy hulajnodze offline', () => {
    const expired = rental({ state: 'RESERVED', reservationExpiresAt: now });
    expect(code(() => decideStart(request({ userRental: expired, scooterRental: expired })))).toBe(
      'RESERVATION_EXPIRED',
    );
    const foreign = rental({ userId: 'u2', state: 'RESERVED' });
    expect(
      code(() => decideStart(request({ scooter: { ...scooter, status: 'RESERVED' }, scooterRental: foreign }))),
    ).toBe('SCOOTER_UNAVAILABLE');
    const own = rental({ state: 'RESERVED', reservationExpiresAt: new Date('2026-11-16T12:05:00Z') });
    expect(() =>
      decideStart(
        request({ scooter: { ...scooter, status: 'RESERVED', online: false }, userRental: own, scooterRental: own }),
      ),
    ).toThrow(expect.objectContaining({ details: { reason: 'OFFLINE', scooterNumber: 27 } }));
  });
});

describe('pauza, wznowienie i zakończenie', () => {
  it('pauza i wznowienie wysyłają komendę, a stan zmienia dopiero potwierdzenie', () => {
    expect(decidePause(rental(), 'u1')).toEqual({ command: 'LOCK' });
    expect(decideResume(rental({ state: 'PAUSED' }), 'u1')).toEqual({ command: 'UNLOCK' });
    expect(code(() => decidePause(rental({ state: 'PAUSED' }), 'u1'))).toBe('INVALID_RENTAL_TRANSITION');
    expect(code(() => decidePause(rental({ pendingCommand: 'LOCK' }), 'u1'))).toBe('RENTAL_COMMAND_PENDING');
    expect(code(() => decideResume(rental({ state: 'PAUSED', pendingCommand: 'UNLOCK' }), 'u1'))).toBe(
      'RENTAL_COMMAND_PENDING',
    );
  });

  it('zakończenie tylko w strefie parkowania, z najbliższą strefą w błędzie', () => {
    const nearestParking = { code: 'P-01', name: 'Rynek', distanceM: 320, lat: 50.1, lon: 18.5 };
    expect(decideEnd(rental(), 'u1', { canPark: true, nearestParking: null })).toEqual({
      command: 'LOCK',
      to: 'ENDING',
      resumeState: 'ACTIVE',
    });
    expect(decideEnd(rental({ state: 'PAUSED' }), 'u1', { canPark: true, nearestParking: null }).resumeState).toBe(
      'PAUSED',
    );
    expect(() => decideEnd(rental(), 'u1', { canPark: false, nearestParking })).toThrow(
      expect.objectContaining({ code: 'OUTSIDE_PARKING', details: { nearestParking } }),
    );
    expect(code(() => decideEnd(rental({ state: 'UNLOCKING' }), 'u1', { canPark: true, nearestParking: null }))).toBe(
      'INVALID_RENTAL_TRANSITION',
    );
  });

  it('operator kończy przejazd z powodem; przy blokadzie w toku nie wysyła drugiej', () => {
    expect(decideRemoteEnd(rental(), 'CUSTOMER_REQUEST', null)).toEqual({ to: 'ENDED', command: 'LOCK' });
    expect(
      decideRemoteEnd(rental({ state: 'ENDING', pendingCommand: 'LOCK' }), 'SCOOTER_NOT_RESPONDING', null),
    ).toEqual({
      to: 'ENDED',
      command: null,
    });
    expect(code(() => decideRemoteEnd(rental(), 'OTHER', ' '))).toBe('VALIDATION_FAILED');
    expect(code(() => decideRemoteEnd(rental({ state: 'PAUSED', pendingCommand: 'UNLOCK' }), 'OTHER', 'x'))).toBe(
      'RENTAL_COMMAND_PENDING',
    );
    expect(code(() => decideRemoteEnd(rental({ state: 'RESERVED' }), 'OTHER', 'x'))).toBe('INVALID_RENTAL_TRANSITION');
  });
});

describe('wynik komendy przejazdu', () => {
  it('potwierdzenie i brak potwierdzenia prowadzą do przejść z ADR 0036', () => {
    const outcome = (
      state: OpenRental['state'],
      command: 'LOCK' | 'UNLOCK',
      result: 'CONFIRMED' | 'FAILED',
      resumeState?: 'ACTIVE' | 'PAUSED',
    ) => rentalCommandOutcome({ state, command, result, late: false, resumeState });
    expect(outcome('UNLOCKING', 'UNLOCK', 'CONFIRMED').action).toBe('CONFIRM_UNLOCK');
    expect(outcome('UNLOCKING', 'UNLOCK', 'FAILED').action).toBe('UNLOCK_TIMEOUT');
    expect(outcome('ACTIVE', 'LOCK', 'CONFIRMED').action).toBe('PAUSE');
    expect(outcome('ACTIVE', 'LOCK', 'FAILED')).toEqual({ action: null, event: 'PAUSE_FAILED', compensateLock: false });
    expect(outcome('PAUSED', 'UNLOCK', 'FAILED').event).toBe('RESUME_FAILED');
    expect(outcome('ENDING', 'LOCK', 'CONFIRMED').action).toBe('COMPLETE_END');
    expect(outcome('ENDING', 'LOCK', 'FAILED', 'ACTIVE')).toEqual({
      action: 'ABORT_END',
      event: 'LOCK_FAILED',
      compensateLock: false,
    });
    expect(outcome('ENDING', 'LOCK', 'FAILED', 'PAUSED').action).toBe('ABORT_END_PAUSED');
    expect(outcome('ENDED', 'LOCK', 'CONFIRMED')).toEqual({ action: null, event: null, compensateLock: false });
    for (const action of ['CONFIRM_UNLOCK', 'PAUSE', 'RESUME', 'COMPLETE_END', 'ABORT_END'] as const) {
      expect(
        RentalStateMachine.next(
          action === 'CONFIRM_UNLOCK'
            ? 'UNLOCKING'
            : action === 'RESUME'
              ? 'PAUSED'
              : action === 'PAUSE'
                ? 'ACTIVE'
                : 'ENDING',
          action,
        ),
      ).toBeDefined();
    }
  });

  it('spóźnione odblokowanie po nieudanym starcie albo po zakończeniu jest kompensowane blokadą', () => {
    expect(
      rentalCommandOutcome({ state: 'UNLOCK_FAILED', command: 'UNLOCK', result: 'CONFIRMED', late: true }),
    ).toEqual({
      action: null,
      event: 'LATE_UNLOCK_LOCKED',
      compensateLock: true,
    });
    expect(
      rentalCommandOutcome({ state: 'PAUSED', command: 'UNLOCK', result: 'CONFIRMED', late: true }).compensateLock,
    ).toBe(true);
    expect(
      rentalCommandOutcome({ state: 'ENDED', command: 'LOCK', result: 'CONFIRMED', late: true }).compensateLock,
    ).toBe(false);
    expect(
      rentalCommandOutcome({ state: 'UNLOCK_FAILED', command: 'UNLOCK', result: 'FAILED', late: true }).compensateLock,
    ).toBe(false);
  });

  it('hulajnoga już w żądanym stanie to sukces, inne odmowy to porażka', () => {
    expect(commandResultFromAck('LOCK', false, 'ALREADY_IN_STATE')).toBe('CONFIRMED');
    expect(commandResultFromAck('UNLOCK', false, 'ALREADY_IN_STATE')).toBe('CONFIRMED');
    // Komendy stref (ADR 0044): zgubione potwierdzenie i ponowienie nie mogą zapętlić uzgadniania.
    expect(commandResultFromAck('RELEASE_STOP', false, 'ALREADY_IN_STATE')).toBe('CONFIRMED');
    expect(commandResultFromAck('SPEED_LIMIT', false, 'ALREADY_IN_STATE')).toBe('FAILED');
    expect(commandResultFromAck('UNLOCK', false, 'LOW_BATTERY')).toBe('FAILED');
    expect(commandResultFromAck('UNLOCK', false, 'EXPIRED')).toBe('FAILED');
    expect(commandResultFromAck('UNLOCK', true)).toBe('CONFIRMED');
  });
});

describe('dzwonek i usunięcie konta', () => {
  it('dzwonek przy własnej rezerwacji albo przy wolnej hulajnodze', () => {
    expect(() => ensureCanRing(scooter, null)).not.toThrow();
    expect(() => ensureCanRing({ ...scooter, status: 'RESERVED' }, rental({ state: 'RESERVED' }))).not.toThrow();
    expect(code(() => ensureCanRing({ ...scooter, status: 'IN_USE' }, null))).toBe('RING_NOT_ALLOWED');
    expect(code(() => ensureCanRing(scooter, rental({ scooterId: 's2' })))).toBe('RING_NOT_ALLOWED');
    expect(code(() => ensureCanRing({ ...scooter, online: false }, null))).toBe('SCOOTER_UNAVAILABLE');
  });

  it('usunięcie konta wymaga braku otwartego przejazdu i salda 0', () => {
    expect(() => ensureCanDeleteAccount({ hasOpenRental: false, balance: 0 })).not.toThrow();
    expect(code(() => ensureCanDeleteAccount({ hasOpenRental: false, balance: 0, unpaidRentals: 1 }))).toBe(
      'PAYMENT_OVERDUE',
    );
    expect(code(() => ensureCanDeleteAccount({ hasOpenRental: false, balance: 0, pendingPayments: 1 }))).toBe(
      'PAYMENT_IN_PROGRESS',
    );
    expect(code(() => ensureCanDeleteAccount({ hasOpenRental: true, balance: 0 }))).toBe('USER_HAS_OPEN_RENTAL');
    expect(code(() => ensureCanDeleteAccount({ hasOpenRental: false, balance: -100 }))).toBe('WALLET_BALANCE_NOT_ZERO');
  });
});

describe('liczniki i wycena', () => {
  const at = (s: number) => new Date(now.getTime() + s * 1000);
  const changed = (toState: TimelineEvent['toState'], s: number): TimelineEvent => ({
    type: 'STATE_CHANGED',
    toState,
    at: at(s),
  });
  const event = (type: TimelineEvent['type'], s: number): TimelineEvent => ({ type, toState: null, at: at(s) });

  it('liczy jazdę od potwierdzonego odblokowania i pauzę między potwierdzeniami', () => {
    const timeline = [
      changed('RESERVED', -300),
      changed('UNLOCKING', 0),
      changed('ACTIVE', 2),
      changed('PAUSED', 302),
      changed('ACTIVE', 482),
      event('END_REQUESTED', 782),
      changed('ENDING', 782),
      changed('ENDED', 784),
    ];
    const counters = rentalCounters(timeline, at(10_000));
    expect(counters).toEqual({ rideSeconds: 600, pauseSeconds: 180, startedAt: at(2), billedUntil: at(782) });
    expect(priceRental(tariff, counters)).toEqual({
      unlockFee: 300,
      rideMinutes: 10,
      rideAmount: 800,
      pauseMinutes: 3,
      pauseAmount: 90,
      total: 1190,
    });
  });

  it('nieudana blokada unieważnia żądanie zakończenia, więc naliczanie biegnie dalej', () => {
    const timeline = [
      changed('ACTIVE', 0),
      event('END_REQUESTED', 60),
      changed('ENDING', 60),
      event('LOCK_FAILED', 71),
      changed('ACTIVE', 71),
    ];
    expect(rentalCounters(timeline, at(130))).toMatchObject({ rideSeconds: 130, billedUntil: null });
    // W trakcie oczekiwania na blokadę naliczanie jest wstrzymane na chwili żądania.
    expect(rentalCounters(timeline.slice(0, 3), at(65))).toMatchObject({ rideSeconds: 60, billedUntil: at(60) });
  });

  it('zdalne zakończenie kończy naliczanie, chyba że klient wcześniej poprosił o zakończenie', () => {
    const remote = [changed('ACTIVE', 0), changed('PAUSED', 100), event('ENDED_REMOTELY', 160), changed('ENDED', 160)];
    expect(rentalCounters(remote, at(999))).toEqual({
      rideSeconds: 100,
      pauseSeconds: 60,
      startedAt: at(0),
      billedUntil: at(160),
    });
    const afterRequest = [
      changed('ACTIVE', 0),
      event('END_REQUESTED', 50),
      changed('ENDING', 50),
      event('ENDED_REMOTELY', 200),
      changed('ENDED', 200),
    ];
    expect(rentalCounters(afterRequest, at(999))).toMatchObject({ rideSeconds: 50, billedUntil: at(50) });
  });

  it('każda rozpoczęta minuta jest płatna, przejazd ma co najmniej minutę jazdy, a nieodblokowany nic nie kosztuje', () => {
    expect(priceRental(tariff, { rideSeconds: 0, pauseSeconds: 0, startedAt: now }).total).toBe(380);
    expect(priceRental(tariff, { rideSeconds: 61, pauseSeconds: 1, startedAt: now })).toMatchObject({
      rideMinutes: 2,
      pauseMinutes: 1,
      total: 490,
    });
    expect(priceRental(tariff, { rideSeconds: 0, pauseSeconds: 0, startedAt: null }).total).toBe(0);
    expect(rentalCounters([changed('UNLOCKING', 0), changed('UNLOCK_FAILED', 10)], at(20))).toMatchObject({
      rideSeconds: 0,
      startedAt: null,
    });
  });
});
