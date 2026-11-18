import { describe, expect, it } from 'vitest';
import { rideReceiptItems } from '../payments/receipts.js';
import { desiredZoneControl } from '../zones/tracking.js';
import type { Zone } from '../zones/zones.js';
import { batteryAlert, newBatteryThresholds } from './battery.js';
import { distanceAfterEnd, IDLE_LOCK_RETRY_MS, isMovedAfterEnd, shouldLockIdleScooter } from './offline.js';
import { OFFLINE_BILLING_CAP_MS, priceRental, rentalCounters, rentalFigures, type TimelineEvent } from './pricing.js';
import { RentalStateMachine } from './rental-state-machine.js';
import {
  canEndOffline,
  decideOfflineEnd,
  OFFLINE_END_TIMEOUT_MS,
  rentalCommandOutcome,
  type OpenRental,
} from './rentals.js';
import { decideTowing, qualifiesForTowing } from './towing.js';

const now = new Date('2026-11-18T12:00:00Z');
const at = (s: number) => new Date(now.getTime() + s * 1000);
const code = (fn: () => unknown) => {
  try {
    fn();
  } catch (error) {
    return (error as { code: string }).code;
  }
  return null;
};
const rental = (overrides: Partial<OpenRental> = {}): OpenRental => ({
  id: 'r1',
  userId: 'u1',
  scooterId: 's1',
  state: 'ACTIVE',
  reservationExpiresAt: null,
  pendingCommand: null,
  ...overrides,
});
const changed = (toState: TimelineEvent['toState'], s: number): TimelineEvent => ({
  type: 'STATE_CHANGED',
  toState,
  at: at(s),
});
const event = (type: TimelineEvent['type'], s: number, mode?: 'OFFLINE'): TimelineEvent => ({
  type,
  toState: null,
  at: at(s),
  mode,
});

describe('zakończenie bez łączności (ADR 0056)', () => {
  const inParking = { now, positionAt: at(-60), inParking: true, inNoRide: false };

  it('wymaga pozycji najwyżej sprzed 120 s w strefie parkowania poza strefą zakazu', () => {
    expect(() => canEndOffline(inParking)).not.toThrow();
    expect(() => canEndOffline({ ...inParking, positionAt: at(-120) })).not.toThrow();
    expect(code(() => canEndOffline({ ...inParking, positionAt: at(-121) }))).toBe('POSITION_STALE');
    expect(code(() => canEndOffline({ ...inParking, positionAt: null }))).toBe('POSITION_STALE');
    expect(code(() => canEndOffline({ ...inParking, inParking: false }))).toBe('OUTSIDE_PARKING');
    expect(code(() => canEndOffline({ ...inParking, inNoRide: true }))).toBe('OUTSIDE_PARKING');
  });

  it('żądanie offline: blokada ważna 10 min i tryb CUSTOMER_OFFLINE', () => {
    expect(decideOfflineEnd(rental({ state: 'PAUSED' }), 'u1', inParking)).toEqual({
      command: 'LOCK',
      to: 'ENDING',
      resumeState: 'PAUSED',
      endMode: 'CUSTOMER_OFFLINE',
      commandTtlMs: OFFLINE_END_TIMEOUT_MS,
    });
    expect(code(() => decideOfflineEnd(rental(), 'u2', inParking))).toBe('NOT_FOUND');
    expect(code(() => decideOfflineEnd(rental({ pendingCommand: 'LOCK' }), 'u1', inParking))).toBe(
      'RENTAL_COMMAND_PENDING',
    );
  });

  it('brak blokady po żądaniu offline kończy przejazd END_UNCONFIRMED zamiast go wznawiać', () => {
    expect(RentalStateMachine.transition('ENDING', 'END_UNCONFIRMED')).toBe('ENDED');
    expect(RentalStateMachine.next('ACTIVE', 'END_UNCONFIRMED')).toBeUndefined();
    const failed = { state: 'ENDING', command: 'LOCK', result: 'FAILED', late: false, resumeState: 'ACTIVE' } as const;
    expect(rentalCommandOutcome({ ...failed, endMode: 'CUSTOMER_OFFLINE' })).toEqual({
      action: 'END_UNCONFIRMED',
      event: 'LOCK_FAILED',
      compensateLock: false,
    });
    expect(rentalCommandOutcome({ ...failed, endMode: 'CUSTOMER' }).action).toBe('ABORT_END');
    expect(rentalCommandOutcome({ ...failed, result: 'CONFIRMED', endMode: 'CUSTOMER_OFFLINE' }).action).toBe(
      'COMPLETE_END',
    );
  });
});

