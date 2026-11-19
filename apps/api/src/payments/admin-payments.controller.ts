import {
  newTariffSchema,
  paymentMethodsResource,
  paymentsResource,
  receiptsResource,
  refundsResource,
  tariffsResource,
  walletAdjustmentSchema,
  walletLedgerResource,
  walletsResource,
  webhookEventsResource,
  type ListQuery,
  type NewTariff,
  type WalletAdjustment,
  type ListExportRequest,
} from '@hulajnogi/shared';
import { Body, Controller, Delete, Get, HttpCode, Param, Post, Query, Res } from '@nestjs/common';
import { ApiOkResponse, ApiOperation, ApiTags } from '@nestjs/swagger';
import { z } from 'zod';
import { CurrentStaff, RequirePermission, type StaffPrincipal } from '../auth/decorators.js';
import { ListQueryPipe } from '../common/list-query.pipe.js';
import { ZodPipe } from '../common/zod-query.js';
import { AdminPaymentsService } from './admin-payments.service.js';
import { TariffsService } from './tariffs.service.js';
import type { FastifyReply } from 'fastify';
import { ListExport, listExportBody } from '../common/list-export/list-export.decorators.js';
import { ListExportService } from '../common/list-export/list-export.service.js';

const idParam = new ZodPipe(z.uuid());

/** Płatności w panelu (D5): listy tylko do odczytu, szczegóły płatności i paragonu (makiety `25-panel-platnosci`). */
@ApiTags('panel: płatności')
@Controller('admin')
export class AdminPaymentsController {
  constructor(
    private readonly payments: AdminPaymentsService,
    private readonly exporter: ListExportService,
  ) {}

  @RequirePermission('payments.read')
  @Get('payments')
  @ApiOperation({
    summary:
      'Płatności u operatora (doładowania i przejazdy kartą) według wzorca listy; bez users.read userName i userPhone = null',
  })
  list(@CurrentStaff() staff: StaffPrincipal, @Query(new ListQueryPipe(paymentsResource)) query: ListQuery) {
    return this.payments.listPayments(staff.staffId, query);
  }

  @RequirePermission('payments.read')
  @ListExport('płatności', 'payments/export')
  exportPayments(
    @CurrentStaff() staff: StaffPrincipal,
    @Body(listExportBody) body: ListExportRequest,
    @Res() reply: FastifyReply,
  ): Promise<void> {
    return this.exporter.list(reply, staff.staffId, paymentsResource, body, (db, query) =>
      this.payments.listPayments(staff.staffId, query, db),
    );
  }

  @RequirePermission('payments.read')
  @Get('payments/:id')
  @ApiOkResponse({ description: 'Płatność z webhookami operatora i zwrotami; bez users.read bez danych klienta' })
  payment(@CurrentStaff() staff: StaffPrincipal, @Param('id', idParam) id: string) {
    return this.payments.payment(staff.staffId, id);
  }

  @RequirePermission('payments.read')
  @Get('wallet-ledger')
  @ApiOperation({
    summary: 'Księga portfeli (tylko do dopisywania) z saldem po operacji; bez users.read userName i userPhone = null',
  })
  ledger(@CurrentStaff() staff: StaffPrincipal, @Query(new ListQueryPipe(walletLedgerResource)) query: ListQuery) {
    return this.payments.listLedger(staff.staffId, query);
  }

  @RequirePermission('payments.read')
  @ListExport('księga portfeli', 'wallet-ledger/export')
  exportLedger(
    @CurrentStaff() staff: StaffPrincipal,
    @Body(listExportBody) body: ListExportRequest,
    @Res() reply: FastifyReply,
  ): Promise<void> {
    return this.exporter.list(reply, staff.staffId, walletLedgerResource, body, (db, query) =>
      this.payments.listLedger(staff.staffId, query, db),
    );
  }

  @RequirePermission('payments.read')
  @Get('wallets')
  @ApiOperation({
    summary:
      'Portfele z saldem z pamięci podręcznej porównanym z księgą (`outOfSync`); bez users.read name i phone = null',
  })
  wallets(@CurrentStaff() staff: StaffPrincipal, @Query(new ListQueryPipe(walletsResource)) query: ListQuery) {
    return this.payments.listWallets(staff.staffId, query);
  }

