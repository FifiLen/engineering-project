import {
  parseListQuery,
  scooterCommandsResource,
  scooterStatusHistoryResource,
  scooterStatusTimeQuerySchema,
  telemetryReadingsQuerySchema,
  type ListExportRequest,
  type ListQuery,
  type ScooterStatusTimeQuery,
  type TelemetryReadingsQuery,
} from '@hulajnogi/shared';
import { Body, Controller, Get, HttpStatus, Param, Query, Res, type PipeTransform } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import type { FastifyReply } from 'fastify';
import { z } from 'zod';
import { CurrentStaff, RequirePermission, type StaffPrincipal } from '../auth/decorators.js';
import { ApiError } from '../common/api-error.js';
import { ListExport, listExportBody } from '../common/list-export/list-export.decorators.js';
import { ListExportService } from '../common/list-export/list-export.service.js';
import { ListQueryPipe } from '../common/list-query.pipe.js';
import { ZodPipe } from '../common/zod-query.js';
import { TELEMETRY_KEEP_DAYS } from '../jobs/jobs.module.js';
import { FleetListsService } from './fleet-lists.service.js';
import { idParam } from './scooters.controller.js';

type RawQuery = Record<string, string | string[] | undefined>;

/** Parametry bez podanych kluczy (okres historii i kursor telemetrii są poza kontraktem list). */
const without = <T extends Record<string, unknown>>(params: T, keys: readonly string[]) =>
  Object.fromEntries(Object.entries(params).filter(([key]) => !keys.includes(key))) as T;

/** Okres zakładki „Historia stanów” w adresie (`from`, `to`): przedziały nachodzące na okres, także otwarte (ADR 0074). */
const overlapSchema = z
  .object({ from: z.iso.datetime({ offset: true }).optional(), to: z.iso.datetime({ offset: true }).optional() })
  .refine((o) => (o.from === undefined) === (o.to === undefined), { path: ['to'], message: 'Podaj oba końce okresu' })
  .refine((o) => !o.from || !o.to || Date.parse(o.to) > Date.parse(o.from), { path: ['to'], message: 'Pusty okres' });

interface StatusHistoryParams {
  query: ListQuery;
  overlap?: { from: Date; to: Date };
}

/** Parametry listy historii stanów: `from` i `to` wyznaczają okres, reszta to kontrakt list (ADR 0031). */
function statusHistoryParams(raw: RawQuery): StatusHistoryParams {
  const { from, to, ...rest } = raw;
  const period = overlapSchema.safeParse({ from, to });
  if (!period.success) {
    throw new ApiError(HttpStatus.BAD_REQUEST, 'VALIDATION_ERROR', 'Nieprawidłowy okres', period.error.issues);
  }
  const parsed = parseListQuery(scooterStatusHistoryResource, rest as Record<string, string | string[]>);
  if (!parsed.ok) {
    throw new ApiError(HttpStatus.BAD_REQUEST, 'VALIDATION_ERROR', 'Nieprawidłowe parametry listy', parsed.issues);
  }
  const overlap =
    period.data.from && period.data.to ? { from: new Date(period.data.from), to: new Date(period.data.to) } : undefined;
  return { query: parsed.query, overlap };
}

class StatusHistoryQueryPipe implements PipeTransform<RawQuery, StatusHistoryParams> {
  transform(value: RawQuery): StatusHistoryParams {
    return statusHistoryParams(value);
  }
}

/**
 * Zakres telemetrii w oknie retencji (ADR 0076): starsze partycje usuwa `telemetry.purge`, więc zakres sprzed
 * `TELEMETRY_KEEP_DAYS` dni to błąd pola zamiast pustej listy.
 */
function ensureWithinRetention(query: TelemetryReadingsQuery): TelemetryReadingsQuery {
  if (Date.parse(query.from) < Date.now() - TELEMETRY_KEEP_DAYS * 86_400_000) {
    throw new ApiError(HttpStatus.BAD_REQUEST, 'VALIDATION_ERROR', 'Zakres poza oknem retencji telemetrii', [
      { path: ['from'], message: `Najwyżej ${TELEMETRY_KEEP_DAYS} dni wstecz` },
    ]);
  }
  return query;
}

class TelemetryQueryPipe implements PipeTransform<unknown, TelemetryReadingsQuery> {
  transform(value: unknown): TelemetryReadingsQuery {
    const result = telemetryReadingsQuerySchema.safeParse(value);
    if (!result.success) {
      throw new ApiError(
        HttpStatus.BAD_REQUEST,
        'VALIDATION_ERROR',
        'Nieprawidłowe parametry żądania',
        result.error.issues,
      );
    }
    return ensureWithinRetention(result.data);
  }
}

