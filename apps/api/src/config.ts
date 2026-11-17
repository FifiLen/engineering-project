import { z } from 'zod';

const booleanFlag = z
  .enum(['true', 'false', '1', '0'])
  .transform((v) => v === 'true' || v === '1')
  .or(z.boolean());

/** Pusta wartość z `.env` (np. `JWT_SECRET=`) oznacza brak zmiennej. */
const optional = <T extends z.ZodType>(schema: T) => z.preprocess((v) => (v === '' ? undefined : v), schema.optional());

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
  /** Podpis tokenów dostępowych JWT (ADR 0035); w produkcji wymagany. */
  JWT_SECRET: optional(z.string().min(32)),
  /** Klucz AES-256-GCM sekretów TOTP: 32 bajty w base64 (ADR 0035); w produkcji wymagany. */
  TOTP_ENCRYPTION_KEY: optional(
    z.string().refine((v) => Buffer.from(v, 'base64').length === 32, 'Klucz musi mieć 32 bajty w base64'),
  ),
  /** Adres panelu w linkach zaproszeń operatorów. */
  PANEL_URL: z.url().default('http://localhost:3000'),
  /** Adres strony w kodach QR hulajnóg (ADR 0041); domena zależy od nazwy marki. */
  PUBLIC_SITE_URL: z.url().default('http://localhost:3000'),
  /**
   * Zadania w tle pg-boss (ADR 0037). Testy API wyłączają kolejkę: zaplanowane zadania są tylko
   * zapisywane, a test wywołuje ich obsługę bezpośrednio.
   */
  JOBS_ENABLED: booleanFlag.default(true),
});

/**
 * Wartości tylko dla środowiska deweloperskiego i testów. W produkcji brak sekretu zatrzymuje start,
 * żeby tokeny nie były podpisane kluczem znanym z repozytorium.
 */
const DEV_JWT_SECRET = 'dev-only-jwt-secret-not-for-production-use';
const DEV_TOTP_KEY = Buffer.alloc(32, 7).toString('base64');

type ParsedEnv = z.infer<typeof envSchema>;
export type AppConfig = Omit<ParsedEnv, 'JWT_SECRET' | 'TOTP_ENCRYPTION_KEY'> & {
  JWT_SECRET: string;
  TOTP_ENCRYPTION_KEY: string;
};

/** Konfiguracja z zmiennych środowiskowych, sprawdzana przy starcie (błąd = brak startu). */
export function loadConfig(env: NodeJS.ProcessEnv | Record<string, unknown> = process.env): AppConfig {
  const parsed = envSchema.safeParse(env);
  if (!parsed.success) {
    throw new Error(`Nieprawidłowa konfiguracja:\n${z.prettifyError(parsed.error)}`);
  }
  const data = parsed.data;
  // z.preprocess traci typ wyniku; po walidacji to napis albo brak wartości.
  const jwtSecret = data.JWT_SECRET as string | undefined;
  const totpKey = data.TOTP_ENCRYPTION_KEY as string | undefined;
  if (data.NODE_ENV === 'production' && (!jwtSecret || !totpKey)) {
    throw new Error('Nieprawidłowa konfiguracja: w produkcji wymagane są JWT_SECRET i TOTP_ENCRYPTION_KEY');
  }
  return { ...data, JWT_SECRET: jwtSecret ?? DEV_JWT_SECRET, TOTP_ENCRYPTION_KEY: totpKey ?? DEV_TOTP_KEY };
}

export const CONFIG = Symbol('CONFIG');
