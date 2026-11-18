import {
  availableTaskTypes,
  decideTaskCancel,
  decideTaskComplete,
  decideTaskStart,
  DomainError,
  ensureCanRetire,
  ensureCanReturnToFleet,
  ensurePartUse,
  ensureTaskAcceptsParts,
  ensureVersion,
  notFound,
  ServiceTaskStateMachine,
  statusAfterService,
  ticketStatusOnTaskClosed,
  type ServiceTaskType,
} from '@hulajnogi/core';
import { type Database, DrizzleServiceRepository, DrizzleTicketRepository } from '@hulajnogi/db';
import type {
  ListQuery,
  ListResponse,
  ScooterRetire,
  ScooterReturn,
  ScooterServiceSummary,
  ServiceTaskAssign,
  ServiceTaskCancel,
  ServiceTaskComplete,
  ServiceTaskCreate,
  ServiceTaskDetails,
  ServiceTaskListItem,
  ServiceTaskStart,
  TaskPartAdd,
  TaskPartRemove,
} from '@hulajnogi/shared';
import { Inject, Injectable } from '@nestjs/common';
import { AuditedTransaction, type AuditScope } from '../audit/audited-transaction.js';
import { DB } from '../database/database.module.js';
import { NotificationsService } from '../notifications/notifications.service.js';
import { OperationsEffects, OperationsService, returnCheck } from './operations.service.js';

/** Ostatnie zadania na karcie hulajnogi (zakładka „Serwis”). */
const SCOOTER_TASKS_LIMIT = 20;

/**
 * Zadania serwisowe i stan hulajnogi w serwisie (ADR 0055): przejścia z core, części przez procedury magazynu,
 * powrót do floty po ostatnim zadaniu w tej samej transakcji i „Przywróć do floty” albo „Wyłącz z ruchu” z karty
 * hulajnogi. Blokady zawsze w kolejności hulajnoga, zadanie (jak w module Wypożyczenia: najpierw hulajnoga).
 */
@Injectable()
export class ServiceTasksService {
  constructor(
    @Inject(DB) private readonly db: Database,
    private readonly audited: AuditedTransaction,
    private readonly operations: OperationsService,
    private readonly notifications: NotificationsService,
  ) {}

  list(query: ListQuery): Promise<ListResponse<ServiceTaskListItem>> {
    return new DrizzleServiceRepository(this.db).listTasks(query);
  }

  /** „Moje zadania”: lista z filtrem wykonawcy ustawionym na operatora. */
  mine(staffId: string, query: ListQuery): Promise<ListResponse<ServiceTaskListItem>> {
    return this.list({
      ...query,
      filters: [
        ...query.filters.filter((f) => f.field !== 'assigneeId'),
        { field: 'assigneeId', op: 'eq', values: [staffId] },
      ],
    });
  }

  async details(id: string): Promise<ServiceTaskDetails> {
    const repo = new DrizzleServiceRepository(this.db);
    const [item, extras, parts] = await Promise.all([repo.taskItem(id), repo.taskExtras(id), repo.taskParts(id)]);
    if (!item || !extras) throw notFound('service_task', id);
    const tickets = new DrizzleTicketRepository(this.db);
    const [scooter, ticket, ticketTasks, minBatteryPct] = await Promise.all([
      repo.scooterState(item.scooterId),
      item.ticketId ? tickets.find(item.ticketId) : null,
      item.ticketId ? tickets.taskCounts(item.ticketId) : null,
      repo.minBatteryPct(),
    ]);
    const open = ServiceTaskStateMachine.isOpen(item.status);
    // Zakończenie ostatniego zadania pilnego zgłoszenia najpierw je rozwiązuje (`ticketAfterTask`), więc to zgłoszenie
    // nie jest przeszkodą w „Skutku dla hulajnogi”.
    const resolvesUrgentTicket =
      open &&
      ticket !== null &&
      ticket.urgent &&
      ticketTasks !== null &&
      ticketStatusOnTaskClosed({
        status: ticket.status,
        openTasks: ticketTasks.open - 1,
        doneTasks: ticketTasks.done + 1,
      }) === 'RESOLVED';
    return {
      id: item.id,
      number: item.number,
      type: item.type,
      status: item.status,
      priority: item.priority,
      assigneeId: item.assigneeId,
      assigneeName: item.assigneeName,
      partsCost: item.partsCost,
      createdAt: new Date(item.createdAt).toISOString(),
      completedAt: item.completedAt ? new Date(item.completedAt).toISOString() : null,
      version: item.version,
      scooter: {
        id: item.scooterId,
        number: item.scooterNumber,
        status: item.scooterStatus,
        statusReason: scooter?.statusReason ?? null,
      },
      ticket: ticket
        ? { id: ticket.id, number: ticket.number, categories: ticket.categories, urgent: ticket.urgent }
        : null,
      description: extras.description,
      resultNote: extras.resultNote,
      cancelReason: extras.cancelReason,
      dueAt: extras.dueAt?.toISOString() ?? null,
      startedAt: extras.startedAt?.toISOString() ?? null,
      target: extras.target,
      parts,
      // „Skutek dla hulajnogi” w oknie zakończenia: otwarte zadania poza tym, bateria z telemetrii (po wymianie
      // hulajnoga wraca do floty po odczycie nowej baterii, ADR 0059).
      returnCheck: returnCheck(scooter!, minBatteryPct, {
        excludeOpenTask: open,
        excludeUrgentTicket: resolvesUrgentTicket,
      }),
    };
  }

