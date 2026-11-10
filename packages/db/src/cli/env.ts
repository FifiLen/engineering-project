import { join } from 'node:path';

/** Wczytuje .env z katalogu głównego repozytorium; zmienne ustawione w powłoce mają pierwszeństwo. */
function loadRootEnv(path: string) {
  try {
    process.loadEnvFile(path);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
  }
}

loadRootEnv(join(import.meta.dirname, '..', '..', '..', '..', '.env'));

export function requireEnv(name: string, fallback?: string): string {
  const value = process.env[name] ?? fallback;
  if (!value) {
    throw new Error(`Brak zmiennej środowiskowej ${name}. Skopiuj .env.example do .env.`);
  }
  return value;
}

export const databaseUrl = () => requireEnv('DATABASE_URL', 'postgres://hulajnogi:hulajnogi@localhost:5432/hulajnogi');
