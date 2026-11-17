import { DomainError } from '@hulajnogi/core';
import {
  fakeAuthenticateSchema,
  fakePaymentConfirmSchema,
  fakeSetupConfirmSchema,
  payDebtSchema,
  receiptsQuerySchema,
  topupSchema,
  walletHistoryQuerySchema,
  type FakeAuthenticate,
  type FakePaymentConfirm,
  type FakeSetupConfirm,
  type PayDebtRequest,
  type TopupRequest,
  type WalletHistoryQuery,
} from '@hulajnogi/shared';
import {
  Body,
  Controller,
  Delete,
  Get,
  Headers,
  HttpCode,
  Inject,
  Param,
  Post,
  Query,
  Req,
  Res,
  type RawBodyRequest,
} from '@nestjs/common';
import { ApiOkResponse, ApiOperation, ApiTags } from '@nestjs/swagger';
import type { FastifyReply, FastifyRequest } from 'fastify';
import { z } from 'zod';
import { CurrentCustomer, CustomerAuth, Public, type CustomerPrincipal } from '../auth/decorators.js';
import { ZodPipe } from '../common/zod-query.js';
import { PaymentsService } from './payments.service.js';
import { FakePaymentProvider } from './provider/fake-payment-provider.js';
import { PAYMENT_PROVIDER, type PaymentProvider } from './provider/payment-provider.js';
import { TariffsService } from './tariffs.service.js';

const idParam = new ZodPipe(z.uuid());

/** Aplikacja klienta: portfel, doładowanie, karty, paragony, cennik i spłata zaległości (ADR 0049–0052). */
@ApiTags('aplikacja: płatności')
@Controller()
export class PaymentsController {
  constructor(
    private readonly payments: PaymentsService,
    private readonly tariffs: TariffsService,
  ) {}

  @Public()
  @Get('payments/config')
  @ApiOkResponse({ description: 'Operator płatności, klucz publiczny i kwoty doładowania (ADR 0051)' })
  config() {
    return this.payments.paymentsConfig();
  }

  @Public()
  @Get('tariff')
  @ApiOkResponse({ description: 'Obowiązująca wersja cennika (ekran „Cennik” w aplikacji)' })
  tariff() {
    return this.tariffs.current();
  }

  @CustomerAuth()
  @Get('payments/:id')
  @ApiOkResponse({ description: 'Status płatności klienta (ekran oczekiwania po powrocie aplikacji)' })
  payment(@CurrentCustomer() customer: CustomerPrincipal, @Param('id', idParam) id: string) {
    return this.payments.payment(customer.userId, id);
  }

  @CustomerAuth()
  @Get('me/wallet')
  @ApiOkResponse({ description: 'Saldo, minimalne saldo, zaległości i historia portfela od najnowszego wpisu' })
  wallet(
    @CurrentCustomer() customer: CustomerPrincipal,
    @Query(new ZodPipe(walletHistoryQuerySchema)) query: WalletHistoryQuery,
  ) {
    return this.payments.wallet(customer.userId, query.limit, query.before);
  }

  @CustomerAuth()
  @Post('me/wallet/topups')
  @HttpCode(202)
  @ApiOperation({
    summary:
      'Doładowanie kartą albo BLIK-iem: płatność PENDING i PaymentIntent; potwierdza aplikacja, saldo rośnie po webhooku',
  })
  topup(@CurrentCustomer() customer: CustomerPrincipal, @Body(new ZodPipe(topupSchema)) body: TopupRequest) {
    return this.payments.topup(customer.userId, body);
  }

  @CustomerAuth()
  @Get('me/payment-methods')
  @ApiOkResponse({ description: 'Zapisane karty z domyślną i stanem ważności' })
  cards(@CurrentCustomer() customer: CustomerPrincipal) {
    return this.payments.cards(customer.userId);
  }

  @CustomerAuth()
  @Post('me/payment-methods/setup')
  @ApiOperation({
    summary: 'Dodanie karty: SetupIntent; karta pojawia się po webhooku (D3: numer nie przechodzi przez API)',
  })
  setup(@CurrentCustomer() customer: CustomerPrincipal) {
    return this.payments.setupCard(customer.userId);
  }

  @CustomerAuth()
  @Post('me/payment-methods/:id/default')
  @HttpCode(200)
  setDefault(@CurrentCustomer() customer: CustomerPrincipal, @Param('id', idParam) id: string) {
    return this.payments.setDefaultCard(customer.userId, id);
  }

