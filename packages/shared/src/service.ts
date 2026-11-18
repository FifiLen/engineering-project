/**
 * Kontrakt serwisu między panelem a API (iteracja 6, ADR 0055): zadania serwisowe, części z magazynu, wyłączenie
 * z ruchu i powrót do floty. Wartości wyliczeń są kopią z packages/core; zgodność pilnuje test API.
 */
import { z } from 'zod';

export const SERVICE_TASK_TYPES = ['REPAIR', 'BATTERY_SWAP', 'INSPECTION', 'RELOCATION'] as const;
export type ServiceTaskType = (typeof SERVICE_TASK_TYPES)[number];

export const SERVICE_TASK_STATUSES = ['OPEN', 'IN_PROGRESS', 'DONE', 'CANCELLED'] as const;
export type ServiceTaskStatus = (typeof SERVICE_TASK_STATUSES)[number];

export const TASK_PRIORITIES = ['LOW', 'NORMAL', 'HIGH'] as const;
export type TaskPriority = (typeof TASK_PRIORITIES)[number];

export const SCOOTER_STATUS_REASONS = [
  'URGENT_TICKET',
  'SERVICE_TASK',
  'BATTERY_BELOW_THRESHOLD',
  'OFFLINE',
  'THEFT',
  'DAMAGE',
  'END_OF_LIFE',
  'OTHER',
] as const;
export type ScooterStatusReason = (typeof SCOOTER_STATUS_REASONS)[number];

export const RETIRE_REASONS = [
  'THEFT',
  'DAMAGE',
  'END_OF_LIFE',
  'OTHER',
] as const satisfies readonly ScooterStatusReason[];
export type RetireReason = (typeof RETIRE_REASONS)[number];

/** Przeszkody w powrocie do floty; te same kody zwraca `fn_scooter_return_blockers`. */
export const RETURN_BLOCKERS = ['URGENT_TICKET', 'OPEN_TASKS', 'OFFLINE', 'BATTERY_BELOW_THRESHOLD'] as const;
export type ReturnBlocker = (typeof RETURN_BLOCKERS)[number];

export const PART_MOVEMENT_KINDS = ['RECEIPT', 'ADJUSTMENT', 'USE', 'RETURN'] as const;
export type PartMovementKind = (typeof PART_MOVEMENT_KINDS)[number];

export const PART_ADJUST_REASONS = ['STOCKTAKE', 'DAMAGED', 'LOST', 'OTHER'] as const;
export type PartAdjustReason = (typeof PART_ADJUST_REASONS)[number];

/** Numer zadania serwisowego, np. `S-1037`. */
export const serviceTaskLabel = (number: number): string => `S-${number}`;

export const geoPointSchema = z.object({ lat: z.number().min(-90).max(90), lon: z.number().min(-180).max(180) });
export type GeoPointInput = z.infer<typeof geoPointSchema>;

/** Cel przewiezienia (`RELOCATION`): strefa albo punkt; core sprawdza, że cel jest tylko przy przewiezieniu. */
export const relocationTargetSchema = z.union([
  z.object({ zoneId: z.uuid() }).strict(),
  z.object({ point: geoPointSchema }).strict(),
]);
export type RelocationTargetInput = z.infer<typeof relocationTargetSchema>;

const text = (max: number) => z.string().trim().max(max);
const requiredText = (max: number) => z.string().trim().min(1).max(max);

/**
 * Utworzenie zadania ze zgłoszenia albo z karty hulajnogi („Utwórz zadanie” i „Wyślij do serwisu” to jedno okno).
 * Rodzaj podpowiada kategoria zgłoszenia, rodzaj otwarty na hulajnodze jest niedostępny.
 */
export const serviceTaskCreateSchema = z.object({
  scooterId: z.uuid(),
  type: z.enum(SERVICE_TASK_TYPES),
  ticketId: z.uuid().nullable().default(null),
  assigneeId: z.uuid().nullable().default(null),
  priority: z.enum(TASK_PRIORITIES).default('NORMAL'),
  description: text(1000).nullable().default(null),
  dueAt: z.iso.datetime({ offset: true }).nullable().default(null),
  target: relocationTargetSchema.nullable().default(null),
});
export type ServiceTaskCreate = z.infer<typeof serviceTaskCreateSchema>;

/** Rozpoczęcie (`OPEN → IN_PROGRESS`): nieprzypisane zadanie dostaje operatora, który je rozpoczyna. */
export const serviceTaskStartSchema = z.object({ version: z.number().int().min(1) });
export type ServiceTaskStart = z.infer<typeof serviceTaskStartSchema>;

/** Zakończenie (`IN_PROGRESS → DONE`) z wymaganą notatką z naprawy. */
export const serviceTaskCompleteSchema = z.object({
  version: z.number().int().min(1),
  note: requiredText(2000),
});
export type ServiceTaskComplete = z.infer<typeof serviceTaskCompleteSchema>;

/** Anulowanie (`OPEN | IN_PROGRESS → CANCELLED`) z powodem; części wracają do magazynu. */
export const serviceTaskCancelSchema = z.object({
  version: z.number().int().min(1),
  reason: requiredText(500),
});
export type ServiceTaskCancel = z.infer<typeof serviceTaskCancelSchema>;

export const serviceTaskAssignSchema = z.object({
  version: z.number().int().min(1),
  assigneeId: z.uuid().nullable(),
});
export type ServiceTaskAssign = z.infer<typeof serviceTaskAssignSchema>;

