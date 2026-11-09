import { hash } from '@node-rs/argon2';
import { Pool } from 'pg';
import { missingCoordinates, readPlaces } from '../places.js';
import { seedDatabase } from '../seed.js';
import { databaseUrl, requireEnv } from './env.js';

async function main() {
  const places = readPlaces();
  const missing = missingCoordinates(places);
  if (missing.length) {
    console.error(`Brak współrzędnych dla: ${missing.join(', ')}. Uruchom najpierw: pnpm db:places`);
    process.exit(1);
  }
  const pool = new Pool({ connectionString: databaseUrl() });
  try {
    const summary = await seedDatabase(pool, {
      places,
      fleetSize: Number(process.env.SEED_FLEET_SIZE ?? 40),
      admin: {
        email: requireEnv('SEED_ADMIN_EMAIL', 'admin@hulajnogi.local'),
        name: 'Administrator',
        passwordHash: await hash(requireEnv('SEED_ADMIN_PASSWORD', 'zmien-mnie')),
      },
    });
    console.log(
      `Dane startowe gotowe: ${summary.zones} stref, ${summary.scootersTotal} hulajnóg (nowych: ${summary.scootersCreated}).`,
    );
  } finally {
    await pool.end();
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