  /** Utworzenie ze zgłoszenia albo z karty hulajnogi („Wyślij do serwisu”). */
  async create(staffId: string, body: ServiceTaskCreate): Promise<ServiceTaskDetails> {
    const effects = new OperationsEffects();
    const task = await this.audited.run(staffId, async (scope) => {
      const service = new DrizzleServiceRepository(scope.tx);
      if (body.ticketId) {
        const ticket = await new DrizzleTicketRepository(scope.tx).find(body.ticketId);
        if (!ticket) throw notFound('ticket', body.ticketId);
        if (ticket.scooterId !== body.scooterId) throw new DomainError('VALIDATION_FAILED', { field: 'scooterId' });
      }
      if (body.assigneeId && !(await service.activeStaff(body.assigneeId))) {
        throw new DomainError('VALIDATION_FAILED', { field: 'assigneeId' });
      }
      return this.operations.createTask(
        scope,
        {
          scooterId: body.scooterId,
          type: body.type,
          ticketId: body.ticketId,
          priority: body.priority,
          description: body.description,
          assigneeId: body.assigneeId,
          dueAt: body.dueAt ? new Date(body.dueAt) : null,
          target: body.target,
          staffId,
        },
        effects,
      );
    });
    await this.operations.afterCommit(effects);
    return this.details(task.id);
  }

  /** Przypisanie wykonawcy; zadanie w toku musi mieć wykonawcę. */
  async assign(staffId: string, id: string, body: ServiceTaskAssign): Promise<ServiceTaskDetails> {
    await this.taskCommand(staffId, id, body.version, async ({ audit }, service, task) => {
      if (!ServiceTaskStateMachine.isOpen(task.status)) throw new DomainError('TASK_CLOSED', { status: task.status });
      if (task.assigneeId === body.assigneeId) return;
      if (!body.assigneeId && task.status === 'IN_PROGRESS') {
        throw new DomainError('VALIDATION_FAILED', { field: 'assigneeId' });
      }
      const assignee = body.assigneeId ? await service.activeStaff(body.assigneeId) : null;
      if (body.assigneeId && !assignee) throw new DomainError('VALIDATION_FAILED', { field: 'assigneeId' });
      await service.updateTask(id, body.version, { assigneeId: body.assigneeId });
      await audit({
        action: 'service_task.assigned',
        entityType: 'service_task',
        entityId: id,
        data: {
          changes: { assigneeId: [task.assigneeId, body.assigneeId] },
          ...(assignee ? { assigneeName: assignee.name } : {}),
          version: [body.version, body.version + 1],
        },
      });
    });
    return this.details(id);
  }

