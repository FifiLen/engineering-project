import {
  availableTaskTypes,
  canAutoCloseOfflineTicket,
  decideTicketUpdate,
  DomainError,
  ensureCanAssignTicket,
  ensureVersion,
  notFound,
  OFFLINE_TICKET_AFTER_MS,
  shouldOpenOfflineTicket,
  suggestTaskType,
  validateTicket,
} from '@hulajnogi/core';
import {
  type Database,
  type DbExecutor,
  DrizzleServiceRepository,
  DrizzleTicketRepository,
  rethrowDatabaseRule,
  type TicketRecord,
} from '@hulajnogi/db';
import {
  TICKET_PAYMENT_FIELDS,
  TICKET_PERSONAL_FIELDS,
  ticketsResource,
  type CustomerTicketCreate,
  type CustomerTicketListItem,
  type CustomerTicketStatusEntry,
  type CustomerTicketView,
  type FileView,
  type ListQuery,
  type ListResponse,
  type StaffTicketCreate,
  type TicketAdminDetails,
  type TicketAssign,
  type TicketListItem,
  type TicketStatus,
  type TicketStatusChange,
  type TicketTimelineEntry,
} from '@hulajnogi/shared';
import { Inject, Injectable, type OnModuleInit } from '@nestjs/common';
import { AuditedTransaction } from '../audit/audited-transaction.js';
import { StaffPermissionsService } from '../auth/staff-permissions.service.js';
import { DB } from '../database/database.module.js';
import { FilesService } from '../files/files.service.js';
import { JOBS, JobsService } from '../jobs/jobs.service.js';
import { NotificationsService } from '../notifications/notifications.service.js';
import { OperationsEffects, OperationsService, systemScope } from './operations.service.js';

/** „Moje zgłoszenia” w aplikacji: najnowsze zgłoszenia klienta. */
const CUSTOMER_TICKETS_LIMIT = 50;

/** Wyszukiwanie zgłoszeń bez danych klienta (operator bez `users.read`). */
const ticketsWithoutPersonalData = {
  ...ticketsResource,
  search: ticketsResource.search.filter((f) => !(TICKET_PERSONAL_FIELDS as readonly string[]).includes(f)),
};

/**
 * Zgłoszenia (ADR 0055): od klienta z aplikacji, od operatora z panelu i automatyczne (brak łączności, krytyczna
 * bateria, hulajnoga poza strefą). Reguły kategorii, statusów i odpowiedzi są w core; zapis operatora idzie
 * z wpisem w dzienniku audytu, a skutki systemu (wyłączenie z ruchu, zamknięcie po powrocie łączności) mają
 * wpisy `SYSTEM`.
 */
@Injectable()
export class TicketsService implements OnModuleInit {
  constructor(
    @Inject(DB) private readonly db: Database,
    private readonly audited: AuditedTransaction,
    private readonly operations: OperationsService,
    private readonly files: FilesService,
    private readonly permissions: StaffPermissionsService,
    private readonly jobs: JobsService,
    private readonly notifications: NotificationsService,
  ) {}

  onModuleInit(): void {
    this.jobs.handle(JOBS.ticketsOfflineCheck, async ({ scooterId, lostAt }) => {
      await this.offlineCheck(scooterId as string, new Date(lostAt as string));
    });
  }

  // --- Aplikacja klienta ------------------------------------------------------------------------

