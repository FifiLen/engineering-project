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
} from '@hulajnogi/shared';
import { Body, Controller, Delete, Get, HttpCode, Param, Post, Query } from '@nestjs/common';
import { ApiOkResponse, ApiOperation, ApiTags } from '@nestjs/swagger';
import { z } from 'zod';
import { CurrentStaff, RequirePermission, type StaffPrincipal } from '../auth/decorators.js';
import { ListQueryPipe } from '../common/list-query.pipe.js';
import { ZodPipe } from '../common/zod-query.js';
import { AdminPaymentsService } from './admin-payments.service.js';
import { TariffsService } from './tariffs.service.js';

const idParam = new ZodPipe(z.uuid());

/** Płatności w panelu (D5): listy tylko do odczytu, szczegóły płatności i paragonu (makiety `25-panel-platnosci`). */
@ApiTags('panel: płatności')
@Controller('admin')
export class AdminPaymentsController {
  constructor(private readonly payments: AdminPaymentsService) {}

  @RequirePermission('payments.read')
  @Get('payments')
  @ApiOperation({ summary: 'Płatności u operatora (doładowania i przejazdy kartą) według wzorca listy' })
  list(@Query(new ListQueryPipe(paymentsResource)) query: ListQuery) {
    return this.payments.listPayments(query);
  }

  @RequirePermission('payments.read')
  @Get('payments/:id')
  @ApiOkResponse({ description: 'Płatność z webhookami operatora i zwrotami' })
  payment(@Param('id', idParam) id: string) {
    return this.payments.payment(id);
  }

  @RequirePermission('payments.read')
  @Get('wallet-ledger')
  @ApiOperation({ summary: 'Księga portfeli (tylko do dopisywania) z saldem po operacji' })
  ledger(@Query(new ListQueryPipe(walletLedgerResource)) query: ListQuery) {
    return this.payments.listLedger(query);
  }

  @RequirePermission('payments.read')
  @Get('wallets')
  @ApiOperation({ summary: 'Portfele z saldem z pamięci podręcznej porównanym z księgą (`outOfSync`)' })
  wallets(@Query(new ListQueryPipe(walletsResource)) query: ListQuery) {
    return this.payments.listWallets(query);
  }

  @RequirePermission('payments.read')
  @Get('receipts')
  @ApiOperation({ summary: 'Paragony i korekty z VAT i netto' })
  receipts(@Query(new ListQueryPipe(receiptsResource)) query: ListQuery) {
    return this.payments.listReceipts(query);
  }

  @RequirePermission('payments.read')
  @Get('receipts/:id')
  @ApiOkResponse({ description: 'Paragon z pozycjami, sprzedawcą, nabywcą i korektami' })
  receipt(@Param('id', idParam) id: string) {
    return this.payments.receipt(id);
  }

  @RequirePermission('payments.read')
  @Get('payment-methods')
  @ApiOperation({ summary: 'Karty klientów (tylko do odczytu, D5) ze stanem ważności' })
  methods(@Query(new ListQueryPipe(paymentMethodsResource)) query: ListQuery) {
    return this.payments.listPaymentMethods(query);
  }

  @RequirePermission('payments.read')
  @Get('payment-webhook-events')
  @ApiOperation({ summary: 'Webhooki operatora z wynikiem przetworzenia i liczbą dostarczeń' })
  webhooks(@Query(new ListQueryPipe(webhookEventsResource)) query: ListQuery) {
    return this.payments.listWebhooks(query);
  }

  @RequirePermission('payments.read')
  @Get('refunds')
  @ApiOperation({ summary: 'Zwroty za przejazdy i zwroty salda ze stanem u operatora' })
  refunds(@Query(new ListQueryPipe(refundsResource)) query: ListQuery) {
    return this.payments.listRefunds(query);
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
  constructor(private readonly tariffs: TariffsService) {}

  @RequirePermission('tariffs.read')
  @Get()
  @ApiOperation({
    summary: 'Wersje cennika ze stanem (obowiązuje, zaplanowana, archiwalna), autorem i liczbą przejazdów',
  })
  list(@Query(new ListQueryPipe(tariffsResource)) query: ListQuery) {
    return this.tariffs.list(query);
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
