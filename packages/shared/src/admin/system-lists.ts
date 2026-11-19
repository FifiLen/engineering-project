/**
 * Nowe listy techniczne i tylko do dopisywania (iteracja 8, ADR 0074, ADR 0076): Flota → Komendy, karta hulajnogi
 * → Historia stanów, Przejazdy → Zdarzenia, Strefy → Obecność i komendy stref, Płatności → Klienci operatora.
 * Wszystkie tylko do odczytu; komendy wysyła karta hulajnogi (`scooters.command`), a resztę zapisuje system.
 * Telemetria nie ma kontraktu list (kursor bez liczby wszystkich, `telemetryReadingsQuerySchema`).
 */
import { z } from 'zod';
import { RENTAL_STATES, type RentalState } from '../rentals.js';
import { SERVICE_TASK_TYPES, type ServiceTaskType } from '../service.js';
import { AUTO_TICKET_KINDS, type AutoTicketKind } from '../tickets.js';
import { USER_STATUSES, type UserStatus } from './access.js';
import { COMMAND_STATUSES, SCOOTER_STATUSES, type CommandStatus, type ScooterStatus } from './fleet.js';
import type { ResourceDefinition } from './list.js';
import { ZONE_TYPES, type ZoneType } from './zones.js';

/** Typy komend MQTT (`command_type`), kopia z bazy i kontraktu MQTT 1.3.0. */
export const COMMAND_TYPES = [
  'UNLOCK',
  'LOCK',
  'SPEED_LIMIT',
  'STOP_GRADUALLY',
  'RING',
  'LIGHTS',
  'RELEASE_STOP',
  'BATTERY_SWAPPED',
] as const;
export type CommandType = (typeof COMMAND_TYPES)[number];
/** Źródło komendy (ADR 0076): operator, przejazd, strefa, system. */
export const COMMAND_SOURCES = ['STAFF', 'RENTAL', 'ZONE', 'SYSTEM'] as const;
export type CommandSource = (typeof COMMAND_SOURCES)[number];

export const RENTAL_EVENT_TYPES = [
  'STATE_CHANGED',
  'ZONE_ENTERED',
  'ZONE_EXITED',
  'BATTERY_LOW',
  'CONNECTION_LOST',
  'CONNECTION_RESTORED',
  'PHOTO_UPLOADED',
  'END_REQUESTED',
  'PAUSE_FAILED',
  'RESUME_FAILED',
  'LOCK_FAILED',
  'ENDED_REMOTELY',
  'LATE_UNLOCK_LOCKED',
  'BILLING_STOPPED',
  'MOVED_AFTER_END',
] as const;
export type RentalEventType = (typeof RENTAL_EVENT_TYPES)[number];

/** Kategoria czasu przedziału (`fn_scooter_time_category`, ADR 0074). */
export const SCOOTER_TIME_CATEGORIES = ['IN_RIDE', 'RESERVED', 'AVAILABLE', 'SERVICE', 'OFFLINE', 'RETIRED'] as const;
export type ScooterTimeCategory = (typeof SCOOTER_TIME_CATEGORIES)[number];
/** Przyczyna przedziału dopasowana w czasie w `v_scooter_status_history` (ADR 0074). */
export const STATUS_HISTORY_REASONS = [
  'RENTAL',
  'RESERVATION',
  'SERVICE_TASK',
  'TICKET',
  'AUTO_OFFLINE',
  'STAFF',
  'NO_TELEMETRY',
  'SYSTEM',
] as const;
export type StatusHistoryReason = (typeof STATUS_HISTORY_REASONS)[number];

// --- Komendy ---------------------------------------------------------------------------------------------

