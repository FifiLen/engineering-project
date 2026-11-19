import {
  zoneImpactSchema,
  zoneInputSchema,
  zonesResource,
  zoneUpdateSchema,
  type ListQuery,
  type ZoneImpactRequest,
  type ZoneInput,
  type ZoneUpdate,
  type ListExportRequest,
} from '@hulajnogi/shared';
import { Body, Controller, Delete, Get, HttpCode, Param, Patch, Post, Query, Res } from '@nestjs/common';
import { ApiOkResponse, ApiOperation, ApiTags } from '@nestjs/swagger';
import { z } from 'zod';
import { CurrentStaff, RequirePermission, type StaffPrincipal } from '../auth/decorators.js';
import { ListQueryPipe } from '../common/list-query.pipe.js';
import { ZodPipe } from '../common/zod-query.js';
import { AdminZonesService } from './admin-zones.service.js';
import type { FastifyReply } from 'fastify';
import { ListExport, listExportBody } from '../common/list-export/list-export.decorators.js';
import { ListExportService } from '../common/list-export/list-export.service.js';

const idParam = new ZodPipe(z.uuid());
const versionBody = new ZodPipe(z.object({ version: z.number().int().min(1) }));

/** Zasób panelu `zones`: edytor stref z mapą (ADR 0047, makiety `23-panel-strefy`). */
@ApiTags('panel: strefy')
@Controller('admin/zones')
export class AdminZonesController {
  constructor(
    private readonly zones: AdminZonesService,
    private readonly exporter: ListExportService,
  ) {}

  @RequirePermission('zones.read')
  @Get()
  @ApiOperation({ summary: 'Lista stref z filtrami typu i aktywności, wyszukiwaniem, sortowaniem i licznikami' })
  list(@Query(new ListQueryPipe(zonesResource)) query: ListQuery) {
    return this.zones.list(query);
  }

  @RequirePermission('zones.read')
  @ListExport('strefy')
  export(
    @CurrentStaff() staff: StaffPrincipal,
    @Body(listExportBody) body: ListExportRequest,
    @Res() reply: FastifyReply,
  ): Promise<void> {
    return this.exporter.list(reply, staff.staffId, zonesResource, body, (db, query) => this.zones.list(query, db));
  }

  @RequirePermission('zones.read')
  @Get(':id')
  @ApiOkResponse({ description: 'Strefa z geometrią, wielokątem do edycji i przejazdami w trakcie w strefie' })
  details(@Param('id', idParam) id: string) {
    return this.zones.details(id);
  }

  @RequirePermission('zones.write')
  @Post()
  @ApiOperation({ summary: 'Nowa strefa; geometria w obszarze działania, parkowanie bez nakładania (422)' })
  create(@CurrentStaff() staff: StaffPrincipal, @Body(new ZodPipe(zoneInputSchema)) body: ZoneInput) {
    return this.zones.create(staff.staffId, body);
  }

  @RequirePermission('zones.read')
  @Post('impact')
  @HttpCode(200)
  @ApiOperation({ summary: 'Przejazdy w trakcie w proponowanej geometrii nowej strefy (ostrzeżenie przed zapisem)' })
  impactNew(@Body(new ZodPipe(zoneImpactSchema)) body: ZoneImpactRequest) {
    return this.zones.impact(null, body.polygon);
  }

  @RequirePermission('zones.read')
  @Post(':id/impact')
  @HttpCode(200)
  @ApiOperation({ summary: 'Przejazdy w trakcie w obecnej i proponowanej geometrii strefy (pytanie 7)' })
  impact(@Param('id', idParam) id: string, @Body(new ZodPipe(zoneImpactSchema)) body: ZoneImpactRequest) {
    return this.zones.impact(id, body.polygon);
  }

  @RequirePermission('zones.write')
  @Patch(':id')
  @ApiOperation({ summary: 'Zmiana strefy z wersją rekordu (409 CONFLICT); typ jest niezmienny (ADR 0047)' })
  update(
    @CurrentStaff() staff: StaffPrincipal,
    @Param('id', idParam) id: string,
    @Body(new ZodPipe(zoneUpdateSchema)) body: ZoneUpdate,
  ) {
    return this.zones.update(staff.staffId, id, body);
  }

  @RequirePermission('zones.write')
  @Post(':id/deactivate')
  @HttpCode(200)
  @ApiOperation({ summary: 'Dezaktywacja: strefa znika z aplikacji, zakończone przejazdy ją zachowują' })
  deactivate(
    @CurrentStaff() staff: StaffPrincipal,
    @Param('id', idParam) id: string,
    @Body(versionBody) body: { version: number },
  ) {
    return this.zones.setActive(staff.staffId, id, body.version, false);
  }

  @RequirePermission('zones.write')
  @Post(':id/restore')
  @HttpCode(200)
  @ApiOperation({ summary: 'Przywrócenie nieaktywnej strefy (te same reguły geometrii co przy zapisie)' })
  restore(
    @CurrentStaff() staff: StaffPrincipal,
    @Param('id', idParam) id: string,
    @Body(versionBody) body: { version: number },
  ) {
    return this.zones.setActive(staff.staffId, id, body.version, true);
  }

  @RequirePermission('zones.write')
  @Delete(':id')
  @HttpCode(204)
  @ApiOperation({ summary: 'Usunięcie nieużytej strefy; użyta w przejazdach kończy się 409 ZONE_IN_USE' })
  async remove(
    @CurrentStaff() staff: StaffPrincipal,
    @Param('id', idParam) id: string,
    @Query(new ZodPipe(z.object({ version: z.coerce.number().int().min(1) }))) query: { version: number },
  ): Promise<void> {
    await this.zones.remove(staff.staffId, id, query.version);
  }
}
