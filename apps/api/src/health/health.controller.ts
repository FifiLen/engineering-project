import { Controller, Get, Inject } from '@nestjs/common';
import { ApiOkResponse, ApiTags } from '@nestjs/swagger';
import type { Pool } from 'pg';
import { DB_POOL } from '../database/database.module.js';

@ApiTags('system')
@Controller('health')
export class HealthController {
  constructor(@Inject(DB_POOL) private readonly pool: Pool) {}

  @Get()
  @ApiOkResponse({ description: 'Stan backendu i bazy danych' })
  async check() {
    const { rows } = await this.pool.query<{ postgis: string }>('SELECT postgis_lib_version() AS postgis');
    return { status: 'ok', database: 'ok', postgis: rows[0]?.postgis, time: new Date().toISOString() };
  }
}