  /** „Rozpocznij”: nieprzypisane zadanie dostaje operatora (`decideTaskStart`). */
  async start(staffId: string, id: string, body: ServiceTaskStart): Promise<ServiceTaskDetails> {
    await this.taskCommand(staffId, id, body.version, async ({ audit }, service, task) => {
      const decision = decideTaskStart(task, staffId);
      await service.updateTask(id, body.version, { status: decision.to, assigneeId: decision.assigneeId });
      await audit({
        action: 'service_task.started',
        entityType: 'service_task',
        entityId: id,
        data: {
          changes: {
            status: [task.status, decision.to],
            ...(task.assigneeId !== decision.assigneeId ? { assigneeId: [task.assigneeId, decision.assigneeId] } : {}),
          },
          version: [body.version, body.version + 1],
        },
      });
    });
    return this.details(id);
  }

  /** Część z magazynu w zadaniu w toku: stan maleje od razu (`sp_task_use_part`), ruch `USE`. */
  async addPart(staffId: string, id: string, body: TaskPartAdd): Promise<ServiceTaskDetails> {
    await this.taskCommand(staffId, id, null, async ({ audit }, service, task) => {
      ensureTaskAcceptsParts(task.status);
      const part = await service.partState(body.partId);
      if (!part) throw notFound('spare_part', body.partId);
      ensurePartUse({ stockQty: part.stockQty, quantity: body.quantity, active: part.active });
      const result = await service.useParts(id, body.partId, body.quantity, staffId);
      await audit({
        action: 'service_task.part_added',
        entityType: 'service_task',
        entityId: id,
        data: { partId: body.partId, sku: part.sku, quantity: body.quantity, ...result },
      });
    });
    return this.details(id);
  }

  /** Zwrot części do magazynu (ruch `RETURN`); bez ilości cała pozycja. */
  async removePart(staffId: string, id: string, body: TaskPartRemove): Promise<ServiceTaskDetails> {
    await this.taskCommand(staffId, id, null, async ({ audit }, service, task) => {
      ensureTaskAcceptsParts(task.status);
      const result = await service.returnPart(id, body.partId, body.quantity ?? null, staffId);
      await audit({
        action: 'service_task.part_removed',
        entityType: 'service_task',
        entityId: id,
        data: { partId: body.partId, ...(body.quantity ? { quantity: body.quantity } : {}), ...result },
      });
    });
    return this.details(id);
  }

  /**
   * Zakończenie z notatką: zgłoszenie po ostatnim zadaniu dostaje `RESOLVED`, hulajnoga bez przeszkód (z baterią
   * z telemetrii) wraca do floty w tej samej transakcji, a wymiana baterii wysyła po zatwierdzeniu komendę
   * `battery_swapped` (ADR 0059). Po wymianie z baterią poniżej progu hulajnoga zostaje w serwisie
   * (`BATTERY_BELOW_THRESHOLD`) i wraca sama po odczycie nowej baterii (moduł Telemetria).
   */
  async complete(staffId: string, id: string, body: ServiceTaskComplete): Promise<ServiceTaskDetails> {
    await this.taskCommand(staffId, id, body.version, async (scope, service, task, effects) => {
      const decision = decideTaskComplete(task, body.note);
      await service.updateTask(id, body.version, { status: decision.to, resultNote: decision.note });
      await scope.audit({
        action: 'service_task.completed',
        entityType: 'service_task',
        entityId: id,
        data: {
          changes: { status: [task.status, decision.to] },
          note: decision.note,
          version: [body.version, body.version + 1],
        },
      });
      if (task.ticketId) await this.ticketAfterTask(scope, task.ticketId, id, effects);
      await this.afterService(scope, task.scooterId, id);
      if (decision.sendBatterySwapped)
        effects.systemCommands.push({ scooterId: task.scooterId, type: 'BATTERY_SWAPPED' });
    });
    return this.details(id);
  }

  /**
   * Anulowanie z powodem: części wracają do magazynu (wyzwalacz bazy), zgłoszenie po anulowaniu wszystkich zadań
   * wraca do dyspozytora (`IN_PROGRESS`), a hulajnoga po ostatnim zadaniu przechodzi tę samą regułę powrotu.
   */
  async cancel(staffId: string, id: string, body: ServiceTaskCancel): Promise<ServiceTaskDetails> {
    await this.taskCommand(staffId, id, body.version, async (scope, service, task, effects) => {
      const decision = decideTaskCancel(task, body.reason);
      await service.updateTask(id, body.version, {
        status: decision.to,
        cancelReason: decision.reason,
        cancelledBy: staffId,
      });
      await scope.audit({
        action: 'service_task.cancelled',
        entityType: 'service_task',
        entityId: id,
        data: {
          changes: { status: [task.status, decision.to] },
          reason: decision.reason,
          version: [body.version, body.version + 1],
        },
      });
      if (task.ticketId) await this.ticketAfterTask(scope, task.ticketId, id, effects);
      await this.afterService(scope, task.scooterId, id);
    });
    return this.details(id);
  }

