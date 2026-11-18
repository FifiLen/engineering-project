import { describe, expect, it } from 'vitest';
import { simulatorControlSchema, simulatorResultSchema, simulatorStatusSchema } from './simulator.js';

// Przykłady przepisane z docs/kontrakty/asyncapi-symulator.yaml 1.0.0 (ADR 0059).
describe('kontrakt symulatora', () => {
  const issuedBy = '2b4d6f80-1a3c-4e5f-9a7b-c8d9e0f1a2b3';

  it('akceptuje przykłady poleceń z kontraktu', () => {
    const examples = [
      { commandId: '7c1e2f40-5a3b-4c6d-8e9f-0a1b2c3d4e5f', action: 'disconnect', scooter: 7, params: {} },
      {
        commandId: '1f2e3d4c-5b6a-4798-8a7b-6c5d4e3f2a10',
        action: 'drain',
        scooter: 12,
        params: { targetPct: 5, durationS: 30 },
      },
      {
        commandId: '9a8b7c6d-5e4f-4321-9fed-cba987654321',
        action: 'goto',
        scooter: 15,
        params: { zoneId: '599af0ac-8db4-4a2b-87c0-6a44fcc86556' },
      },
      {
        commandId: '0d1c2b3a-4958-4776-a5b4-c3d2e1f0a9b8',
        action: 'goto',
        scooter: 15,
        params: { point: { lat: 50.1012, lon: 18.5431 } },
      },
      {
        commandId: '4e5f6a7b-8c9d-4e0f-a1b2-c3d4e5f6a7b8',
        action: 'enter_no_ride',
        scooter: 7,
        params: { zoneId: '93b3d522-f37c-4c83-b40e-ef7e6c671b59' },
      },
    ];
    for (const example of examples) {
      const message = { ...example, issuedBy, expiresAt: '2026-11-18T14:35:32.000Z' };
      expect(simulatorControlSchema.parse(message)).toEqual(message);
    }
  });

  it('rozładowanie bez parametrów to 5% w 30 s; wjazd w strefę zakazu wymaga zoneId', () => {
    const base = {
      commandId: '7c1e2f40-5a3b-4c6d-8e9f-0a1b2c3d4e5f',
      scooter: 12,
      issuedBy,
      expiresAt: '2026-11-18T14:35:32Z',
    };
    expect(simulatorControlSchema.parse({ ...base, action: 'drain' }).params).toEqual({ targetPct: 5, durationS: 30 });
    expect(() =>
      simulatorControlSchema.parse({ ...base, action: 'enter_no_ride', params: { point: { lat: 50, lon: 18 } } }),
    ).toThrow();
  });

  it('akceptuje przykłady wyniku i stanu z kontraktu', () => {
    expect(
      simulatorResultSchema.parse({
        commandId: '1f2e3d4c-5b6a-4798-8a7b-6c5d4e3f2a10',
        ok: false,
        reason: 'SCENARIO_ACTIVE',
      }).reason,
    ).toBe('SCENARIO_ACTIVE');
    const status = simulatorStatusSchema.parse({
      online: true,
      since: '2026-11-18T12:21:00.000Z',
      fleetSize: 240,
      connected: 238,
      riding: 6,
      messagesPerSecond: 48,
      ridesPerHour: 30,
      telemetryIntervalMs: 5000,
      ridesStarted: 112,
      commandsReceived: 1204,
      commandsUnacked: 2,
      updatedAt: '2026-11-18T14:35:30.000Z',
      scenarios: [
        { scooter: 7, kind: 'disconnect', startedAt: '2026-11-18T14:32:18.000Z', progress: {} },
        {
          scooter: 12,
          kind: 'drain',
          startedAt: '2026-11-18T14:35:12.000Z',
          progress: { batteryPct: 41, targetPct: 5, remainingS: 18 },
        },
        { scooter: 221, kind: 'silence', startedAt: '2026-11-18T14:34:25.000Z', progress: { unackedCommands: 2 } },
        {
          scooter: 15,
          kind: 'goto',
          startedAt: '2026-11-18T14:33:40.000Z',
          progress: { remainingM: 420 },
          target: { zoneId: '599af0ac-8db4-4a2b-87c0-6a44fcc86556', code: 'P-04' },
        },
      ],
    });
    expect(status.online && status.scenarios).toHaveLength(4);
    expect(simulatorStatusSchema.parse({ online: false })).toEqual({ online: false });
  });
});
