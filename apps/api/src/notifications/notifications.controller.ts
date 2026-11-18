import {
  notificationsResource,
  notificationTemplatePreviewSchema,
  notificationTemplateRestoreSchema,
  notificationTemplatesResource,
  notificationTemplateUpdateSchema,
  pushTokenSchema,
  pushTokensResource,
  type ListQuery,
  type NotificationTemplatePreview,
  type NotificationTemplateRestore,
  type NotificationTemplateUpdate,
  type PushTokenRequest,
} from '@hulajnogi/shared';
import { Body, Controller, Delete, Get, HttpCode, Param, Patch, Post, Query } from '@nestjs/common';
import { ApiOkResponse, ApiOperation, ApiTags } from '@nestjs/swagger';
import { z } from 'zod';
import {
  CurrentCustomer,
  CurrentStaff,
  CustomerAuth,
  RequirePermission,
  type CustomerPrincipal,
  type StaffPrincipal,
} from '../auth/decorators.js';
import { ListQueryPipe } from '../common/list-query.pipe.js';
import { ZodPipe } from '../common/zod-query.js';
import { NotificationTemplatesService } from './notification-templates.service.js';
import { NotificationsService } from './notifications.service.js';

const idParam = new ZodPipe(z.uuid());

/** Aplikacja: rejestracja tokenu Expo po zgodzie na powiadomienia i usunięcie przy wyłączeniu (ADR 0058). */
@ApiTags('aplikacja: powiadomienia')
@CustomerAuth()
@Controller('me/push-tokens')
export class CustomerPushTokensController {
  constructor(private readonly notifications: NotificationsService) {}

  @Post()
  @HttpCode(204)
  @ApiOperation({
    summary:
      'Rejestracja tokenu Expo (upsert po tokenie, przy każdym starcie aplikacji); token z innego konta przechodzi do zalogowanego, wylogowanie usuwa tokeny sesji',
  })
  async register(
    @CurrentCustomer() customer: CustomerPrincipal,
    @Body(new ZodPipe(pushTokenSchema)) body: PushTokenRequest,
  ): Promise<void> {
    await this.notifications.registerToken(customer.userId, customer.sessionId, body);
  }

  @Delete(':token')
  @HttpCode(204)
  @ApiOperation({ summary: 'Usunięcie własnego tokenu (powiadomienia wyłączone w systemie); brak tokenu to też 204' })
  async remove(
    @CurrentCustomer() customer: CustomerPrincipal,
    @Param('token', new ZodPipe(pushTokenSchema.shape.token)) token: string,
  ): Promise<void> {
    await this.notifications.removeToken(customer.userId, token);
  }
}

/**
 * Zasób panelu `notification-templates` (ADR 0058, wymaganie 17): podgląd `content.read`, zapis nowej wersji
 * i przywrócenie `content.write` z wpisem w dzienniku audytu.
 */
@ApiTags('panel: powiadomienia')
@Controller('admin/notification-templates')
export class AdminNotificationTemplatesController {
  constructor(private readonly templates: NotificationTemplatesService) {}

  @RequirePermission('content.read')
  @Get()
  @ApiOperation({ summary: 'Szablony powiadomień push i SMS (kody z rejestru) według wzorca listy' })
  list(@Query(new ListQueryPipe(notificationTemplatesResource)) query: ListQuery) {
    return this.templates.list(query);
  }

  @RequirePermission('content.read')
  @Get(':id')
  @ApiOkResponse({ description: 'Szablon z parametrami z rejestru, ekranem aplikacji i historią wersji' })
  details(@Param('id', idParam) id: string) {
    return this.templates.details(id);
  }

  @RequirePermission('content.read')
  @Post(':id/preview')
  @HttpCode(200)
  @ApiOperation({
    summary:
      'Podgląd bez zapisu: problemy szablonu z wierszem i znakiem (składnia, parametry, limity) albo treść po renderowaniu',
  })
  preview(
    @Param('id', idParam) id: string,
    @Body(new ZodPipe(notificationTemplatePreviewSchema)) body: NotificationTemplatePreview,
  ) {
    return this.templates.preview(id, body);
  }

  @RequirePermission('content.write')
  @Patch(':id')
  @ApiOperation({
    summary: 'Zapis treści jako nowej wersji (blokada optymistyczna `version`); działa od następnej wysyłki',
  })
  update(
    @CurrentStaff() staff: StaffPrincipal,
    @Param('id', idParam) id: string,
    @Body(new ZodPipe(notificationTemplateUpdateSchema)) body: NotificationTemplateUpdate,
  ) {
    return this.templates.update(staff.staffId, id, body);
  }

  @RequirePermission('content.write')
  @Post(':id/restore')
  @HttpCode(200)
  @ApiOperation({ summary: 'Przywrócenie treści starszej wersji jako nowej wersji' })
  restore(
    @CurrentStaff() staff: StaffPrincipal,
    @Param('id', idParam) id: string,
    @Body(new ZodPipe(notificationTemplateRestoreSchema)) body: NotificationTemplateRestore,
  ) {
    return this.templates.restore(staff.staffId, id, body);
  }
}

/** Zakładki „Wysłane” i „Tokeny push” (wymaganie 12): listy tylko do odczytu. */
@ApiTags('panel: powiadomienia')
@Controller('admin')
export class AdminNotificationsController {
  constructor(private readonly notifications: NotificationsService) {}

  @RequirePermission('content.read')
  @Get('notifications')
  @ApiOperation({
    summary: 'Wysłane powiadomienia ze stanem wysyłki; bez users.read bez imienia i telefonu klienta (userName = null)',
  })
  list(@CurrentStaff() staff: StaffPrincipal, @Query(new ListQueryPipe(notificationsResource)) query: ListQuery) {
    return this.notifications.list(staff.staffId, query);
  }

  @RequirePermission('users.read')
  @Get('push-tokens')
  @ApiOperation({ summary: 'Tokeny push klientów ze stanem sesji' })
  pushTokens(@Query(new ListQueryPipe(pushTokensResource)) query: ListQuery) {
    return this.notifications.listPushTokens(query);
  }
}