describe('naliczanie bez łączności (ADR 0056 zmienia ADR 0042)', () => {
  const capS = OFFLINE_BILLING_CAP_MS / 1000;

  it('odcinek bez łączności liczy się najwyżej 30 min, a po powrocie naliczanie biegnie dalej', () => {
    const timeline = [changed('ACTIVE', 0), event('CONNECTION_LOST', 600), event('CONNECTION_RESTORED', 600 + 3600)];
    expect(rentalCounters(timeline, at(600 + 3600 + 120))).toMatchObject({
      rideSeconds: 600 + capS + 120,
      billingStoppedAt: null,
    });
    // Krótka przerwa nie zmienia niczego.
    const short = [changed('ACTIVE', 0), event('CONNECTION_LOST', 60), event('CONNECTION_RESTORED', 120)];
    expect(rentalCounters(short, at(300))).toMatchObject({ rideSeconds: 300, billingStoppedAt: null });
  });

  it('bez powrotu łączności naliczanie stoi od chwili limitu (BILLING_STOPPED), także w pauzie', () => {
    const timeline = [changed('ACTIVE', 0), changed('PAUSED', 300), event('CONNECTION_LOST', 400)];
    expect(rentalCounters(timeline, at(400 + 7200))).toEqual({
      rideSeconds: 300,
      pauseSeconds: 100 + capS,
      startedAt: at(0),
      billedUntil: null,
      billingStoppedAt: at(400 + capS),
    });
    // Operator kończy zdalnie po limicie: kwota bez zmian.
    const remote = [
      ...timeline,
      event('BILLING_STOPPED', 400 + capS),
      event('ENDED_REMOTELY', 9000),
      changed('ENDED', 9000),
    ];
    expect(rentalCounters(remote, at(9999))).toMatchObject({ pauseSeconds: 100 + capS, billedUntil: at(9000) });
  });

  it('zakończony przejazd pokazuje liczniki i kwotę z chwili zakończenia, nie z bieżących reguł', () => {
    const tariff = { unlockFee: 300, minuteRate: 80, pauseMinuteRate: 20 };
    // Przejazd sprzed limitu 30 min: rozliczony za całą godzinę bez łączności.
    const timeline = [
      changed('ACTIVE', 0),
      event('CONNECTION_LOST', 600),
      event('CONNECTION_RESTORED', 4200),
      event('END_REQUESTED', 4800),
      changed('ENDED', 4805),
    ];
    const stored = { endMode: 'CUSTOMER', rideSeconds: 4800, pauseSeconds: 0, towingFee: null } as const;
    const ended = rentalFigures(tariff, timeline, at(9000), {
      ...stored,
      state: 'ENDED',
      totalAmount: 300 + 80 * 80,
    });
    expect(ended.counters).toMatchObject({ rideSeconds: 4800, pauseSeconds: 0, billedUntil: at(4800) });
    expect(ended.price).toMatchObject({ rideMinutes: 80, total: 300 + 80 * 80 });
    // Otwarty przejazd liczy się z osi czasu z bieżącymi regułami.
    const open = rentalFigures(tariff, timeline.slice(0, 3), at(4800), {
      ...stored,
      state: 'ACTIVE',
      totalAmount: null,
    });
    expect(open.counters.rideSeconds).toBe(4800 - 3600 + capS);
    expect(open.price.total).toBe(priceRental(tariff, open.counters).total);
  });

  it('LOCK_FAILED po żądaniu offline nie przywraca naliczania (oś czasu z data.mode albo end_mode)', () => {
    const offline = [
      changed('ACTIVE', 0),
      event('CONNECTION_LOST', 100),
      event('END_REQUESTED', 160, 'OFFLINE'),
      changed('ENDING', 160),
      event('LOCK_FAILED', 760),
      changed('ENDED', 760),
    ];
    expect(rentalCounters(offline, at(900))).toMatchObject({ rideSeconds: 160, billedUntil: at(160) });
    const withoutMode = offline.map((e) => ({ ...e, mode: undefined }));
    expect(rentalCounters(withoutMode, at(900), { endMode: 'UNCONFIRMED' })).toMatchObject({
      rideSeconds: 160,
      billedUntil: at(160),
    });
    // W ENDING (czekanie na blokadę do 10 min) naliczanie stoi na chwili żądania.
    expect(rentalCounters(offline.slice(0, 4), at(500), { endMode: 'CUSTOMER_OFFLINE' })).toMatchObject({
      rideSeconds: 160,
      billedUntil: at(160),
    });
  });

  it('end_mode dotyczy tylko ostatniego żądania: wcześniejsze nieudane zakończenie online zostaje unieważnione', () => {
    const timeline = [
      changed('ACTIVE', 0),
      event('END_REQUESTED', 60),
      changed('ENDING', 60),
      event('LOCK_FAILED', 70),
      changed('ACTIVE', 70),
      event('END_REQUESTED', 200),
      changed('ENDING', 200),
      event('LOCK_FAILED', 800),
      changed('ENDED', 800),
    ];
    expect(rentalCounters(timeline, at(900), { endMode: 'UNCONFIRMED' })).toMatchObject({
      rideSeconds: 200,
      billedUntil: at(200),
    });
  });
});