  /**
   * `POST /tickets`: z przejazdu (w trakcie jazdy przejazd się nie kończy, D5), z podsumowania, z karty hulajnogi
   * albo z profilu. Pilna kategoria wyłącza wolną hulajnogę z ruchu od razu, a hulajnogę w przejeździe przy jego
   * zakończeniu (wyzwalacz bazy).
   */
  async createForCustomer(userId: string, body: CustomerTicketCreate): Promise<CustomerTicketView> {
    const effects = new OperationsEffects();
    const id = await this.transaction(async (tx) => {
      const tickets = new DrizzleTicketRepository(tx);
      if (body.rentalId) {
        const rental = await tickets.customerRental(body.rentalId);
        if (rental?.userId !== userId) throw notFound('rental', body.rentalId);
        if (rental.scooterId !== body.scooterId) throw new DomainError('VALIDATION_FAILED', { field: 'scooterId' });
      }
      const scooter = await new DrizzleServiceRepository(tx).lockScooter(body.scooterId);
      // Hulajnoga wycofana z floty nie ma karty w aplikacji; zgłoszenie z jej przejazdu jest dozwolone.
      if (!scooter || (scooter.status === 'RETIRED' && !body.rentalId)) throw notFound('scooter', body.scooterId);
      const valid = validateTicket({
        source: 'USER',
        categories: body.categories,
        description: body.description,
        photoCount: uniquePhotos(body.photoIds).length,
        hasRental: body.rentalId !== null,
      });
      for (const fileId of body.photoIds) {
        await this.files.ensureAttachable(tx, fileId, { userId }, 'TICKET_PHOTO');
      }
      const ticket = await tickets.insert({
        scooterId: body.scooterId,
        rentalId: body.rentalId,
        reportedBy: userId,
        source: 'USER',
        categories: valid.categories,
        description: valid.description,
        urgent: valid.urgent,
        assigneeId: null,
      });
      await tickets.addPhotos(ticket.id, body.photoIds);
      if (valid.urgent) await this.operations.holdScooter(systemScope(tx), body.scooterId, { ticketId: ticket.id });
      // Push „Otrzymaliśmy zgłoszenie” (ADR 0058) w tej transakcji.
      await this.notifications.ticketReceived(tx, { ...ticket, reportedBy: userId }, scooter.number);
      effects.tickets.add(ticket.id);
      return ticket.id;
    });
    await this.operations.afterCommit(effects);
    return this.customerView(userId, id);
  }

  customerList(userId: string): Promise<CustomerTicketListItem[]> {
    return new DrizzleTicketRepository(this.db).forCustomer(userId, CUSTOMER_TICKETS_LIMIT);
  }

  /** Szczegóły w aplikacji; otwarcie oznacza odpowiedź jako przeczytaną (D7). */
  async customerTicket(userId: string, id: string): Promise<CustomerTicketView> {
    if (await new DrizzleTicketRepository(this.db).markReplyRead(id, userId)) {
      const effects = new OperationsEffects();
      effects.tickets.add(id);
      await this.operations.afterCommit(effects);
    }
    return this.customerView(userId, id);
  }

  private async customerView(userId: string, id: string): Promise<CustomerTicketView> {
    const repo = new DrizzleTicketRepository(this.db);
    const ticket = await repo.customerTicket(id, userId);
    if (!ticket) throw notFound('ticket', id);
    // Klient widzi tylko własne zdjęcia; zdjęcia operatora (np. z oględzin) są w panelu.
    const [photos, timeline] = await Promise.all([this.photos(repo, id, userId), repo.timeline(id)]);
    return {
      id: ticket.id,
      number: ticket.number,
      status: ticket.status,
      categories: ticket.categories,
      scooterNumber: ticket.scooterNumber,
      createdAt: ticket.createdAt.toISOString(),
      updatedAt: ticket.updatedAt.toISOString(),
      hasUnreadReply: ticket.customerReplyAt !== null && ticket.customerReplyReadAt === null,
      description: ticket.description,
      rental:
        ticket.rentalId && ticket.rentalNumber !== null
          ? { id: ticket.rentalId, number: ticket.rentalNumber, endedAt: ticket.rentalEndedAt?.toISOString() ?? null }
          : null,
      photos,
      reply: replyView(ticket),
      refund: ticket.refundAmount ? { amount: ticket.refundAmount, receiptId: ticket.refundReceiptId } : null,
      history: statusHistory(ticket, timeline),
      resolvedAt: ticket.resolvedAt?.toISOString() ?? null,
    };
  }