  @RequirePermission('payments.read')
  @ListExport('portfele', 'wallets/export')
  exportWallets(
    @CurrentStaff() staff: StaffPrincipal,
    @Body(listExportBody) body: ListExportRequest,
    @Res() reply: FastifyReply,
  ): Promise<void> {
    return this.exporter.list(reply, staff.staffId, walletsResource, body, (db, query) =>
      this.payments.listWallets(staff.staffId, query, db),
    );
  }

  @RequirePermission('payments.read')
  @Get('receipts')
  @ApiOperation({ summary: 'Paragony i korekty z VAT i netto; bez users.read buyerName i buyerPhone = null' })
  receipts(@CurrentStaff() staff: StaffPrincipal, @Query(new ListQueryPipe(receiptsResource)) query: ListQuery) {
    return this.payments.listReceipts(staff.staffId, query);
  }

  @RequirePermission('payments.read')
  @ListExport('paragony', 'receipts/export')
  exportReceipts(
    @CurrentStaff() staff: StaffPrincipal,
    @Body(listExportBody) body: ListExportRequest,
    @Res() reply: FastifyReply,
  ): Promise<void> {
    return this.exporter.list(reply, staff.staffId, receiptsResource, body, (db, query) =>
      this.payments.listReceipts(staff.staffId, query, db),
    );
  }

  @RequirePermission('payments.read')
  @Get('receipts/:id')
  @ApiOkResponse({
    description: 'Paragon z pozycjami, sprzedawcą, nabywcą i korektami; bez users.read nabywca bez imienia i telefonu',
  })
  receipt(@CurrentStaff() staff: StaffPrincipal, @Param('id', idParam) id: string) {
    return this.payments.receipt(staff.staffId, id);
  }

  @RequirePermission('payments.read')
  @Get('payment-methods')
  @ApiOperation({
    summary: 'Karty klientów (tylko do odczytu, D5) ze stanem ważności; bez users.read userName i userPhone = null',
  })
  methods(@CurrentStaff() staff: StaffPrincipal, @Query(new ListQueryPipe(paymentMethodsResource)) query: ListQuery) {
    return this.payments.listPaymentMethods(staff.staffId, query);
  }

  @RequirePermission('payments.read')
  @ListExport('karty klientów', 'payment-methods/export')
  exportMethods(
    @CurrentStaff() staff: StaffPrincipal,
    @Body(listExportBody) body: ListExportRequest,
    @Res() reply: FastifyReply,
  ): Promise<void> {
    return this.exporter.list(reply, staff.staffId, paymentMethodsResource, body, (db, query) =>
      this.payments.listPaymentMethods(staff.staffId, query, db),
    );
  }

  @RequirePermission('payments.read')
  @Get('payment-webhook-events')
  @ApiOperation({
    summary: 'Webhooki operatora z wynikiem przetworzenia i liczbą dostarczeń; bez users.read userName = null',
  })
  webhooks(@CurrentStaff() staff: StaffPrincipal, @Query(new ListQueryPipe(webhookEventsResource)) query: ListQuery) {
    return this.payments.listWebhooks(staff.staffId, query);
  }

  @RequirePermission('payments.read')
  @ListExport('webhooki operatora', 'payment-webhook-events/export')
  exportWebhooks(
    @CurrentStaff() staff: StaffPrincipal,
    @Body(listExportBody) body: ListExportRequest,
    @Res() reply: FastifyReply,
  ): Promise<void> {
    return this.exporter.list(reply, staff.staffId, webhookEventsResource, body, (db, query) =>
      this.payments.listWebhooks(staff.staffId, query, db),
    );
  }

  @RequirePermission('payments.read')
  @Get('refunds')
  @ApiOperation({
    summary: 'Zwroty za przejazdy i zwroty salda ze stanem u operatora; bez users.read userName i userPhone = null',
  })
  refunds(@CurrentStaff() staff: StaffPrincipal, @Query(new ListQueryPipe(refundsResource)) query: ListQuery) {
    return this.payments.listRefunds(staff.staffId, query);
  }

