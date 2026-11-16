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

export function createPool(connectionString: string): Pool {
  return new Pool({ connectionString, max: 10 });
}

export function createDb(pool: Pool): Database {
  return drizzle(pool, { schema: fullSchema });
}
