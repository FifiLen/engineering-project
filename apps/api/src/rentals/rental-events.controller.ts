import { type Database, type DbExecutor, DrizzleAdminListsRepository } from '@hulajnogi/db';
import {
  rentalEventsResource,
  type ListExportRequest,
  type ListQuery,
  type ListResponse,
  type RentalEventListItem,
} from '@hulajnogi/shared';
import { Body, Controller, Get, Inject, Query, Res } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import type { FastifyReply } from 'fastify';
import { CurrentStaff, RequirePermission, type StaffPrincipal } from '../auth/decorators.js';
import { StaffPermissionsService } from '../auth/staff-permissions.service.js';
import { ListExport, listExportBody } from '../common/list-export/list-export.decorators.js';
import { ListExportService } from '../common/list-export/list-export.service.js';
import { listWithCustomerData } from '../common/list-masking.js';
import { ListQueryPipe } from '../common/list-query.pipe.js';
import { DB } from '../database/database.module.js';

/**
 * Przejazdy → Zdarzenia (ADR 0076): zdarzenia wszystkich przejazdów z filtrami i sortowaniem, tylko odczyt
 * (`rentals.read`). Bez `users.read` imię klienta jest zamaskowane (`null`), także w eksporcie.
 */
@ApiTags('panel: przejazdy')
@Controller('admin/rental-events')
export class RentalEventsController {
  constructor(
    @Inject(DB) private readonly db: Database,
    private readonly permissions: StaffPermissionsService,
    private readonly exporter: ListExportService,
  ) {}

  private async list(staffId: string, query: ListQuery, db: DbExecutor = this.db) {
    const { permissions } = await this.permissions.get(staffId);
    return listWithCustomerData<RentalEventListItem, typeof rentalEventsResource>(
      rentalEventsResource,
      query,
      permissions.has('users.read'),
      (q, def) => new DrizzleAdminListsRepository(db).rentalEvents(q, def),
    );
  }

  @RequirePermission('rentals.read')
  @Get()
  @ApiOperation({
    summary:
      'Zdarzenia przejazdów (typ, przejazd, hulajnoga, strefa) według wzorca listy; bez users.read userName = null',
  })
  events(
    @CurrentStaff() staff: StaffPrincipal,
    @Query(new ListQueryPipe(rentalEventsResource)) query: ListQuery,
  ): Promise<ListResponse<RentalEventListItem>> {
    return this.list(staff.staffId, query);
  }

  @RequirePermission('rentals.read')
  @ListExport('zdarzenia przejazdów')
  export(
    @CurrentStaff() staff: StaffPrincipal,
    @Body(listExportBody) body: ListExportRequest,
    @Res() reply: FastifyReply,
  ): Promise<void> {
    return this.exporter.list(reply, staff.staffId, rentalEventsResource, body, (db, query) =>
      this.list(staff.staffId, query, db),
    );
  }
}
