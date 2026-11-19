/**
 * Zasoby panelu modułu Operacje (iteracja 6, ADR 0031, ADR 0055, ADR 0057): zgłoszenia, zadania serwisowe, magazyn
 * części z ruchami i pliki. Zmiany stanu (przypisanie, status, części, przyjęcie, korekta) są poleceniami z wpisem
 * w dzienniku audytu, a nie edycją rekordu.
 */
import { z } from 'zod';
import { FILE_STATUSES, type FileStatus } from '../files.js';
import {
  PART_ADJUST_REASONS,
  PART_MOVEMENT_KINDS,
  SERVICE_TASK_STATUSES,
  SERVICE_TASK_TYPES,
  TASK_PRIORITIES,
  serviceTaskCreateSchema,
  type PartAdjustReason,
  type PartMovementKind,
  type ServiceTaskStatus,
  type ServiceTaskType,
  type TaskPriority,
} from '../service.js';
import {
  AUTO_TICKET_KINDS,
  TICKET_CATEGORIES,
  TICKET_SOURCES,
  TICKET_STATUSES,
  staffTicketCreateSchema,
  type AutoTicketKind,
  type TicketCategory,
  type TicketSource,
  type TicketStatus,
} from '../tickets.js';
import { SCOOTER_STATUSES, type ScooterStatus } from './fleet.js';
import type { ResourceDefinition } from './list.js';

// --- Zgłoszenia ----------------------------------------------------------------------------------

/**
 * Zgłoszenia z `v_ticket_list`. Bez `users.read` API podaje `reporterName` i `reporterPhone` jako `null` (panel
 * pokazuje „Klient” z tłumaczeń przy źródle `USER`), nie szuka po nich i odrzuca filtr albo sortowanie po nich.
 */
export const ticketsResource = {
  name: 'tickets',
  fields: {
    id: { type: 'uuid', filters: ['eq'] },
    number: { type: 'integer', filters: ['eq'], sortable: true },
    status: { type: 'enum', values: TICKET_STATUSES, filters: ['eq'], facet: true, sortable: true },
    urgent: { type: 'boolean', filters: ['eq'], facet: true, sortable: true },
    categories: { type: 'enum', values: TICKET_CATEGORIES, filters: ['eq'], array: true },
    source: { type: 'enum', values: TICKET_SOURCES, filters: ['eq'], facet: true },
    autoKind: { type: 'enum', values: AUTO_TICKET_KINDS, filters: ['eq'], facet: true },
    description: { type: 'text' },
    scooterId: { type: 'uuid', filters: ['eq'] },
    scooterNumber: { type: 'integer', filters: ['eq'], sortable: true },
    scooterStatus: { type: 'enum', values: SCOOTER_STATUSES, filters: ['eq'] },
    rentalId: { type: 'uuid', filters: ['eq'] },
    rentalNumber: { type: 'integer', filters: ['eq'], sortable: true },
    reportedBy: { type: 'uuid', filters: ['eq'] },
    reporterName: { type: 'text', sortable: true },
    reporterPhone: { type: 'text', filters: ['contains'] },
    assigneeId: { type: 'uuid', filters: ['eq'], facet: true },
    assigneeName: { type: 'text', sortable: true },
    photos: { type: 'integer' },
    openTasks: { type: 'integer', filters: ['gte', 'lte'] },
    serviceTaskId: { type: 'uuid' },
    serviceTaskNumber: { type: 'integer', filters: ['eq'] },
    serviceTaskStatus: { type: 'enum', values: SERVICE_TASK_STATUSES, filters: ['eq'] },
    refundedAmount: { type: 'integer', sortable: true },
    customerReply: { type: 'text' },
    customerReplyAt: { type: 'datetime', sortable: true },
    customerReplyReadAt: { type: 'datetime' },
    resolutionNote: { type: 'text' },
    createdAt: { type: 'datetime', filters: ['gte', 'lte'], sortable: true },
    updatedAt: { type: 'datetime', filters: ['gte', 'lte'], sortable: true },
    resolvedAt: { type: 'datetime', filters: ['gte', 'lte'], sortable: true },
    ageSeconds: { type: 'integer', sortable: true },
    version: { type: 'integer' },
  },
  search: ['number', 'scooterNumber', 'rentalNumber', 'reporterName', 'reporterPhone', 'description'],
  defaultSort: ['-createdAt'],
  // Zgłoszenie się zamyka (`RESOLVED`), nie usuwa (macierz operacji w modelu danych).
  deleteMode: 'none',
  permissions: { read: 'tickets.read', write: 'tickets.manage' },
  createSchema: staffTicketCreateSchema,
} as const satisfies ResourceDefinition;