describe('ruch po żądaniu zakończenia i hulajnoga odblokowana bez przejazdu', () => {
  const origin = { lat: 50.0921, lon: 18.5418 };
  // ok. 111 m na 0,001° szerokości
  const north = (k: number) => ({ lat: origin.lat + 0.001 * k, lon: origin.lon });

  it('liczy drogę z punktów po żądaniu (także z bufora) i pomija szum GPS', () => {
    const readings = [
      { recordedAt: at(-10), position: north(-5) },
      { recordedAt: at(10), position: { lat: origin.lat + 0.00001, lon: origin.lon } },
      { recordedAt: at(20), position: north(1) },
      { recordedAt: at(30), position: north(2) },
    ];
    const distance = distanceAfterEnd({ endRequestedAt: at(0), origin, readings });
    expect(distance).toBeGreaterThan(220);
    expect(distance).toBeLessThan(225);
    expect(isMovedAfterEnd(distance)).toBe(true);
    expect(isMovedAfterEnd(200)).toBe(false);
    expect(distanceAfterEnd({ endRequestedAt: at(0), origin, readings: readings.slice(0, 2) })).toBe(0);
  });

  it('blokuje odblokowaną hulajnogę bez przejazdu także w serwisie, poza świadomym odblokowaniem przez operatora', () => {
    const ended = new Date('2026-11-18T10:00:00Z');
    const now = new Date('2026-11-18T10:30:00Z');
    const idle = {
      hasOpenRental: false,
      locked: false,
      lockPending: false,
      lastEndedAt: ended,
      lastManualCommand: null,
      lastLockFailedAt: null,
      now,
    };
    expect(shouldLockIdleScooter(idle)).toBe(true);
    expect(shouldLockIdleScooter({ ...idle, hasOpenRental: true })).toBe(false);
    expect(shouldLockIdleScooter({ ...idle, lockPending: true })).toBe(false);
    expect(shouldLockIdleScooter({ ...idle, locked: true })).toBe(false);
    // Odblokowanie z panelu po końcu przejazdu: serwisant pracuje przy hulajnodze.
    const unlockAfter = { type: 'UNLOCK', at: new Date(ended.getTime() + 60_000) } as const;
    expect(shouldLockIdleScooter({ ...idle, lastManualCommand: unlockAfter })).toBe(false);
    expect(shouldLockIdleScooter({ ...idle, lastEndedAt: null, lastManualCommand: unlockAfter })).toBe(false);
    // Odblokowanie sprzed końca przejazdu albo blokada po nim nie są wyjątkiem.
    const unlockBefore = { type: 'UNLOCK', at: new Date(ended.getTime() - 60_000) } as const;
    expect(shouldLockIdleScooter({ ...idle, lastManualCommand: unlockBefore })).toBe(true);
    expect(shouldLockIdleScooter({ ...idle, lastManualCommand: { ...unlockAfter, type: 'LOCK' } })).toBe(true);
    // Odrzucona blokada: kolejna próba dopiero po 5 min.
    const failed = (ms: number) => ({ ...idle, lastLockFailedAt: new Date(now.getTime() - ms) });
    expect(shouldLockIdleScooter(failed(IDLE_LOCK_RETRY_MS - 1000))).toBe(false);
    expect(shouldLockIdleScooter(failed(IDLE_LOCK_RETRY_MS))).toBe(true);
  });
});

