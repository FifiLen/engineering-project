import { describe, expect, it } from 'vitest';
import { DomainError } from '../errors.js';
import { commandStatusAfterAck, ensurePanelCommandAllowed, isCommandTimedOut } from './commands.js';
import { deriveFleetStatus, estimateRangeKm } from './fleet-status.js';
import { ensureModelAssignable, ensureOperatorStatusChange, planModelRemoval, planScooterRemoval } from './scooters.js';

const code = (fn: () => void) => {
  try {
    fn();
  } catch (error) {
    return (error as DomainError).code;
  }
  return null;
};

describe('status floty', () => {
  const ok = { status: 'AVAILABLE', online: true, batteryPct: 80 } as const;

  it('dostępna hulajnoga z baterią powyżej progu jest dostępna', () => {
    expect(deriveFleetStatus(ok, 15)).toBe('AVAILABLE');
  });

  it('bateria poniżej progu wypożyczenia to niska bateria; równa progowi jeszcze nie', () => {
    expect(deriveFleetStatus({ ...ok, batteryPct: 14 }, 15)).toBe('LOW_BATTERY');
    expect(deriveFleetStatus({ ...ok, batteryPct: 15 }, 15)).toBe('AVAILABLE');
    expect(deriveFleetStatus({ ...ok, batteryPct: null }, 15)).toBe('LOW_BATTERY');
  });

  it('brak łączności wygrywa z przejazdem i baterią, serwis i wycofanie z brakiem łączności', () => {
    expect(deriveFleetStatus({ ...ok, status: 'IN_USE', online: false }, 15)).toBe('OFFLINE');
    expect(deriveFleetStatus({ ...ok, batteryPct: 5, online: false }, 15)).toBe('OFFLINE');
    expect(deriveFleetStatus({ ...ok, status: 'MAINTENANCE', online: false }, 15)).toBe('MAINTENANCE');
    expect(deriveFleetStatus({ ...ok, status: 'RETIRED', online: false }, 15)).toBe('RETIRED');
  });

  it('w trakcie przejazdu niska bateria nie zmienia statusu', () => {
    expect(deriveFleetStatus({ ...ok, status: 'IN_USE', batteryPct: 5 }, 15)).toBe('IN_USE');
    expect(deriveFleetStatus({ ...ok, status: 'RESERVED', batteryPct: 5 }, 15)).toBe('RESERVED');
  });

  it('szacuje zasięg z baterii i zasięgu modelu', () => {
    expect(estimateRangeKm(6, 7)).toBe(0.4);
    expect(estimateRangeKm(50, null)).toBeNull();
    expect(estimateRangeKm(null, 40)).toBeNull();
  });
});

describe('zmiany hulajnóg w panelu', () => {
  it('operator przenosi hulajnogę do serwisu i z powrotem', () => {
    expect(code(() => ensureOperatorStatusChange('AVAILABLE', 'MAINTENANCE', false))).toBeNull();
    expect(code(() => ensureOperatorStatusChange('MAINTENANCE', 'AVAILABLE', false))).toBeNull();
  });

  it('rezerwację i jazdę ustawia tylko proces wypożyczenia', () => {
    expect(code(() => ensureOperatorStatusChange('AVAILABLE', 'IN_USE', false))).toBe('STATUS_MANAGED_BY_RENTAL');
  });

  it('nie zmienia statusu hulajnogi z otwartym przejazdem', () => {
    expect(code(() => ensureOperatorStatusChange('IN_USE', 'MAINTENANCE', true))).toBe('SCOOTER_HAS_OPEN_RENTAL');
  });

  it('wycofaną hulajnogę przywraca tylko do serwisu', () => {
    expect(code(() => ensureOperatorStatusChange('RETIRED', 'AVAILABLE', false))).toBe('SCOOTER_RETIRED');
    expect(code(() => ensureOperatorStatusChange('RETIRED', 'MAINTENANCE', false))).toBeNull();
  });

  it('usunięcie hulajnogi to wycofanie, niedozwolone w trakcie przejazdu', () => {
    expect(planScooterRemoval('AVAILABLE', false)).toBe('RETIRE');
    expect(code(() => planScooterRemoval('IN_USE', true))).toBe('SCOOTER_HAS_OPEN_RENTAL');
  });

  it('model bez hulajnóg usuwa, z hulajnogami archiwizuje', () => {
    expect(planModelRemoval(0)).toBe('DELETE');
    expect(planModelRemoval(3)).toBe('ARCHIVE');
  });

  it('nie przypisuje hulajnogi do modelu wycofanego z oferty', () => {
    expect(code(() => ensureModelAssignable({ code: 'OLD', active: false }))).toBe('MODEL_INACTIVE');
    expect(code(() => ensureModelAssignable({ code: 'BASE', active: true }))).toBeNull();
  });
});

describe('komendy z panelu', () => {
  const target = { status: 'AVAILABLE', online: true, hasOpenRental: false } as const;

  it('dzwonek i blokada są dozwolone dla hulajnogi online', () => {
    expect(code(() => ensurePanelCommandAllowed('RING', target))).toBeNull();
    expect(
      code(() => ensurePanelCommandAllowed('LOCK', { ...target, status: 'IN_USE', hasOpenRental: true })),
    ).toBeNull();
  });

  it('nie wysyła komend do hulajnogi offline ani wycofanej', () => {
    expect(code(() => ensurePanelCommandAllowed('RING', { ...target, online: false }))).toBe('SCOOTER_OFFLINE');
    expect(code(() => ensurePanelCommandAllowed('RING', { ...target, status: 'RETIRED' }))).toBe('SCOOTER_RETIRED');
  });

  it('odblokowuje tylko w serwisie i bez otwartego przejazdu', () => {
    expect(code(() => ensurePanelCommandAllowed('UNLOCK', target))).toBe('UNLOCK_REQUIRES_MAINTENANCE');
    expect(code(() => ensurePanelCommandAllowed('UNLOCK', { ...target, status: 'MAINTENANCE' }))).toBeNull();
    expect(code(() => ensurePanelCommandAllowed('UNLOCK', { ...target, status: 'IN_USE', hasOpenRental: true }))).toBe(
      'SCOOTER_HAS_OPEN_RENTAL',
    );
  });

  it('limit prędkości nie jest komendą panelu', () => {
    expect(code(() => ensurePanelCommandAllowed('SPEED_LIMIT', target))).toBe('COMMAND_NOT_ALLOWED');
  });

  it('potwierdzenie po przekroczeniu czasu nie zmienia statusu komendy', () => {
    expect(commandStatusAfterAck('SENT', true)).toBe('ACKED');
    expect(commandStatusAfterAck('SENT', false)).toBe('REJECTED');
    expect(commandStatusAfterAck('TIMEOUT', true)).toBe('TIMEOUT');
    expect(commandStatusAfterAck('ACKED', false)).toBe('ACKED');
  });

  it('limit czasu potwierdzenia to 10 s', () => {
    const sent = new Date('2026-11-16T10:00:00Z');
    expect(isCommandTimedOut(sent, new Date('2026-11-16T10:00:09.999Z'))).toBe(false);
    expect(isCommandTimedOut(sent, new Date('2026-11-16T10:00:10Z'))).toBe(true);
  });
});
