import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { PutObjectCommand, S3Client } from '@aws-sdk/client-s3';
import { hash } from '@node-rs/argon2';
import { Pool } from 'pg';
import { missingCoordinates, readPlaces } from '../places.js';
import { loadSeedMedia, loadStarterTemplates, type SeedFileStorage } from '../seed-assets.js';
import type { SeedContentFiles } from '../seed-content.js';
import { seedDatabase } from '../seed.js';
import { databaseUrl, requireEnv } from './env.js';

/** Treść deweloperska dokumentu z `seed/documents` (bez komentarza HTML z nagłówka pliku). */
function doc(slug: string): string {
  const path = join(import.meta.dirname, '..', '..', 'seed', 'documents', `${slug}.md`);
  return readFileSync(path, 'utf8')
    .replace(/^<!--[\s\S]*?-->\n/, '')
    .trim();
}

/**
 * Grafiki i szablony startowe trafiają do SeaweedFS przez bramę S3 (ADR 0024), tak jak pliki wysyłane do API,
 * więc seed wymaga `pnpm infra:up`. Klucze i adres jak domyślne w konfiguracji API (`infra/seaweedfs/s3.json`).
 * `FILE_STORAGE=memory` pomija grafiki i szablony (treści powstają bez nich).
 */
function contentFiles(): { files: SeedContentFiles; close: () => void } | null {
  if (process.env.FILE_STORAGE === 'memory') return null;
  const bucket = process.env.S3_BUCKET ?? 'hulajnogi';
  const client = new S3Client({
    endpoint: process.env.S3_ENDPOINT ?? 'http://localhost:8333',
    region: process.env.S3_REGION ?? 'us-east-1',
    forcePathStyle: true,
    credentials: {
      accessKeyId: process.env.S3_ACCESS_KEY ?? 'hulajnogi',
      secretAccessKey: process.env.S3_SECRET_KEY ?? 'hulajnogi-dev-secret',
    },
  });
  const storage: SeedFileStorage = {
    async put(key, body, contentType) {
      await client.send(
        new PutObjectCommand({
          Bucket: bucket,
          Key: key,
          Body: body,
          ContentType: contentType,
          ContentLength: body.length,
        }),
      );
    },
  };
  return {
    files: { storage, media: loadSeedMedia(), templates: loadStarterTemplates() },
    close: () => client.destroy(),
  };
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
  const files = contentFiles();
  if (!files) console.log('FILE_STORAGE=memory: dane startowe bez grafik i szablonów wydruków.');
  try {
    const summary = await seedDatabase(pool, {
      places,
      fleetSize: Number(process.env.SEED_FLEET_SIZE ?? 40),
      sampleRentals: Number(process.env.SEED_SAMPLE_RENTALS ?? 12),
      sampleOperations: true,
      contentFiles: files?.files,
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
        // Strona bez ciasteczek i banera; stopka prowadzi do tego dokumentu (ADR 0065, pytanie 11).
        {
          slug: 'polityka-cookies',
          name: 'Polityka cookies',
          consentType: null,
          title: 'Polityka cookies',
          bodyMd: doc('polityka-cookies'),
        },
      ],
    });
    console.log(
      `Dane startowe gotowe: ${summary.zones} stref, ${summary.scootersTotal} hulajnóg (nowych: ${summary.scootersCreated}).`,
    );
  } finally {
    files?.close();
    await pool.end();
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
