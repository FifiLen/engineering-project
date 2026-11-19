import { type Database, DrizzleAdminListsRepository } from '@hulajnogi/db';
import { zoneControlResource, zonePresenceResource, type ListExportRequest, type ListQuery } from '@hulajnogi/shared';
import { Body, Controller, Get, Inject, Query, Res } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import type { FastifyReply } from 'fastify';
import { CurrentStaff, RequirePermission, type StaffPrincipal } from '../auth/decorators.js';
import { ListExport, listExportBody } from '../common/list-export/list-export.decorators.js';
import { ListExportService } from '../common/list-export/list-export.service.js';
import { ListQueryPipe } from '../common/list-query.pipe.js';
import { DB } from '../database/database.module.js';

/**
 * Strefy → Obecność i komendy stref (ADR 0076): bieżące strefy hulajnóg w przejazdach i stan sterowania strefami,
 * tabele techniczne tylko do odczytu (`zones.read`), bez danych klienta.
 */
@ApiTags('panel: strefy')
@Controller('admin')
export class ZoneListsController {
  constructor(
    @Inject(DB) private readonly db: Database,
    private readonly exporter: ListExportService,
  ) {}

  @RequirePermission('zones.read')
  @Get('zone-presence')
  @ApiOperation({ summary: 'Obecność hulajnóg w strefach w trakcie przejazdu (od kiedy, odczyty poza strefą)' })
  presence(@Query(new ListQueryPipe(zonePresenceResource)) query: ListQuery) {
    return new DrizzleAdminListsRepository(this.db).zonePresence(query);
  }

  @RequirePermission('zones.read')
  @ListExport('obecność w strefach', 'zone-presence/export')
  exportPresence(
    @CurrentStaff() staff: StaffPrincipal,
    @Body(listExportBody) body: ListExportRequest,
    @Res() reply: FastifyReply,
  ): Promise<void> {
    return this.exporter.list(reply, staff.staffId, zonePresenceResource, body, (db, query) =>
      new DrizzleAdminListsRepository(db).zonePresence(query),
    );
  }

  @RequirePermission('zones.read')
  @Get('zone-control')
  @ApiOperation({ summary: 'Sterowanie strefami hulajnóg w przejeździe (limit, zatrzymanie, wynik ostatnich komend)' })
  control(@Query(new ListQueryPipe(zoneControlResource)) query: ListQuery) {
    return new DrizzleAdminListsRepository(this.db).zoneControl(query);
  }

  @RequirePermission('zones.read')
  @ListExport('komendy stref', 'zone-control/export')
  exportControl(
    @CurrentStaff() staff: StaffPrincipal,
    @Body(listExportBody) body: ListExportRequest,
    @Res() reply: FastifyReply,
  ): Promise<void> {
    return this.exporter.list(reply, staff.staffId, zoneControlResource, body, (db, query) =>
      new DrizzleAdminListsRepository(db).zoneControl(query),
    );
  }
}
