import {
  autoTicket,
  DomainError,
  maintenanceEffect,
  notFound,
  reasonAfterUrgentTicketResolved,
  returnToFleetBlockers,
  statusAfterService,
  taskPriorityForTicket,
  ticketStatusOnTaskOpened,
  validateNewTask,
  type AutoTicketKind,
  type CommandType,
  type GeoPoint,
  type ServiceTaskType,
  type TaskPriority,
} from '@hulajnogi/core';
import {
  type Database,
  type DbExecutor,
  DrizzleServiceRepository,
  DrizzleTicketRepository,
  type ScooterServiceState,
} from '@hulajnogi/db';
import type { ReturnToFleetCheck, ServiceTaskUpdated, TicketUpdated } from '@hulajnogi/shared';
import { Inject, Injectable, Logger } from '@nestjs/common';
import { systemAudit, type AuditRecord } from '../audit/audited-transaction.js';
import { DB } from '../database/database.module.js';
import { CommandsService } from '../fleet/commands.service.js';
import { NotificationsService } from '../notifications/notifications.service.js';
import { FleetGateway } from '../realtime/fleet.gateway.js';

/** Skutki transakcji modułu Operacje wykonywane po zatwierdzeniu: zdarzenia Socket.IO i komendy systemu. */
export class OperationsEffects {
  readonly tickets = new Set<string>();
  readonly tasks = new Set<string>();
  readonly systemCommands: Array<{ scooterId: string; type: CommandType }> = [];
}

/** Zakres zapisu: transakcja i dziennik audytu (operator, jeśli jest, i system). */
export interface OperationsScope {
  tx: DbExecutor;
  /** Wpis operatora; `undefined` w transakcji bez operatora (klient, zadanie w tle, zakończenie przejazdu). */
  audit?: (record: AuditRecord) => Promise<void>;
  system: (record: AuditRecord) => Promise<void>;
}

/** Zakres transakcji bez operatora: tylko wpisy systemu. */
export const systemScope = (tx: DbExecutor): OperationsScope => ({ tx, system: (record) => systemAudit(tx, record) });

export interface NewTaskInput {
  scooterId: string;
  type: ServiceTaskType;
  ticketId: string | null;
  priority: TaskPriority;
  description: string | null;
  assigneeId: string | null;
  dueAt: Date | null;
  target: { zoneId?: string | null; point?: GeoPoint | null } | null;
  /** Operator zakładający zadanie; `null`: zadanie systemu ze zgłoszenia automatycznego. */
  staffId: string | null;
}

/**
 * Wspólne kroki modułu Operacje w transakcji wywołującego (ADR 0055): wyłączenie wolnej hulajnogi z ruchu,
 * zadanie z przejściem zgłoszenia do `AT_SERVICE`, zgłoszenie automatyczne bez duplikatów. Używają ich serwisy
 * zgłoszeń i zadań, moduł Wypożyczenia (zakończenie przejazdu) i Telemetria (brak łączności).
 */
@Injectable()
export class OperationsService {
  private readonly logger = new Logger(OperationsService.name);

  constructor(
    @Inject(DB) private readonly db: Database,
    private readonly gateway: FleetGateway,
    private readonly commands: CommandsService,
    private readonly notifications: NotificationsService,
  ) {}

  /**
   * Pilne zgłoszenie albo otwarte zadanie (pytanie 4): wolna hulajnoga przechodzi do `MAINTENANCE` od razu
   * z przyczyną z `fn_scooter_service_hold` i wpisem systemu; w rezerwacji albo przejeździe przejdzie przy jego
   * zakończeniu (wyzwalacz `scooters_status`), w serwisie albo wycofana zostaje bez zmian.
   */
  async holdScooter(scope: OperationsScope, scooterId: string, context: Record<string, unknown>): Promise<void> {
    const repo = new DrizzleServiceRepository(scope.tx);
    const scooter = await repo.lockScooter(scooterId);
    const hold = await repo.serviceHold(scooterId);
    if (!scooter || !hold || maintenanceEffect(scooter.status, hold).kind !== 'NOW') return;
    await repo.setScooterStatus(scooterId, 'MAINTENANCE', hold);
    await scope.system({
      action: 'scooter.sent_to_service',
      entityType: 'scooter',
      entityId: scooterId,
      data: { changes: { status: [scooter.status, 'MAINTENANCE'] }, reason: hold, ...context },
    });
  }

