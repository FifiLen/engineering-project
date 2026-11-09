/**
 * Tabela telemetrii jest partycjonowana (PARTITION BY RANGE), a drizzle-kit nie introspekuje
 * tabel partycjonowanych. Definicja utrzymywana ręcznie, zgodna z migrations/0001_init.sql.
 */
import { geometry, index, pgTable, primaryKey, real, smallint, timestamp, uuid } from 'drizzle-orm/pg-core';
import { rentals, scooters } from './schema.js';

export const telemetry = pgTable(
  'telemetry',
  {
    scooterId: uuid('scooter_id')
      .notNull()
      .references(() => scooters.id),
    recordedAt: timestamp('recorded_at', { withTimezone: true, mode: 'date' }).notNull(),
    position: geometry('position', { type: 'point', srid: 4326 }).notNull(),
    batteryPct: smallint('battery_pct').notNull(),
    speedKmh: real('speed_kmh').notNull(),
    rentalId: uuid('rental_id').references(() => rentals.id),
  },
  (table) => [
    primaryKey({ columns: [table.scooterId, table.recordedAt] }),
    index('telemetry_rental_idx').on(table.rentalId, table.recordedAt),
  ],
);