  // --- Panel ----------------------------------------------------------------------------------

  /**
   * Lista na wzorcu (ADR 0031); bez `users.read` bez danych klienta i bez wyszukiwania po nich (ADR 0055), bez
   * `payments.read` bez kwoty zwrotów i bez filtrowania ani sortowania po niej (Serwisant).
   */
  async list(staffId: string, query: ListQuery): Promise<ListResponse<TicketListItem>> {
    const { seesCustomers, seesPayments } = await this.access(staffId);
    const repo = new DrizzleTicketRepository(this.db);
    const hidden = [...(seesCustomers ? [] : TICKET_PERSONAL_FIELDS), ...(seesPayments ? [] : TICKET_PAYMENT_FIELDS)];
    const used = (field: string) => (hidden as readonly string[]).includes(field);
    const blocked = [...query.filters.map((f) => f.field), ...query.sort.map((s) => s.field)].find(used);
    if (blocked) {
      const permission = (TICKET_PAYMENT_FIELDS as readonly string[]).includes(blocked)
        ? 'payments.read'
        : 'users.read';
      throw new DomainError('FORBIDDEN', { permission });
    }
    const result = await repo.list(query, seesCustomers ? undefined : ticketsWithoutPersonalData);
    return {
      ...result,
      items: result.items.map((item) => ({
        ...(seesCustomers ? item : withoutCustomer(item)),
        refundedAmount: seesPayments ? item.refundedAmount : null,
      })),
    };
  }

  async details(staffId: string, id: string): Promise<TicketAdminDetails> {
    const repo = new DrizzleTicketRepository(this.db);
    const service = new DrizzleServiceRepository(this.db);
    const [item, ticket] = await Promise.all([repo.listItem(id), repo.find(id)]);
    if (!item || !ticket) throw notFound('ticket', id);
    const [{ seesCustomers, seesPayments }, photos, tasks, timeline, scooter, openTypes] = await Promise.all([
      this.access(staffId),
      this.photos(repo, id),
      service.tasksForTicket(id),
      repo.timeline(id),
      service.scooterState(ticket.scooterId),
      service.openTaskTypes(ticket.scooterId),
    ]);
    return {
      id: ticket.id,
      number: ticket.number,
      version: ticket.version,
      source: ticket.source,
      autoKind: ticket.autoKind,
      status: ticket.status,
      urgent: ticket.urgent,
      categories: ticket.categories,
      description: ticket.description,
      scooter: {
        id: ticket.scooterId,
        number: item.scooterNumber,
        status: item.scooterStatus,
        online: scooter?.online ?? false,
        batteryPct: scooter?.batteryPct ?? null,
      },
      rental: item.rentalId && item.rentalNumber !== null ? { id: item.rentalId, number: item.rentalNumber } : null,
      reporter: ticket.reportedBy ? { id: ticket.reportedBy, name: seesCustomers ? item.reporterName : null } : null,
      assignee: item.assigneeId ? { id: item.assigneeId, name: item.assigneeName ?? '' } : null,
      photos,
      reply: replyView(ticket),
      resolutionNote: ticket.resolutionNote,
      tasks,
      suggestedTaskType: suggestTaskType(ticket.categories),
      availableTaskTypes: scooter?.status === 'RETIRED' ? [] : availableTaskTypes(openTypes),
      // Zwroty z reklamacji (kwota i wpisy osi czasu) tylko z `payments.read`; Serwisant ich nie widzi (ADR 0055).
      refundedAmount: seesPayments ? item.refundedAmount : null,
      timeline: seesPayments
        ? timeline
        : timeline.filter((e) => e.entityType !== 'rental' && e.entityType !== 'refund'),
      createdAt: ticket.createdAt.toISOString(),
      updatedAt: ticket.updatedAt.toISOString(),
      resolvedAt: ticket.resolvedAt?.toISOString() ?? null,
    };
  }