  /**
   * Zadanie serwisowe ze zgłoszenia albo z karty hulajnogi („Utwórz zadanie” i „Wyślij do serwisu” to jedno okno):
   * reguły z core, zgłoszenie przechodzi do `AT_SERVICE`, wolna hulajnoga do `MAINTENANCE`.
   */
  async createTask(
    scope: OperationsScope,
    input: NewTaskInput,
    effects: OperationsEffects,
  ): Promise<{ id: string; number: number }> {
    const service = new DrizzleServiceRepository(scope.tx);
    const scooter = await service.lockScooter(input.scooterId);
    if (!scooter) throw notFoundScooter(input.scooterId);
    const { target } = validateNewTask({
      type: input.type,
      scooterStatus: scooter.status,
      openTypes: await service.openTaskTypes(input.scooterId),
      target: input.target,
    });
    if (target?.zoneId && !(await service.zoneExists(target.zoneId))) {
      throw validation('target');
    }
    const task = await service.insertTask({
      scooterId: input.scooterId,
      ticketId: input.ticketId,
      type: input.type,
      priority: input.priority,
      description: input.description,
      assigneeId: input.assigneeId,
      createdBy: input.staffId,
      dueAt: input.dueAt,
      targetZoneId: target?.zoneId ?? null,
      targetPoint: target?.point ?? null,
    });
    const record: AuditRecord = {
      action: 'service_task.created',
      entityType: 'service_task',
      entityId: task.id,
      data: {
        number: task.number,
        type: input.type,
        scooterId: input.scooterId,
        priority: input.priority,
        ...(input.ticketId ? { ticketId: input.ticketId } : {}),
        ...(input.assigneeId ? { assigneeId: input.assigneeId } : {}),
        ...(target ? { target } : {}),
      },
    };
    await (scope.audit ?? scope.system)(record);
    if (input.ticketId) await this.ticketAtService(scope, input.ticketId, task.id, effects);
    await this.holdScooter(scope, input.scooterId, { taskId: task.id });
    effects.tasks.add(task.id);
    return task;
  }

  /** Pierwsze otwarte zadanie ze zgłoszenia ustawia `AT_SERVICE` (ustawia je tylko system, ADR 0055). */
  private async ticketAtService(
    scope: OperationsScope,
    ticketId: string,
    taskId: string,
    effects: OperationsEffects,
  ): Promise<void> {
    const tickets = new DrizzleTicketRepository(scope.tx);
    const ticket = await tickets.lock(ticketId);
    if (!ticket) throw notFoundTicket(ticketId);
    const to = ticketStatusOnTaskOpened(ticket.status);
    effects.tickets.add(ticketId);
    if (ticket.status === to) return;
    await tickets.update(ticketId, null, { status: to });
    await (scope.audit ?? scope.system)({
      action: 'ticket.status_changed',
      entityType: 'ticket',
      entityId: ticketId,
      data: { changes: { status: [ticket.status, to] }, taskId },
    });
    if (ticket.source === 'USER') {
      // Push „hulajnoga jest w serwisie” (ADR 0058) w tej transakcji.
      await this.notifications.ticketStatusChanged(scope.tx, ticket, {
        status: to,
        reply: null,
        version: ticket.version + 1,
      });
    }
  }