/** Pola zgłoszenia z danymi klienta: tylko z `users.read` (ADR 0055). */
export const TICKET_PERSONAL_FIELDS = ['reporterName', 'reporterPhone'] as const;
/** Pola płatności w liście zgłoszeń: bez `payments.read` API podaje `null` i odrzuca filtr i sortowanie po nich. */
export const TICKET_PAYMENT_FIELDS = ['refundedAmount'] as const;

export interface TicketListItem {
  id: string;
  number: number;
  status: TicketStatus;
  urgent: boolean;
  categories: TicketCategory[];
  source: TicketSource;
  autoKind: AutoTicketKind | null;
  description: string | null;
  scooterId: string;
  scooterNumber: number;
  scooterStatus: ScooterStatus;
  rentalId: string | null;
  rentalNumber: number | null;
  reportedBy: string | null;
  /** `null` bez `users.read` albo bez zgłaszającego (zgłoszenie systemu lub operatora). */
  reporterName: string | null;
  reporterPhone: string | null;
  assigneeId: string | null;
  assigneeName: string | null;
  photos: number;
  openTasks: number;
  serviceTaskId: string | null;
  serviceTaskNumber: number | null;
  serviceTaskStatus: ServiceTaskStatus | null;
  refundedAmount: number | null;
  customerReply: string | null;
  customerReplyAt: string | null;
  customerReplyReadAt: string | null;
  resolutionNote: string | null;
  createdAt: string;
  updatedAt: string;
  resolvedAt: string | null;
  ageSeconds: number;
  version: number;
}

/** Zdjęcie operatora w zgłoszeniu (plik z `POST /files`, cel `TICKET_PHOTO`). */
export const ticketPhotoAddSchema = z.object({ fileId: z.uuid() });
export type TicketPhotoAdd = z.infer<typeof ticketPhotoAddSchema>;

// --- Zadania serwisowe ---------------------------------------------------------------------------

