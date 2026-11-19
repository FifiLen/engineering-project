import { dataExportsResource, type ListQuery } from '@hulajnogi/shared';
import { Controller, Get, HttpCode, Post, Query } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { CurrentCustomer, CustomerAuth, RequirePermission, type CustomerPrincipal } from '../auth/decorators.js';
import { ListQueryPipe } from '../common/list-query.pipe.js';
import { DataExportService } from './data-export.service.js';

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
  constructor(private readonly exports: DataExportService) {}

  @RequirePermission('users.read')
  @Get()
  @ApiOperation({ summary: 'Zlecenia eksportu danych klientów według wzorca listy (stan, daty, rozmiar)' })
  list(@Query(new ListQueryPipe(dataExportsResource)) query: ListQuery) {
    return this.exports.list(query);
  }
}
