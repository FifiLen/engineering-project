import {
  partAdjustmentSchema,
  partReceiptSchema,
  scooterRetireSchema,
  scooterReturnSchema,
  serviceTaskAssignSchema,
  serviceTaskCancelSchema,
  serviceTaskCompleteSchema,
  serviceTaskCreateSchema,
  serviceTasksResource,
  serviceTaskStartSchema,
  sparePartCreateSchema,
  sparePartMovementsResource,
  sparePartsResource,
  sparePartUpdateSchema,
  taskPartAddSchema,
  taskPartRemoveSchema,
  type ListQuery,
  type PartAdjustment,
  type PartReceipt,
  type ScooterRetire,
  type ScooterReturn,
  type ServiceTaskAssign,
  type ServiceTaskCancel,
  type ServiceTaskComplete,
  type ServiceTaskCreate,
  type ServiceTaskStart,
  type SparePartCreate,
  type SparePartUpdate,
  type TaskPartAdd,
  type TaskPartRemove,
  type ListExportRequest,
} from '@hulajnogi/shared';
import { Body, Controller, Delete, Get, Param, Patch, Post, Query, Res } from '@nestjs/common';
import { ApiOkResponse, ApiOperation, ApiTags } from '@nestjs/swagger';
import { z } from 'zod';
import { EntityHistory } from '../audit/entity-history.service.js';
import { CurrentStaff, RequirePermission, type StaffPrincipal } from '../auth/decorators.js';
import { ListQueryPipe } from '../common/list-query.pipe.js';
import { ZodPipe } from '../common/zod-query.js';
import { DashboardService } from './dashboard.service.js';
import { ServiceTasksService } from './service-tasks.service.js';
import { SparePartsService } from './spare-parts.service.js';
import type { FastifyReply } from 'fastify';
import { ListExport, listExportBody } from '../common/list-export/list-export.decorators.js';
import { ListExportService } from '../common/list-export/list-export.service.js';

const idParam = new ZodPipe(z.uuid());
const versionQuery = new ZodPipe(z.object({ version: z.coerce.number().int().min(1) }));

/** Zasób panelu `service-tasks` (ADR 0055): lista, „moje”, szczegóły z częściami i przejścia z dziennikiem audytu. */
@ApiTags('panel: serwis')
@Controller('admin/service-tasks')
export class ServiceTasksController {
  constructor(
    private readonly tasks: ServiceTasksService,
    private readonly history: EntityHistory,
    private readonly exporter: ListExportService,
  ) {}

  @RequirePermission('service.read')
  @Get()
  @ApiOperation({ summary: 'Zadania serwisowe według wzorca listy (koszt części, termin, cel przewiezienia)' })
  list(@Query(new ListQueryPipe(serviceTasksResource)) query: ListQuery) {
    return this.tasks.list(query);
  }

  @RequirePermission('service.read')
  @ListExport('zadania serwisowe')
  export(
    @CurrentStaff() staff: StaffPrincipal,
    @Body(listExportBody) body: ListExportRequest,
    @Res() reply: FastifyReply,
  ): Promise<void> {
    return this.exporter.list(reply, staff.staffId, serviceTasksResource, body, (db, query) =>
      this.tasks.list(query, db),
    );
  }

  @RequirePermission('service.read')
  @Get('mine')
  @ApiOperation({ summary: 'Moje zadania: lista z wykonawcą ustawionym na zalogowanego operatora' })
  mine(@CurrentStaff() staff: StaffPrincipal, @Query(new ListQueryPipe(serviceTasksResource)) query: ListQuery) {
    return this.tasks.mine(staff.staffId, query);
  }

  @RequirePermission('service.read')
  @Get(':id')
  @ApiOkResponse({ description: 'Zadanie z częściami, zgłoszeniem i skutkiem dla hulajnogi (returnCheck)' })
  details(@Param('id', idParam) id: string) {
    return this.tasks.details(id);
  }

  @RequirePermission('service.read')
  @Get(':id/history')
  @ApiOkResponse({ description: 'Historia zadania z dziennika audytu, od najnowszej' })
  historyOf(@Param('id', idParam) id: string) {
    return this.history.of('service_task', id, 50);
  }

  @RequirePermission('service.manage')
  @Post()
  @ApiOperation({
    summary:
      'Utworzenie ze zgłoszenia (ticketId, zgłoszenie przechodzi do AT_SERVICE) albo z karty hulajnogi („Wyślij do serwisu”); wolna hulajnoga od razu do MAINTENANCE',
  })
  create(@CurrentStaff() staff: StaffPrincipal, @Body(new ZodPipe(serviceTaskCreateSchema)) body: ServiceTaskCreate) {
    return this.tasks.create(staff.staffId, body);
  }

  @RequirePermission('service.manage')
  @Post(':id/assign')
  assign(
    @CurrentStaff() staff: StaffPrincipal,
    @Param('id', idParam) id: string,
    @Body(new ZodPipe(serviceTaskAssignSchema)) body: ServiceTaskAssign,
  ) {
    return this.tasks.assign(staff.staffId, id, body);
  }

