import { dataExportsResource, type ListQuery, type ListExportRequest } from '@hulajnogi/shared';
import { Body, Controller, Get, HttpCode, Post, Query, Res } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import {
  CurrentCustomer,
  CustomerAuth,
  RequirePermission,
  type CustomerPrincipal,
  CurrentStaff,
  type StaffPrincipal,
} from '../auth/decorators.js';
import { ListQueryPipe } from '../common/list-query.pipe.js';
import { DataExportService } from './data-export.service.js';
import type { FastifyReply } from 'fastify';
import { ListExport, listExportBody } from '../common/list-export/list-export.decorators.js';
import { ListExportService } from '../common/list-export/list-export.service.js';

/** „Pobierz moje dane” w ustawieniach aplikacji (ADR 0069). */
@ApiTags('aplikacja: dane klienta')
@Controller('me/data-exports')
export class CustomerDataExportController {
  constructor(private readonly exports: DataExportService) {}

  @CustomerAuth()
  @Post()
  @HttpCode(202)
  @ApiOperation({
    summary:
      'Zlecenie eksportu danych (202, zadanie data-export.generate): najwyżej raz na 24 h, nieudane się nie liczą; 429 DATA_EXPORT_LIMIT z details.nextAllowedAt, 409 DATA_EXPORT_IN_PROGRESS; wynik w data-export.ready (pokój user:{id})',
  })
  request(@CurrentCustomer() customer: CustomerPrincipal) {
    return this.exports.request(customer.userId);
  }

  @CustomerAuth()
  @Get('latest')
  @ApiOperation({
    summary:
      'Ostatnie zlecenie (stan, rozmiar, expiresAt) i nextAllowedAt; gotowy i ważny plik ma adres z podpisem na 10 min (dane-RRRR-MM-DD.json)',
  })
  latest(@CurrentCustomer() customer: CustomerPrincipal) {
    return this.exports.latest(customer.userId);
  }
}

/** Zasób `data-exports` (tylko do odczytu, `users.read`): zlecenia klientów bez pobierania pliku. */
@ApiTags('panel: użytkownicy')
@Controller('admin/data-exports')
export class AdminDataExportsController {
  constructor(
    private readonly exports: DataExportService,
    private readonly exporter: ListExportService,
  ) {}

  @RequirePermission('users.read')
  @Get()
  @ApiOperation({ summary: 'Zlecenia eksportu danych klientów według wzorca listy (stan, daty, rozmiar)' })
  list(@Query(new ListQueryPipe(dataExportsResource)) query: ListQuery) {
    return this.exports.list(query);
  }

  @RequirePermission('users.read')
  @ListExport('eksporty danych klientów')
  export(
    @CurrentStaff() staff: StaffPrincipal,
    @Body(listExportBody) body: ListExportRequest,
    @Res() reply: FastifyReply,
  ): Promise<void> {
    return this.exporter.list(reply, staff.staffId, dataExportsResource, body, (db, query) =>
      this.exports.list(query, db),
    );
  }
}