  /**
   * Zgłoszenie automatyczne (pytanie 3): duplikat odrzuca indeks (`null`, „już jest”). `BATTERY_CRITICAL` dostaje
   * od razu zadanie `BATTERY_SWAP`, `OUT_OF_ZONE` zadanie `RELOCATION` do najbliższej strefy parkowania; rodzaj
   * zadania już otwarty na hulajnodze zostaje, a zgłoszenie czeka na dyspozytora.
   */
  async openAutoTicket(
    scope: OperationsScope,
    input: {
      scooterId: string;
      kind: AutoTicketKind;
      rentalId: string | null;
      data?: Record<string, unknown>;
      /** Pozycja hulajnogi do celu `RELOCATION`. */
      position?: GeoPoint | null;
    },
    effects: OperationsEffects,
  ): Promise<{ id: string; number: number } | null> {
    const spec = autoTicket(input.kind);
    const tickets = new DrizzleTicketRepository(scope.tx);
    const ticket = await tickets.insertAuto({
      scooterId: input.scooterId,
      rentalId: input.rentalId,
      kind: input.kind,
      categories: spec.categories,
      urgent: spec.urgent,
    });
    if (!ticket) return null;
    await scope.system({
      action: 'ticket.created',
      entityType: 'ticket',
      entityId: ticket.id,
      data: {
        number: ticket.number,
        autoKind: input.kind,
        scooterId: input.scooterId,
        ...(input.rentalId ? { rentalId: input.rentalId } : {}),
        ...input.data,
      },
    });
    effects.tickets.add(ticket.id);
    if (spec.taskType) {
      const service = new DrizzleServiceRepository(scope.tx);
      const zone =
        spec.taskType === 'RELOCATION' && input.position ? await service.nearestParkingZone(input.position) : null;
      // Przewiezienie bez znanej pozycji nie ma celu: zgłoszenie czeka na dyspozytora.
      const task =
        spec.taskType === 'RELOCATION' && !zone
          ? null
          : await service.insertTaskIfFree({
              scooterId: input.scooterId,
              ticketId: ticket.id,
              type: spec.taskType,
              priority: taskPriorityForTicket(spec.urgent),
              description: null,
              assigneeId: null,
              createdBy: null,
              dueAt: null,
              targetZoneId: zone?.id ?? null,
              targetPoint: null,
            });
      if (task) {
        await scope.system({
          action: 'service_task.created',
          entityType: 'service_task',
          entityId: task.id,
          data: {
            number: task.number,
            type: spec.taskType,
            scooterId: input.scooterId,
            ticketId: ticket.id,
            ...(zone ? { target: { zoneId: zone.id, zoneCode: zone.code } } : {}),
          },
        });
        await this.ticketAtService(systemScope(scope.tx), ticket.id, task.id, effects);
        effects.tasks.add(task.id);
      }
    }
    await this.holdScooter(scope, input.scooterId, { ticketId: ticket.id });
    return ticket;
  }

  /**
   * Ręczne `RESOLVED` pilnego zgłoszenia (N z przeglądu iteracji 6): hulajnoga w serwisie z przyczyną
   * `URGENT_TICKET` dostaje przyczynę z reguły powrotu (`reasonAfterUrgentTicketResolved`) z wpisem systemu. Bez
   * automatycznego powrotu do floty: ADR 0055 przewiduje go tylko po ostatnim zadaniu, więc bez przeszkód zostaje
   * `OTHER` i operator klika „Przywróć do floty”.
   */
  async afterUrgentTicketResolved(scope: OperationsScope, scooterId: string, ticketId: string): Promise<void> {
    const service = new DrizzleServiceRepository(scope.tx);
    const scooter = await service.lockScooter(scooterId);
    if (scooter?.status !== 'MAINTENANCE' || scooter.statusReason !== 'URGENT_TICKET') return;
    const check = returnCheck(scooter, await service.minBatteryPct());
    const reason = reasonAfterUrgentTicketResolved(check.blockers);
    if (reason === scooter.statusReason) return;
    await service.setScooterStatus(scooterId, 'MAINTENANCE', reason);
    await scope.system({
      action: 'scooter.kept_in_service',
      entityType: 'scooter',
      entityId: scooterId,
      data: { changes: { statusReason: [scooter.statusReason, reason] }, blockers: check.blockers, ticketId },
    });
  }

  /**
   * Bateria wróciła ponad próg (np. odczyt po `battery_swapped`, I z przeglądu iteracji 6): hulajnoga w serwisie
   * z przyczyną `BATTERY_BELOW_THRESHOLD` bez innych przeszkód wraca do floty z wpisem systemu
   * `scooter.returned_to_fleet`; z inną przeszkodą zostaje w serwisie z jej przyczyną. Wołane przez moduł Telemetria
   * po zapisie partii z odczytem bieżącym.
   */
  async returnAfterBatteryRecovered(scooterIds: readonly string[]): Promise<string[]> {
    const candidates = await new DrizzleServiceRepository(this.db).batteryRecovered(scooterIds);
    const returned: string[] = [];
    for (const scooterId of candidates) {
      try {
        await this.db.transaction(async (tx) => {
          const service = new DrizzleServiceRepository(tx);
          const scooter = await service.lockScooter(scooterId);
          if (scooter?.status !== 'MAINTENANCE' || scooter.statusReason !== 'BATTERY_BELOW_THRESHOLD') return;
          const check = returnCheck(scooter, await service.minBatteryPct());
          if (check.blockers.includes('BATTERY_BELOW_THRESHOLD')) return;
          const next = statusAfterService(check.blockers);
          await service.setScooterStatus(scooterId, next.status, next.reason);
          await systemAudit(tx, {
            action: next.status === 'AVAILABLE' ? 'scooter.returned_to_fleet' : 'scooter.kept_in_service',
            entityType: 'scooter',
            entityId: scooterId,
            data: {
              changes: {
                ...(next.status === 'AVAILABLE' ? { status: ['MAINTENANCE', 'AVAILABLE'] } : {}),
                statusReason: [scooter.statusReason, next.reason],
              },
              reason: 'BATTERY_RECOVERED',
              batteryPct: scooter.batteryPct,
              ...(check.blockers.length ? { blockers: check.blockers } : {}),
            },
          });
          if (next.status === 'AVAILABLE') returned.push(scooterId);
        });
      } catch (error) {
        // Błąd jednej hulajnogi nie zatrzymuje pozostałych; kolejny odczyt baterii spróbuje ponownie.
        this.logger.warn(`Powrót do floty po baterii ${scooterId}: ${(error as Error).message}`);
      }
    }
    return returned;
  }

