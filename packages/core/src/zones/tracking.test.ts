import { describe, expect, it } from 'vitest';
import { DomainError } from '../errors.js';
import {
  ensureZoneCanDeactivate,
  ensureZoneUpdateAllowed,
  isSimpleRing,
  ringAreaM2,
  validateZoneInput,
  type Ring,
  type ZoneInput,
} from './editing.js';
import {
  desiredZoneControl,
  detectZoneChanges,
  RESET_ZONE_CONTROL,
  zoneControlCommands,
  type ZonePresence,
  type ZoneReading,
} from './tracking.js';
import type { Zone, ZoneType } from './zones.js';

const zone = (code: string, type: ZoneType, speedLimitKmh: number | null = null): Zone => ({
  id: code,
  code,
  name: code,
  type,
  speedLimitKmh,
});
const AREA = zone('AREA', 'SERVICE_AREA');
const SLOW = zone('S-01', 'SLOW', 10);
const NO_RIDE = zone('Z-01', 'NO_RIDE');
const at = (s: number) => new Date(Date.UTC(2026, 10, 17, 12, 0, s));
const reading = (s: number, ...near: Array<[Zone, boolean]>): ZoneReading => ({
  at: at(s),
  near: near.map(([z, inside]) => ({ zone: z, inside })),
});
const codes = (presence: ZonePresence[]) => presence.map((p) => p.zone.code).sort();

describe('wykrywanie zmian stref (ADR 0043)', () => {
  it('pierwszy odczyt przejazdu ustawia stan bez zdarzeń, także w strefie wolnej jazdy', () => {
    const result = detectZoneChanges(null, reading(0, [AREA, true], [SLOW, true]));
    expect(codes(result.presence)).toEqual(['AREA', 'S-01']);
    expect(result.transitions).toEqual([]);
  });

  it('wjazd od pierwszego odczytu w strefie z czasem odczytu', () => {
    const start = detectZoneChanges(null, reading(0, [AREA, true])).presence;
    const result = detectZoneChanges(start, reading(5, [AREA, true], [SLOW, true]));
    expect(result.transitions).toEqual([{ kind: 'ENTERED', zone: SLOW, at: at(5) }]);
    expect(result.presence.find((p) => p.zone.code === 'S-01')?.enteredAt).toEqual(at(5));
  });

  it('wyjazd dopiero po dwóch kolejnych odczytach poza strefą w promieniu 10 m', () => {
    let presence = detectZoneChanges(null, reading(0, [AREA, true], [SLOW, true])).presence;
    const first = detectZoneChanges(presence, reading(5, [AREA, true], [SLOW, false]));
    expect(first.transitions).toEqual([]);
    expect(first.presence.find((p) => p.zone.code === 'S-01')?.outsideCount).toBe(1);
    // Powrót do strefy kasuje licznik (skok GPS na granicy).
    presence = detectZoneChanges(first.presence, reading(10, [AREA, true], [SLOW, true])).presence;
    expect(presence.find((p) => p.zone.code === 'S-01')?.outsideCount).toBe(0);
    const out1 = detectZoneChanges(presence, reading(15, [AREA, true], [SLOW, false]));
    const out2 = detectZoneChanges(out1.presence, reading(20, [AREA, true], [SLOW, false]));
    expect(out2.transitions).toEqual([{ kind: 'EXITED', zone: SLOW, at: at(20) }]);
    expect(codes(out2.presence)).toEqual(['AREA']);
  });

  it('strefa dalej niż 10 m albo nieaktywna to wyjazd od razu', () => {
    const presence = detectZoneChanges(null, reading(0, [AREA, true], [SLOW, true])).presence;
    const result = detectZoneChanges(presence, reading(5, [AREA, true]));
    expect(result.transitions).toEqual([{ kind: 'EXITED', zone: SLOW, at: at(5) }]);
  });

  it('wyjazd poza obszar działania i powrót to zdarzenia obszaru', () => {
    const presence = detectZoneChanges(null, reading(0, [AREA, true])).presence;
    const out = detectZoneChanges(presence, reading(5));
    expect(out.transitions).toEqual([{ kind: 'EXITED', zone: AREA, at: at(5) }]);
    const back = detectZoneChanges(out.presence, reading(10, [AREA, true]));
    expect(back.transitions).toEqual([{ kind: 'ENTERED', zone: AREA, at: at(10) }]);
  });

  it('dane strefy pochodzą z bieżącego odczytu (nowy limit po zmianie w panelu)', () => {
    const presence = detectZoneChanges(null, reading(0, [AREA, true], [SLOW, true])).presence;
    const changed = zone('S-01', 'SLOW', 8);
    const result = detectZoneChanges(presence, reading(5, [AREA, true], [changed, true]));
    expect(result.presence.find((p) => p.zone.code === 'S-01')?.zone.speedLimitKmh).toBe(8);
  });
});