  @RequirePermission('service.manage')
  @Post(':id/start')
  @ApiOperation({ summary: 'Rozpoczęcie (OPEN → IN_PROGRESS); nieprzypisane zadanie dostaje operatora' })
  start(
    @CurrentStaff() staff: StaffPrincipal,
    @Param('id', idParam) id: string,
    @Body(new ZodPipe(serviceTaskStartSchema)) body: ServiceTaskStart,
  ) {
    return this.tasks.start(staff.staffId, id, body);
  }

  @RequirePermission('service.manage')
  @Post(':id/parts')
  @ApiOperation({ summary: 'Część z magazynu w zadaniu w toku: stan maleje od razu (422 PART_OUT_OF_STOCK)' })
  addPart(
    @CurrentStaff() staff: StaffPrincipal,
    @Param('id', idParam) id: string,
    @Body(new ZodPipe(taskPartAddSchema)) body: TaskPartAdd,
  ) {
    return this.tasks.addPart(staff.staffId, id, body);
  }

  @RequirePermission('service.manage')
  @Post(':id/parts/remove')
  @ApiOperation({ summary: 'Zwrot części do magazynu z zadania w toku (bez ilości cała pozycja)' })
  removePart(
    @CurrentStaff() staff: StaffPrincipal,
    @Param('id', idParam) id: string,
    @Body(new ZodPipe(taskPartRemoveSchema)) body: TaskPartRemove,
  ) {
    return this.tasks.removePart(staff.staffId, id, body);
  }

  @RequirePermission('service.manage')
  @Post(':id/complete')
  @ApiOperation({
    summary:
      'Zakończenie z notatką: zgłoszenie RESOLVED po ostatnim zadaniu, hulajnoga bez przeszkód wraca do floty, BATTERY_SWAP wysyła battery_swapped',
  })
  complete(
    @CurrentStaff() staff: StaffPrincipal,
    @Param('id', idParam) id: string,
    @Body(new ZodPipe(serviceTaskCompleteSchema)) body: ServiceTaskComplete,
  ) {
    return this.tasks.complete(staff.staffId, id, body);
  }

  @RequirePermission('service.manage')
  @Post(':id/cancel')
  @ApiOperation({ summary: 'Anulowanie z powodem; części wracają do magazynu' })
  cancel(
    @CurrentStaff() staff: StaffPrincipal,
    @Param('id', idParam) id: string,
    @Body(new ZodPipe(serviceTaskCancelSchema)) body: ServiceTaskCancel,
  ) {
    return this.tasks.cancel(staff.staffId, id, body);
  }
}

/** Karta hulajnogi: zakładka „Serwis”, „Przywróć do floty” i „Wyłącz z ruchu” (ADR 0055). */
@ApiTags('panel: serwis')
@Controller('admin/scooters')
export class ScooterServiceController {
  constructor(private readonly tasks: ServiceTasksService) {}

  @RequirePermission('service.read')
  @Get(':id/service')
  @ApiOkResponse({ description: 'Reguła powrotu do floty, dostępne rodzaje zadań, ostatnie zadania i koszt części' })
  summary(@Param('id', idParam) id: string) {
    return this.tasks.scooterSummary(id);
  }

  @RequirePermission('service.manage')
  @Post(':id/return-to-fleet')
  @ApiOperation({
    summary: 'Przywróć do floty: bez otwartych zadań, online, bateria ≥ próg (409 RETURN_TO_FLEET_BLOCKED)',
  })
  returnToFleet(
    @CurrentStaff() staff: StaffPrincipal,
    @Param('id', idParam) id: string,
    @Body(new ZodPipe(scooterReturnSchema)) body: ScooterReturn,
  ) {
    return this.tasks.returnToFleet(staff.staffId, id, body);
  }

  @RequirePermission('scooters.write')
  @Post(':id/retire')
  @ApiOperation({ summary: 'Wyłącz z ruchu (RETIRED) z powodem; niedostępne w przejeździe i przy otwartych zadaniach' })
  retire(
    @CurrentStaff() staff: StaffPrincipal,
    @Param('id', idParam) id: string,
    @Body(new ZodPipe(scooterRetireSchema)) body: ScooterRetire,
  ) {
    return this.tasks.retire(staff.staffId, id, body);
  }
}

/** Zasoby panelu `spare-parts` i `spare-part-movements`: słownik części, przyjęcie dostawy i korekta stanu. */
@ApiTags('panel: magazyn')
@Controller('admin')
export class SparePartsController {
  constructor(
    private readonly parts: SparePartsService,
    private readonly history: EntityHistory,
    private readonly exporter: ListExportService,
  ) {}

