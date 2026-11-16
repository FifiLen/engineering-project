import { sql } from 'drizzle-orm';
import type { DbExecutor } from '../client.js';

export interface DatabaseHealth {
  postgis: string;
}

/** Stan bazy dla punktu /health: połączenie i wersja PostGIS. */
export async function checkDatabaseHealth(db: DbExecutor): Promise<DatabaseHealth> {
  const { rows } = await db.execute<{ postgis: string }>(sql`SELECT postgis_lib_version() AS postgis`);
  return { postgis: rows[0]!.postgis };
}

/** Minimalny wiek klienta z obowiązującej wersji cennika (tekst zgody przy rejestracji). */
export async function currentMinUserAge(db: DbExecutor): Promise<number | null> {
  const { rows } = await db.execute<{ age: number }>(
    sql`SELECT min_user_age AS age FROM tariffs WHERE valid_from <= now() ORDER BY valid_from DESC, version DESC LIMIT 1`,
  );
  return rows[0]?.age ?? null;
}
