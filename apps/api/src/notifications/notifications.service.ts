import { DomainError, notificationDedupeKey, notificationDelivery } from '@hulajnogi/core';
import { type Database, type DbExecutor, DrizzleNotificationRepository, type NotificationRecord } from '@hulajnogi/db';
import {
  isNotificationTemplateCode,
  NOTIFICATION_PERSONAL_FIELDS,
  NOTIFICATION_TEMPLATES,
  notificationPath,
  notificationsResource,
  type ListQuery,
  type ListResponse,
  type NotificationListItem,
  type NotificationTemplateCode,
  type NotificationView,
  type PushTokenListItem,
  type PushTokenRequest,
  type TicketStatus,
} from '@hulajnogi/shared';
import { Inject, Injectable, Logger, type OnModuleInit } from '@nestjs/common';
import { StaffPermissionsService } from '../auth/staff-permissions.service.js';
import { DB } from '../database/database.module.js';
import { JOBS, JobsService } from '../jobs/jobs.service.js';
import { FleetGateway } from '../realtime/fleet.gateway.js';
import { amountLabel, rentalLabel, rideMinutes, scooterLabel, ticketLabel } from './notification-params.js';
import { NotificationTemplatesService } from './notification-templates.service.js';
import { PUSH_GATEWAY, type PushGateway } from './push-gateway.js';

/** Potwierdzenia dostarczenia Expo są dostępne po około 15 min (ADR 0058). */
export const RECEIPTS_AFTER_MS = 15 * 60_000;
/** Powiadomienie w kolejce dłużej niż 5 min wysyła ponownie zadanie `notifications.sweep`. */
export const STUCK_QUEUED_AFTER_MS = 5 * 60_000;

type Params = Record<string, string | number | boolean>;

/** Powiadomienie o zdarzeniu: odbiorca, kod szablonu, parametry i identyfikatory zdarzenia w kluczu idempotencji. */
interface Enqueue {
  userId: string;
  code: NotificationTemplateCode;
  params: Params;
  /** Identyfikatory zdarzenia w `dedupe_key` po kodzie, np. `[rentalId]` dla `ride_ended:{rentalId}`. */
  key: ReadonlyArray<string | number>;
  /** Identyfikator w ścieżce ekranu aplikacji (`/podsumowanie/[id]`). */
  pathId?: string;
  rentalId?: string | null;
  ticketId?: string | null;
}

/** Przejazd do powiadomień `ride_ended` i `payment_failed` (wiersz przejazdu po zakończeniu). */
export interface RideNotice {
  id: string;
  userId: string;
  number: number;
  rideSeconds: number;
  pauseSeconds: number;
  totalAmount: number | null;
  towingFee: number | null;
}

/** Zgłoszenie klienta do powiadomień `ticket_received` i `ticket_status_changed`. */
export interface TicketNotice {
  id: string;
  number: number;
  /** Zgłaszający klient; zgłoszenie automatyczne albo operatora nie ma odbiorcy. */
  reportedBy: string | null;
}

/**
 * Moduł Powiadomienia (ADR 0058). Moduł zdarzenia zapisuje w swojej transakcji wiersz `notifications` (`QUEUED`)
 * z parametrami i kluczem idempotencji i planuje zadanie `notification.send`; zadanie renderuje bieżącą wersję
 * szablonu, sprawdza preferencje i tokeny w core i wysyła przez bramkę (`PushGateway`). Wynik to `SENT`, `FAILED`
 * albo `SKIPPED`; po wysyłce klient dostaje `notification.created` (baner w wersji web).
 */
@Injectable()
export class NotificationsService implements OnModuleInit {
  private readonly logger = new Logger(NotificationsService.name);

  constructor(
    @Inject(DB) private readonly db: Database,
    @Inject(PUSH_GATEWAY) private readonly push: PushGateway,
    private readonly templates: NotificationTemplatesService,
    private readonly jobs: JobsService,
    private readonly gateway: FleetGateway,
    private readonly permissions: StaffPermissionsService,
  ) {}

  onModuleInit(): void {
    this.jobs.handle(JOBS.notificationSend, async ({ notificationId }) => this.send(Number(notificationId)));
    this.jobs.handle(JOBS.notificationReceipts, async (data) =>
      this.checkReceipts(Number(data.notificationId), data.tickets as Array<{ id: string; token: string }>),
    );
    this.jobs.handle(JOBS.notificationsSweep, async () => this.sweep());
  }

  // --- Zdarzenia (w transakcji modułu zdarzenia) -----------------------------------------------------