  /** Zdarzenia dla panelu i klienta oraz komendy systemu po zatwierdzeniu transakcji. */
  async afterCommit(effects: OperationsEffects): Promise<void> {
    for (const command of effects.systemCommands) {
      try {
        await this.commands.sendSystem(command.scooterId, command.type);
      } catch (error) {
        this.logger.warn(`Nie wysłano komendy ${command.type}: ${(error as Error).message}`);
      }
    }
    if (effects.tickets.size) {
      const tickets = new DrizzleTicketRepository(this.db);
      for (const id of effects.tickets) {
        const ticket = await tickets.find(id);
        if (!ticket) continue;
        const event: TicketUpdated = {
          id: ticket.id,
          number: ticket.number,
          scooterId: ticket.scooterId,
          source: ticket.source,
          autoKind: ticket.autoKind,
          status: ticket.status,
          urgent: ticket.urgent,
          assigneeId: ticket.assigneeId,
          hasUnreadReply: ticket.customerReplyAt !== null && ticket.customerReplyReadAt === null,
          updatedAt: ticket.updatedAt.toISOString(),
        };
        this.gateway.ticketUpdated(event, ticket.reportedBy);
      }
    }
    if (effects.tasks.size) {
      const service = new DrizzleServiceRepository(this.db);
      for (const id of effects.tasks) {
        const task = await service.taskItem(id);
        if (!task) continue;
        const event: ServiceTaskUpdated = {
          id: task.id,
          number: task.number,
          scooterId: task.scooterId,
          ticketId: task.ticketId,
          type: task.type,
          status: task.status,
          priority: task.priority,
          assigneeId: task.assigneeId,
          updatedAt: new Date(task.updatedAt).toISOString(),
        };
        this.gateway.serviceTaskUpdated(event);
      }
    }
  }
}

const notFoundScooter = (id: string) => notFound('scooter', id);
const notFoundTicket = (id: string) => notFound('ticket', id);
const validation = (field: string) => new DomainError('VALIDATION_FAILED', { field });

/**
 * Reguła powrotu do floty z core dla hulajnogi (ADR 0055) z prawdziwą baterią z telemetrii; `excludeOpenTask` liczy
 * otwarte zadania poza kończonym, `excludeUrgentTicket` pomija pilne zgłoszenie, które rozwiąże zakończenie zadania.
 * Wymiana baterii nie zakłada 100%: hulajnoga wraca po odczycie baterii ponad progiem
 * (`returnAfterBatteryRecovered`).
 */
export function returnCheck(
  scooter: ScooterServiceState,
  minBatteryPct: number,
  options: { excludeOpenTask?: boolean; excludeUrgentTicket?: boolean } = {},
): ReturnToFleetCheck {
  const openTasks = Math.max(0, scooter.openTasks - (options.excludeOpenTask ? 1 : 0));
  const openUrgentTickets = Math.max(0, scooter.openUrgentTickets - (options.excludeUrgentTicket ? 1 : 0));
  return {
    blockers: returnToFleetBlockers({
      openUrgentTickets,
      openTasks,
      online: scooter.online,
      batteryPct: scooter.batteryPct,
      minBatteryPct,
    }),
    openUrgentTickets,
    openTasks,
    online: scooter.online,
    lastSeenAt: scooter.lastSeenAt?.toISOString() ?? null,
    batteryPct: scooter.batteryPct,
    minBatteryPct,
  };
}