export const scooterCommandsResource = {
  name: 'scooter-commands',
  fields: {
    id: { type: 'uuid', filters: ['eq'] },
    scooterId: { type: 'uuid', filters: ['eq'] },
    scooterNumber: { type: 'integer', filters: ['eq'], sortable: true },
    type: { type: 'enum', values: COMMAND_TYPES, filters: ['eq'], facet: true, sortable: true },
    source: { type: 'enum', values: COMMAND_SOURCES, filters: ['eq'], facet: true, sortable: true },
    zoneId: { type: 'uuid', filters: ['eq'] },
    zoneCode: { type: 'text', filters: ['eq'], sortable: true },
    zoneName: { type: 'text' },
    issuedByStaff: { type: 'uuid', filters: ['eq'] },
    staffName: { type: 'text', sortable: true },
    rentalId: { type: 'uuid', filters: ['eq'] },
    rentalNumber: { type: 'integer', filters: ['eq'], sortable: true },
    status: { type: 'enum', values: COMMAND_STATUSES, filters: ['eq'], facet: true, sortable: true },
    ackReason: { type: 'text', filters: ['eq'] },
    sentAt: { type: 'datetime', filters: ['gte', 'lte'], sortable: true },
    ackedAt: { type: 'datetime', filters: ['gte', 'lte'], sortable: true },
    expiresAt: { type: 'datetime', filters: ['gte', 'lte'] },
    responseMs: { type: 'integer', filters: ['gte', 'lte'], sortable: true },
  },
  search: ['scooterNumber', 'rentalNumber', 'staffName', 'zoneCode'],
  defaultSort: ['-sentAt'],
  deleteMode: 'none',
  // Lista z `scooters.read` (ADR 0076; macierz miała `scooters.command`, które zostaje do wysyłki).
  permissions: { read: 'scooters.read' },
} as const satisfies ResourceDefinition;

export interface ScooterCommandListItem {
  id: string;
  scooterId: string;
  scooterNumber: number;
  type: CommandType;
  source: CommandSource;
  zoneId: string | null;
  zoneCode: string | null;
  zoneName: string | null;
  issuedByStaff: string | null;
  staffName: string | null;
  rentalId: string | null;
  rentalNumber: number | null;
  status: CommandStatus;
  ackReason: string | null;
  sentAt: string;
  ackedAt: string | null;
  expiresAt: string | null;
  responseMs: number | null;
}

// --- Historia stanów hulajnogi ------------------------------------------------------------------------------

export const scooterStatusHistoryResource = {
  name: 'scooter-status-history',
  fields: {
    id: { type: 'integer', filters: ['eq'], sortable: true },
    scooterId: { type: 'uuid', filters: ['eq'] },
    scooterNumber: { type: 'integer', filters: ['eq'], sortable: true },
    modelId: { type: 'uuid', filters: ['eq'] },
    status: { type: 'enum', values: SCOOTER_STATUSES, filters: ['eq'], facet: true, sortable: true },
    online: { type: 'boolean', filters: ['eq'], facet: true },
    validFrom: { type: 'datetime', filters: ['gte', 'lte'], sortable: true },
    validTo: { type: 'datetime', filters: ['gte', 'lte'], sortable: true },
    isOpen: { type: 'boolean', filters: ['eq'] },
    durationSeconds: { type: 'integer', filters: ['gte', 'lte'], sortable: true },
    category: { type: 'enum', values: SCOOTER_TIME_CATEGORIES, filters: ['eq'], facet: true, sortable: true },
    reason: { type: 'enum', values: STATUS_HISTORY_REASONS, filters: ['eq'], facet: true },
    reasonRentalId: { type: 'uuid', filters: ['eq'] },
    reasonRentalNumber: { type: 'integer' },
    reasonTaskId: { type: 'uuid', filters: ['eq'] },
    reasonTaskNumber: { type: 'integer' },
    reasonTaskType: { type: 'enum', values: SERVICE_TASK_TYPES },
    reasonTaskAssigneeName: { type: 'text' },
    reasonTicketId: { type: 'uuid', filters: ['eq'] },
    reasonTicketNumber: { type: 'integer' },
    reasonTicketAutoKind: { type: 'enum', values: AUTO_TICKET_KINDS },
    reasonAuditAction: { type: 'text' },
    reasonStaffName: { type: 'text' },
  },
  search: ['scooterNumber', 'reasonRentalNumber', 'reasonTaskNumber', 'reasonTicketNumber'],
  defaultSort: ['-validFrom'],
  // Okres zakładki (przedziały nachodzące na `[from, to)`, także otwarte) dokłada `ListSource` z repozytorium.
  deleteMode: 'none',
  permissions: { read: 'scooters.read' },
} as const satisfies ResourceDefinition;

export interface ScooterStatusHistoryItem {
  id: number;
  scooterId: string;
  scooterNumber: number;
  modelId: string;
  status: ScooterStatus;
  online: boolean;
  validFrom: string;
  /** `null`: przedział otwarty („teraz”). */
  validTo: string | null;
  isOpen: boolean;
  durationSeconds: number;
  category: ScooterTimeCategory;
  reason: StatusHistoryReason;
  reasonRentalId: string | null;
  reasonRentalNumber: number | null;
  reasonTaskId: string | null;
  reasonTaskNumber: number | null;
  reasonTaskType: ServiceTaskType | null;
  reasonTaskAssigneeName: string | null;
  reasonTicketId: string | null;
  reasonTicketNumber: number | null;
  reasonTicketAutoKind: AutoTicketKind | null;
  reasonAuditAction: string | null;
  reasonStaffName: string | null;
}

