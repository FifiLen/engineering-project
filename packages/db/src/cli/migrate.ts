import { Pool } from 'pg';
import { runMigrations } from '../migrator.js';
import { databaseUrl } from './env.js';

async function main() {
  const pool = new Pool({ connectionString: databaseUrl() });
  try {
    const { applied, skipped } = await runMigrations(pool);
    console.log(`Wykonane migracje: ${applied.length ? applied.join(', ') : 'brak'}; pominięte: ${skipped.length}`);
  } finally {
    await pool.end();
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
