import { Global, Inject, Module, type OnApplicationShutdown } from '@nestjs/common';
import { createDb, createPool } from '@hulajnogi/db';
import type { Pool } from 'pg';
import { CONFIG, type AppConfig } from '../config.js';

export const DB_POOL = Symbol('DB_POOL');
export const DB = Symbol('DB');

@Global()
@Module({
  providers: [
    { provide: DB_POOL, inject: [CONFIG], useFactory: (config: AppConfig) => createPool(config.DATABASE_URL) },
    { provide: DB, inject: [DB_POOL], useFactory: (pool: Pool) => createDb(pool) },
  ],
  exports: [DB_POOL, DB],
})
export class DatabaseModule implements OnApplicationShutdown {
  constructor(@Inject(DB_POOL) private readonly pool: Pool) {}

  async onApplicationShutdown(): Promise<void> {
    await this.pool.end();
  }
}