export const serviceTasksResource = {
  name: 'service-tasks',
  fields: {
    id: { type: 'uuid', filters: ['eq'] },
    number: { type: 'integer', filters: ['eq'], sortable: true },
    type: { type: 'enum', values: SERVICE_TASK_TYPES, filters: ['eq'], facet: true },
    status: { type: 'enum', values: SERVICE_TASK_STATUSES, filters: ['eq'], facet: true, sortable: true },
    priority: { type: 'enum', values: TASK_PRIORITIES, filters: ['eq'], facet: true },
    description: { type: 'text' },
    resultNote: { type: 'text' },
    cancelReason: { type: 'text' },
    scooterId: { type: 'uuid', filters: ['eq'] },
    scooterNumber: { type: 'integer', filters: ['eq'], sortable: true },
    scooterStatus: { type: 'enum', values: SCOOTER_STATUSES, filters: ['eq'] },
    assigneeId: { type: 'uuid', filters: ['eq'], facet: true },
    assigneeName: { type: 'text', sortable: true },
    createdBy: { type: 'uuid', filters: ['eq'] },
    createdByName: { type: 'text' },
    dueAt: { type: 'datetime', filters: ['gte', 'lte'], sortable: true },
    overdue: { type: 'boolean', filters: ['eq'], facet: true },
    ticketId: { type: 'uuid', filters: ['eq'] },
    ticketNumber: { type: 'integer', filters: ['eq'], sortable: true },
    ticketCategories: { type: 'enum', values: TICKET_CATEGORIES, filters: ['eq'], array: true },
    targetZoneId: { type: 'uuid', filters: ['eq'] },
    targetZoneCode: { type: 'text' },
    targetZoneName: { type: 'text' },
    targetLat: { type: 'decimal' },
    targetLon: { type: 'decimal' },
    partsCount: { type: 'integer' },
    partsCost: { type: 'integer', filters: ['gte', 'lte'], sortable: true },
    cancelledBy: { type: 'uuid' },
    cancelledByName: { type: 'text' },
    createdAt: { type: 'datetime', filters: ['gte', 'lte'], sortable: true },
    startedAt: { type: 'datetime', sortable: true },
    completedAt: { type: 'datetime', filters: ['gte', 'lte'], sortable: true },
    updatedAt: { type: 'datetime', sortable: true },
    version: { type: 'integer' },
  },
  search: ['number', 'scooterNumber', 'ticketNumber', 'description', 'assigneeName'],
  defaultSort: ['-createdAt'],
  // Zadanie się anuluje z powodem (`CANCELLED`), nie usuwa.
  deleteMode: 'none',
  permissions: { read: 'service.read', write: 'service.manage' },
  createSchema: serviceTaskCreateSchema,
} as const satisfies ResourceDefinition;

export interface ServiceTaskListItem {
  id: string;
  number: number;
  type: ServiceTaskType;
  status: ServiceTaskStatus;
  priority: TaskPriority;
  description: string | null;
  resultNote: string | null;
  cancelReason: string | null;
  scooterId: string;
  scooterNumber: number;
  scooterStatus: ScooterStatus;
  assigneeId: string | null;
  assigneeName: string | null;
  createdBy: string | null;
  /** `null` dla zadania systemu (zgłoszenie automatyczne). */
  createdByName: string | null;
  dueAt: string | null;
  overdue: boolean;
  ticketId: string | null;
  ticketNumber: number | null;
  ticketCategories: TicketCategory[] | null;
  targetZoneId: string | null;
  targetZoneCode: string | null;
  targetZoneName: string | null;
  targetLat: number | null;
  targetLon: number | null;
  partsCount: number;
  partsCost: number;
  cancelledBy: string | null;
  cancelledByName: string | null;
  createdAt: string;
  startedAt: string | null;
  completedAt: string | null;
  updatedAt: string;
  version: number;
}

// --- Magazyn części ------------------------------------------------------------------------------

const partFields = {
  sku: z
    .string()
    .trim()
    .min(2)
    .max(40)
    .regex(/^[A-Z0-9-]+$/),
  name: z.string().trim().min(2).max(120),
  unitCost: z.number().int().min(0).max(10_000_000),
  minStockQty: z.number().int().min(0).max(100_000),
  active: z.boolean(),
};

/**
 * Nowa część: stan początkowy jako przyjęcie dostawy (`sp_part_receive`, ruch `RECEIPT`), bo stan zmienia się
 * tylko razem z ruchem.
 */
export const sparePartCreateSchema = z.object({
  ...partFields,
  active: partFields.active.default(true),
  initialQty: z.number().int().min(0).max(100_000).default(0),
  document: z.string().trim().max(200).nullable().default(null),
});
export type SparePartCreate = z.infer<typeof sparePartCreateSchema>;

/** Edycja słownika części bez stanu (stan zmienia przyjęcie, korekta i zużycie w zadaniu). */
export const sparePartUpdateSchema = z
  .object({ version: z.number().int().min(1), ...partFields })
  .partial()
  .required({ version: true });
export type SparePartUpdate = z.infer<typeof sparePartUpdateSchema>;

