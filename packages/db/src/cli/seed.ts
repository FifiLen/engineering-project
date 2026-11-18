import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { hash } from '@node-rs/argon2';
import { Pool } from 'pg';
import { missingCoordinates, readPlaces } from '../places.js';
import { seedDatabase } from '../seed.js';
import { databaseUrl, requireEnv } from './env.js';

/** Treść deweloperska dokumentu z `seed/documents` (bez komentarza HTML z nagłówka pliku). */
function doc(slug: string): string {
  const path = join(import.meta.dirname, '..', '..', 'seed', 'documents', `${slug}.md`);
  return readFileSync(path, 'utf8')
    .replace(/^<!--[\s\S]*?-->\n/, '')
    .trim();
}

async function main() {
  const places = readPlaces();
  const missing = missingCoordinates(places);
  if (missing.length) {
    console.error(`Brak współrzędnych dla: ${missing.join(', ')}. Uruchom najpierw: pnpm db:places`);
    process.exit(1);
  }
  const pool = new Pool({ connectionString: databaseUrl() });
  // Wszyscy operatorzy deweloperscy mają to samo hasło; TOTP konfigurują przy pierwszym logowaniu.
  const passwordHash = await hash(requireEnv('SEED_ADMIN_PASSWORD', 'zmien-mnie'));
  try {
    const summary = await seedDatabase(pool, {
      places,
      fleetSize: Number(process.env.SEED_FLEET_SIZE ?? 40),
      sampleRentals: Number(process.env.SEED_SAMPLE_RENTALS ?? 12),
      sampleOperations: true,
      admin: {
        email: requireEnv('SEED_ADMIN_EMAIL', 'admin@hulajnogi.local'),
        name: 'Administrator',
        passwordHash,
      },
      staff: [
        { email: 'dyspozytor@hulajnogi.local', name: 'Marta Wiśniewska', role: 'Dyspozytor', passwordHash },
        { email: 'serwisant@hulajnogi.local', name: 'Tomasz Nowak', role: 'Serwisant', passwordHash },
      ],
      documents: [
        {
          slug: 'regulamin',
          name: 'Regulamin',
          consentType: 'TERMS',
          title: 'Regulamin świadczenia usług',
          bodyMd: doc('regulamin'),
        },
        {
          slug: 'polityka-prywatnosci',
          name: 'Polityka prywatności',
          consentType: 'PRIVACY',
          title: 'Polityka prywatności',
          bodyMd: doc('polityka-prywatnosci'),
        },
        {
          slug: 'zasady-jazdy',
          name: 'Zasady jazdy',
          consentType: null,
          title: 'Zanim ruszysz',
          bodyMd: doc('zasady-jazdy'),
        },
      ],
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
