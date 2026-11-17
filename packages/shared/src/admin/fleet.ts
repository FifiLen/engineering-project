/**
 * Zasoby panelu modułu Flota: hulajnogi i modele (ADR 0031). Wartości wyliczeń są kopią z packages/core;
 * zgodność pilnuje test API.
 */
import { z } from 'zod';
import type { ResourceDefinition } from './list.js';

export const SCOOTER_STATUSES = ['AVAILABLE', 'RESERVED', 'IN_USE', 'MAINTENANCE', 'RETIRED'] as const;
export type ScooterStatus = (typeof SCOOTER_STATUSES)[number];
export const OPERATOR_STATUSES = ['AVAILABLE', 'MAINTENANCE', 'RETIRED'] as const;
export const FLEET_STATUSES = [
  'AVAILABLE',
  'RESERVED',
  'IN_USE',
  'LOW_BATTERY',
  'MAINTENANCE',
  'OFFLINE',
  'RETIRED',
] as const;
export type FleetStatus = (typeof FLEET_STATUSES)[number];
export const SCOOTER_VARIANTS = ['GRAFIT', 'BETON', 'KOBALT'] as const;
export type ScooterVariant = (typeof SCOOTER_VARIANTS)[number];
export const PANEL_COMMANDS = ['UNLOCK', 'LOCK', 'RING', 'LIGHTS'] as const;
export type PanelCommand = (typeof PANEL_COMMANDS)[number];
export const COMMAND_STATUSES = ['SENT', 'ACKED', 'REJECTED', 'TIMEOUT'] as const;
export type CommandStatus = (typeof COMMAND_STATUSES)[number];

// ---------------------------------------------------------------------------------------------
// Hulajnogi
// ---------------------------------------------------------------------------------------------

export const scooterCreateSchema = z.object({
  number: z.number().int().min(1).max(9999),
  serialNumber: z
    .string()
    .trim()
    .min(3)
    .max(40)
    .regex(/^[A-Z0-9-]+$/),
  variant: z.enum(SCOOTER_VARIANTS),
  modelId: z.uuid(),
  status: z.enum(['AVAILABLE', 'MAINTENANCE']).default('MAINTENANCE'),
  firmware: z.string().trim().max(40).nullable().default(null),
});
export type ScooterCreate = z.infer<typeof scooterCreateSchema>;

export const scooterUpdateSchema = z.object({
  version: z.number().int().min(1),
  serialNumber: scooterCreateSchema.shape.serialNumber.optional(),
  variant: z.enum(SCOOTER_VARIANTS).optional(),
  modelId: z.uuid().optional(),
  status: z.enum(OPERATOR_STATUSES).optional(),
  firmware: z.string().trim().max(40).nullable().optional(),
});
export type ScooterUpdate = z.infer<typeof scooterUpdateSchema>;

export const scootersResource = {
  name: 'scooters',
  fields: {
    id: { type: 'uuid', filters: ['eq'] },
    number: { type: 'integer', filters: ['eq', 'gte', 'lte'], sortable: true },
    serialNumber: { type: 'text', filters: ['contains'], sortable: true },
    variant: { type: 'enum', values: SCOOTER_VARIANTS, filters: ['eq'], sortable: true, facet: true },
    status: { type: 'enum', values: SCOOTER_STATUSES, filters: ['eq'], facet: true },
    fleetStatus: { type: 'enum', values: FLEET_STATUSES, filters: ['eq'], facet: true },
    online: { type: 'boolean', filters: ['eq'] },
    modelId: { type: 'uuid', filters: ['eq'] },
    modelName: { type: 'text', sortable: true },
    batteryPct: { type: 'integer', filters: ['gte', 'lte'], sortable: true },
    parkingZoneCode: { type: 'text', filters: ['eq'], sortable: true, facet: true },
    parkingZoneName: { type: 'text' },
    lastSeenAt: { type: 'datetime', filters: ['gte', 'lte'], sortable: true },
    rentals30d: { type: 'integer', sortable: true },
    odometerM: { type: 'integer', filters: ['gte', 'lte'], sortable: true },
    firmware: { type: 'text', filters: ['eq'], sortable: true },
    lat: { type: 'decimal' },
    lon: { type: 'decimal' },
    version: { type: 'integer' },
  },
  search: ['number', 'serialNumber'],
  defaultSort: ['number'],
  deleteMode: 'retire',
  permissions: { read: 'scooters.read', write: 'scooters.write', delete: 'scooters.write' },
  createSchema: scooterCreateSchema,
  updateSchema: scooterUpdateSchema,
} as const satisfies ResourceDefinition;

