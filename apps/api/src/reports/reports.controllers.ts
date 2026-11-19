import {
  REPORT_CODES,
  reportDefinitionsReorderSchema,
  reportDefinitionsResource,
  reportDefinitionUpdateSchema,
  reportRunCreateSchema,
  reportRunsResource,
  type ListQuery,
  type ReportDefinitionsReorder,
  type ReportDefinitionUpdate,
  type ReportRunCreate,
} from '@hulajnogi/shared';
import { Body, Controller, Get, HttpCode, Param, Patch, Post, Query } from '@nestjs/common';
import { ApiOperation, ApiQuery, ApiTags } from '@nestjs/swagger';
import { z } from 'zod';
import { CurrentStaff, RequirePermission, StaffAuth, type StaffPrincipal } from '../auth/decorators.js';
import { ListQueryPipe } from '../common/list-query.pipe.js';
import { ZodPipe } from '../common/zod-query.js';
import { ReportDefinitionsService } from './report-definitions.service.js';
import { ReportsService } from './reports.service.js';

const idParam = new ZodPipe(z.uuid());
// Kod spoza katalogu przechodzi do serwisu, który zwraca `404 REPORT_NOT_FOUND` (jak raport bez uprawnienia).
const codeParam = new ZodPipe(z.string().regex(/^[a-z_]{2,40}$/));

/**
 * Raporty (ADR 0071). Uprawnienie `reports.<kod>` zależy od parametru ścieżki, więc punkty deklarują `@StaffAuth()`,
 * a serwis sprawdza uprawnienie raportu (`ensureCanUseReport`) i zwraca `404 REPORT_NOT_FOUND` bez niego.
 */
@ApiTags('panel: raporty')
@Controller('admin/reports')
export class ReportsController {
  constructor(private readonly reports: ReportsService) {}

  @StaffAuth()
  @Get()
  @ApiOperation({
    summary:
      'Katalog: aktywne raporty z uprawnieniem reports.<kod> w kolejności definicji (nazwa i opis z report_definitions, sekcje, parametry, formaty, orientacja, ostatnie uruchomienie), trzy ostatnie eksporty operatora i canManage (reports.manage)',
  })
  catalog(@CurrentStaff() staff: StaffPrincipal) {
    return this.reports.catalog(staff.staffId);
  }

  @StaffAuth()
  @Get(':code/preview')
  @ApiQuery({
    name: 'preset',
    required: false,
    enum: ['today', 'yesterday', 'last_7_days', 'this_month', 'previous_month', 'custom'],
  })
  @ApiQuery({ name: 'from', required: false, description: 'Pierwsza doba okresu RRRR-MM-DD (czas polski)' })
  @ApiQuery({ name: 'to', required: false, description: 'Ostatnia doba okresu RRRR-MM-DD (włącznie)' })
  @ApiQuery({ name: 'granularity', required: false, enum: ['day', 'week', 'month'] })
  @ApiQuery({ name: 'compare', required: false, enum: ['1', '0', 'true', 'false'] })
  @ApiQuery({ name: 'zoneId', required: false })
  @ApiQuery({ name: 'modelId', required: false })
  @ApiQuery({ name: 'scooterId', required: false })
  @ApiOperation({
    summary:
      'Podgląd synchroniczny (migawka REPEATABLE READ, limit 15 s): kafelki z porównaniem, wykresy jako dane, tabele do 200 wierszy z totalRows, dataAsOf i earliestDataAt; REPORT_NOT_FOUND 404, VALIDATION_ERROR i REPORT_RANGE_TOO_LONG, REPORT_RANGE_INVALID, REPORT_RANGE_IN_FUTURE, REPORT_PARAM_NOT_SUPPORTED, REPORT_INVALID_GRANULARITY 400, REPORT_TIMEOUT 504',
  })
  preview(
    @CurrentStaff() staff: StaffPrincipal,
    @Param('code', codeParam) code: string,
    @Query() query: Record<string, unknown>,
  ) {
    return this.reports.preview(staff.staffId, code, query);
  }

  @StaffAuth()
  @Post(':code/runs')
  @HttpCode(202)
  @ApiOperation({
    summary:
      'Eksport PDF albo XLSX (202, zadanie report.generate): wiersz report_runs QUEUED z datami bezwzględnymi; REPORT_FORMAT_NOT_ALLOWED 422, REPORT_EMPTY 409, błędy parametrów jak w podglądzie; wynik w report.ready (pokój staff:{id}) albo GET /admin/report-runs/{id}',
  })
  export(
    @CurrentStaff() staff: StaffPrincipal,
    @Param('code', codeParam) code: string,
    @Body(new ZodPipe(reportRunCreateSchema)) body: ReportRunCreate,
  ) {
    return this.reports.export(staff.staffId, code, body.format, body.params);
  }
}

