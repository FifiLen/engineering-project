/**
 * Symulator floty (ADR 0002). Każda wirtualna hulajnoga ma własne połączenie MQTT i zachowuje się jak
 * urządzenie z kontraktu AsyncAPI: telemetria, status z Last Will, komendy z potwierdzeniami.
 * Przejazdy pokazowe zastępują wypożyczenia do iteracji 3.
 */
import { join } from 'node:path';
import mqtt from 'mqtt';
import { loadArea } from './area.js';
import { loadConfig } from './config.js';
import { ScooterConnection, type ConnectionStats } from './connection.js';
import { DemoTraffic, readState, restoreFleet, runFleet, writeState } from './fleet.js';
import { RoutePlanner } from './osrm.js';

const STATUS_TOPIC = 'simulator/status';
const STATS_INTERVAL_MS = 10_000;
const SAVE_INTERVAL_MS = 30_000;

/** Wczytuje .env z katalogu głównego repozytorium; zmienne ustawione w powłoce mają pierwszeństwo. */
function loadRootEnv(path: string) {
  try {
    process.loadEnvFile(path);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
  }
}

loadRootEnv(join(import.meta.dirname, '..', '..', '..', '.env'));
const config = loadConfig();
const area = loadArea(config.SIM_PLACES_FILE);
const scooters = restoreFleet(config.SIM_FLEET_SIZE, area, readState(config.SIM_STATE_FILE));
const stats: ConnectionStats = { sent: 0 };
const connections = scooters.map((s) => new ScooterConnection(s, config.MQTT_URL, config.SIM_FIRMWARE, stats));
const traffic = new DemoTraffic(scooters, {
  area,
  planner: new RoutePlanner(config.OSRM_URL),
  ridesPerHour: config.SIM_RIDES_PER_HOUR,
});
const stopFleet = runFleet(scooters, connections, traffic, config.SIM_TELEMETRY_INTERVAL_MS);
const since = new Date().toISOString();

// Połączenie samego symulatora: stan i liczniki dla ekranu symulatora w panelu (iteracja 6).
const control = mqtt.connect(config.MQTT_URL, {
  clientId: `simulator-${process.pid}`,
  will: { topic: STATUS_TOPIC, payload: Buffer.from(JSON.stringify({ online: false })), qos: 1, retain: true },
});
let lastSent = 0;
const publishStats = () => {
  const payload = {
    online: true,
    since,
    fleetSize: scooters.length,
    connected: connections.filter((c) => c.connected).length,
    riding: scooters.filter((s) => s.riding).length,
    messagesPerSecond: Math.round(((stats.sent - lastSent) / STATS_INTERVAL_MS) * 1000 * 10) / 10,
    ridesPerHour: config.SIM_RIDES_PER_HOUR,
  };
  lastSent = stats.sent;
  control.publish(STATUS_TOPIC, JSON.stringify(payload), { qos: 1, retain: true });
};
control.on('connect', () => {
  publishStats();
  console.log(
    `Symulator: ${scooters.length} hulajnóg, telemetria co ${config.SIM_TELEMETRY_INTERVAL_MS / 1000} s, ` +
      `${config.SIM_RIDES_PER_HOUR} przejazdów pokazowych na godzinę, broker ${config.MQTT_URL}.`,
  );
});
control.on('error', (error) => console.error('Błąd MQTT:', error.message));

const timers = [
  setInterval(publishStats, STATS_INTERVAL_MS),
  setInterval(() => writeState(config.SIM_STATE_FILE, scooters), SAVE_INTERVAL_MS),
];

let stopping = false;
const shutdown = async () => {
  if (stopping) return;
  stopping = true;
  stopFleet();
  timers.forEach((t) => clearInterval(t));
  writeState(config.SIM_STATE_FILE, scooters);
  await Promise.all(connections.map((c) => c.close()));
  await control.publishAsync(STATUS_TOPIC, JSON.stringify({ online: false }), { qos: 1, retain: true });
  await control.endAsync();
  process.exit(0);
};
process.on('SIGINT', () => void shutdown());
process.on('SIGTERM', () => void shutdown());