  /** Zgłoszenie operatora (`STAFF`) z karty hulajnogi albo przejazdu; kategorie systemowe dozwolone. */
  async createByStaff(staffId: string, body: StaffTicketCreate): Promise<TicketAdminDetails> {
    const effects = new OperationsEffects();
    const id = await this.audited.run(staffId, async (scope) => {
      const { tx } = scope;
      const tickets = new DrizzleTicketRepository(tx);
      const service = new DrizzleServiceRepository(tx);
      const scooter = await service.lockScooter(body.scooterId);
      if (!scooter) throw notFound('scooter', body.scooterId);
      if (body.rentalId) {
        const rental = await tickets.customerRental(body.rentalId);
        if (!rental) throw notFound('rental', body.rentalId);
        if (rental.scooterId !== body.scooterId) throw new DomainError('VALIDATION_FAILED', { field: 'scooterId' });
      }
      if (body.assigneeId && !(await service.activeStaff(body.assigneeId))) {
        throw new DomainError('VALIDATION_FAILED', { field: 'assigneeId' });
      }
      const valid = validateTicket({
        source: 'STAFF',
        categories: body.categories,
        description: body.description,
        photoCount: uniquePhotos(body.photoIds).length,
        hasRental: body.rentalId !== null,
      });
      for (const fileId of body.photoIds) await this.files.ensureAttachable(tx, fileId, { staffId }, 'TICKET_PHOTO');
      const ticket = await tickets.insert({
        scooterId: body.scooterId,
        rentalId: body.rentalId,
        reportedBy: null,
        source: 'STAFF',
        categories: valid.categories,
        description: valid.description,
        urgent: valid.urgent,
        assigneeId: body.assigneeId,
      });
      await tickets.addPhotos(ticket.id, body.photoIds);
      await scope.audit({
        action: 'ticket.created',
        entityType: 'ticket',
        entityId: ticket.id,
        data: {
          number: ticket.number,
          source: 'STAFF',
          categories: valid.categories,
          scooterId: body.scooterId,
          ...(body.rentalId ? { rentalId: body.rentalId } : {}),
          ...(body.assigneeId ? { assigneeId: body.assigneeId } : {}),
          photos: body.photoIds.length,
        },
      });
      if (valid.urgent) await this.operations.holdScooter(scope, body.scooterId, { ticketId: ticket.id });
      effects.tickets.add(ticket.id);
      return ticket.id;
    });
    await this.operations.afterCommit(effects);
    return this.details(staffId, id);
  }

  /** Przypisanie dyspozytora albo serwisanta (`null` zdejmuje przypisanie). */
  async assign(staffId: string, id: string, body: TicketAssign): Promise<TicketAdminDetails> {
    const effects = new OperationsEffects();
    await this.audited.run(staffId, async ({ tx, audit }) => {
      const tickets = new DrizzleTicketRepository(tx);
      const ticket = await tickets.lock(id);
      if (!ticket) throw notFound('ticket', id);
      ensureVersion(body.version, ticket.version);
      ensureCanAssignTicket(ticket.status);
      if (ticket.assigneeId === body.assigneeId) return;
      const assignee = body.assigneeId ? await new DrizzleServiceRepository(tx).activeStaff(body.assigneeId) : null;
      if (body.assigneeId && !assignee) throw new DomainError('VALIDATION_FAILED', { field: 'assigneeId' });
      await tickets.update(id, body.version, { assigneeId: body.assigneeId });
      await audit({
        action: 'ticket.assigned',
        entityType: 'ticket',
        entityId: id,
        data: {
          changes: { assigneeId: [ticket.assigneeId, body.assigneeId] },
          ...(assignee ? { assigneeName: assignee.name } : {}),
          version: [body.version, body.version + 1],
        },
      });
      effects.tickets.add(id);
    });
    await this.operations.afterCommit(effects);
    return this.details(staffId, id);
  }

