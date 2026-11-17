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

const callCount = async (db: DbExecutor, query: ReturnType<typeof sql>, column: string): Promise<number> =>
  Number((await db.execute<Record<string, number>>(query)).rows[0]![column]);

/** Retencja telemetrii (zadanie `telemetry.purge`, ADR 0037): usunięte partycje dzienne. */
export function purgeTelemetry(db: DbExecutor, keepDays: number): Promise<number> {
  return callCount(db, sql`CALL sp_purge_telemetry(${keepDays}, NULL)`, 'dropped_count');
}

/** Czyszczenie kodów SMS, sesji i zaproszeń (zadanie `auth.purge`, ADR 0037). */
export async function purgeExpiredAuth(
  db: DbExecutor,
  keepDays: number,
): Promise<{ otpCodes: number; sessions: number }> {
  return {
    otpCodes: await callCount(db, sql`CALL sp_purge_expired_otp(NULL)`, 'deleted_count'),
    sessions: await callCount(db, sql`CALL sp_purge_expired_sessions(${keepDays}, NULL)`, 'deleted_count'),
  };
}
