import { describe, expect, it } from 'vitest';
import { loadConfig } from './config.js';

describe('konfiguracja symulatora', () => {
  it('ma wartości domyślne dla środowiska deweloperskiego', () => {
    expect(loadConfig({})).toMatchObject({
      MQTT_URL: 'mqtt://localhost:1883',
      OSRM_URL: 'http://localhost:5000',
      SIM_FLEET_SIZE: 40,
      SIM_TELEMETRY_INTERVAL_MS: 5000,
      SIM_RIDES_PER_HOUR: 30,
    });
    expect(loadConfig({}).SIM_PLACES_FILE).toMatch(/packages\/db\/seed\/rybnik-places\.json$/);
  });

  it('odrzuca zbyt krótki odstęp telemetrii', () => {
    expect(() => loadConfig({ SIM_TELEMETRY_INTERVAL_MS: '100' })).toThrow(/SIM_TELEMETRY_INTERVAL_MS/);
  });
});