  // --- Hulajnoga ------------------------------------------------------------------------------

  /** Zakładka „Serwis” na karcie hulajnogi: reguła powrotu, dostępne rodzaje zadań, zadania i koszt części. */
  async scooterSummary(scooterId: string): Promise<ScooterServiceSummary> {
    const repo = new DrizzleServiceRepository(this.db);
    const scooter = await repo.scooterState(scooterId);
    if (!scooter) throw notFound('scooter', scooterId);
    const [minBatteryPct, openTypes, tasks, totals] = await Promise.all([
      repo.minBatteryPct(),
      repo.openTaskTypes(scooterId),
      repo.tasksForScooter(scooterId, SCOOTER_TASKS_LIMIT),
      repo.scooterServiceTotals(scooterId),
    ]);
    return {
      scooterId,
      scooterNumber: scooter.number,
      status: scooter.status,
      statusReason: scooter.statusReason,
      statusChangedAt: scooter.statusChangedAt.toISOString(),
      version: scooter.version,
      returnCheck: returnCheck(scooter, minBatteryPct),
      availableTaskTypes: scooter.status === 'RETIRED' ? [] : availableTaskTypes(openTypes as ServiceTaskType[]),
      openTickets: scooter.openTickets,
      tasks,
      tasksDone: totals.tasksDone,
      partsCost: totals.partsCost,
    };
  }

  /** „Przywróć do floty” (`service.manage`): ta sama reguła co po ostatnim zadaniu (`ensureCanReturnToFleet`). */
  async returnToFleet(staffId: string, scooterId: string, body: ScooterReturn): Promise<ScooterServiceSummary> {
    await this.audited.run(staffId, async ({ tx, audit }) => {
      const service = new DrizzleServiceRepository(tx);
      const scooter = await service.lockScooter(scooterId);
      if (!scooter) throw notFound('scooter', scooterId);
      ensureVersion(body.version, scooter.version);
      const check = returnCheck(scooter, await service.minBatteryPct());
      ensureCanReturnToFleet(scooter.status, check.blockers);
      await service.setScooterStatus(scooterId, 'AVAILABLE', null);
      await audit({
        action: 'scooter.returned_to_fleet',
        entityType: 'scooter',
        entityId: scooterId,
        data: {
          changes: { status: [scooter.status, 'AVAILABLE'], statusReason: [scooter.statusReason, null] },
          ...(body.note ? { note: body.note } : {}),
          version: [body.version, body.version + 1],
        },
      });
    });
    return this.scooterSummary(scooterId);
  }

  /** „Wyłącz z ruchu” (`scooters.write`): `RETIRED` z powodem, niedostępne w przejeździe i przy otwartych zadaniach. */
  async retire(staffId: string, scooterId: string, body: ScooterRetire): Promise<ScooterServiceSummary> {
    await this.audited.run(staffId, async ({ tx, audit }) => {
      const service = new DrizzleServiceRepository(tx);
      const scooter = await service.lockScooter(scooterId);
      if (!scooter) throw notFound('scooter', scooterId);
      ensureVersion(body.version, scooter.version);
      ensureCanRetire({
        status: scooter.status,
        hasOpenRental: scooter.hasOpenRental,
        openTasks: scooter.openTasks,
        reason: body.reason,
        note: body.note,
      });
      await service.setScooterStatus(scooterId, 'RETIRED', body.reason);
      await audit({
        action: 'scooter.retired',
        entityType: 'scooter',
        entityId: scooterId,
        data: {
          changes: { status: [scooter.status, 'RETIRED'], statusReason: [scooter.statusReason, body.reason] },
          ...(body.note ? { note: body.note } : {}),
          version: [body.version, body.version + 1],
        },
      });
    });
    return this.scooterSummary(scooterId);
  }