  /**
   * Wiersz `QUEUED` i zadanie `notification.send` w transakcji zdarzenia: powiadomienie powstaje tylko wtedy, gdy
   * zdarzenie się zatwierdzi. Drugie powiadomienie o tym samym zdarzeniu pomija unikalny `dedupe_key` (`null`).
   */
  async enqueue(tx: DbExecutor, input: Enqueue): Promise<number | null> {
    const definition = NOTIFICATION_TEMPLATES[input.code];
    if (definition.channel !== 'PUSH') throw new Error(`Szablon ${input.code} nie jest powiadomieniem push`);
    const created = await new DrizzleNotificationRepository(tx).insert({
      userId: input.userId,
      templateCode: input.code,
      channel: definition.channel,
      payload: { params: input.params, path: notificationPath(input.code, input.pathId) },
      dedupeKey: notificationDedupeKey(input.code, ...input.key),
      rentalId: input.rentalId ?? null,
      ticketId: input.ticketId ?? null,
    });
    if (!created) return null;
    await this.jobs.sendInTransaction(tx, JOBS.notificationSend, { notificationId: created.id }, new Date());
    return created.id;
  }

  /** `ride_ended`: po rozliczeniu (portfel przy zakończeniu, karta po paragonie); `ride_ended:{rentalId}`. */
  rideEnded(tx: DbExecutor, ride: RideNotice, hasReceipt: boolean): Promise<number | null> {
    const towingFee = ride.towingFee ?? 0;
    return this.enqueue(tx, {
      userId: ride.userId,
      code: 'ride_ended',
      params: {
        rideNumber: rentalLabel(ride.number),
        minutes: rideMinutes(ride.rideSeconds + ride.pauseSeconds),
        amount: amountLabel(ride.totalAmount ?? 0),
        hasReceipt,
        towingFee: amountLabel(towingFee),
        hasTowingFee: towingFee > 0,
      },
      key: [ride.id],
      pathId: ride.id,
      rentalId: ride.id,
    });
  }

  /** `payment_failed`: odmowa obciążenia karty za przejazd, przejazd w `UNPAID`; jedno na przejazd. */
  paymentFailed(tx: DbExecutor, ride: RideNotice): Promise<number | null> {
    return this.enqueue(tx, {
      userId: ride.userId,
      code: 'payment_failed',
      params: { rideNumber: rentalLabel(ride.number), amount: amountLabel(ride.totalAmount ?? 0) },
      key: [ride.id],
      pathId: ride.id,
      rentalId: ride.id,
    });
  }

  /** `battery_low`: pierwszy próg `LOW` w przejeździe (ADR 0056); jedno na przejazd. */
  batteryLow(
    tx: DbExecutor,
    input: { rentalId: string; userId: string; scooterNumber: number; batteryPct: number },
  ): Promise<number | null> {
    return this.enqueue(tx, {
      userId: input.userId,
      code: 'battery_low',
      params: { scooterNumber: scooterLabel(input.scooterNumber), batteryPct: Math.round(input.batteryPct) },
      key: [input.rentalId],
      rentalId: input.rentalId,
    });
  }

  /** `reservation_ending`: 2 min przed końcem rezerwacji, gdy nadal trwa; jedno na rezerwację. */
  reservationEnding(
    tx: DbExecutor,
    input: { rentalId: string; userId: string; scooterNumber: number; minutesLeft: number },
  ): Promise<number | null> {
    return this.enqueue(tx, {
      userId: input.userId,
      code: 'reservation_ending',
      params: { scooterNumber: scooterLabel(input.scooterNumber), minutesLeft: input.minutesLeft },
      key: [input.rentalId],
      rentalId: input.rentalId,
    });
  }

  /** `ticket_received`: przyjęcie zgłoszenia klienta. */
  async ticketReceived(tx: DbExecutor, ticket: TicketNotice, scooterNumber: number): Promise<number | null> {
    if (!ticket.reportedBy) return null;
    return this.enqueue(tx, {
      userId: ticket.reportedBy,
      code: 'ticket_received',
      params: { ticketNumber: ticketLabel(ticket.number), scooterNumber: scooterLabel(scooterNumber) },
      key: [ticket.id],
      pathId: ticket.id,
      ticketId: ticket.id,
    });
  }

  /**
   * `ticket_status_changed`: zmiana statusu albo odpowiedź dla klienta (D7); klucz z wersją zgłoszenia po zmianie,
   * więc każda zmiana to jedno powiadomienie, a powtórzone zdarzenie żadnego.
   */
  async ticketStatusChanged(
    tx: DbExecutor,
    ticket: TicketNotice,
    change: { status: TicketStatus; reply: string | null; version: number },
  ): Promise<number | null> {
    if (!ticket.reportedBy) return null;
    return this.enqueue(tx, {
      userId: ticket.reportedBy,
      code: 'ticket_status_changed',
      params: { ticketNumber: ticketLabel(ticket.number), status: change.status, reply: change.reply ?? '' },
      key: [ticket.id, change.version],
      pathId: ticket.id,
      ticketId: ticket.id,
    });
  }