  /**
   * Zmiana statusu i (albo) odpowiedź dla klienta (D7): reguły w `decideTicketUpdate`; nowa odpowiedź zastępuje
   * poprzednią (poprzednie zostają w dzienniku audytu), notatka rozwiązania jest tylko w panelu.
   */
  async changeStatus(staffId: string, id: string, body: TicketStatusChange): Promise<TicketAdminDetails> {
    const effects = new OperationsEffects();
    const found = await new DrizzleTicketRepository(this.db).find(id);
    if (!found) throw notFound('ticket', id);
    await this.audited.run(staffId, async (scope) => {
      const { tx, audit } = scope;
      // Blokady w kolejności hulajnoga, zgłoszenie (jak po zakończeniu zadania): rozwiązanie pilnego zgłoszenia
      // zmienia przyczynę stanu hulajnogi.
      if (found.urgent) await new DrizzleServiceRepository(tx).lockScooter(found.scooterId);
      const tickets = new DrizzleTicketRepository(tx);
      const ticket = await tickets.lock(id);
      if (!ticket) throw notFound('ticket', id);
      ensureVersion(body.version, ticket.version);
      const decision = decideTicketUpdate({
        ticket,
        status: body.status,
        reply: body.reply,
        openTasks: (await tickets.taskCounts(id)).open,
      });
      const note = body.note?.trim() || null;
      await tickets.update(id, body.version, {
        ...(decision.statusChanged ? { status: decision.status } : {}),
        ...(decision.reply ? { customerReply: decision.reply } : {}),
        ...(note ? { resolutionNote: note } : {}),
      });
      await audit({
        action: decision.statusChanged ? 'ticket.status_changed' : 'ticket.replied',
        entityType: 'ticket',
        entityId: id,
        data: {
          ...(decision.statusChanged ? { changes: { status: [ticket.status, decision.status] } } : {}),
          ...(decision.reply ? { reply: decision.reply } : {}),
          ...(note ? { note } : {}),
          version: [body.version, body.version + 1],
        },
      });
      // Ręczne rozwiązanie pilnego zgłoszenia: hulajnoga w serwisie dostaje przyczynę z reguły powrotu do floty.
      if (decision.statusChanged && decision.status === 'RESOLVED' && ticket.urgent) {
        await this.operations.afterUrgentTicketResolved(scope, ticket.scooterId, id);
      }
      if (decision.notifyCustomer) {
        // Push z odpowiedzią albo nowym statusem (D7, ADR 0058); klucz idempotencji z wersją zgłoszenia po zmianie.
        await this.notifications.ticketStatusChanged(tx, ticket, {
          status: decision.status,
          // Tylko nowa odpowiedź; poprzednia jest już w aplikacji.
          reply: decision.reply,
          version: body.version + 1,
        });
      }
      effects.tickets.add(id);
    });
    await this.operations.afterCommit(effects);
    return this.details(staffId, id);
  }

  /** Zdjęcie operatora w zgłoszeniu (plik z `POST /files` z celem `TICKET_PHOTO`), najwyżej 3 na zgłoszenie. */
  async addPhoto(staffId: string, id: string, fileId: string): Promise<TicketAdminDetails> {
    const effects = new OperationsEffects();
    await this.audited.run(staffId, async ({ tx, audit }) => {
      const tickets = new DrizzleTicketRepository(tx);
      const ticket = await tickets.lock(id);
      if (!ticket) throw notFound('ticket', id);
      ensureCanAssignTicket(ticket.status);
      await this.files.ensureAttachable(tx, fileId, { staffId }, 'TICKET_PHOTO');
      await tickets.addPhotos(id, [fileId]);
      await tickets.update(id, null, {});
      await audit({ action: 'ticket.photo_added', entityType: 'ticket', entityId: id, data: { fileId } });
      effects.tickets.add(id);
    });
    await this.operations.afterCommit(effects);
    return this.details(staffId, id);
  }

