export function requireEnv(name: string, fallback?: string): string {
  const value = process.env[name] ?? fallback;
  if (!value) {
    throw new Error(`Brak zmiennej środowiskowej ${name}. Skopiuj .env.example do .env.`);
  }
  return value;
}

export const databaseUrl = () =>
  requireEnv('DATABASE_URL', 'postgres://hulajnogi:hulajnogi@localhost:5432/hulajnogi');