/**
 * Udziały czasu hulajnogi za okres (karta hulajnogi → Historia stanów, ADR 0074): `GET /admin/scooters/{id}/status-time`
 * z okresem najwyżej `STATUS_HISTORY_MAX_DAYS` dni; przedziały przycięte do okresu, sekundy w kategoriach i wskaźniki
 * z core (wykorzystanie = przejazd ÷ czas okresu, dostępność = dostępna + rezerwacja + przejazd ÷ czas okresu).
 */
export const STATUS_HISTORY_MAX_DAYS = 92;
export const scooterStatusTimeQuerySchema = z
  .object({ from: z.iso.datetime({ offset: true }), to: z.iso.datetime({ offset: true }) })
  .refine((q) => Date.parse(q.to) > Date.parse(q.from), { path: ['to'], message: 'Koniec okresu przed początkiem' })
  .refine((q) => Date.parse(q.to) - Date.parse(q.from) <= STATUS_HISTORY_MAX_DAYS * 86_400_000, {
    path: ['to'],
    message: 'Okres najwyżej 92 dni',
  });
export type ScooterStatusTimeQuery = z.infer<typeof scooterStatusTimeQuerySchema>;

export interface ScooterStatusTimeInterval {
  status: ScooterStatus;
  online: boolean;
  category: ScooterTimeCategory;
  /** Granice przycięte do okresu (oś czasu); przedział otwarty kończy się na `now`. */
  from: string;
  to: string;
  /** `true`: przedział trwa (`valid_to` puste). */
  open: boolean;
}

export interface ScooterStatusTime {
  scooterId: string;
  from: string;
  to: string;
  /** Chwila odczytu: okres trwający liczy się do niej. */
  now: string;
  /** Czas okresu w sekundach do `min(to, now)`. */
  periodSeconds: number;
  /** Początek historii hulajnogi (`null`: brak przedziałów w okresie i wcześniej). */
  historySince: string | null;
  intervals: ScooterStatusTimeInterval[];
  totals: Record<ScooterTimeCategory, number>;
  utilization: number | null;
  availability: number | null;
  shares: Record<ScooterTimeCategory, number | null>;
}

// --- Zdarzenia przejazdów ------------------------------------------------------------------------------------

export const rentalEventsResource = {
  name: 'rental-events',
  fields: {
    id: { type: 'integer', filters: ['eq'], sortable: true },
    rentalId: { type: 'uuid', filters: ['eq'] },
    rentalNumber: { type: 'integer', filters: ['eq'], sortable: true },
    rentalState: { type: 'enum', values: RENTAL_STATES, filters: ['eq'], facet: true },
    scooterId: { type: 'uuid', filters: ['eq'] },
    scooterNumber: { type: 'integer', filters: ['eq'], sortable: true },
    userId: { type: 'uuid', filters: ['eq'] },
    // Bez `users.read` API pokazuje „Klient” (maskowanie jak na liście przejazdów).
    userName: { type: 'text', sortable: true, personal: true },
    type: { type: 'enum', values: RENTAL_EVENT_TYPES, filters: ['eq'], facet: true, sortable: true },
    fromState: { type: 'enum', values: RENTAL_STATES, filters: ['eq'] },
    toState: { type: 'enum', values: RENTAL_STATES, filters: ['eq'] },
    zoneId: { type: 'uuid', filters: ['eq'] },
    zoneCode: { type: 'text', filters: ['eq'], sortable: true },
    zoneName: { type: 'text' },
    zoneType: { type: 'enum', values: ZONE_TYPES, filters: ['eq'], facet: true },
    createdAt: { type: 'datetime', filters: ['gte', 'lte'], sortable: true },
  },
  search: ['rentalNumber', 'scooterNumber', 'userName', 'zoneCode'],
  defaultSort: ['-createdAt', '-id'],
  deleteMode: 'none',
  permissions: { read: 'rentals.read' },
} as const satisfies ResourceDefinition;