/** Flota → Komendy (ADR 0076): lista `scooters.read` (wysyłka z karty hulajnogi zostaje przy `scooters.command`). */
@ApiTags('panel: flota')
@Controller('admin/scooter-commands')
export class ScooterCommandsController {
  constructor(
    private readonly lists: FleetListsService,
    private readonly exporter: ListExportService,
  ) {}

  @RequirePermission('scooters.read')
  @Get()
  @ApiOperation({
    summary: 'Komendy hulajnóg (źródło, strefa, operator, przejazd, czas odpowiedzi) według wzorca listy',
  })
  list(@Query(new ListQueryPipe(scooterCommandsResource)) query: ListQuery) {
    return this.lists.commands(query);
  }

  @RequirePermission('scooters.read')
  @ListExport('komendy hulajnóg')
  export(
    @CurrentStaff() staff: StaffPrincipal,
    @Body(listExportBody) body: ListExportRequest,
    @Res() reply: FastifyReply,
  ): Promise<void> {
    return this.exporter.list(reply, staff.staffId, scooterCommandsResource, body, (db, query) =>
      this.lists.commands(query, db),
    );
  }
}

/** Historia stanów hulajnóg (ADR 0074): lista przedziałów z filtrami i okresem (`from`, `to`), `scooters.read`. */
@ApiTags('panel: flota')
@Controller('admin/scooter-status-history')
export class ScooterStatusHistoryController {
  constructor(
    private readonly lists: FleetListsService,
    private readonly exporter: ListExportService,
  ) {}

  @RequirePermission('scooters.read')
  @Get()
  @ApiOperation({
    summary:
      'Przedziały stanu i łączności z przyczyną według wzorca listy; opcjonalny okres from/to wybiera przedziały nachodzące na niego (także otwarte)',
  })
  list(@Query(new StatusHistoryQueryPipe()) params: StatusHistoryParams) {
    return this.lists.statusHistory(params.query, params.overlap);
  }

  @RequirePermission('scooters.read')
  @ListExport('historia stanów hulajnóg')
  export(
    @CurrentStaff() staff: StaffPrincipal,
    @Body(listExportBody) body: ListExportRequest,
    @Res() reply: FastifyReply,
  ): Promise<void> {
    // Okres zakładki jest poza definicją zasobu: wyjęty z zapytania, a reszta idzie przez ten sam mechanizm co lista.
    const { overlap } = statusHistoryParams(body.query);
    const query = without(body.query, ['from', 'to']);
    return this.exporter.list(reply, staff.staffId, scooterStatusHistoryResource, { ...body, query }, (db, q) =>
      this.lists.statusHistory(q, overlap, db),
    );
  }
}

/** Karta hulajnogi → Historia stanów: udziały czasu i wskaźniki za okres (ADR 0074), `scooters.read`. */
@ApiTags('panel: flota')
@Controller('admin/scooters')
export class ScooterStatusTimeController {
  constructor(private readonly lists: FleetListsService) {}

  @RequirePermission('scooters.read')
  @Get(':id/status-time')
  @ApiOperation({
    summary:
      'Przedziały przycięte do okresu (do 92 dni), sekundy w kategoriach czasu, wykorzystanie, dostępność i udziały (definicje z core)',
  })
  statusTime(
    @Param('id', idParam) id: string,
    @Query(new ZodPipe(scooterStatusTimeQuerySchema)) query: ScooterStatusTimeQuery,
  ) {
    return this.lists.statusTime(id, query);
  }
}

/**
 * Flota → Telemetria (ADR 0076): wyjątek od kontraktu list (kursor bez liczby wszystkich); hulajnoga i zakres do 24 h
 * wymagane, `telemetry.read`. Eksport zakresu tym samym mechanizmem co listy z limitem 17 280 odczytów.
 */
@ApiTags('panel: flota')
@Controller('admin/telemetry')
export class TelemetryAdminController {
  constructor(private readonly lists: FleetListsService) {}

  @RequirePermission('telemetry.read')
  @Get()
  @ApiOperation({
    summary:
      'Odczyty hulajnogi w zakresie (najwyżej 24 h, w oknie retencji 90 dni) od najnowszych, kursor older/newer, filtry baterii i przejazdu, bez total',
  })
  list(@Query(new TelemetryQueryPipe()) query: TelemetryReadingsQuery) {
    return this.lists.telemetry(query);
  }

  @RequirePermission('telemetry.read')
  @ListExport('telemetria hulajnogi w zakresie')
  export(
    @CurrentStaff() staff: StaffPrincipal,
    @Body(listExportBody) body: ListExportRequest,
    @Res() reply: FastifyReply,
  ): Promise<void> {
    const query = new TelemetryQueryPipe().transform(without(body.query, ['cursor', 'direction', 'pageSize']));
    return this.lists.export(reply, staff.staffId, query, body);
  }
}
