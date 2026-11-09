import { defineConfig } from 'drizzle-kit';

// Migracje piszemy ręcznie w SQL (migrations/), a schemat Drizzle generujemy z bazy (ADR 0021).
export default defineConfig({
  dialect: 'postgresql',
  out: './src/schema',
  dbCredentials: {
    url: process.env.DATABASE_URL ?? 'postgres://hulajnogi:hulajnogi@localhost:5432/hulajnogi',
  },
  schemaFilter: ['public'],
  tablesFilter: ['!schema_migrations', '!spatial_ref_sys', '!telemetry_default'],
  extensionsFilters: ['postgis'],
  introspect: { casing: 'camel' },
});
