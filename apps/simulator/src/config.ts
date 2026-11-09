import { z } from 'zod';

const envSchema = z.object({
  MQTT_URL: z.string().default('mqtt://localhost:1883'),
  OSRM_URL: z.url().default('http://localhost:5000'),
  SIM_FLEET_SIZE: z.coerce.number().int().min(1).max(5000).default(40),
  SIM_TELEMETRY_INTERVAL_MS: z.coerce.number().int().min(500).default(5000),
});

export type SimulatorConfig = z.infer<typeof envSchema>;

export function loadConfig(env: NodeJS.ProcessEnv = process.env): SimulatorConfig {
  const parsed = envSchema.safeParse(env);
  if (!parsed.success) throw new Error(`Nieprawidłowa konfiguracja symulatora:\n${z.prettifyError(parsed.error)}`);
  return parsed.data;
}
