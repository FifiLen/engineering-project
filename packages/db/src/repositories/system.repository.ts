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
