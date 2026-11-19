import { drizzle, type NodePgDatabase } from 'drizzle-orm/node-postgres';
import { Pool } from 'pg';
import * as relations from './schema/relations.js';
import * as tables from './schema/schema.js';
import { telemetry } from './schema/telemetry.js';

export const fullSchema = { ...tables, ...relations, telemetry };
export type Database = NodePgDatabase<typeof fullSchema>;
/** Transakcja Drizzle; repozytoria przyjmują ją zamiast bazy, żeby kilka zapisów tworzyło jedną jednostkę pracy. */
export type Transaction = Parameters<Parameters<Database['transaction']>[0]>[0];
export type DbExecutor = Database | Transaction;

/** Czas oczekiwania na wolne połączenie z puli; potem zapytanie kończy się błędem zamiast czekać bez końca. */
export const POOL_CONNECTION_TIMEOUT_MS = 10_000;

/**
 * Pula połączeń. `pg` zgłasza zerwanie bezczynnego połączenia (restart bazy, zamknięcie przez serwer)
 * zdarzeniem `error` puli; bez nasłuchu takie zdarzenie kończy cały proces. `connectionTimeoutMillis` ogranicza
 * czekanie na połączenie przy pełnej puli (domyślnie `pg` czeka w nieskończoność, więc zakleszczenie wisiałoby).
 */
export function createPool(connectionString: string, onIdleError: (error: Error) => void = () => undefined): Pool {
  const pool = new Pool({ connectionString, max: 10, connectionTimeoutMillis: POOL_CONNECTION_TIMEOUT_MS });
  pool.on('error', onIdleError);
  return pool;
}

export function createDb(pool: Pool): Database {
  return drizzle(pool, { schema: fullSchema });
}
