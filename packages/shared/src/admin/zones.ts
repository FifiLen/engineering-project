/**
 * Zasób panelu modułu Strefy (iteracja 4, ADR 0031, ADR 0047): lista w edytorze stref z mapą, zapis
 * z wersją rekordu, dezaktywacja i usunięcie nieużytej strefy.
 */
import { z } from 'zod';
import type { ResourceDefinition } from './list.js';

/** Kopia z packages/core (`ZONE_TYPES`); zgodność pilnuje test API. */
export const ZONE_TYPES = ['SERVICE_AREA', 'PARKING', 'SLOW', 'NO_RIDE'] as const;
export type ZoneType = (typeof ZONE_TYPES)[number];

export const zonesResource = {
  name: 'zones',
  fields: {
    id: { type: 'uuid', filters: ['eq'] },
    code: { type: 'text', filters: ['eq', 'contains'], sortable: true },
    name: { type: 'text', filters: ['contains'], sortable: true },
    type: { type: 'enum', values: ZONE_TYPES, filters: ['eq'], facet: true, sortable: true },
    active: { type: 'boolean', filters: ['eq'], facet: true },
    visibleInApp: { type: 'boolean', filters: ['eq'] },
    speedLimitKmh: { type: 'integer', sortable: true },
    capacity: { type: 'integer', sortable: true },
    areaM2: { type: 'integer', sortable: true },
    points: { type: 'integer' },
    scootersInside: { type: 'integer', sortable: true },
    ridesInside: { type: 'integer' },
    used: { type: 'boolean' },
    version: { type: 'integer' },
    updatedAt: { type: 'datetime', filters: ['gte', 'lte'], sortable: true },
    updatedByName: { type: 'text' },
  },
  search: ['code', 'name'],
  defaultSort: ['code'],
  deleteMode: 'archive',
  permissions: { read: 'zones.read', write: 'zones.write' },
} as const satisfies ResourceDefinition;

export interface ZoneListItem {
  id: string;
  code: string;
  name: string;
  type: ZoneType;
  active: boolean;
  visibleInApp: boolean;
  speedLimitKmh: number | null;
  capacity: number | null;
  areaM2: number;
  points: number;
  scootersInside: number;
  ridesInside: number;
  /** Strefa była użyta w przejazdach albo zdarzeniach: można ją tylko dezaktywować. */
  used: boolean;
  version: number;
  updatedAt: string;
  updatedByName: string | null;
}

/** Wielokąt strefy w edytorze: jeden pierścień [lon, lat] bez otworów (decyzja D1). */
export interface ZonePolygon {
  type: 'Polygon';
  coordinates: Array<Array<[number, number]>>;
}

/** Przejazd w trakcie, którego dotyczy zmiana strefy (ostrzeżenie przed zapisem, pytanie 7). */
export interface ZoneImpactRental {
  rentalId: string;
  rentalNumber: number;
  scooterId: string;
  scooterNumber: number;
  userName: string | null;
  enteredAt: string | null;
  speedKmh: number | null;
}

export interface ZoneDetails extends ZoneListItem {
  /** `null` dla strefy wieloczęściowej, którą edytor pokazuje tylko do odczytu (ADR 0047). */
  polygon: ZonePolygon | null;
  geometry: { type: 'MultiPolygon'; coordinates: number[][][][] };
  rentals: ZoneImpactRental[];
  /** Przejazdy zakończone w strefie (okno dezaktywacji: dlaczego strefy nie można usunąć). */
  endedRentals: number;
}

const coordinate = z.tuple([z.number().min(-180).max(180), z.number().min(-90).max(90)]);
export const zonePolygonSchema = z.object({
  type: z.literal('Polygon'),
  coordinates: z.array(z.array(coordinate).min(4).max(500)).length(1),
});

export const zoneInputSchema = z.object({
  code: z.string().trim().toUpperCase().min(1).max(20),
  name: z.string().trim().min(1).max(100),
  type: z.enum(ZONE_TYPES),
  speedLimitKmh: z.number().int().nullable().default(null),
  capacity: z.number().int().nullable().default(null),
  visibleInApp: z.boolean().default(true),
  polygon: zonePolygonSchema,
});
export type ZoneInput = z.infer<typeof zoneInputSchema>;

export const zoneUpdateSchema = zoneInputSchema.extend({ version: z.number().int().min(1) });
export type ZoneUpdate = z.infer<typeof zoneUpdateSchema>;

/** Podgląd skutków przed zapisem: przejazdy w obecnej i proponowanej geometrii. */
export const zoneImpactSchema = z.object({ polygon: zonePolygonSchema.nullable().default(null) });
export type ZoneImpactRequest = z.infer<typeof zoneImpactSchema>;
