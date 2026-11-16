import { z } from 'zod';

const booleanFlag = z
  .enum(['true', 'false', '1', '0'])
  .transform((v) => v === 'true' || v === '1')
  .or(z.boolean());

const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  DATABASE_URL: z.url().default('postgres://hulajnogi:hulajnogi@localhost:5432/hulajnogi'),
  API_PORT: z.coerce.number().int().positive().default(3001),
  /** Adresy panelu i strony dopuszczone przez CORS (po przecinku); w trybie deweloperskim każdy localhost. */
  CORS_ORIGINS: z.string().default(''),
  MQTT_URL: z.string().default('mqtt://localhost:1883'),
  /** Jedna instancja backendu ma stały identyfikator, żeby po restarcie wznowić swoją sesję w brokerze. */
  MQTT_CLIENT_ID: z.string().min(1).default('hulajnogi-api'),
  /** Testy API działają bez brokera: wiadomości podaje test, a publikacje są tylko zapisywane. */
  MQTT_ENABLED: booleanFlag.default(true),
  /** Okno zbierania telemetrii przed zapisem do bazy i wysłaniem do panelu (ADR 0033). */
  TELEMETRY_FLUSH_MS: z.coerce.number().int().min(100).max(10_000).default(1000),
});

export type AppConfig = z.infer<typeof envSchema>;

/** Konfiguracja z zmiennych środowiskowych, sprawdzana przy starcie (błąd = brak startu). */
export function loadConfig(env: NodeJS.ProcessEnv | Record<string, unknown> = process.env): AppConfig {
  const parsed = envSchema.safeParse(env);
  if (!parsed.success) {
    throw new Error(`Nieprawidłowa konfiguracja:\n${z.prettifyError(parsed.error)}`);
  }
  return parsed.data;
}

export const CONFIG = Symbol('CONFIG');
