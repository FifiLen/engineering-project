import { createHash } from 'node:crypto';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { Pool } from 'pg';

/** Katalog z migracjami SQL (ADR 0021). */
export const migrationsDir = join(import.meta.dirname, '..', 'migrations');

const LOCK_ID = 727_001;

export interface MigrationResult {
  applied: string[];
  skipped: string[];
}

/**
 * Wykonuje brakujące migracje SQL w kolejności nazw plików, każdą w osobnej transakcji.
 * Blokada doradcza chroni przed równoległym uruchomieniem. Zmiana treści już wykonanej
 * migracji jest błędem: poprawki zawsze trafiają do nowego pliku.
 */
export async function runMigrations(pool: Pool, dir = migrationsDir): Promise<MigrationResult> {
  const client = await pool.connect();
  const result: MigrationResult = { applied: [], skipped: [] };
  try {
    await client.query('SELECT pg_advisory_lock($1)', [LOCK_ID]);
    await client.query(`
      CREATE TABLE IF NOT EXISTS schema_migrations (
        version    text PRIMARY KEY,
        checksum   text NOT NULL,
        applied_at timestamptz NOT NULL DEFAULT now()
      )`);
    const { rows } = await client.query<{ version: string; checksum: string }>(
      'SELECT version, checksum FROM schema_migrations',
    );
    const done = new Map(rows.map((r) => [r.version, r.checksum]));
    const files = readdirSync(dir)
      .filter((f) => f.endsWith('.sql'))
      .sort();

    for (const file of files) {
      const sql = readFileSync(join(dir, file), 'utf8');
      const checksum = createHash('sha256').update(sql).digest('hex');
      const known = done.get(file);
      if (known) {
        if (known !== checksum) {
          throw new Error(`Migracja ${file} została zmieniona po wykonaniu. Dodaj nową migrację zamiast edytować starą.`);
        }
        result.skipped.push(file);
        continue;
      }
      await client.query('BEGIN');
      try {
        await client.query(sql);
        await client.query('INSERT INTO schema_migrations (version, checksum) VALUES ($1, $2)', [file, checksum]);
        await client.query('COMMIT');
        result.applied.push(file);
      } catch (error) {
        await client.query('ROLLBACK');
        throw new Error(`Migracja ${file} nie powiodła się: ${(error as Error).message}`, { cause: error });
      }
    }
    return result;
  } finally {
    await client.query('SELECT pg_advisory_unlock($1)', [LOCK_ID]).catch(() => undefined);
    client.release();
  }
}
