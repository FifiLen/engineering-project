import { Controller, Get, Inject } from '@nestjs/common';
import { ApiOkResponse, ApiTags } from '@nestjs/swagger';
import { checkDatabaseHealth, type Database } from '@hulajnogi/db';
import { DB } from '../database/database.module.js';

@ApiTags('system')
@Controller('health')
export class HealthController {
  constructor(@Inject(DB) private readonly db: Database) {}

  @Get()
  @ApiOkResponse({ description: 'Stan backendu i bazy danych' })
  async check() {
    const { postgis } = await checkDatabaseHealth(this.db);
    return { status: 'ok', database: 'ok', postgis, time: new Date().toISOString() };
  }
}