export interface ScooterListItem {
  id: string;
  number: number;
  serialNumber: string;
  variant: ScooterVariant;
  status: ScooterStatus;
  fleetStatus: FleetStatus;
  online: boolean;
  modelId: string;
  modelName: string;
  batteryPct: number | null;
  parkingZoneCode: string | null;
  parkingZoneName: string | null;
  lastSeenAt: string | null;
  rentals30d: number;
  odometerM: number;
  firmware: string | null;
  lat: number | null;
  lon: number | null;
  /** Wersja rekordu do operacji grupowych z blokadą optymistyczną. */
  version: number;
}

export interface ScooterDetails extends ScooterListItem {
  modelCode: string;
  /** Szacowany zasięg przy obecnej baterii (packages/core). */
  rangeKm: number | null;
  rentalId: string | null;
  rentalNumber: number | null;
  openTickets: number;
  openServiceTasks: number;
}

export interface CommandView {
  id: string;
  scooterId: string;
  scooterNumber: number;
  type: string;
  status: CommandStatus;
  sentAt: string;
  ackedAt: string | null;
}

/** Komenda z panelu; `on` dotyczy tylko świateł. */
export const commandRequestSchema = z.object({ type: z.enum(PANEL_COMMANDS), on: z.boolean().optional() });

// ---------------------------------------------------------------------------------------------
// Modele hulajnóg
// ---------------------------------------------------------------------------------------------

const nullableInt = (min: number, max: number) => z.number().int().min(min).max(max).nullable();

/** Pola modelu bez wartości domyślnych: wspólne dla tworzenia i częściowej edycji. */
const scooterModelFields = {
  code: z
    .string()
    .trim()
    .min(2)
    .max(20)
    .regex(/^[A-Z0-9-]+$/),
  name: z.string().trim().min(2).max(80),
  manufacturer: z.string().trim().max(80).nullable(),
  maxSpeedKmh: nullableInt(1, 100),
  batteryWh: nullableInt(1, 10_000),
  rangeKm: nullableInt(1, 300),
  weightKg: z.number().min(0.1).max(999.9).multipleOf(0.1).nullable(),
  description: z.string().trim().max(2000).nullable(),
  active: z.boolean(),
};

export const scooterModelCreateSchema = z.object({
  ...scooterModelFields,
  manufacturer: scooterModelFields.manufacturer.default(null),
  maxSpeedKmh: scooterModelFields.maxSpeedKmh.default(null),
  batteryWh: scooterModelFields.batteryWh.default(null),
  rangeKm: scooterModelFields.rangeKm.default(null),
  weightKg: scooterModelFields.weightKg.default(null),
  description: scooterModelFields.description.default(null),
  active: scooterModelFields.active.default(true),
});
export type ScooterModelCreate = z.infer<typeof scooterModelCreateSchema>;

export const scooterModelUpdateSchema = z
  .object({ version: z.number().int().min(1), ...scooterModelFields })
  .partial()
  .required({ version: true });
export type ScooterModelUpdate = z.infer<typeof scooterModelUpdateSchema>;

export const scooterModelsResource = {
  name: 'scooter-models',
  fields: {
    id: { type: 'uuid', filters: ['eq'] },
    code: { type: 'text', filters: ['contains'], sortable: true },
    name: { type: 'text', filters: ['contains'], sortable: true },
    manufacturer: { type: 'text', filters: ['contains'], sortable: true },
    maxSpeedKmh: { type: 'integer', filters: ['gte', 'lte'], sortable: true },
    batteryWh: { type: 'integer', filters: ['gte', 'lte'], sortable: true },
    rangeKm: { type: 'integer', filters: ['gte', 'lte'], sortable: true },
    weightKg: { type: 'decimal', filters: ['gte', 'lte'], sortable: true },
    active: { type: 'boolean', filters: ['eq'], facet: true },
    scootersTotal: { type: 'integer', sortable: true },
    scootersActive: { type: 'integer', filters: ['gte', 'lte'], sortable: true },
    updatedAt: { type: 'datetime', filters: ['gte', 'lte'], sortable: true },
    version: { type: 'integer' },
  },
  search: ['code', 'name', 'manufacturer'],
  defaultSort: ['name'],
  deleteMode: 'archive',
  permissions: { read: 'scooters.read', write: 'scooters.write', delete: 'scooters.write' },
  createSchema: scooterModelCreateSchema,
  updateSchema: scooterModelUpdateSchema,
} as const satisfies ResourceDefinition;

export interface ScooterModelListItem {
  id: string;
  code: string;
  name: string;
  manufacturer: string | null;
  maxSpeedKmh: number | null;
  batteryWh: number | null;
  rangeKm: number | null;
  weightKg: number | null;
  active: boolean;
  scootersTotal: number;
  scootersActive: number;
  updatedAt: string;
  version: number;
}

export interface ScooterModelDetails extends ScooterModelListItem {
  description: string | null;
  createdAt: string;
}

/** Wynik usunięcia rekordu: usunięty albo zarchiwizowany (ADR 0031). */
export interface RemovalResult {
  outcome: 'DELETED' | 'ARCHIVED' | 'RETIRED';
}