  // --- Wspólne --------------------------------------------------------------------------------

  /**
   * Polecenie na zadaniu z dziennikiem audytu: blokada hulajnogi, potem zadania, wersja (gdy podana), zdarzenia
   * po zatwierdzeniu.
   */
  private async taskCommand(
    staffId: string,
    id: string,
    version: number | null,
    work: (
      scope: AuditScope,
      service: DrizzleServiceRepository,
      task: NonNullable<Awaited<ReturnType<DrizzleServiceRepository['lockTask']>>>,
      effects: OperationsEffects,
    ) => Promise<void>,
  ): Promise<void> {
    const found = await new DrizzleServiceRepository(this.db).findTask(id);
    if (!found) throw notFound('service_task', id);
    const effects = new OperationsEffects();
    await this.audited.run(staffId, async (scope) => {
      const service = new DrizzleServiceRepository(scope.tx);
      await service.lockScooter(found.scooterId);
      const task = await service.lockTask(id);
      if (!task) throw notFound('service_task', id);
      if (version !== null) ensureVersion(version, task.version);
      await work(scope, service, task, effects);
      effects.tasks.add(id);
    });
    await this.operations.afterCommit(effects);
  }

  /** Status zgłoszenia po zamknięciu zadania (`ticketStatusOnTaskClosed`): `RESOLVED` albo powrót do dyspozytora. */
  private async ticketAfterTask(
    { tx, audit }: AuditScope,
    ticketId: string,
    taskId: string,
    effects: OperationsEffects,
  ): Promise<void> {
    const tickets = new DrizzleTicketRepository(tx);
    const ticket = await tickets.lock(ticketId);
    if (!ticket) return;
    const counts = await tickets.taskCounts(ticketId);
    const to = ticketStatusOnTaskClosed({ status: ticket.status, openTasks: counts.open, doneTasks: counts.done });
    if (!to) return;
    await tickets.update(ticketId, null, { status: to });
    await audit({
      action: 'ticket.status_changed',
      entityType: 'ticket',
      entityId: ticketId,
      data: { changes: { status: [ticket.status, to] }, taskId },
    });
    if (ticket.source === 'USER') {
      // Push o zmianie statusu (ADR 0058); po naprawie zgłoszenie dostaje `RESOLVED` bez nowej odpowiedzi operatora.
      await this.notifications.ticketStatusChanged(tx, ticket, {
        status: to,
        reply: null,
        version: ticket.version + 1,
      });
    }
    effects.tickets.add(ticketId);
  }

  /**
   * Po ostatnim zadaniu (pytanie 5): hulajnoga w `MAINTENANCE` bez przeszkód wraca do `AVAILABLE`, inaczej zostaje
   * z przyczyną pierwszej przeszkody; wpisy systemu. Otwarte pilne zgłoszenie bez zadania też ją zatrzymuje
   * (przeszkoda `URGENT_TICKET`).
   */
  private async afterService({ tx, system }: AuditScope, scooterId: string, taskId: string): Promise<void> {
    const service = new DrizzleServiceRepository(tx);
    const scooter = await service.lockScooter(scooterId);
    if (scooter?.status !== 'MAINTENANCE') return;
    const check = returnCheck(scooter, await service.minBatteryPct());
    const next = statusAfterService(check.blockers);
    if (next.status === 'AVAILABLE') {
      await service.setScooterStatus(scooterId, 'AVAILABLE', null);
      await system({
        action: 'scooter.returned_to_fleet',
        entityType: 'scooter',
        entityId: scooterId,
        data: { changes: { status: ['MAINTENANCE', 'AVAILABLE'], statusReason: [scooter.statusReason, null] }, taskId },
      });
      return;
    }
    if (next.reason === scooter.statusReason) return;
    await service.setScooterStatus(scooterId, 'MAINTENANCE', next.reason);
    await system({
      action: 'scooter.kept_in_service',
      entityType: 'scooter',
      entityId: scooterId,
      data: { changes: { statusReason: [scooter.statusReason, next.reason] }, blockers: check.blockers, taskId },
    });
  }
}