export interface RentalEventListItem {
  id: number;
  rentalId: string;
  rentalNumber: number;
  rentalState: RentalState;
  scooterId: string;
  scooterNumber: number;
  userId: string;
  /** `null` bez `users.read`. */
  userName: string | null;
  type: RentalEventType;
  fromState: RentalState | null;
  toState: RentalState | null;
  zoneId: string | null;
  zoneCode: string | null;
  zoneName: string | null;
  zoneType: ZoneType | null;
  /** Dane zdarzenia (szczegóły; bez filtrów i eksportu). */
  data?: Record<string, unknown>;
  createdAt: string;
}

// --- Obecność i komendy stref --------------------------------------------------------------------------------

export const zonePresenceResource = {
  name: 'zone-presence',
  fields: {
    scooterId: { type: 'uuid', filters: ['eq'] },
    scooterNumber: { type: 'integer', filters: ['eq'], sortable: true },
    zoneId: { type: 'uuid', filters: ['eq'] },
    zoneCode: { type: 'text', filters: ['eq'], sortable: true },
    zoneName: { type: 'text' },
    zoneType: { type: 'enum', values: ZONE_TYPES, filters: ['eq'], facet: true, sortable: true },
    rentalId: { type: 'uuid', filters: ['eq'] },
    rentalNumber: { type: 'integer', filters: ['eq'], sortable: true },
    enteredAt: { type: 'datetime', filters: ['gte', 'lte'], sortable: true },
    outsideCount: { type: 'integer', filters: ['gte'], sortable: true },
    secondsInZone: { type: 'integer', filters: ['gte', 'lte'], sortable: true },
  },
  search: ['scooterNumber', 'rentalNumber', 'zoneCode'],
  defaultSort: ['-enteredAt'],
  deleteMode: 'none',
  permissions: { read: 'zones.read' },
} as const satisfies ResourceDefinition;

export interface ZonePresenceListItem {
  scooterId: string;
  scooterNumber: number;
  zoneId: string;
  zoneCode: string;
  zoneName: string;
  zoneType: ZoneType;
  rentalId: string;
  rentalNumber: number;
  enteredAt: string;
  outsideCount: number;
  secondsInZone: number;
}

export const zoneControlResource = {
  name: 'zone-control',
  fields: {
    scooterId: { type: 'uuid', filters: ['eq'] },
    scooterNumber: { type: 'integer', filters: ['eq'], sortable: true },
    rentalId: { type: 'uuid', filters: ['eq'] },
    rentalNumber: { type: 'integer', filters: ['eq'], sortable: true },
    speedLimitKmh: { type: 'integer', filters: ['eq'], sortable: true },
    limitSynced: { type: 'boolean', filters: ['eq'], facet: true },
    limitCommandId: { type: 'uuid', filters: ['eq'] },
    limitCommandStatus: { type: 'enum', values: COMMAND_STATUSES, filters: ['eq'], facet: true },
    stopped: { type: 'boolean', filters: ['eq'], facet: true },
    stopSynced: { type: 'boolean', filters: ['eq'], facet: true },
    stopCommandId: { type: 'uuid', filters: ['eq'] },
    stopCommandStatus: { type: 'enum', values: COMMAND_STATUSES, filters: ['eq'], facet: true },
    startedAt: { type: 'datetime', filters: ['gte', 'lte'], sortable: true },
    updatedAt: { type: 'datetime', filters: ['gte', 'lte'], sortable: true },
  },
  search: ['scooterNumber', 'rentalNumber'],
  defaultSort: ['-updatedAt'],
  deleteMode: 'none',
  permissions: { read: 'zones.read' },
} as const satisfies ResourceDefinition;

export interface ZoneControlListItem {
  scooterId: string;
  scooterNumber: number;
  rentalId: string;
  rentalNumber: number;
  speedLimitKmh: number | null;
  limitSynced: boolean;
  limitCommandId: string | null;
  limitCommandStatus: CommandStatus | null;
  stopped: boolean;
  stopSynced: boolean;
  stopCommandId: string | null;
  stopCommandStatus: CommandStatus | null;
  startedAt: string;
  updatedAt: string;
}

// --- Klienci operatora płatności ------------------------------------------------------------------------------

