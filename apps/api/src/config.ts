import { z } from 'zod';

const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  DATABASE_URL: z.url().default('postgres://hulajnogi:hulajnogi@localhost:5432/hulajnogi'),
  API_PORT: z.coerce.number().int().positive().default(3001),
});

export type AppConfig = z.infer<typeof envSchema>;

/** Konfiguracja z zmiennych środowiskowych, sprawdzana przy starcie (błąd = brak startu). */
export function loadConfig(env: NodeJS.ProcessEnv = process.env): AppConfig {
  const parsed = envSchema.safeParse(env);
  if (!parsed.success) {
    throw new Error(`Nieprawidłowa konfiguracja:\n${z.prettifyError(parsed.error)}`);
  }
  return parsed.data;
}

export const CONFIG = Symbol('CONFIG');
