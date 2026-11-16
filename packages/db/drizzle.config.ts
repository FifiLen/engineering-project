import { defineConfig } from 'drizzle-kit';

// .env z katalogu głównego, jak w poleceniach z src/cli; zmienne z powłoki mają pierwszeństwo.
// drizzle-kit uruchamia konfigurację z katalogu pakietu.
try {
  process.loadEnvFile('../../.env');
} catch (error) {
  if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
}

// Migracje piszemy ręcznie w SQL (migrations/), a schemat Drizzle generujemy z bazy (ADR 0021).
export default defineConfig({
  dialect: 'postgresql',
  out: './src/schema',
  dbCredentials: {
    url: process.env.DATABASE_URL ?? 'postgres://hulajnogi:hulajnogi@localhost:5432/hulajnogi',
  },
  schemaFilter: ['public'],
  tablesFilter: ['!schema_migrations', '!spatial_ref_sys', '!telemetry_*'],
  extensionsFilters: ['postgis'],
  introspect: { casing: 'camel' },
});
