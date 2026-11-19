import { Controller, Get, Inject } from '@nestjs/common';
import { ApiOkResponse, ApiTags } from '@nestjs/swagger';
import { checkDatabaseHealth, type Database } from '@hulajnogi/db';
import { DB } from '../database/database.module.js';
import { Public } from '../auth/decorators.js';
import { DOCUMENT_RENDERER, type DocumentEngine } from '../documents/renderers.js';

@ApiTags('system')
@Public()
@Controller('health')
export class HealthController {
  constructor(
    @Inject(DB) private readonly db: Database,
    @Inject(DOCUMENT_RENDERER) private readonly renderer: DocumentEngine,
  ) {}

  @Get()
  @ApiOkResponse({
    description:
      'Stan backendu i bazy danych; `documents` to stan silnika dokumentów (nie zmienia stanu API, ADR 0066)',
  })
  async check() {
    const [{ postgis }, documents] = await Promise.all([checkDatabaseHealth(this.db), this.renderer.health()]);
    return { status: 'ok', database: 'ok', postgis, documents, time: new Date().toISOString() };
  }
}