export const sparePartsResource = {
  name: 'spare-parts',
  fields: {
    id: { type: 'uuid', filters: ['eq'] },
    sku: { type: 'text', filters: ['eq', 'contains'], sortable: true },
    name: { type: 'text', filters: ['contains'], sortable: true },
    unitCost: { type: 'integer', filters: ['gte', 'lte'], sortable: true },
    stockQty: { type: 'integer', filters: ['gte', 'lte'], sortable: true },
    minStockQty: { type: 'integer', sortable: true },
    belowMinimum: { type: 'boolean', filters: ['eq'], facet: true },
    active: { type: 'boolean', filters: ['eq'], facet: true },
    used30d: { type: 'integer', sortable: true },
    lastMovementAt: { type: 'datetime', filters: ['gte', 'lte'], sortable: true },
    lastMovementKind: { type: 'enum', values: PART_MOVEMENT_KINDS, filters: ['eq'] },
    lastMovementDelta: { type: 'integer' },
    lastMovementTaskNumber: { type: 'integer' },
    usedInTasks: { type: 'boolean', filters: ['eq'] },
    createdAt: { type: 'datetime', sortable: true },
    updatedAt: { type: 'datetime', sortable: true },
    version: { type: 'integer' },
  },
  search: ['sku', 'name'],
  defaultSort: ['name'],
  // Część z ruchami albo użyta w zadaniu jest archiwizowana (`active = false`), nowa bez ruchów usuwana.
  deleteMode: 'archive',
  permissions: { read: 'service.read', write: 'service.manage', delete: 'service.manage' },
  createSchema: sparePartCreateSchema,
  updateSchema: sparePartUpdateSchema,
} as const satisfies ResourceDefinition;

export interface SparePartListItem {
  id: string;
  sku: string;
  name: string;
  /** Cena jednostkowa dla kolejnych użyć (grosze). */
  unitCost: number;
  stockQty: number;
  minStockQty: number;
  belowMinimum: boolean;
  active: boolean;
  /** Zużycie z 30 dni: użycia minus zwroty. */
  used30d: number;
  lastMovementAt: string | null;
  lastMovementKind: PartMovementKind | null;
  lastMovementDelta: number | null;
  lastMovementTaskNumber: number | null;
  usedInTasks: boolean;
  createdAt: string;
  updatedAt: string;
  version: number;
}

export interface SparePartDetails extends SparePartListItem {
  /** Ostatnie ruchy części (pełna historia w zasobie `spare-part-movements`). */
  movements: SparePartMovementItem[];
}

export const sparePartMovementsResource = {
  name: 'spare-part-movements',
  fields: {
    id: { type: 'integer', filters: ['eq'], sortable: true },
    createdAt: { type: 'datetime', filters: ['gte', 'lte'], sortable: true },
    partId: { type: 'uuid', filters: ['eq'] },
    sku: { type: 'text', filters: ['eq'] },
    partName: { type: 'text', sortable: true },
    kind: { type: 'enum', values: PART_MOVEMENT_KINDS, filters: ['eq'], facet: true },
    delta: { type: 'integer', filters: ['gte', 'lte'], sortable: true },
    stockAfter: { type: 'integer' },
    unitCost: { type: 'integer' },
    taskId: { type: 'uuid', filters: ['eq'] },
    taskNumber: { type: 'integer', filters: ['eq'] },
    scooterId: { type: 'uuid', filters: ['eq'] },
    scooterNumber: { type: 'integer', filters: ['eq'] },
    staffId: { type: 'uuid', filters: ['eq'] },
    staffName: { type: 'text' },
    document: { type: 'text', filters: ['contains'] },
    reason: { type: 'enum', values: PART_ADJUST_REASONS, filters: ['eq'], facet: true },
    note: { type: 'text' },
  },
  search: ['sku', 'partName', 'taskNumber', 'scooterNumber', 'document'],
  defaultSort: ['-createdAt', '-id'],
  // Ruchy tylko się dopisuje (`PART_MOVEMENTS_APPEND_ONLY`).
  deleteMode: 'none',
  permissions: { read: 'service.read' },
} as const satisfies ResourceDefinition;

