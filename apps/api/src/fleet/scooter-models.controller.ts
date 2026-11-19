import {
  scooterModelCreateSchema,
  scooterModelsResource,
  scooterModelUpdateSchema,
  type ListQuery,
  type ScooterModelCreate,
  type ScooterModelUpdate,
  type ListExportRequest,
} from '@hulajnogi/shared';
import { Body, Controller, Delete, Get, Param, Patch, Post, Query, Res } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { CurrentStaff, RequirePermission, type StaffPrincipal } from '../auth/decorators.js';
import { EntityHistory } from '../audit/entity-history.service.js';
import { ListQueryPipe } from '../common/list-query.pipe.js';
import { ZodPipe } from '../common/zod-query.js';
import { ScooterModelsService } from './scooter-models.service.js';
import { idParam, versionQuery } from './scooters.controller.js';
import type { FastifyReply } from 'fastify';
import { ListExport, listExportBody } from '../common/list-export/list-export.decorators.js';
import { ListExportService } from '../common/list-export/list-export.service.js';

/** Zasób panelu `scooter-models` (słownik, ADR 0031). */
@ApiTags('panel: flota')
@Controller('admin/scooter-models')
export class ScooterModelsController {
  constructor(
    private readonly models: ScooterModelsService,
    private readonly history: EntityHistory,
    private readonly exporter: ListExportService,
  ) {}

  @RequirePermission('scooters.read')
  @Get()
  @ApiOperation({ summary: 'Lista modeli z liczbą hulajnóg (kontrakt list)' })
  list(@Query(new ListQueryPipe(scooterModelsResource)) query: ListQuery) {
    return this.models.list(query);
  }

  @RequirePermission('scooters.read')
  @ListExport('modele hulajnóg')
  export(
    @CurrentStaff() staff: StaffPrincipal,
    @Body(listExportBody) body: ListExportRequest,
    @Res() reply: FastifyReply,
  ): Promise<void> {
    return this.exporter.list(reply, staff.staffId, scooterModelsResource, body, (db, query) =>
      this.models.list(query, db),
    );
  }

  @RequirePermission('scooters.read')
  @Get(':id')
  details(@Param('id', idParam) id: string) {
    return this.models.details(id);
  }

  @RequirePermission('scooters.read')
  @Get(':id/history')
  historyOf(@Param('id', idParam) id: string) {
    return this.history.of('scooter_model', id);
  }

  @RequirePermission('scooters.write')
  @Post()
  create(@CurrentStaff() staff: StaffPrincipal, @Body(new ZodPipe(scooterModelCreateSchema)) body: ScooterModelCreate) {
    return this.models.create(staff.staffId, body);
  }

  @RequirePermission('scooters.write')
  @Patch(':id')
  update(
    @CurrentStaff() staff: StaffPrincipal,
    @Param('id', idParam) id: string,
    @Body(new ZodPipe(scooterModelUpdateSchema)) body: ScooterModelUpdate,
  ) {
    return this.models.update(staff.staffId, id, body);
  }

  @RequirePermission('scooters.write')
  @Delete(':id')
  @ApiOperation({ summary: 'Usunięcie modelu bez hulajnóg albo archiwizacja modelu, który ma hulajnogi' })
  remove(
    @CurrentStaff() staff: StaffPrincipal,
    @Param('id', idParam) id: string,
    @Query(versionQuery) { version }: { version: number },
  ) {
    return this.models.remove(staff.staffId, id, version);
  }
}
