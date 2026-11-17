import { join } from 'node:path';
import { z } from 'zod';

const repoRoot = join(import.meta.dirname, '..', '..', '..');

const envSchema = z.object({
  MQTT_URL: z.string().default('mqtt://localhost:1883'),
  OSRM_URL: z.url().default('http://localhost:5000'),
  SIM_FLEET_SIZE: z.coerce.number().int().min(1).max(5000).default(40),
  SIM_TELEMETRY_INTERVAL_MS: z.coerce.number().int().min(500).default(5000),
  /**
   * Przejazdy pokazowe na godzinę dla całej floty; domyślnie wyłączone, bo przejazdy tworzy API (ADR 0039).
   * Pokazowa hulajnoga ma w bazie status AVAILABLE, więc włączamy je tylko do pokazu samej telemetrii.
   */
  SIM_RIDES_PER_HOUR: z.coerce.number().min(0).max(10_000).default(0),
  /** Miejsca z danych startowych (sprawdzone współrzędne Rybnika): obszar działania i punkty postoju. */
  SIM_PLACES_FILE: z.string().default(join(repoRoot, 'packages', 'db', 'seed', 'rybnik-places.json')),
  /** Stan hulajnóg (pozycja, bateria) zapisywany między uruchomieniami. */
  SIM_STATE_FILE: z.string().default(join(repoRoot, 'apps', 'simulator', '.state', 'fleet.json')),
  /** Plik sterujący awariami do demo: hulajnogi offline i bez potwierdzeń (ADR 0039). */
  SIM_CONTROL_FILE: z.string().default(join(repoRoot, 'apps', 'simulator', '.state', 'control.json')),
  SIM_FIRMWARE: z.string().default('v2.4.1'),
});

/** Wczytuje .env z katalogu głównego repozytorium; zmienne ustawione w powłoce mają pierwszeństwo. */
export function loadRootEnv(path = join(repoRoot, '.env')): void {
  try {
    process.loadEnvFile(path);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
  }
}

export type SimulatorConfig = z.infer<typeof envSchema>;

export function loadConfig(env: NodeJS.ProcessEnv = process.env): SimulatorConfig {
  const parsed = envSchema.safeParse(env);
  if (!parsed.success) throw new Error(`Nieprawidłowa konfiguracja symulatora:\n${z.prettifyError(parsed.error)}`);
  return parsed.data;
}
