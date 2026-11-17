import {
  remoteEndSchema,
  rentalRefundSchema,
  rentalsResource,
  type ListQuery,
  type RemoteEnd,
  type RentalRefund,
} from '@hulajnogi/shared';
import { Body, Controller, Get, Param, Post, Query } from '@nestjs/common';
import { ApiOkResponse, ApiOperation, ApiTags } from '@nestjs/swagger';
import { z } from 'zod';
import { CurrentStaff, RequirePermission, type StaffPrincipal } from '../auth/decorators.js';
import { ListQueryPipe } from '../common/list-query.pipe.js';
import { ZodPipe } from '../common/zod-query.js';
import { AdminRentalsService } from './admin-rentals.service.js';

const idParam = new ZodPipe(z.uuid());

/** Zasób panelu `rentals`: tylko do odczytu i zdalne zakończenie (macierz operacji w modelu danych). */
@ApiTags('panel: przejazdy')
@Controller('admin/rentals')
export class AdminRentalsController {
  constructor(private readonly rentals: AdminRentalsService) {}

  @RequirePermission('rentals.read')
  @Get()
  @ApiOperation({ summary: 'Lista przejazdów z filtrami, sortowaniem, stronicowaniem i licznikami (kontrakt list)' })
  list(@Query(new ListQueryPipe(rentalsResource)) query: ListQuery) {
    return this.rentals.list(query);
  }

  @RequirePermission('rentals.read')
  @Get(':id')
  @ApiOkResponse({ description: 'Szczegóły przejazdu: liczniki, kwota, oś czasu z komendami, trasa' })
  details(@Param('id', idParam) id: string) {
    return this.rentals.details(id);
  }

  @RequirePermission('rentals.manage')
  @Post(':id/end')
  @ApiOperation({
    summary: 'Zdalne zakończenie (D7): niezależnie od strefy, z powodem, komendą lock i wpisem w dzienniku audytu',
  })
  end(
    @CurrentStaff() staff: StaffPrincipal,
    @Param('id', idParam) id: string,
    @Body(new ZodPipe(remoteEndSchema)) body: RemoteEnd,
  ) {
    return this.rentals.remoteEnd(staff.staffId, id, body);
  }

  @RequirePermission('rentals.manage')
  @Post(':id/refund')
  @ApiOperation({
    summary:
      'Zwrot za przejazd według źródła płatności (pytanie 11): portfel od razu, karta u operatora; suma zwrotów nie większa niż zapłata',
  })
  refund(
    @CurrentStaff() staff: StaffPrincipal,
    @Param('id', idParam) id: string,
    @Body(new ZodPipe(rentalRefundSchema)) body: RentalRefund,
  ) {
    return this.rentals.refund(staff.staffId, id, body);
  }
}
