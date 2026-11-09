/**
 * Symulator floty (ADR 0002). W iteracji 0 tylko łączy się z brokerem i ogłasza swój stan.
 * Wirtualne hulajnogi, trasy z OSRM i scenariusze awarii powstają w iteracji 1.
 */
import mqtt from 'mqtt';
import { loadConfig } from './config.js';

const STATUS_TOPIC = 'simulator/status';

const config = loadConfig();
const client = mqtt.connect(config.MQTT_URL, {
  clientId: `simulator-${process.pid}`,
  will: { topic: STATUS_TOPIC, payload: JSON.stringify({ online: false }), qos: 1, retain: true },
});

client.on('connect', () => {
  client.publish(
    STATUS_TOPIC,
    JSON.stringify({ online: true, fleetSize: config.SIM_FLEET_SIZE, since: new Date().toISOString() }),
    { qos: 1, retain: true },
  );
  console.log(`Symulator połączony z ${config.MQTT_URL}. Flota: ${config.SIM_FLEET_SIZE} (wirtualne hulajnogi od iteracji 1).`);
});

client.on('error', (error) => console.error('Błąd MQTT:', error.message));

const shutdown = () => {
  client.publish(STATUS_TOPIC, JSON.stringify({ online: false }), { qos: 1, retain: true }, () => {
    client.end(false, () => process.exit(0));
  });
};
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
