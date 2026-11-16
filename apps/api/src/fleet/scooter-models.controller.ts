import {
  scooterModelCreateSchema,
  scooterModelsResource,
  scooterModelUpdateSchema,
  type ListQuery,
  type ScooterModelCreate,
  type ScooterModelUpdate,
} from '@hulajnogi/shared';
import { Body, Controller, Delete, Get, Param, Patch, Post, Query } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { RequirePermission } from '../auth/decorators.js';
import { ListQueryPipe } from '../common/list-query.pipe.js';
import { ZodPipe } from '../common/zod-query.js';
import { ScooterModelsService } from './scooter-models.service.js';
import { idParam, versionQuery } from './scooters.controller.js';

/** Zasób panelu `scooter-models` (słownik, ADR 0031). */
@ApiTags('panel: flota')
@Controller('admin/scooter-models')
export class ScooterModelsController {
  constructor(private readonly models: ScooterModelsService) {}

  @RequirePermission('scooters.read')
  @Get()
  @ApiOperation({ summary: 'Lista modeli z liczbą hulajnóg (kontrakt list)' })
  list(@Query(new ListQueryPipe(scooterModelsResource)) query: ListQuery) {
    return this.models.list(query);
  }

  @RequirePermission('scooters.read')
  @Get(':id')
  details(@Param('id', idParam) id: string) {
    return this.models.details(id);
  }

  @RequirePermission('scooters.write')
  @Post()
  create(@Body(new ZodPipe(scooterModelCreateSchema)) body: ScooterModelCreate) {
    return this.models.create(body);
  }

  @RequirePermission('scooters.write')
  @Patch(':id')
  update(@Param('id', idParam) id: string, @Body(new ZodPipe(scooterModelUpdateSchema)) body: ScooterModelUpdate) {
    return this.models.update(id, body);
  }

  @RequirePermission('scooters.write')
  @Delete(':id')
  @ApiOperation({ summary: 'Usunięcie modelu bez hulajnóg albo archiwizacja modelu, który ma hulajnogi' })
  remove(@Param('id', idParam) id: string, @Query(versionQuery) { version }: { version: number }) {
    return this.models.remove(id, version);
  }
}