describe('niska bateria w trakcie jazdy', () => {
  it('każdy próg raz na przejazd, z odczytu bieżącego', () => {
    const base = { minBatteryPct: 15, reached: [] };
    expect(newBatteryThresholds({ ...base, batteryPct: 16 })).toEqual([]);
    // Wypożyczenie wymaga baterii co najmniej na progu, więc start na 15% nie daje od razu komunikatu.
    expect(newBatteryThresholds({ ...base, batteryPct: 15 })).toEqual([]);
    expect(newBatteryThresholds({ ...base, batteryPct: 14 })).toEqual(['LOW']);
    expect(newBatteryThresholds({ ...base, batteryPct: 6, reached: ['LOW'] })).toEqual([]);
    expect(newBatteryThresholds({ ...base, batteryPct: 3 })).toEqual(['LOW', 'CRITICAL']);
    expect(newBatteryThresholds({ ...base, batteryPct: 14, reached: ['LOW'] })).toEqual([]);
    expect(newBatteryThresholds({ ...base, batteryPct: 5, reached: ['LOW'] })).toEqual(['CRITICAL']);
    expect(newBatteryThresholds({ ...base, batteryPct: 4, buffered: true })).toEqual([]);
    expect(newBatteryThresholds({ ...base, batteryPct: null })).toEqual([]);
    expect(batteryAlert(['LOW', 'CRITICAL'])).toBe('CRITICAL');
    expect(batteryAlert([])).toBeNull();
  });

  it('krytyczna bateria ogranicza prędkość do mniejszego z limitu stref i 10 km/h', () => {
    const area: Zone = { id: 'a', code: 'AREA', name: 'Obszar', type: 'SERVICE_AREA', speedLimitKmh: null };
    const slow = (kmh: number): Zone => ({ id: `s${kmh}`, code: 'S', name: 'Wolna', type: 'SLOW', speedLimitKmh: kmh });
    expect(desiredZoneControl([area])).toEqual({ stopped: false, speedLimitKmh: null });
    expect(desiredZoneControl([area], { batteryCritical: true })).toEqual({ stopped: false, speedLimitKmh: 10 });
    expect(desiredZoneControl([area, slow(15)], { batteryCritical: true }).speedLimitKmh).toBe(10);
    expect(desiredZoneControl([area, slow(6)], { batteryCritical: true }).speedLimitKmh).toBe(6);
  });
});

describe('opłata za odholowanie (ADR 0060)', () => {
  const tariff = { unlockFee: 300, minuteRate: 80, pauseMinuteRate: 30 };
  const counters = { rideSeconds: 600, pauseSeconds: 0, startedAt: now };

  it('osobna pozycja wyceny wliczona do sumy i do paragonu', () => {
    const price = priceRental(tariff, counters, { towingFee: 2000 });
    expect(price).toMatchObject({ rideAmount: 800, towingFee: 2000, total: 3100 });
    expect(priceRental(tariff, counters, { towingFee: null })).toMatchObject({ towingFee: 0, total: 1100 });
    expect(rideReceiptItems(price, tariff, 23).at(-1)).toEqual({
      description: 'TOWING_FEE',
      quantity: 1,
      unitPrice: 2000,
      vatRate: null,
      amount: 2000,
    });
    expect(rideReceiptItems(priceRental(tariff, counters), tariff, 23).map((i) => i.description)).toEqual([
      'UNLOCK',
      'RIDE_MINUTES',
    ]);
  });

  it('tylko gdy ostatnia pozycja jest poza strefą parkowania; przewiezienie zawsze poza strefą', () => {
    expect(qualifiesForTowing({ canPark: false })).toBe(true);
    expect(qualifiesForTowing(null)).toBe(true);
    expect(qualifiesForTowing({ canPark: true })).toBe(false);
    expect(decideTowing({ outsideParking: true, collect: true, outOfZoneFee: 2000 })).toEqual({
      towingFee: 2000,
      relocation: true,
    });
    expect(decideTowing({ outsideParking: true, collect: false, outOfZoneFee: 2000 })).toEqual({
      towingFee: null,
      relocation: true,
    });
    expect(decideTowing({ outsideParking: false, collect: false, outOfZoneFee: 2000 })).toEqual({
      towingFee: null,
      relocation: false,
    });
    expect(code(() => decideTowing({ outsideParking: false, collect: true, outOfZoneFee: 2000 }))).toBe(
      'TOWING_FEE_NOT_APPLICABLE',
    );
  });
});
