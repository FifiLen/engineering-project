import { describe, expect, it } from 'vitest';
import { distanceM } from '../geo.js';
import { evaluateTelemetry, type TelemetryReading } from './telemetry.js';

const now = new Date('2026-11-16T12:00:00Z');
// Rynek w Rybniku i punkt ok. 70 m na wschód.
const rynek = { lat: 50.095541, lon: 18.542034 };
const east = { lat: 50.095541, lon: 18.543 };

const reading = (overrides: Partial<TelemetryReading> = {}): TelemetryReading => ({
  recordedAt: now,
  position: east,
  batteryPct: 70,
  speedKmh: 14,
  locked: false,
  buffered: false,
  ...overrides,
});

describe('odległość', () => {
  it('liczy metry między punktami w mieście', () => {
    expect(distanceM(rynek, east)).toBeGreaterThan(68);
    expect(distanceM(rynek, east)).toBeLessThan(70);
    expect(distanceM(rynek, rynek)).toBe(0);
  });
});

describe('przyjmowanie telemetrii', () => {
  const track = { lastSeenAt: new Date(now.getTime() - 15_000), position: rynek };

  it('nowszy odczyt zmienia stan bieżący i dolicza przebieg', () => {
    expect(evaluateTelemetry(track, reading(), now)).toEqual({
      accepted: true,
      updatesCurrentState: true,
      odometerIncrementM: 69,
    });
  });

  it('starszy odczyt z bufora trafia tylko do historii', () => {
    const old = reading({ recordedAt: new Date(now.getTime() - 60_000), buffered: true });
    expect(evaluateTelemetry(track, old, now)).toEqual({
      accepted: true,
      updatesCurrentState: false,
      odometerIncrementM: 0,
    });
  });

  it('odrzuca odczyt z przyszłości ponad dopuszczalną różnicę zegara', () => {
    const future = reading({ recordedAt: new Date(now.getTime() + 120_000) });
    expect(evaluateTelemetry(track, future, now)).toEqual({ accepted: false, reason: 'FROM_FUTURE' });
    const skewed = reading({ recordedAt: new Date(now.getTime() + 30_000) });
    expect(evaluateTelemetry(track, skewed, now).accepted).toBe(true);
  });

  it('skok pozycji szybszy niż jazda nie zwiększa przebiegu', () => {
    const jump = { lastSeenAt: new Date(now.getTime() - 1_000), position: rynek };
    expect(evaluateTelemetry(jump, reading(), now)).toMatchObject({ updatesCurrentState: true, odometerIncrementM: 0 });
  });

  it('szum GPS stojącej hulajnogi nie zwiększa przebiegu', () => {
    const nearby = reading({ position: { lat: rynek.lat + 0.00001, lon: rynek.lon } });
    expect(evaluateTelemetry(track, nearby, now)).toMatchObject({ odometerIncrementM: 0 });
  });

  it('pierwszy odczyt hulajnogi ustawia stan bez przebiegu', () => {
    expect(evaluateTelemetry({ lastSeenAt: null, position: null }, reading(), now)).toEqual({
      accepted: true,
      updatesCurrentState: true,
      odometerIncrementM: 0,
    });
  });
});
