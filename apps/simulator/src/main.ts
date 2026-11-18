/**
 * Symulator floty (ADR 0002). Każda wirtualna hulajnoga ma własne połączenie MQTT i zachowuje się jak
 * urządzenie z kontraktu AsyncAPI: telemetria, status z Last Will, komendy z potwierdzeniami.
 * Po odblokowaniu komendą wirtualny klient jedzie do strefy parkowania ze stref z API, a po `stop_gradually`
 * prowadzi hulajnogę pieszo poza strefę zakazu (ADR 0039, ADR 0046). Przejazdy pokazowe są domyślnie
 * wyłączone. Scenariusze awarii i jazdy do demo przychodzą z panelu przez `simulator/control` albo z pliku
 * sterującego (`pnpm --filter @hulajnogi/simulator control`) i trafiają do jednej obsługi (ADR 0059).
 */
import { simulatorTopics } from '@hulajnogi/shared';
import mqtt from 'mqtt';
import { loadArea } from './area.js';
import { loadConfig, loadRootEnv } from './config.js';
import { ScooterConnection, type ConnectionStats } from './connection.js';
import { controlCommands, emptyControl, takeGoto, watchControl } from './control.js';
import { CommandRides, DemoTraffic, readState, restoreFleet, runFleet, writeState } from './fleet.js';
import { RoutePlanner } from './osrm.js';
import { ControlChannel, simulatorStatus, STATUS_INTERVAL_MS, statusDue } from './remote.js';
import { Scenarios } from './scenarios.js';
import { loadPlaceZones, ZONES_REFRESH_MS, ZoneSource } from './zones.js';

const SAVE_INTERVAL_MS = 30_000;

loadRootEnv();
const config = loadConfig();
const area = loadArea(config.SIM_PLACES_FILE);
const scooters = restoreFleet(config.SIM_FLEET_SIZE, area, readState(config.SIM_STATE_FILE));
const stats: ConnectionStats = { sent: 0, commandsReceived: 0, commandsUnacked: 0 };
const connections = scooters.map((s) => new ScooterConnection(s, config.MQTT_URL, config.SIM_FIRMWARE, stats));
const planner = new RoutePlanner(config.OSRM_URL);
// Wirtualny klient widzi strefy tak jak aplikacja; plik miejsc jest zapasem, gdy API nie działa (ADR 0046).
const zones = new ZoneSource({ apiUrl: config.SIM_API_URL, fallback: loadPlaceZones(config.SIM_PLACES_FILE) });
await zones.refresh();
const stopZones = zones.watch(ZONES_REFRESH_MS);
const rides = {
  commands: new CommandRides(scooters, { planner, zones }),
  demo: new DemoTraffic(scooters, { area, planner, ridesPerHour: config.SIM_RIDES_PER_HOUR }),
};
const stopFleet = runFleet(scooters, connections, rides, config.SIM_TELEMETRY_INTERVAL_MS);

// Scenariusze z panelu i z pliku sterującego: jedna obsługa, wygrywa ostatnie polecenie (ADR 0059).
let scenariosChanged = false;
const scenarios = new Scenarios({
  scooters,
  links: connections,
  rides: rides.commands,
  zones,
  onChange: () => (scenariosChanged = true),
});
let fileState = emptyControl();
const stopControl = watchControl(config.SIM_CONTROL_FILE, (state) => {
  const now = new Date();
  for (const command of controlCommands(fileState, state)) void scenarios.apply(command, now, 'control.json');
  fileState = state;
  // Cel `goto` jest jednorazowy: odczyt usuwa go z pliku, a obserwacja pliku nie traktuje usunięcia jako polecenia.
  for (const key of Object.keys(state.goto)) {
    const scooter = Number(key);
    const target = takeGoto(config.SIM_CONTROL_FILE, scooter);
    if (target) void scenarios.apply({ scooter, action: 'goto', params: target }, now, 'control.json');
  }
});
const since = new Date().toISOString();