/** Raporty → Historia: uruchomienia raportów z uprawnieniem operatora, także cudze (pytanie 7). */
@ApiTags('panel: raporty')
@Controller('admin/report-runs')
export class ReportRunsController {
  constructor(private readonly reports: ReportsService) {}

  @StaffAuth()
  @Get()
  @ApiOperation({
    summary: `Historia uruchomień według wzorca listy (raporty: ${REPORT_CODES.join(', ')}; tylko z uprawnieniem reports.<kod>, bez żadnego 403 FORBIDDEN); q szuka identyfikatora ze stopki (8 znaków), nazwy raportu i zlecającego`,
  })
  list(@CurrentStaff() staff: StaffPrincipal, @Query(new ListQueryPipe(reportRunsResource)) query: ListQuery) {
    return this.reports.list(staff.staffId, query);
  }

  @StaffAuth()
  @Get(':id')
  @ApiOperation({
    summary:
      'Stan uruchomienia z adresem pliku (podpis 10 min); zapas dla report.ready, odpytywanie co 2 s; REPORT_RUN_NOT_FOUND 404 także bez uprawnienia raportu',
  })
  details(@CurrentStaff() staff: StaffPrincipal, @Param('id', idParam) id: string) {
    return this.reports.details(staff.staffId, id);
  }

  @StaffAuth()
  @Get(':id/file')
  @ApiOperation({
    summary:
      'Pobranie pliku: adres z podpisem na 10 min (GET /files/{id}?exp&sig); REPORT_RUN_NOT_READY 409, REPORT_FILE_DELETED 410 po 30 dniach, REPORT_RUN_NOT_FOUND 404',
  })
  file(@CurrentStaff() staff: StaffPrincipal, @Param('id', idParam) id: string) {
    return this.reports.file(staff.staffId, id);
  }

  @StaffAuth()
  @Post(':id/retry')
  @HttpCode(202)
  @ApiOperation({
    summary:
      '„Ponów” i „Uruchom ponownie z tymi parametrami”: nowy wiersz z retry_of, ten sam okres bezwzględny i format, dane na teraz; REPORT_RUN_NOT_RETRYABLE 409 dla uruchomienia w toku',
  })
  retry(@CurrentStaff() staff: StaffPrincipal, @Param('id', idParam) id: string) {
    return this.reports.retry(staff.staffId, id);
  }
}

/** Raporty → Definicje (`reports.manage`, tylko Administrator; pytanie 8). */
@ApiTags('panel: raporty')
@Controller('admin/report-definitions')
export class ReportDefinitionsController {
  constructor(private readonly definitions: ReportDefinitionsService) {}

  @RequirePermission('reports.manage')
  @Get()
  @ApiOperation({
    summary: 'Definicje raportów według wzorca listy (nazwa, opis, aktywność, kolejność, ostatnie uruchomienie)',
  })
  list(@Query(new ListQueryPipe(reportDefinitionsResource)) query: ListQuery) {
    return this.definitions.list(query);
  }

  @RequirePermission('reports.manage')
  @Post('reorder')
  @HttpCode(200)
  @ApiOperation({
    summary:
      'Kolejność przeciąganiem: definicje w nowym porządku z wersjami; zwraca wszystkie definicje; CONFLICT 409 przy nieaktualnej wersji',
  })
  reorder(
    @CurrentStaff() staff: StaffPrincipal,
    @Body(new ZodPipe(reportDefinitionsReorderSchema)) body: ReportDefinitionsReorder,
  ) {
    return this.definitions.reorder(staff.staffId, body);
  }

  @RequirePermission('reports.manage')
  @Get(':code')
  @ApiOperation({ summary: 'Definicja z polami z kodu tylko do odczytu (uprawnienie, formaty, parametry, sekcje)' })
  details(@Param('code', codeParam) code: string) {
    return this.definitions.details(code);
  }

  @RequirePermission('reports.manage')
  @Patch(':code')
  @ApiOperation({
    summary:
      'Zmiana nazwy, opisu, aktywności i kolejności z wersją rekordu (blokada optymistyczna, CONFLICT 409); wpis report_definition.updated w dzienniku audytu',
  })
  update(
    @CurrentStaff() staff: StaffPrincipal,
    @Param('code', codeParam) code: string,
    @Body(new ZodPipe(reportDefinitionUpdateSchema)) body: ReportDefinitionUpdate,
  ) {
    return this.definitions.update(staff.staffId, code, body);
  }
}