  /** Usunięcie zdjęcia ze zgłoszenia; plik bez przypięcia usuwa zadanie `files.cleanup`. */
  async removePhoto(staffId: string, id: string, fileId: string): Promise<TicketAdminDetails> {
    const effects = new OperationsEffects();
    await this.audited.run(staffId, async ({ tx, audit }) => {
      const tickets = new DrizzleTicketRepository(tx);
      const ticket = await tickets.lock(id);
      if (!ticket) throw notFound('ticket', id);
      ensureCanAssignTicket(ticket.status);
      if (!(await tickets.removePhoto(id, fileId))) throw notFound('ticket_photo', fileId);
      await tickets.update(id, null, {});
      await audit({ action: 'ticket.photo_removed', entityType: 'ticket', entityId: id, data: { fileId } });
      effects.tickets.add(id);
    });
    await this.operations.afterCommit(effects);
    return this.details(staffId, id);
  }

  /**
   * Zwrot z reklamacji (pytanie 6): `refunds.ticket_id` w transakcji zwrotu; wpis `rental.refunded` trafia na oś
   * zgłoszenia przez `v_ticket_timeline`. Zgłoszenie musi dotyczyć zwracanego przejazdu.
   */
  async linkRefund(
    tx: DbExecutor,
    ticketId: string,
    rentalId: string,
    refundId: string,
    effects: OperationsEffects,
  ): Promise<void> {
    const tickets = new DrizzleTicketRepository(tx);
    const ticket = await tickets.lock(ticketId);
    if (!ticket) throw notFound('ticket', ticketId);
    if (ticket.rentalId !== rentalId) throw new DomainError('TICKET_RENTAL_MISMATCH', { ticketId, rentalId });
    await tickets.linkRefund(refundId, ticketId);
    effects.tickets.add(ticketId);
  }

  // --- Zgłoszenia automatyczne `OFFLINE` (ADR 0055) ------------------------------------------------

  /**
   * Utrata łączności (Last Will): sprawdzenie po 5 min, jedno oczekujące na hulajnogę (kolejka `short`
   * z `singletonKey`). Dotyczy każdej hulajnogi, nie tylko w przejeździe.
   */
  async scheduleOfflineCheck(scooterId: string, lostAt: Date): Promise<void> {
    await this.jobs.send(
      JOBS.ticketsOfflineCheck,
      { scooterId, lostAt: lostAt.toISOString() },
      { startAfter: new Date(lostAt.getTime() + OFFLINE_TICKET_AFTER_MS), singletonKey: scooterId },
    );
  }

  /**
   * Zadanie `tickets.offline-check`: hulajnoga nadal offline od co najmniej 5 min dostaje zgłoszenie `OFFLINE`
   * (duplikat odrzuca indeks). Po krótkim powrocie łączności i ponownej utracie czas liczy się od ostatniego
   * sygnału, a sprawdzenie przechodzi na nowy termin.
   */
  async offlineCheck(scooterId: string, lostAt: Date): Promise<void> {
    const service = new DrizzleServiceRepository(this.db);
    const scooter = await service.scooterState(scooterId);
    if (!scooter || scooter.online || scooter.status === 'RETIRED') return;
    const lastSeen = scooter.lastSeenAt?.getTime() ?? 0;
    const offlineSince = new Date(Math.max(lostAt.getTime(), lastSeen));
    const now = new Date();
    if (!shouldOpenOfflineTicket({ online: scooter.online, offlineSince, now })) {
      await this.scheduleOfflineCheck(scooterId, offlineSince);
      return;
    }
    const effects = new OperationsEffects();
    await this.transaction(async (tx) => {
      const locked = await new DrizzleServiceRepository(tx).lockScooter(scooterId);
      if (!locked || locked.online) return;
      await this.operations.openAutoTicket(
        systemScope(tx),
        {
          scooterId,
          kind: 'OFFLINE',
          rentalId: await new DrizzleTicketRepository(tx).openRentalOf(scooterId),
          data: { offlineSince: offlineSince.toISOString(), lastSeenAt: locked.lastSeenAt?.toISOString() ?? null },
        },
        effects,
      );
    });
    await this.operations.afterCommit(effects);
  }

