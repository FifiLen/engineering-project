import { Module } from '@nestjs/common';
import { CONFIG, type AppConfig } from '../config.js';
import { AdminPaymentsController, AdminTariffsController } from './admin-payments.controller.js';
import { AdminPaymentsService } from './admin-payments.service.js';
import { FakeProviderController, PaymentsController, PaymentWebhooksController } from './payments.controller.js';
import { PaymentsService } from './payments.service.js';
import { FakePaymentProvider } from './provider/fake-payment-provider.js';
import { PAYMENT_PROVIDER, type PaymentProvider } from './provider/payment-provider.js';
import { StripePaymentProvider } from './provider/stripe-payment-provider.js';
import { TariffsService } from './tariffs.service.js';
import { PaymentDataExport } from './payment-data-export.js';

/** Operator płatności z konfiguracji (D1): atrapa domyślnie, Stripe po wpisaniu kluczy testowych. */
export function createPaymentProvider(config: AppConfig): PaymentProvider {
  if (config.PAYMENT_PROVIDER === 'stripe') {
    return new StripePaymentProvider({
      secretKey: config.STRIPE_SECRET_KEY as string,
      publishableKey: config.STRIPE_PUBLISHABLE_KEY as string,
      webhookSecret: config.STRIPE_WEBHOOK_SECRET as string,
      blik: config.STRIPE_BLIK,
    });
  }
  return new FakePaymentProvider({
    secret: config.FAKE_WEBHOOK_SECRET,
    delivery: config.FAKE_WEBHOOK_DELIVERY,
    delayMs: config.FAKE_WEBHOOK_DELAY_MS,
    url:
      (config.FAKE_WEBHOOK_URL as string | undefined) ?? `http://localhost:${config.API_PORT}/payments/webhooks/stripe`,
  });
}

/** Moduł Płatności: portfel, karty, doładowania, rozliczenie przejazdu, paragony, cennik, zwroty (ADR 0049–0054). */
@Module({
  controllers: [
    PaymentsController,
    PaymentWebhooksController,
    FakeProviderController,
    AdminPaymentsController,
    AdminTariffsController,
  ],
  providers: [
    { provide: PAYMENT_PROVIDER, inject: [CONFIG], useFactory: createPaymentProvider },
    PaymentsService,
    AdminPaymentsService,
    TariffsService,
    PaymentDataExport,
  ],
  exports: [PaymentsService, AdminPaymentsService, PAYMENT_PROVIDER],
})
export class PaymentsModule {}