  @RequirePermission('service.read')
  @Get('spare-parts')
  @ApiOperation({ summary: 'Części ze stanem względem minimum i zużyciem z 30 dni' })
  list(@Query(new ListQueryPipe(sparePartsResource)) query: ListQuery) {
    return this.parts.list(query);
  }

  @RequirePermission('service.read')
  @ListExport('części zamienne', 'spare-parts/export')
  exportParts(
    @CurrentStaff() staff: StaffPrincipal,
    @Body(listExportBody) body: ListExportRequest,
    @Res() reply: FastifyReply,
  ): Promise<void> {
    return this.exporter.list(reply, staff.staffId, sparePartsResource, body, (db, query) =>
      this.parts.list(query, db),
    );
  }

  @RequirePermission('service.read')
  @Get('spare-parts/:id')
  @ApiOkResponse({ description: 'Część z ostatnimi ruchami magazynowymi' })
  details(@Param('id', idParam) id: string) {
    return this.parts.details(id);
  }

  @RequirePermission('service.read')
  @Get('spare-parts/:id/history')
  @ApiOkResponse({ description: 'Historia zmian części z dziennika audytu' })
  historyOf(@Param('id', idParam) id: string) {
    return this.history.of('spare_part', id);
  }

  @RequirePermission('service.manage')
  @Post('spare-parts')
  @ApiOperation({ summary: 'Nowa część; stan początkowy jako przyjęcie dostawy (ruch RECEIPT)' })
  create(@CurrentStaff() staff: StaffPrincipal, @Body(new ZodPipe(sparePartCreateSchema)) body: SparePartCreate) {
    return this.parts.create(staff.staffId, body);
  }

  @RequirePermission('service.manage')
  @Patch('spare-parts/:id')
  @ApiOperation({ summary: 'Edycja słownika z blokadą optymistyczną (stan tylko przyjęciem albo korektą)' })
  update(
    @CurrentStaff() staff: StaffPrincipal,
    @Param('id', idParam) id: string,
    @Body(new ZodPipe(sparePartUpdateSchema)) body: SparePartUpdate,
  ) {
    return this.parts.update(staff.staffId, id, body);
  }

  @RequirePermission('service.manage')
  @Delete('spare-parts/:id')
  @ApiOperation({ summary: 'Usunięcie części bez historii albo archiwizacja części z ruchami' })
  remove(
    @CurrentStaff() staff: StaffPrincipal,
    @Param('id', idParam) id: string,
    @Query(versionQuery) { version }: { version: number },
  ) {
    return this.parts.remove(staff.staffId, id, version);
  }

  @RequirePermission('service.manage')
  @Post('spare-parts/:id/receipts')
  @ApiOperation({ summary: 'Przyjęcie dostawy: stan rośnie, opcjonalna nowa cena dla kolejnych użyć' })
  receive(
    @CurrentStaff() staff: StaffPrincipal,
    @Param('id', idParam) id: string,
    @Body(new ZodPipe(partReceiptSchema)) body: PartReceipt,
  ) {
    return this.parts.receive(staff.staffId, id, body);
  }

  @RequirePermission('service.manage')
  @Post('spare-parts/:id/adjustments')
  @ApiOperation({ summary: 'Korekta stanu: nowy stan bezwzględny z powodem (OTHER z notatką)' })
  adjust(
    @CurrentStaff() staff: StaffPrincipal,
    @Param('id', idParam) id: string,
    @Body(new ZodPipe(partAdjustmentSchema)) body: PartAdjustment,
  ) {
    return this.parts.adjust(staff.staffId, id, body);
  }

  @RequirePermission('service.read')
  @Get('spare-part-movements')
  @ApiOperation({ summary: 'Ruchy magazynowe (przyjęcie, korekta, użycie, zwrot) tylko do odczytu' })
  movements(@Query(new ListQueryPipe(sparePartMovementsResource)) query: ListQuery) {
    return this.parts.movements(query);
  }

  @RequirePermission('service.read')
  @ListExport('ruchy magazynowe', 'spare-part-movements/export')
  exportMovements(
    @CurrentStaff() staff: StaffPrincipal,
    @Body(listExportBody) body: ListExportRequest,
    @Res() reply: FastifyReply,
  ): Promise<void> {
    return this.exporter.list(reply, staff.staffId, sparePartMovementsResource, body, (db, query) =>
      this.parts.movements(query, db),
    );
  }
}

/** Pulpit „Wymaga uwagi” (D1). */
@ApiTags('panel: pulpit')
@Controller('admin/dashboard')
export class DashboardController {
  constructor(private readonly dashboard: DashboardService) {}

  @RequirePermission('dashboard.read')
  @Get('attention')
  @ApiOperation({
    summary:
      'Grupy „Wymaga uwagi” z liczbami i do 4 pozycji; grupa tylko z uprawnieniem listy docelowej (rentals.read, scooters.read, tickets.read, payments.read)',
  })
  attention(@CurrentStaff() staff: StaffPrincipal) {
    return this.dashboard.attention(staff.staffId);
  }
}