  /**
   * Powrót łączności: zgłoszenie `OFFLINE` bez zadania w stanie `NEW` albo `IN_PROGRESS` zamyka się samo
   * (`canAutoCloseOfflineTicket`) z wpisem systemu; dotyczy też zgłoszenia po `END_UNCONFIRMED`.
   */
  async onConnectionRestored(scooterId: string): Promise<void> {
    const effects = new OperationsEffects();
    await this.transaction(async (tx) => {
      const tickets = new DrizzleTicketRepository(tx);
      const ticket = await tickets.lockOpenAuto(scooterId, 'OFFLINE');
      if (!ticket) return;
      if (
        !canAutoCloseOfflineTicket({ autoKind: ticket.autoKind, status: ticket.status, hasTasks: ticket.tasks > 0 })
      ) {
        return;
      }
      await tickets.update(ticket.id, null, { status: 'RESOLVED' });
      await systemScope(tx).system({
        action: 'ticket.auto_closed',
        entityType: 'ticket',
        entityId: ticket.id,
        data: { changes: { status: [ticket.status, 'RESOLVED'] }, reason: 'CONNECTION_RESTORED' },
      });
      effects.tickets.add(ticket.id);
    });
    await this.operations.afterCommit(effects);
  }

  // --- Wspólne --------------------------------------------------------------------------------

  private async access(staffId: string): Promise<{ seesCustomers: boolean; seesPayments: boolean }> {
    const { permissions } = await this.permissions.get(staffId);
    return { seesCustomers: permissions.has('users.read'), seesPayments: permissions.has('payments.read') };
  }

  private async photos(repo: DrizzleTicketRepository, ticketId: string, uploadedBy?: string): Promise<FileView[]> {
    const views = await Promise.all((await repo.photoIds(ticketId, uploadedBy)).map((id) => this.files.viewById(id)));
    return views.filter((v): v is FileView => v !== null);
  }

  private async transaction<T>(work: (tx: DbExecutor) => Promise<T>): Promise<T> {
    try {
      return await this.db.transaction(work);
    } catch (error) {
      rethrowDatabaseRule(error);
    }
  }
}

const uniquePhotos = (ids: readonly string[]): string[] => {
  const unique = [...new Set(ids)];
  if (unique.length !== ids.length) throw new DomainError('VALIDATION_FAILED', { field: 'photoIds' });
  return unique;
};

const replyView = (ticket: TicketRecord) =>
  ticket.customerReply && ticket.customerReplyAt
    ? {
        text: ticket.customerReply,
        at: ticket.customerReplyAt.toISOString(),
        readAt: ticket.customerReplyReadAt?.toISOString() ?? null,
      }
    : null;

/** Historia statusów dla klienta: utworzenie i zmiany statusu z osi czasu, bez nazwisk i notatek (ADR 0055). */
function statusHistory(ticket: TicketRecord, timeline: TicketTimelineEntry[]): CustomerTicketStatusEntry[] {
  const history: CustomerTicketStatusEntry[] = [{ status: 'NEW', at: ticket.createdAt.toISOString() }];
  for (const entry of timeline) {
    if (entry.entityType !== 'ticket') continue;
    const change = (entry.data.changes as { status?: [TicketStatus, TicketStatus] } | undefined)?.status;
    if (change) history.push({ status: change[1], at: entry.at });
  }
  return history;
}

/** Wiersz listy bez danych klienta (operator bez `users.read`). */
const withoutCustomer = (item: TicketListItem): TicketListItem => ({
  ...item,
  reporterName: null,
  reporterPhone: null,
});