  // --- Wysyłka (zadania pg-boss) --------------------------------------------------------------------

  /**
   * Zadanie `notification.send`: treść z bieżącej wersji szablonu (zmiana szablonu działa od następnej wysyłki),
   * decyzja w core (preferencja, tokeny), wysyłka na wszystkie tokeny klienta. `DeviceNotRegistered` usuwa token.
   */
  async send(notificationId: number, now = new Date()): Promise<void> {
    const repo = new DrizzleNotificationRepository(this.db);
    // Przejęcie przed wysyłką: równoległe wykonanie (zadanie i `notifications.sweep`) nie wyśle drugiego push;
    // przejęcie sprzed 5 min (przerwane wykonanie) przejmuje kolejne.
    if (!(await repo.claim(notificationId, new Date(now.getTime() - STUCK_QUEUED_AFTER_MS)))) return;
    try {
      await this.deliver(repo, notificationId);
    } catch (error) {
      await repo.releaseClaim(notificationId).catch(() => undefined);
      throw error;
    }
  }

  private async deliver(repo: DrizzleNotificationRepository, notificationId: number): Promise<void> {
    const notification = await repo.find(notificationId);
    if (notification?.status !== 'QUEUED') return;
    const code = notification.templateCode;
    if (!isNotificationTemplateCode(code)) {
      await repo.complete(notificationId, failed('TEMPLATE_UNKNOWN'));
      return;
    }
    let rendered;
    try {
      rendered = await this.templates.render(code, notification.payload.params);
    } catch (error) {
      if (!(error instanceof DomainError)) throw error;
      this.logger.warn(`Powiadomienie ${notificationId} (${code}): ${error.code}`);
      await repo.complete(notificationId, failed(error.code));
      return;
    }
    const content = { title: rendered.title, body: rendered.body, templateVersion: rendered.version };
    const tokens = await repo.pushTokens(notification.userId);
    const delivery = notificationDelivery({
      code,
      channel: notification.channel,
      preferences: await repo.preferences(notification.userId),
      pushTokens: tokens.length,
    });
    if (!delivery.send) {
      if (!(await repo.complete(notificationId, { status: 'SKIPPED', ...content, error: delivery.reason }))) return;
      // Wersja web nie ma tokenu Expo (ADR 0058), a baner pokazuje z Socket.IO; wyłączona preferencja nic nie pokazuje.
      if (delivery.reason === 'NO_PUSH_TOKEN') await this.emit(notificationId);
      return;
    }
    const tickets = await this.push.send(
      tokens.map((t) => ({
        to: t.token,
        title: rendered.title,
        body: rendered.body,
        data: { path: notification.payload.path, notificationId, templateCode: code },
      })),
    );
    const unregistered = tickets.filter((t) => !t.ok && t.deviceNotRegistered).map((t) => t.to);
    if (unregistered.length) await repo.deletePushTokens(unregistered);
    const accepted = tickets.flatMap((t) => (t.ok ? [{ id: t.ticketId, token: t.to }] : []));
    const errors = [...new Set(tickets.flatMap((t) => (t.ok ? [] : [t.error])))];
    if (!accepted.length) {
      await repo.complete(notificationId, { status: 'FAILED', ...content, error: errors.join('; ') || 'NO_TICKETS' });
      return;
    }
    const sent = await repo.complete(notificationId, {
      status: 'SENT',
      ...content,
      providerRef: accepted.map((t) => t.id).join(','),
      // Część urządzeń odrzuciła wiadomość: powiadomienie wysłane, błąd widoczny w panelu.
      error: errors.length ? errors.join('; ') : null,
    });
    if (!sent) return;
    await this.jobs.send(
      JOBS.notificationReceipts,
      { notificationId, tickets: accepted },
      { startAfter: new Date(Date.now() + RECEIPTS_AFTER_MS) },
    );
    await this.emit(notificationId);
  }