  @CustomerAuth()
  @Delete('me/payment-methods/:id')
  @ApiOperation({ summary: 'Usunięcie karty (nie przy przejeździe w toku ani zaległości z tą kartą)' })
  remove(@CurrentCustomer() customer: CustomerPrincipal, @Param('id', idParam) id: string) {
    return this.payments.removeCard(customer.userId, id);
  }

  @CustomerAuth()
  @Get('me/receipts')
  @ApiOkResponse({ description: 'Paragony i korekty klienta od najnowszego' })
  receipts(
    @CurrentCustomer() customer: CustomerPrincipal,
    @Query(new ZodPipe(receiptsQuerySchema)) query: { limit: number },
  ) {
    return this.payments.receipts(customer.userId, query.limit);
  }

  @CustomerAuth()
  @Get('me/receipts/:id')
  @ApiOkResponse({ description: 'Paragon z pozycjami, VAT, sprzedawcą, nabywcą i korektami (ADR 0052)' })
  receipt(@CurrentCustomer() customer: CustomerPrincipal, @Param('id', idParam) id: string) {
    return this.payments.receipt(customer.userId, id);
  }

  @CustomerAuth()
  @Post('rentals/:id/pay')
  @ApiOperation({
    summary:
      'Spłata zaległości UNPAID: z portfela od razu (200, `payment: null`) albo kartą z potwierdzeniem w aplikacji (202)',
  })
  async pay(
    @CurrentCustomer() customer: CustomerPrincipal,
    @Param('id', idParam) id: string,
    @Body(new ZodPipe(payDebtSchema)) body: PayDebtRequest,
    @Res({ passthrough: true }) reply: FastifyReply,
  ) {
    const payment = await this.payments.payDebt(customer.userId, id, body);
    void reply.status(payment ? 202 : 200);
    return { payment };
  }
}

/** Webhook operatora płatności (ADR 0050): podpis na surowej treści, zapis zdarzenia, przetwarzanie w kolejce. */
@ApiTags('płatności: webhooki')
@Controller('payments/webhooks')
export class PaymentWebhooksController {
  constructor(private readonly payments: PaymentsService) {}

  @Public()
  @Post('stripe')
  @HttpCode(200)
  @ApiOperation({
    summary: 'Zdarzenia Stripe (i atrapy w tym samym formacie); zły podpis: 400 WEBHOOK_SIGNATURE_INVALID',
  })
  async stripe(
    @Req() request: RawBodyRequest<FastifyRequest>,
    @Headers('stripe-signature') signature: string | undefined,
  ): Promise<{ received: true }> {
    await this.payments.receiveWebhook(request.rawBody, signature);
    return { received: true };
  }
}

/**
 * Formularz atrapy operatora w aplikacji (ADR 0051): numery kart testowych i kod BLIK idą do atrapy w API.
 * Tylko przy `PAYMENT_PROVIDER=fake`; z prawdziwym operatorem punkty odpowiadają 404.
 */
@ApiTags('płatności: atrapa operatora')
@CustomerAuth()
@Controller('payments/fake')
export class FakeProviderController {
  constructor(@Inject(PAYMENT_PROVIDER) private readonly provider: PaymentProvider) {}

  private fake(): FakePaymentProvider {
    if (!(this.provider instanceof FakePaymentProvider))
      throw new DomainError('NOT_FOUND', { entity: 'fake_provider' });
    return this.provider;
  }

  @Post('setup-intents/confirm')
  @HttpCode(200)
  @ApiOperation({ summary: 'Atrapa: potwierdzenie karty testowej (4242 sukces, 0002 odmowa, 3220 wymaga 3-D Secure)' })
  confirmSetup(@Body(new ZodPipe(fakeSetupConfirmSchema)) body: FakeSetupConfirm) {
    return this.fake().confirmSetup(body.clientSecret, body);
  }

  @Post('payment-intents/confirm')
  @HttpCode(200)
  @ApiOperation({
    summary: 'Atrapa: potwierdzenie płatności kartą albo BLIK-iem (000000 odmowa, 999999 brak potwierdzenia)',
  })
  confirmPayment(@Body(new ZodPipe(fakePaymentConfirmSchema)) body: FakePaymentConfirm) {
    return this.fake().confirmPayment(body.clientSecret, body.blikCode);
  }

  @Post('authenticate')
  @HttpCode(200)
  @ApiOperation({ summary: 'Atrapa: okno 3-D Secure (akceptacja albo odrzucenie)' })
  authenticate(@Body(new ZodPipe(fakeAuthenticateSchema)) body: FakeAuthenticate) {
    return this.fake().authenticate(body.clientSecret, body.approve);
  }
}
