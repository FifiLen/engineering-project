import { type Database, type DbExecutor, DrizzleAdminListsRepository } from '@hulajnogi/db';
import {
  paymentCustomersResource,
  type ListExportRequest,
  type ListQuery,
  type ListResponse,
  type PaymentCustomerListItem,
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
 * Płatności → Klienci operatora (ADR 0076): identyfikator klienta u operatora płatności, liczba kart i ostatnia
 * płatność, tylko odczyt (`payments.read`). Bez `users.read` imię klienta jest zamaskowane, także w eksporcie.
 */
@ApiTags('panel: płatności')
@Controller('admin/payment-customers')
export class PaymentCustomersController {
  constructor(
    @Inject(DB) private readonly db: Database,
    private readonly permissions: StaffPermissionsService,
    private readonly exporter: ListExportService,
  ) {}

  private async list(staffId: string, query: ListQuery, db: DbExecutor = this.db) {
    const { permissions } = await this.permissions.get(staffId);
    return listWithCustomerData<PaymentCustomerListItem, typeof paymentCustomersResource>(
      paymentCustomersResource,
      query,
      permissions.has('users.read'),
      (q, def) => new DrizzleAdminListsRepository(db).paymentCustomers(q, def),
    );
  }

  @RequirePermission('payments.read')
  @Get()
  @ApiOperation({ summary: 'Klienci u operatora płatności według wzorca listy; bez users.read userName = null' })
  customers(
    @CurrentStaff() staff: StaffPrincipal,
    @Query(new ListQueryPipe(paymentCustomersResource)) query: ListQuery,
  ): Promise<ListResponse<PaymentCustomerListItem>> {
    return this.list(staff.staffId, query);
  }

  @RequirePermission('payments.read')
  @ListExport('klienci operatora płatności')
  export(
    @CurrentStaff() staff: StaffPrincipal,
    @Body(listExportBody) body: ListExportRequest,
    @Res() reply: FastifyReply,
  ): Promise<void> {
    return this.exporter.list(reply, staff.staffId, paymentCustomersResource, body, (db, query) =>
      this.list(staff.staffId, query, db),
    );
  }
}