export const paymentCustomersResource = {
  name: 'payment-customers',
  fields: {
    userId: { type: 'uuid', filters: ['eq'] },
    userName: { type: 'text', sortable: true, personal: true },
    userStatus: { type: 'enum', values: USER_STATUSES, filters: ['eq'], facet: true },
    provider: { type: 'text', filters: ['eq'], facet: true, sortable: true },
    providerCustomerId: { type: 'text', filters: ['eq', 'contains'], sortable: true },
    createdAt: { type: 'datetime', filters: ['gte', 'lte'], sortable: true },
    paymentMethods: { type: 'integer', filters: ['gte', 'lte'], sortable: true },
    lastPaymentAt: { type: 'datetime', filters: ['gte', 'lte'], sortable: true },
  },
  search: ['userName', 'providerCustomerId'],
  defaultSort: ['-createdAt'],
  deleteMode: 'none',
  permissions: { read: 'payments.read' },
} as const satisfies ResourceDefinition;

export interface PaymentCustomerListItem {
  userId: string;
  /** `null` bez `users.read` (maskowanie jak na liście płatności). */
  userName: string | null;
  userStatus: UserStatus;
  provider: string;
  providerCustomerId: string;
  createdAt: string;
  paymentMethods: number;
  lastPaymentAt: string | null;
}

// --- Telemetria (kursor, wyjątek od kontraktu list) ---------------------------------------------------------

/** Najdłuższy zakres listy i eksportu telemetrii (ADR 0076). */
export const TELEMETRY_MAX_RANGE_HOURS = 24;
export const TELEMETRY_PAGE_SIZE = 50;

/**
 * `GET /admin/telemetry` (`telemetry.read`): hulajnoga i zakres wymagane (najwyżej 24 h), kursor to czas ostatniego
 * wiersza strony (`direction=older` od najnowszych, `newer` w górę), bez liczby wszystkich wierszy.
 */
export const telemetryReadingsQuerySchema = z
  .object({
    scooterId: z.uuid(),
    from: z.iso.datetime({ offset: true }),
    to: z.iso.datetime({ offset: true }),
    cursor: z.iso.datetime({ offset: true }).optional(),
    direction: z.enum(['older', 'newer']).default('older'),
    batteryBelow: z.coerce.number().int().min(1).max(100).optional(),
    inRide: z
      .union([z.boolean(), z.enum(['1', '0', 'true', 'false'])])
      .transform((v) => v === true || v === '1' || v === 'true')
      .optional(),
    pageSize: z.coerce.number().int().min(10).max(200).default(TELEMETRY_PAGE_SIZE),
  })
  .refine((q) => Date.parse(q.to) > Date.parse(q.from), { path: ['to'], message: 'Koniec zakresu przed początkiem' })
  .refine((q) => Date.parse(q.to) - Date.parse(q.from) <= TELEMETRY_MAX_RANGE_HOURS * 3_600_000, {
    path: ['to'],
    message: 'Zakres najwyżej 24 h',
  });
export type TelemetryReadingsQuery = z.infer<typeof telemetryReadingsQuerySchema>;

export interface TelemetryReadingView {
  recordedAt: string;
  lon: number;
  lat: number;
  batteryPct: number | null;
  speedKmh: number | null;
  rentalId: string | null;
  rentalNumber: number | null;
  /** `null` w odczytach sprzed migracji 0013. */
  locked: boolean | null;
  buffered: boolean | null;
  /** Odstęp od poprzedniego odczytu tej hulajnogi (do doby wstecz). */
  gapSeconds: number | null;
}

/**
 * Kolumny eksportu telemetrii (`POST /admin/telemetry/export`, ADR 0073): pola odczytu do walidacji kolumn i typów
 * komórek. Lista telemetrii nie ma kontraktu list, więc definicja nie ma filtrów ani sortowania i nie jest w rejestrze.
 */
export const telemetryReadingsResource = {
  name: 'telemetry',
  fields: {
    recordedAt: { type: 'datetime' },
    lat: { type: 'decimal' },
    lon: { type: 'decimal' },
    batteryPct: { type: 'integer' },
    speedKmh: { type: 'decimal' },
    rentalId: { type: 'uuid' },
    rentalNumber: { type: 'integer' },
    locked: { type: 'boolean' },
    buffered: { type: 'boolean' },
    gapSeconds: { type: 'decimal' },
  },
  search: [],
  defaultSort: [],
  deleteMode: 'none',
  permissions: { read: 'telemetry.read' },
} as const satisfies ResourceDefinition;

export interface TelemetryReadingsPage {
  items: TelemetryReadingView[];
  /** Kursor kolejnej strony starszej i nowszej; `null`, gdy w zakresie nie ma więcej odczytów. */
  olderCursor: string | null;
  newerCursor: string | null;
}
