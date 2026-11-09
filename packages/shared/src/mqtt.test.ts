import { describe, expect, it } from 'vitest';
import { ackSchema, commandSchema, scooterIdFromTopic, scooterTopicId, telemetrySchema, topics } from './mqtt.js';

// Przykłady przepisane z docs/kontrakty/asyncapi-mqtt.yaml.
describe('kontrakt MQTT', () => {
  it('akceptuje przykład telemetrii z kontraktu', () => {
    const parsed = telemetrySchema.parse({
      ts: '2026-11-09T14:35:12.204Z',
      lat: 50.0921,
      lon: 18.5418,
      bat: 71,
      v: 14.2,
      locked: false,
      buffered: false,
    });
    expect(parsed.bat).toBe(71);
  });

  it('uzupełnia domyślne buffered = false', () => {
    const parsed = telemetrySchema.parse({ ts: '2026-11-09T14:35:12Z', lat: 50, lon: 18, bat: 5, v: 0, locked: true });
    expect(parsed.buffered).toBe(false);
  });

  it('odrzuca baterię spoza zakresu', () => {
    expect(() =>
      telemetrySchema.parse({ ts: '2026-11-09T14:35:12Z', lat: 50, lon: 18, bat: 101, v: 0, locked: true }),
    ).toThrow();
  });

  it('akceptuje przykłady komend z kontraktu', () => {
    expect(
      commandSchema.parse({
        commandId: '6f1c2d0e-3b1a-4b8e-9b55-0a1f4c2e7d10',
        cmd: 'unlock',
        issuedAt: '2026-11-09T14:19:02.000Z',
      }).cmd,
    ).toBe('unlock');
    expect(
      commandSchema.parse({
        commandId: '0b7e4a35-91d2-4f3c-8a64-2c5d1e9f7a21',
        cmd: 'speed_limit',
        issuedAt: '2026-11-09T14:24:10.000Z',
        params: { kmh: 10 },
      }).params?.kmh,
    ).toBe(10);
  });

  it('odrzuca nieznaną komendę', () => {
    expect(() =>
      commandSchema.parse({ commandId: '6f1c2d0e-3b1a-4b8e-9b55-0a1f4c2e7d10', cmd: 'explode', issuedAt: '2026-11-09T14:19:02Z' }),
    ).toThrow();
  });

  it('akceptuje odrzucenie komendy z powodem', () => {
    const ack = ackSchema.parse({
      commandId: '6f1c2d0e-3b1a-4b8e-9b55-0a1f4c2e7d10',
      ok: false,
      reason: 'LOW_BATTERY',
      ts: '2026-11-09T14:19:02.180Z',
    });
    expect(ack.reason).toBe('LOW_BATTERY');
  });

  it('buduje i rozbiera tematy', () => {
    const id = scooterTopicId(142);
    expect(id).toBe('0142');
    expect(topics.command(id)).toBe('scooters/0142/cmd');
    expect(scooterIdFromTopic('scooters/0142/telemetry')).toBe('0142');
    expect(scooterIdFromTopic('scooters/142/telemetry')).toBeNull();
    expect(scooterIdFromTopic('other/0142/telemetry')).toBeNull();
  });
});