  @RequirePermission('payments.read')
  @ListExport('zwroty', 'refunds/export')
  exportRefunds(
    @CurrentStaff() staff: StaffPrincipal,
    @Body(listExportBody) body: ListExportRequest,
    @Res() reply: FastifyReply,
  ): Promise<void> {
    return this.exporter.list(reply, staff.staffId, refundsResource, body, (db, query) =>
      this.payments.listRefunds(staff.staffId, query, db),
    );
  }

  @RequirePermission('payments.read')
  @Get('users/:id/wallet')
  @ApiOkResponse({ description: 'Portfel klienta: saldo, zgodność z księgą, zaległości, karty' })
  wallet(@Param('id', idParam) id: string) {
    return this.payments.customerWallet(id);
  }

  @RequirePermission('wallet.adjust')
  @Post('users/:id/wallet/adjustments')
  @ApiOperation({ summary: 'Korekta salda (pytanie 10): kwota ze znakiem, powód, notatka; wpis w dzienniku audytu' })
  adjust(
    @CurrentStaff() staff: StaffPrincipal,
    @Param('id', idParam) id: string,
    @Body(new ZodPipe(walletAdjustmentSchema)) body: WalletAdjustment,
  ) {
    return this.payments.adjustWallet(staff.staffId, id, body);
  }

  @RequirePermission('wallet.adjust')
  @Post('users/:id/wallet/payout')
  @HttpCode(202)
  @ApiOperation({ summary: 'Zwrot salda na kartę z ostatnich doładowań (pytanie 9); reszta do rozliczenia korektą' })
  payout(@CurrentStaff() staff: StaffPrincipal, @Param('id', idParam) id: string) {
    return this.payments.payout(staff.staffId, id);
  }
}

/** Zasób panelu `tariffs`: wersje cennika, nowa wersja zamiast edycji, usunięcie zaplanowanej (ADR 0053). */
@ApiTags('panel: cennik')
@Controller('admin/tariffs')
export class AdminTariffsController {
  constructor(
    private readonly tariffs: TariffsService,
    private readonly exporter: ListExportService,
  ) {}

  @RequirePermission('tariffs.read')
  @Get()
  @ApiOperation({
    summary: 'Wersje cennika ze stanem (obowiązuje, zaplanowana, archiwalna), autorem i liczbą przejazdów',
  })
  list(@Query(new ListQueryPipe(tariffsResource)) query: ListQuery) {
    return this.tariffs.list(query);
  }

  @RequirePermission('tariffs.read')
  @ListExport('cennik')
  export(
    @CurrentStaff() staff: StaffPrincipal,
    @Body(listExportBody) body: ListExportRequest,
    @Res() reply: FastifyReply,
  ): Promise<void> {
    return this.exporter.list(reply, staff.staffId, tariffsResource, body, (db, query) => this.tariffs.list(query, db));
  }

  @RequirePermission('tariffs.read')
  @Get(':id')
  details(@Param('id', idParam) id: string) {
    return this.tariffs.item(id);
  }

  @RequirePermission('tariffs.write')
  @Post()
  @ApiOperation({ summary: 'Nowa wersja od teraz albo od daty; najwyżej jedna zaplanowana (TARIFF_ALREADY_SCHEDULED)' })
  create(@CurrentStaff() staff: StaffPrincipal, @Body(new ZodPipe(newTariffSchema)) body: NewTariff) {
    return this.tariffs.create(staff.staffId, body);
  }

  @RequirePermission('tariffs.write')
  @Delete(':id')
  @HttpCode(204)
  @ApiOperation({ summary: 'Usunięcie zaplanowanej wersji przed jej datą, gdy żaden przejazd jej nie wskazuje' })
  async remove(@CurrentStaff() staff: StaffPrincipal, @Param('id', idParam) id: string): Promise<void> {
    await this.tariffs.remove(staff.staffId, id);
  }
}
