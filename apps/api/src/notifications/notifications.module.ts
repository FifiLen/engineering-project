import { Global, Module } from '@nestjs/common';
import { CONFIG, type AppConfig } from '../config.js';
import { ExpoPushGateway } from './expo-push-gateway.js';
import { FakePushGateway } from './fake-push-gateway.js';
import { NotificationTemplatesService } from './notification-templates.service.js';
import {
  AdminNotificationsController,
  AdminNotificationTemplatesController,
  CustomerPushTokensController,
} from './notifications.controller.js';
import { NotificationsService } from './notifications.service.js';
import { PUSH_GATEWAY, type PushGateway } from './push-gateway.js';
import { NotificationDataExport } from './notification-data-export.js';

/** Bramka push z konfiguracji (D2): atrapa domyślnie, Expo Push po skonfigurowaniu projektu EAS przez autora. */
export function createPushGateway(config: AppConfig): PushGateway {
  if (config.PUSH_PROVIDER === 'expo') {
    return new ExpoPushGateway({ accessToken: config.EXPO_ACCESS_TOKEN as string | undefined });
  }
  return new FakePushGateway();
}

/**
 * Moduł Powiadomienia (ADR 0058): szablony, wysyłka push zadaniami pg-boss i tokeny. Globalny, bo powiadomienia
 * zapisują w swoich transakcjach moduły Wypożyczenia, Płatności i Operacje, a szablon SMS renderuje bramka SMS.
 */
@Global()
@Module({
  controllers: [CustomerPushTokensController, AdminNotificationTemplatesController, AdminNotificationsController],
  providers: [
    { provide: PUSH_GATEWAY, inject: [CONFIG], useFactory: createPushGateway },
    NotificationTemplatesService,
    NotificationsService,
    NotificationDataExport,
  ],
  exports: [NotificationsService, NotificationTemplatesService, PUSH_GATEWAY],
})
export class NotificationsModule {}