/** Dodanie części do zadania w toku: stan magazynu maleje od razu (`sp_task_use_part`). */
export const taskPartAddSchema = z.object({
  partId: z.uuid(),
  quantity: z.number().int().min(1).max(100),
});
export type TaskPartAdd = z.infer<typeof taskPartAddSchema>;

/** Usunięcie części z zadania w toku (ruch `RETURN`); bez `quantity` wraca cała pozycja. */
export const taskPartRemoveSchema = z.object({
  partId: z.uuid(),
  quantity: z.number().int().min(1).max(100).optional(),
});
export type TaskPartRemove = z.infer<typeof taskPartRemoveSchema>;

/** Przyjęcie dostawy: nowa cena jednostkowa (grosze) dotyczy kolejnych użyć. */
export const partReceiptSchema = z.object({
  version: z.number().int().min(1),
  quantity: z.number().int().min(1).max(100_000),
  unitCost: z.number().int().min(0).max(10_000_000).nullable().default(null),
  document: text(200).nullable().default(null),
});
export type PartReceipt = z.infer<typeof partReceiptSchema>;

/** Korekta stanu: nowy stan policzony w magazynie, powód z listy, `OTHER` z notatką (core). */
export const partAdjustmentSchema = z.object({
  version: z.number().int().min(1),
  newQty: z.number().int().min(0).max(100_000),
  reason: z.enum(PART_ADJUST_REASONS),
  note: text(500).nullable().default(null),
});
export type PartAdjustment = z.infer<typeof partAdjustmentSchema>;

/** „Wyłącz z ruchu” (`RETIRED`, `scooters.write`); `OTHER` wymaga notatki (core). */
export const scooterRetireSchema = z.object({
  version: z.number().int().min(1),
  reason: z.enum(RETIRE_REASONS),
  note: text(500).nullable().default(null),
});
export type ScooterRetire = z.infer<typeof scooterRetireSchema>;

/** „Przywróć do floty” (`service.manage`): ta sama reguła co po ostatnim zadaniu. */
export const scooterReturnSchema = z.object({
  version: z.number().int().min(1),
  note: text(500).nullable().default(null),
});
export type ScooterReturn = z.infer<typeof scooterReturnSchema>;

// --- Widoki ---------------------------------------------------------------------------------------

/** „Skutek dla hulajnogi” w oknie zakończenia zadania i na karcie hulajnogi. */
export interface ReturnToFleetCheck {
  blockers: ReturnBlocker[];
  /** Otwarte pilne zgłoszenia hulajnogi (hamulce, koło, kierownica). */
  openUrgentTickets: number;
  /** Otwarte zadania poza tym, które się kończy. */
  openTasks: number;
  online: boolean;
  lastSeenAt: string | null;
  batteryPct: number | null;
  minBatteryPct: number;
}

export interface ServiceTaskPartView {
  partId: string;
  sku: string;
  name: string;
  quantity: number;
  /** Koszt jednostkowy z chwili użycia (grosze). */
  unitCost: number;
  cost: number;
}

/** Zadanie w szczegółach zgłoszenia i na karcie hulajnogi. */
export interface ServiceTaskSummary {
  id: string;
  number: number;
  type: ServiceTaskType;
  status: ServiceTaskStatus;
  priority: TaskPriority;
  assigneeId: string | null;
  assigneeName: string | null;
  partsCost: number;
  createdAt: string;
  completedAt: string | null;
}

export interface ServiceTaskDetails extends ServiceTaskSummary {
  version: number;
  scooter: { id: string; number: number; status: string; statusReason: ScooterStatusReason | null };
  ticket: { id: string; number: number; categories: string[]; urgent: boolean } | null;
  description: string | null;
  resultNote: string | null;
  cancelReason: string | null;
  dueAt: string | null;
  startedAt: string | null;
  target: { zoneId: string; zoneCode: string; zoneName: string } | { point: GeoPointInput } | null;
  parts: ServiceTaskPartView[];
  returnCheck: ReturnToFleetCheck;
}

/** Ruch magazynowy w historii części. */
export interface PartMovementView {
  id: number;
  kind: PartMovementKind;
  /** Zmiana stanu ze znakiem (`delta`). */
  delta: number;
  unitCost: number | null;
  stockAfter: number;
  taskId: string | null;
  taskNumber: number | null;
  staffName: string | null;
  document: string | null;
  reason: PartAdjustReason | null;
  note: string | null;
  createdAt: string;
}

/** Zakładka „Serwis” na karcie hulajnogi (makieta `hulajnoga-serwis`); zgłoszenia z listy `tickets?scooterId=`. */
export interface ScooterServiceSummary {
  scooterId: string;
  scooterNumber: number;
  status: string;
  statusReason: ScooterStatusReason | null;
  statusChangedAt: string;
  version: number;
  /** Reguła „Przywróć do floty” (ta sama co po ostatnim zadaniu). */
  returnCheck: ReturnToFleetCheck;
  /** Rodzaje dostępne w oknie „Wyślij do serwisu”. */
  availableTaskTypes: ServiceTaskType[];
  openTickets: number;
  /** Ostatnie zadania hulajnogi, od najnowszego. */
  tasks: ServiceTaskSummary[];
  tasksDone: number;
  /** Koszt części zakończonych zadań (grosze). */
  partsCost: number;
}