  /** Zadanie `notification.receipts` 15 min po wysyłce: `DeviceNotRegistered` usuwa token (ADR 0058). */
  async checkReceipts(notificationId: number, tickets: ReadonlyArray<{ id: string; token: string }>): Promise<void> {
    if (!tickets?.length) return;
    const receipts = await this.push.receipts(tickets.map((t) => t.id));
    const repo = new DrizzleNotificationRepository(this.db);
    const unregistered: string[] = [];
    const errors = new Set<string>();
    for (const ticket of tickets) {
      const receipt = receipts.get(ticket.id);
      if (!receipt || receipt.ok) continue;
      errors.add(receipt.error);
      if (receipt.deviceNotRegistered) unregistered.push(ticket.token);
    }
    if (unregistered.length) await repo.deletePushTokens(unregistered);
    if (errors.size) await repo.setDeliveryError(notificationId, [...errors].join('; '));
  }

  /** Zadanie `notifications.sweep`: powiadomienia w kolejce dłużej niż 5 min (zgubione albo przerwane zadanie). */
  async sweep(now = new Date()): Promise<void> {
    const repo = new DrizzleNotificationRepository(this.db);
    for (const id of await repo.stuckQueued(new Date(now.getTime() - STUCK_QUEUED_AFTER_MS))) {
      // Błąd jednego powiadomienia nie zatrzymuje pozostałych; zostaje w kolejce na kolejny przebieg.
      try {
        await this.send(id, now);
      } catch (error) {
        this.logger.warn(`Powiadomienie ${id} (sweep): ${(error as Error).message}`);
      }
    }
  }

  private async emit(notificationId: number): Promise<void> {
    const notification = await new DrizzleNotificationRepository(this.db).find(notificationId);
    if (notification) this.gateway.notificationCreated(notification.userId, notificationView(notification));
  }

  // --- Tokeny push ---------------------------------------------------------------------------------

  /** `POST /me/push-tokens`: upsert po tokenie, przejęcie z innego konta, sesja bieżąca, `last_seen_at`. */
  async registerToken(userId: string, sessionId: string, body: PushTokenRequest): Promise<void> {
    const { previousUserId } = await new DrizzleNotificationRepository(this.db).upsertPushToken({
      userId,
      sessionId,
      token: body.token,
      platform: body.platform,
    });
    if (previousUserId) this.logger.log(`Token push przeszedł z konta ${previousUserId} do ${userId}`);
  }

  /** `DELETE /me/push-tokens/:token`: tylko własny token; brak tokenu niczego nie zmienia. */
  async removeToken(userId: string, token: string): Promise<void> {
    await new DrizzleNotificationRepository(this.db).deletePushToken(userId, token);
  }

  /** Wylogowanie: sesja jest unieważniana, nie usuwana, więc tokeny rodziny sesji usuwamy jawnie. */
  forgetSessionFamily(executor: DbExecutor, familyId: string): Promise<number> {
    return new DrizzleNotificationRepository(executor).deleteSessionFamilyTokens(familyId);
  }

  /** Rotacja tokenu odświeżającego: tokeny push przechodzą do nowej sesji (w transakcji rotacji). */
  moveSessionTokens(tx: DbExecutor, fromSessionId: string, toSessionId: string): Promise<void> {
    return new DrizzleNotificationRepository(tx).moveSessionTokens(fromSessionId, toSessionId);
  }

  // --- Panel ---------------------------------------------------------------------------------------

  /** „Wysłane”: bez `users.read` bez imienia i telefonu klienta i bez wyszukiwania po nich (jak zgłoszenia). */
  async list(staffId: string, query: ListQuery, db: DbExecutor = this.db): Promise<ListResponse<NotificationListItem>> {
    const repo = new DrizzleNotificationRepository(db);
    if ((await this.permissions.get(staffId)).permissions.has('users.read')) return repo.list(query);
    const personal = (field: string) => (NOTIFICATION_PERSONAL_FIELDS as readonly string[]).includes(field);
    if (query.filters.some((f) => personal(f.field)) || query.sort.some((s) => personal(s.field))) {
      throw new DomainError('FORBIDDEN', { permission: 'users.read' });
    }
    const result = await repo.list(query, {
      ...notificationsResource,
      search: notificationsResource.search.filter((f) => !personal(f)),
    });
    return { ...result, items: result.items.map((item) => ({ ...item, userName: null, userPhone: null })) };
  }

  listPushTokens(query: ListQuery, db: DbExecutor = this.db): Promise<ListResponse<PushTokenListItem>> {
    return new DrizzleNotificationRepository(db).listPushTokens(query);
  }
}

const failed = (error: string) =>
  ({ status: 'FAILED', title: null, body: null, templateVersion: null, error }) as const;

export function notificationView(n: NotificationRecord): NotificationView {
  return {
    id: n.id,
    templateCode: n.templateCode as NotificationTemplateCode,
    title: n.title,
    body: n.body ?? '',
    path: n.payload.path,
    createdAt: n.createdAt.toISOString(),
    readAt: n.readAt?.toISOString() ?? null,
  };
}
