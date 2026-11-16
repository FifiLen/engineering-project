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
import { ListQueryPipe } from '../common/list-query.pipe.js';
import { ZodPipe } from '../common/zod-query.js';
import { CommandsService } from './commands.service.js';
import { ScootersService } from './scooters.service.js';

export const idParam = new ZodPipe(z.uuid());
export const versionQuery = new ZodPipe(z.object({ version: z.coerce.number().int().min(1) }));

/** Zasób panelu `scooters` (ADR 0031). Uprawnienia z definicji zasobu są sprawdzane od iteracji 2. */
@ApiTags('panel: flota')
@Controller('admin/scooters')
export class ScootersController {
  constructor(
    private readonly scooters: ScootersService,
    private readonly commands: CommandsService,
  ) {}

  @Get()
  @ApiOperation({ summary: 'Lista floty z filtrami, sortowaniem, stronicowaniem i licznikami (kontrakt list)' })
  list(@Query(new ListQueryPipe(scootersResource)) query: ListQuery) {
    return this.scooters.list(query);
  }

  @Get(':id')
  @ApiOkResponse({ description: 'Szczegóły hulajnogi z wersją rekordu do edycji' })
  details(@Param('id', idParam) id: string) {
    return this.scooters.details(id);
  }

  @Post()
  create(@Body(new ZodPipe(scooterCreateSchema)) body: ScooterCreate) {
    return this.scooters.create(body);
  }

  @Patch(':id')
  @ApiOperation({ summary: 'Edycja z blokadą optymistyczną: konflikt wersji kończy się 409 CONFLICT' })
  update(@Param('id', idParam) id: string, @Body(new ZodPipe(scooterUpdateSchema)) body: ScooterUpdate) {
    return this.scooters.update(id, body);
  }

  @Delete(':id')
  @ApiOperation({ summary: 'Wycofanie hulajnogi z floty (rekord zostaje, bo wskazuje go historia)' })
  remove(@Param('id', idParam) id: string, @Query(versionQuery) { version }: { version: number }) {
    return this.scooters.remove(id, version);
  }

  @Get(':id/commands')
  @ApiOkResponse({ description: 'Ostatnie komendy hulajnogi' })
  recentCommands(@Param('id', idParam) id: string) {
    return this.commands.recent(id);
  }

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
