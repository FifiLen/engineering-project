import {
  customerTicketCreateSchema,
  staffTicketCreateSchema,
  ticketAssignSchema,
  ticketPhotoAddSchema,
  ticketsResource,
  ticketStatusChangeSchema,
  type CustomerTicketCreate,
  type ListQuery,
  type StaffTicketCreate,
  type TicketAssign,
  type TicketPhotoAdd,
  type TicketStatusChange,
  type ListExportRequest,
} from '@hulajnogi/shared';
import { Body, Controller, Delete, Get, Param, Post, Query, Res } from '@nestjs/common';
import { ApiOkResponse, ApiOperation, ApiTags } from '@nestjs/swagger';
import { z } from 'zod';
import {
  CurrentCustomer,
  CurrentStaff,
  CustomerAuth,
  RequirePermission,
  type CustomerPrincipal,
  type StaffPrincipal,
} from '../auth/decorators.js';
import { ListQueryPipe } from '../common/list-query.pipe.js';
import { ZodPipe } from '../common/zod-query.js';
import { TicketsService } from './tickets.service.js';
import type { FastifyReply } from 'fastify';
import { ListExport, listExportBody } from '../common/list-export/list-export.decorators.js';
import { ListExportService } from '../common/list-export/list-export.service.js';

const idParam = new ZodPipe(z.uuid());

/** Aplikacja klienta: zgłoszenie usterki i „Moje zgłoszenia” (ADR 0055, makiety `26-mobile-operacje`). */
@ApiTags('aplikacja: zgłoszenia')
@CustomerAuth()
@Controller()
export class CustomerTicketsController {
  constructor(private readonly tickets: TicketsService) {}

  @Post('tickets')
  @ApiOperation({
    summary:
      'Zgłoszenie z przejazdu (w trakcie jazdy przejazd się nie kończy), z karty hulajnogi albo z profilu; zdjęcia z POST /files (TICKET_PHOTO), pilna kategoria wyłącza wolną hulajnogę z ruchu',
  })
  create(
    @CurrentCustomer() customer: CustomerPrincipal,
    @Body(new ZodPipe(customerTicketCreateSchema)) body: CustomerTicketCreate,
  ) {
    return this.tickets.createForCustomer(customer.userId, body);
  }

  @Get('me/tickets')
  @ApiOperation({ summary: 'Moje zgłoszenia od najnowszego z oznaczeniem nieprzeczytanej odpowiedzi' })
  list(@CurrentCustomer() customer: CustomerPrincipal) {
    return this.tickets.customerList(customer.userId);
  }

  @Get('me/tickets/:id')
  @ApiOperation({
    summary: 'Zgłoszenie ze statusami i odpowiedzią (bez nazwisk); otwarcie oznacza odpowiedź jako przeczytaną',
  })
  details(@CurrentCustomer() customer: CustomerPrincipal, @Param('id', idParam) id: string) {
    return this.tickets.customerTicket(customer.userId, id);
  }
}

/** Zasób panelu `tickets` (ADR 0031, ADR 0055): lista, szczegóły z osią czasu i polecenia z dziennikiem audytu. */
@ApiTags('panel: zgłoszenia')
@Controller('admin/tickets')
export class AdminTicketsController {
  constructor(
    private readonly tickets: TicketsService,
    private readonly exporter: ListExportService,
  ) {}

  @RequirePermission('tickets.read')
  @Get()
  @ApiOperation({
    summary: 'Zgłoszenia według wzorca listy; bez users.read bez imienia i telefonu klienta (reporterName = null)',
  })
  list(@CurrentStaff() staff: StaffPrincipal, @Query(new ListQueryPipe(ticketsResource)) query: ListQuery) {
    return this.tickets.list(staff.staffId, query);
  }

  @RequirePermission('tickets.read')
  @ListExport('zgłoszenia')
  export(
    @CurrentStaff() staff: StaffPrincipal,
    @Body(listExportBody) body: ListExportRequest,
    @Res() reply: FastifyReply,
  ): Promise<void> {
    return this.exporter.list(reply, staff.staffId, ticketsResource, body, (db, query) =>
      this.tickets.list(staff.staffId, query, db),
    );
  }

  @RequirePermission('tickets.read')
  @Get(':id')
  @ApiOkResponse({ description: 'Zgłoszenie ze zdjęciami, zadaniami i osią czasu z dziennika audytu (D6)' })
  details(@CurrentStaff() staff: StaffPrincipal, @Param('id', idParam) id: string) {
    return this.tickets.details(staff.staffId, id);
  }

  @RequirePermission('tickets.manage')
  @Post()
  @ApiOperation({ summary: 'Zgłoszenie operatora (STAFF) z karty hulajnogi albo przejazdu' })
  create(@CurrentStaff() staff: StaffPrincipal, @Body(new ZodPipe(staffTicketCreateSchema)) body: StaffTicketCreate) {
    return this.tickets.createByStaff(staff.staffId, body);
  }

  @RequirePermission('tickets.manage')
  @Post(':id/assign')
  @ApiOperation({ summary: 'Przypisanie (null zdejmuje) z blokadą optymistyczną' })
  assign(
    @CurrentStaff() staff: StaffPrincipal,
    @Param('id', idParam) id: string,
    @Body(new ZodPipe(ticketAssignSchema)) body: TicketAssign,
  ) {
    return this.tickets.assign(staff.staffId, id, body);
  }

  @RequirePermission('tickets.manage')
  @Post(':id/status')
  @ApiOperation({
    summary:
      'Zmiana statusu (NEW, IN_PROGRESS, RESOLVED) i odpowiedź dla klienta (D7); RESOLVED zgłoszenia klienta wymaga odpowiedzi',
  })
  status(
    @CurrentStaff() staff: StaffPrincipal,
    @Param('id', idParam) id: string,
    @Body(new ZodPipe(ticketStatusChangeSchema)) body: TicketStatusChange,
  ) {
    return this.tickets.changeStatus(staff.staffId, id, body);
  }

  @RequirePermission('tickets.manage')
  @Post(':id/photos')
  @ApiOperation({ summary: 'Zdjęcie operatora (POST /files, TICKET_PHOTO), najwyżej 3 na zgłoszenie' })
  addPhoto(
    @CurrentStaff() staff: StaffPrincipal,
    @Param('id', idParam) id: string,
    @Body(new ZodPipe(ticketPhotoAddSchema)) body: TicketPhotoAdd,
  ) {
    return this.tickets.addPhoto(staff.staffId, id, body.fileId);
  }

  @RequirePermission('tickets.manage')
  @Delete(':id/photos/:fileId')
  @ApiOperation({ summary: 'Usunięcie zdjęcia ze zgłoszenia (plik usuwa potem files.cleanup)' })
  removePhoto(
    @CurrentStaff() staff: StaffPrincipal,
    @Param('id', idParam) id: string,
    @Param('fileId', idParam) fileId: string,
  ) {
    return this.tickets.removePhoto(staff.staffId, id, fileId);
  }
}