describe('sterowanie hulajnogą według stref (ADR 0044)', () => {
  it('stan docelowy: zakaz i brak obszaru zatrzymują, wolna jazda daje najniższy limit', () => {
    expect(desiredZoneControl([AREA])).toEqual({ stopped: false, speedLimitKmh: null });
    expect(desiredZoneControl([AREA, SLOW, zone('S-02', 'SLOW', 8)])).toEqual({ stopped: false, speedLimitKmh: 8 });
    expect(desiredZoneControl([AREA, NO_RIDE])).toEqual({ stopped: true, speedLimitKmh: null });
    expect(desiredZoneControl([])).toEqual({ stopped: true, speedLimitKmh: null });
  });

  it('komenda tylko przy różnicy stanu albo po nieudanej poprzedniej', () => {
    expect(zoneControlCommands(RESET_ZONE_CONTROL, { stopped: false, speedLimitKmh: null })).toEqual([]);
    expect(zoneControlCommands(RESET_ZONE_CONTROL, { stopped: false, speedLimitKmh: 10 })).toEqual([
      { type: 'SPEED_LIMIT', speedLimitKmh: 10 },
    ]);
    const limited = { ...RESET_ZONE_CONTROL, speedLimitKmh: 10 };
    expect(zoneControlCommands(limited, { stopped: false, speedLimitKmh: 10 })).toEqual([]);
    expect(zoneControlCommands({ ...limited, limitSynced: false }, { stopped: false, speedLimitKmh: 10 })).toEqual([
      { type: 'SPEED_LIMIT', speedLimitKmh: 10 },
    ]);
    expect(zoneControlCommands(limited, { stopped: false, speedLimitKmh: null })).toEqual([
      { type: 'SPEED_LIMIT', speedLimitKmh: null },
    ]);
  });

  it('zakaz zatrzymuje, a wyjazd z niego przywraca napęd', () => {
    expect(zoneControlCommands(RESET_ZONE_CONTROL, { stopped: true, speedLimitKmh: null })).toEqual([
      { type: 'STOP_GRADUALLY' },
    ]);
    const stopped = { ...RESET_ZONE_CONTROL, stopped: true };
    expect(zoneControlCommands(stopped, { stopped: false, speedLimitKmh: 10 })).toEqual([
      { type: 'RELEASE_STOP' },
      { type: 'SPEED_LIMIT', speedLimitKmh: 10 },
    ]);
  });
});

const square = (sizeDeg: number): Ring => [
  [18.5, 50.0],
  [18.5 + sizeDeg, 50.0],
  [18.5 + sizeDeg, 50.0 + sizeDeg],
  [18.5, 50.0 + sizeDeg],
  [18.5, 50.0],
];
const input = (patch: Partial<ZoneInput> = {}): ZoneInput => ({
  code: 'P-06',
  name: 'Nowa',
  type: 'PARKING',
  speedLimitKmh: null,
  capacity: 10,
  visibleInApp: true,
  ring: square(0.001),
  ...patch,
});
const error = (fn: () => void) => {
  try {
    fn();
  } catch (e) {
    return { code: (e as DomainError).code, details: (e as DomainError).details };
  }
  return null;
};

describe('edycja strefy (ADR 0047)', () => {
  it('powierzchnia kwadratu 0,001° w Rybniku to około 8 tys. m²', () => {
    const area = ringAreaM2(square(0.001));
    expect(area).toBeGreaterThan(7_000);
    expect(area).toBeLessThan(8_100);
  });

  it('wykrywa samoprzecięcie (kokardka)', () => {
    const bowtie: Ring = [
      [18.5, 50.0],
      [18.501, 50.001],
      [18.501, 50.0],
      [18.5, 50.001],
      [18.5, 50.0],
    ];
    expect(isSimpleRing(square(0.001))).toBe(true);
    expect(isSimpleRing(bowtie)).toBe(false);
    expect(error(() => validateZoneInput(input({ ring: bowtie })))).toEqual({
      code: 'ZONE_INVALID_GEOMETRY',
      details: { reason: 'SELF_INTERSECTION' },
    });
  });

  it('odrzuca za mało punktów i za małą strefę', () => {
    const line: Ring = [
      [18.5, 50.0],
      [18.501, 50.0],
      [18.5, 50.0],
    ];
    expect(error(() => validateZoneInput(input({ ring: line })))?.details).toEqual({ reason: 'TOO_FEW_POINTS' });
    expect(error(() => validateZoneInput(input({ ring: square(0.00005) })))?.details).toEqual({ reason: 'TOO_SMALL' });
  });

  it('limit tylko w wolnej jeździe w zakresie 5–15 km/h, pojemność tylko w parkowaniu', () => {
    expect(error(() => validateZoneInput(input({ type: 'SLOW', capacity: null, speedLimitKmh: 10 })))).toBeNull();
    expect(error(() => validateZoneInput(input({ type: 'SLOW', capacity: null, speedLimitKmh: 20 })))?.details).toEqual(
      {
        fields: ['speedLimitKmh'],
      },
    );
    expect(error(() => validateZoneInput(input({ type: 'NO_RIDE', capacity: 5 })))?.details).toEqual({
      fields: ['capacity'],
    });
    expect(error(() => validateZoneInput(input({ code: 'p 1', name: ' ' })))?.details).toEqual({
      fields: ['code', 'name'],
    });
  });

  it('typ strefy jest niezmienny, a obszaru działania nie można dezaktywować', () => {
    expect(error(() => ensureZoneUpdateAllowed({ type: 'PARKING' }, { type: 'NO_RIDE' }))?.code).toBe(
      'ZONE_TYPE_IMMUTABLE',
    );
    expect(error(() => ensureZoneCanDeactivate({ type: 'SERVICE_AREA', active: true }))?.code).toBe(
      'SERVICE_AREA_REQUIRED',
    );
    expect(error(() => ensureZoneCanDeactivate({ type: 'PARKING', active: true }))).toBeNull();
  });
});
