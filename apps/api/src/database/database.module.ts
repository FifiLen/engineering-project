import { Global, Inject, Module, type OnApplicationShutdown } from '@nestjs/common';
import { createDb, createPool } from '@hulajnogi/db';
import { CONFIG, type AppConfig } from '../config.js';

type Pool = ReturnType<typeof createPool>;

const DB_POOL = Symbol('DB_POOL');
/** Baza Drizzle z packages/db; jedyna droga do danych w API (ADR 0025). */
export const DB = Symbol('DB');

@Global()
@Module({
  providers: [
    { provide: DB_POOL, inject: [CONFIG], useFactory: (config: AppConfig) => createPool(config.DATABASE_URL) },
    { provide: DB, inject: [DB_POOL], useFactory: (pool: Pool) => createDb(pool) },
  ],
  exports: [DB],
})
export class DatabaseModule implements OnApplicationShutdown {
  constructor(@Inject(DB_POOL) private readonly pool: Pool) {}

  async onApplicationShutdown(): Promise<void> {
    await this.pool.end();
  }
}