// Połączenie samego symulatora: polecenia z panelu, ich wyniki oraz stan i liczniki dla ekranu symulatora.
const client = mqtt.connect(config.MQTT_URL, {
  clientId: `simulator-${process.pid}`,
  will: {
    topic: simulatorTopics.status,
    payload: Buffer.from(JSON.stringify({ online: false })),
    qos: 1,
    retain: true,
  },
});
const channel = new ControlChannel(scenarios);
client.on('message', (topic, payload) => {
  if (topic !== simulatorTopics.control) return;
  void channel.handle(payload)?.then((result) => {
    client.publish(simulatorTopics.result, JSON.stringify(result), { qos: 1 });
  });
});

let rate = { sent: 0, at: Date.now(), perSecond: 0 };
let lastStatusAt = 0;
const publishStatus = (now: Date) => {
  // Tempo telemetrii z ostatniego okna co najmniej 10 s; częstsze publikacje przy scenariuszach go nie zmieniają.
  const windowMs = now.getTime() - rate.at;
  if (windowMs >= STATUS_INTERVAL_MS) {
    rate = {
      sent: stats.sent,
      at: now.getTime(),
      perSecond: Math.round(((stats.sent - rate.sent) / windowMs) * 10_000) / 10,
    };
  }
  const payload = simulatorStatus(
    {
      since,
      fleetSize: scooters.length,
      connected: connections.filter((c) => c.connected).length,
      riding: scooters.filter((s) => s.riding).length,
      messagesPerSecond: rate.perSecond,
      ridesPerHour: config.SIM_RIDES_PER_HOUR,
      telemetryIntervalMs: config.SIM_TELEMETRY_INTERVAL_MS,
      ridesStarted: scooters.reduce((sum, s) => sum + s.tripsStarted, 0),
      commandsReceived: stats.commandsReceived,
      commandsUnacked: stats.commandsUnacked,
      scenarios: scenarios.list(now),
    },
    now,
  );
  scenariosChanged = false;
  lastStatusAt = now.getTime();
  if (client.connected) client.publish(simulatorTopics.status, JSON.stringify(payload), { qos: 1, retain: true });
};
client.on('connect', () => {
  client.subscribe(simulatorTopics.control, { qos: 1 });
  publishStatus(new Date());
  console.log(
    `Symulator: ${scooters.length} hulajnóg, telemetria co ${config.SIM_TELEMETRY_INTERVAL_MS / 1000} s, ` +
      `${config.SIM_RIDES_PER_HOUR} przejazdów pokazowych na godzinę, broker ${config.MQTT_URL}, ` +
      `strefy ${zones.fromApi ? `z API ${config.SIM_API_URL}` : 'z pliku miejsc'}.`,
  );
});
client.on('error', (error) => console.error('Błąd MQTT:', error.message));

const timers = [
  setInterval(() => {
    const now = new Date();
    scenarios.tick(now);
    const due = statusDue({
      changed: scenariosChanged,
      scenarios: scenarios.size,
      sinceLastMs: now.getTime() - lastStatusAt,
    });
    if (due) publishStatus(now);
  }, 1000),
  setInterval(() => writeState(config.SIM_STATE_FILE, scooters), SAVE_INTERVAL_MS),
];

let stopping = false;
const shutdown = async () => {
  if (stopping) return;
  stopping = true;
  stopFleet();
  stopZones();
  stopControl();
  timers.forEach((t) => clearInterval(t));
  writeState(config.SIM_STATE_FILE, scooters);
  await Promise.all(connections.map((c) => c.close()));
  await client.publishAsync(simulatorTopics.status, JSON.stringify({ online: false }), { qos: 1, retain: true });
  await client.endAsync();
  process.exit(0);
};
process.on('SIGINT', () => void shutdown());
process.on('SIGTERM', () => void shutdown());
