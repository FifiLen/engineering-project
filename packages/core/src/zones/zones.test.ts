import { describe, expect, it } from 'vitest';
import { evaluatePosition, type Zone, type ZoneType } from './zones.js';

const zone = (type: ZoneType, speedLimitKmh: number | null = null): Zone => ({
  id: type,
  code: type,
  name: type,
  type,
  speedLimitKmh,
});

describe('reguły stref', () => {
  it('w strefie parkowania w obszarze działania można jechać i zaparkować', () => {
    expect(evaluatePosition([zone('PARKING'), zone('SERVICE_AREA')])).toEqual({
      insideServiceArea: true,
      canRide: true,
      canPark: true,
      speedLimitKmh: null,
    });
  });

  it('strefa zakazu wyklucza jazdę i parkowanie, nawet w strefie parkowania', () => {
    const rules = evaluatePosition([zone('NO_RIDE'), zone('PARKING'), zone('SERVICE_AREA')]);
    expect(rules).toMatchObject({ canRide: false, canPark: false });
  });

  it('obowiązuje najniższy limit z nakładających się stref wolnej jazdy', () => {
    expect(evaluatePosition([zone('SLOW', 15), zone('SLOW', 10), zone('SERVICE_AREA')]).speedLimitKmh).toBe(10);
  });

  it('poza obszarem działania nie można jechać ani parkować', () => {
    expect(evaluatePosition([])).toEqual({ insideServiceArea: false, canRide: false, canPark: false, speedLimitKmh: null });
  });
});