export interface SparePartMovementItem {
  id: number;
  createdAt: string;
  partId: string;
  sku: string;
  partName: string;
  kind: PartMovementKind;
  delta: number;
  stockAfter: number;
  unitCost: number | null;
  taskId: string | null;
  taskNumber: number | null;
  scooterId: string | null;
  scooterNumber: number | null;
  /** `null`: system (zwrot przy anulowaniu bez autora, dane startowe). */
  staffId: string | null;
  staffName: string | null;
  document: string | null;
  reason: PartAdjustReason | null;
  note: string | null;
}

// --- Pliki ---------------------------------------------------------------------------------------

/** Typ `file_purpose`: cele z wysyłki (iteracja 6) i cele modułu treści i wydruków (iteracja 7). */
export const FILE_PURPOSES = [
  'PARKING_PHOTO',
  'TICKET_PHOTO',
  'MEDIA',
  'DOCUMENT_TEMPLATE',
  'GENERATED_DOCUMENT',
  'REPORT_EXPORT',
  'DATA_EXPORT',
] as const;
export type FilePurpose = (typeof FILE_PURPOSES)[number];

/**
 * Pliki z `v_file_list` (ADR 0057). Uprawnienie modułu, który używa pliku: zdjęcia parkowania z `rentals.read`,
 * zdjęcia zgłoszeń z `tickets.read`; operator widzi tylko pliki celów, do których ma uprawnienie. Nazwa klienta
 * jak w zgłoszeniach tylko z `users.read`. Usunięcie dotyczy tylko pliku nieprzypiętego.
 */
export const filesResource = {
  name: 'files',
  fields: {
    id: { type: 'uuid', filters: ['eq'] },
    purpose: { type: 'enum', values: FILE_PURPOSES, filters: ['eq'], facet: true },
    status: { type: 'enum', values: FILE_STATUSES, filters: ['eq'], facet: true },
    contentType: { type: 'text', filters: ['eq'] },
    sizeBytes: { type: 'integer', filters: ['gte', 'lte'], sortable: true },
    sha256: { type: 'text', filters: ['eq'] },
    originalName: { type: 'text', filters: ['contains'], sortable: true },
    uploadedBy: { type: 'uuid', filters: ['eq'] },
    uploadedByName: { type: 'text' },
    uploadedByStaff: { type: 'uuid', filters: ['eq'] },
    uploadedByStaffName: { type: 'text', sortable: true },
    createdAt: { type: 'datetime', filters: ['gte', 'lte'], sortable: true },
    deletedAt: { type: 'datetime', filters: ['gte', 'lte'], sortable: true },
    rentalId: { type: 'uuid', filters: ['eq'] },
    rentalNumber: { type: 'integer', filters: ['eq'] },
    ticketId: { type: 'uuid', filters: ['eq'] },
    ticketNumber: { type: 'integer', filters: ['eq'] },
    attached: { type: 'boolean', filters: ['eq'], facet: true },
  },
  search: ['originalName', 'rentalNumber', 'ticketNumber', 'sha256'],
  defaultSort: ['-createdAt'],
  deleteMode: 'delete',
  permissions: { read: 'tickets.read' },
} as const satisfies ResourceDefinition;

export interface FileListItem {
  id: string;
  purpose: FilePurpose;
  status: FileStatus;
  contentType: string;
  sizeBytes: number | null;
  sha256: string | null;
  originalName: string | null;
  uploadedBy: string | null;
  /** `null` bez `users.read`. */
  uploadedByName: string | null;
  uploadedByStaff: string | null;
  uploadedByStaffName: string | null;
  createdAt: string;
  deletedAt: string | null;
  rentalId: string | null;
  rentalNumber: number | null;
  ticketId: string | null;
  ticketNumber: number | null;
  attached: boolean;
  /** Podpisany adres podglądu (10 min); `null` po usunięciu. */
  url: string | null;
}
