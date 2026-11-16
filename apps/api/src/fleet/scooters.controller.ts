import {
  commandRequestSchema,
  scooterCreateSchema,
  scootersResource,
  scooterUpdateSchema,
  type ListQuery,
  type ScooterCreate,
  type ScooterUpdate,
} from '@hulajnogi/shared';
import { Body, Controller, Delete, Get, HttpCode, Param, Patch, Post, Query } from '@nestjs/common';
import { ApiOkResponse, ApiOperation, ApiTags } from '@nestjs/swagger';
import { z } from 'zod';
import { RequirePermission } from '../auth/decorators.js';
import { ListQueryPipe } from '../common/list-query.pipe.js';
import { ZodPipe } from '../common/zod-query.js';
import { CommandsService } from './commands.service.js';
import { ScootersService } from './scooters.service.js';

export const idParam = new ZodPipe(z.uuid());
export const versionQuery = new ZodPipe(z.object({ version: z.coerce.number().int().min(1) }));

/** Zasób panelu `scooters` (ADR 0031); uprawnienia jak w definicji zasobu, komendy osobno (ADR 0028). */
@ApiTags('panel: flota')
@Controller('admin/scooters')
export class ScootersController {
  constructor(
    private readonly scooters: ScootersService,
    private readonly commands: CommandsService,
  ) {}

  @RequirePermission('scooters.read')
  @Get()
  @ApiOperation({ summary: 'Lista floty z filtrami, sortowaniem, stronicowaniem i licznikami (kontrakt list)' })
  list(@Query(new ListQueryPipe(scootersResource)) query: ListQuery) {
    return this.scooters.list(query);
  }

  @RequirePermission('scooters.read')
  @Get(':id')
  @ApiOkResponse({ description: 'Szczegóły hulajnogi z wersją rekordu do edycji' })
  details(@Param('id', idParam) id: string) {
    return this.scooters.details(id);
  }

  @RequirePermission('scooters.write')
  @Post()
  create(@Body(new ZodPipe(scooterCreateSchema)) body: ScooterCreate) {
    return this.scooters.create(body);
  }

  @RequirePermission('scooters.write')
  @Patch(':id')
  @ApiOperation({ summary: 'Edycja z blokadą optymistyczną: konflikt wersji kończy się 409 CONFLICT' })
  update(@Param('id', idParam) id: string, @Body(new ZodPipe(scooterUpdateSchema)) body: ScooterUpdate) {
    return this.scooters.update(id, body);
  }

  @RequirePermission('scooters.write')
  @Delete(':id')
  @ApiOperation({ summary: 'Wycofanie hulajnogi z floty (rekord zostaje, bo wskazuje go historia)' })
  remove(@Param('id', idParam) id: string, @Query(versionQuery) { version }: { version: number }) {
    return this.scooters.remove(id, version);
  }

  @RequirePermission('scooters.read')
  @Get(':id/commands')
  @ApiOkResponse({ description: 'Ostatnie komendy hulajnogi' })
  recentCommands(@Param('id', idParam) id: string) {
    return this.commands.recent(id);
  }

  @RequirePermission('scooters.command')
  @Post(':id/commands')
  @HttpCode(202)
  @ApiOperation({ summary: 'Komenda z panelu; wynik przychodzi zdarzeniem fleet.command po potwierdzeniu z hulajnogi' })
  command(
    @Param('id', idParam) id: string,
    @Body(new ZodPipe(commandRequestSchema)) body: z.infer<typeof commandRequestSchema>,
  ) {
    return this.commands.send(id, body.type, body.type === 'LIGHTS' ? { on: body.on ?? true } : undefined);
  }
}
