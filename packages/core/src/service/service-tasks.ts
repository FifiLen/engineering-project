import { DomainError } from '../errors.js';
import type { ScooterStatus } from '../fleet/fleet-status.js';
import type { GeoPoint } from '../zones/zones.js';

/** Zadania serwisowe (ADR 0055); baza pilnuje wykonawcy w `IN_PROGRESS` i jednego otwartego zadania danego rodzaju. */
export const SERVICE_TASK_TYPES = ['REPAIR', 'BATTERY_SWAP', 'INSPECTION', 'RELOCATION'] as const;
export type ServiceTaskType = (typeof SERVICE_TASK_TYPES)[number];

export const SERVICE_TASK_STATUSES = ['OPEN', 'IN_PROGRESS', 'DONE', 'CANCELLED'] as const;
export type ServiceTaskStatus = (typeof SERVICE_TASK_STATUSES)[number];

export const OPEN_SERVICE_TASK_STATUSES = ['OPEN', 'IN_PROGRESS'] as const satisfies readonly ServiceTaskStatus[];

export const TASK_PRIORITIES = ['LOW', 'NORMAL', 'HIGH'] as const;
export type TaskPriority = (typeof TASK_PRIORITIES)[number];

export type ServiceTaskAction = 'START' | 'COMPLETE' | 'CANCEL';

const TASK_TRANSITIONS: Record<ServiceTaskAction, ReadonlyArray<readonly [ServiceTaskStatus, ServiceTaskStatus]>> = {
  START: [['OPEN', 'IN_PROGRESS']],
  COMPLETE: [['IN_PROGRESS', 'DONE']],
  CANCEL: [
    ['OPEN', 'CANCELLED'],
    ['IN_PROGRESS', 'CANCELLED'],
  ],
};

/** Kolejność statusów zadania; ten sam warunek sprawdza wyzwalacz przejść w bazie. */
export const ServiceTaskStateMachine = {
  next(from: ServiceTaskStatus, action: ServiceTaskAction): ServiceTaskStatus | undefined {
    return TASK_TRANSITIONS[action].find(([source]) => source === from)?.[1];
  },

  /** Niedozwolone przejście kończy się błędem `INVALID_TASK_TRANSITION`. */
  transition(from: ServiceTaskStatus, action: ServiceTaskAction): ServiceTaskStatus {
    const to = ServiceTaskStateMachine.next(from, action);
    if (!to) throw new DomainError('INVALID_TASK_TRANSITION', { from, action });
    return to;
  },

  isOpen(status: ServiceTaskStatus): boolean {
    return (OPEN_SERVICE_TASK_STATUSES as readonly ServiceTaskStatus[]).includes(status);
  },
};

export interface ServiceTaskState {
  type: ServiceTaskType;
  status: ServiceTaskStatus;
  assigneeId: string | null;
}

/** Cel przewiezienia (`RELOCATION`): strefa albo punkt (SRID 4326), dokładnie jedno z nich. */
export type RelocationTarget = { zoneId: string; point?: undefined } | { point: GeoPoint; zoneId?: undefined };

export interface NewTaskInput {
  type: ServiceTaskType;
  scooterStatus: ScooterStatus;
  /** Rodzaje zadań już otwartych na hulajnodze (`OPEN`, `IN_PROGRESS`). */
  openTypes: readonly ServiceTaskType[];
  target: { zoneId?: string | null; point?: GeoPoint | null } | null;
}

/** Rodzaje dostępne w oknie „Utwórz zadanie” (rodzaj już otwarty na hulajnodze jest niedostępny). */
export const availableTaskTypes = (openTypes: readonly ServiceTaskType[]): ServiceTaskType[] =>
  SERVICE_TASK_TYPES.filter((type) => !openTypes.includes(type));

/**
 * Utworzenie zadania ze zgłoszenia albo z karty hulajnogi („Utwórz zadanie” i „Wyślij do serwisu” to jedno okno).
 * Hulajnoga wycofana nie dostaje zadań, rodzaj otwarty daje `SERVICE_TASK_TYPE_OPEN` (indeks
 * `service_tasks_one_open_per_type`), a cel jest wymagany tylko przy `RELOCATION`.
 */
export function validateNewTask(input: NewTaskInput): { target: RelocationTarget | null } {
  if (input.scooterStatus === 'RETIRED') throw new DomainError('SCOOTER_RETIRED');
  if (input.openTypes.includes(input.type)) throw new DomainError('SERVICE_TASK_TYPE_OPEN', { type: input.type });
  const zoneId = input.target?.zoneId ?? null;
  const point = input.target?.point ?? null;
  if (input.type !== 'RELOCATION') {
    if (zoneId || point) throw new DomainError('VALIDATION_FAILED', { field: 'target' });
    return { target: null };
  }
  if (Boolean(zoneId) === Boolean(point)) throw new DomainError('VALIDATION_FAILED', { field: 'target' });
  return { target: zoneId ? { zoneId } : { point: point! } };
}

/** „Rozpocznij”: nieprzypisane zadanie dostaje operatora; zadanie przypisane komuś innemu wymaga zmiany przypisania. */
export function decideTaskStart(
  task: ServiceTaskState,
  staffId: string,
): { to: ServiceTaskStatus; assigneeId: string } {
  const to = ServiceTaskStateMachine.transition(task.status, 'START');
  if (task.assigneeId && task.assigneeId !== staffId) {
    throw new DomainError('TASK_ASSIGNED_TO_OTHER', { assigneeId: task.assigneeId });
  }
  return { to, assigneeId: staffId };
}

export interface TaskCompletion {
  to: ServiceTaskStatus;
  note: string;
  /** Zakończenie `BATTERY_SWAP` wysyła komendę `battery_swapped` (kontrakt MQTT 1.3.0, ADR 0059). */
  sendBatterySwapped: boolean;
}

/** Zakończenie z wymaganą notatką z naprawy (`result_note`). */
export function decideTaskComplete(task: ServiceTaskState, note: string | null): TaskCompletion {
  const to = ServiceTaskStateMachine.transition(task.status, 'COMPLETE');
  const text = note?.trim();
  if (!text) throw new DomainError('VALIDATION_FAILED', { field: 'note' });
  return { to, note: text, sendBatterySwapped: task.type === 'BATTERY_SWAP' };
}

/** Anulowanie z powodem; części użyte w zadaniu wracają do magazynu ruchem `RETURN`. */
export function decideTaskCancel(
  task: ServiceTaskState,
  reason: string | null,
): { to: ServiceTaskStatus; reason: string } {
  const to = ServiceTaskStateMachine.transition(task.status, 'CANCEL');
  const text = reason?.trim();
  if (!text) throw new DomainError('VALIDATION_FAILED', { field: 'reason' });
  return { to, reason: text };
}
