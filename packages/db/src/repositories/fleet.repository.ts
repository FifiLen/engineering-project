import {
  type ScooterChanges,
  type ScooterDraft,
  type ScooterRepository,
  type ScooterState,
  type ScooterStatusReason,
} from '@hulajnogi/core';
import {
  scootersResource,
  type FleetMapScooter,
  type FleetStatus,
  type ListQuery,
  type ListResponse,
  type ScooterListItem,
} from '@hulajnogi/shared';
import { and, eq, inArray, ne, sql } from 'drizzle-orm';
import { runListQuery, type ListSource } from '../admin/list-query.js';
import type { DbExecutor } from '../client.js';
import { rentals, scooters, vFleetList } from '../schema/schema.js';
import { rethrowUniqueViolation } from './errors.js';

type ScooterField = keyof typeof scootersResource.fields;

const OPEN_RENTAL = ['RESERVED', 'UNLOCKING', 'ACTIVE', 'PAUSED', 'ENDING'] as const;

const listSource: ListSource<ScooterField> = {
  from: vFleetList,
  id: vFleetList.id,
  columns: {
    id: vFleetList.id,
    number: vFleetList.number,
    serialNumber: vFleetList.serialNumber,
    variant: vFleetList.variant,
    status: vFleetList.status,
    fleetStatus: vFleetList.fleetStatus,
    online: vFleetList.online,
    modelId: vFleetList.modelId,
    modelName: vFleetList.modelName,
    batteryPct: vFleetList.batteryPct,
    parkingZoneCode: vFleetList.parkingZoneCode,
    parkingZoneName: vFleetList.parkingZoneName,
    lastSeenAt: vFleetList.lastSeenAt,
    rentals30d: vFleetList.rentals30D,
    odometerM: vFleetList.odometerM,
    firmware: vFleetList.firmware,
    lat: vFleetList.lat,
    lon: vFleetList.lon,
    version: vFleetList.version,
    statusReason: vFleetList.statusReason,
    statusChangedAt: vFleetList.statusChangedAt,
  },
};

export interface ScooterDetailsRow extends ScooterListItem {
  modelCode: string;
  modelRangeKm: number | null;
  rentalId: string | null;
  rentalNumber: number | null;
  openTickets: number;
  openServiceTasks: number;
}

const DRAFT_FIELDS = ['number', 'serialNumber', 'variant', 'modelId', 'status', 'firmware'] as const;

/** Tylko kolumny edytowalne; nadmiarowe właściwości obiektu nie trafiają do zapytania. */
function pickDraft<T extends Partial<ScooterDraft>>(draft: T): Partial<ScooterDraft> {
  return Object.fromEntries(
    DRAFT_FIELDS.filter((k) => k in draft && draft[k as keyof T] !== undefined).map((k) => [k, draft[k as keyof T]]),
  );
}

/** Moduł Flota: hulajnogi (lista z widoku `v_fleet_list`, zapisy z blokadą optymistyczną). */
export class DrizzleScooterRepository implements ScooterRepository {
  constructor(private readonly db: DbExecutor) {}

  list(query: ListQuery): Promise<ListResponse<ScooterListItem>> {
    return runListQuery<ScooterField, ScooterListItem>(this.db, scootersResource, listSource, query);
  }

  async details(id: string): Promise<ScooterDetailsRow | null> {
    const [row] = await this.db
      .select({
        ...listSource.columns,
        modelCode: vFleetList.modelCode,
        modelRangeKm: vFleetList.modelRangeKm,
        rentalId: vFleetList.rentalId,
        rentalNumber: vFleetList.rentalNumber,
        openTickets: vFleetList.openTickets,
        openServiceTasks: vFleetList.openServiceTasks,
      })
      .from(vFleetList)
      .where(eq(vFleetList.id, id));
    return (row as ScooterDetailsRow | undefined) ?? null;
  }

  /** Punkt początkowy mapy floty: wszystkie hulajnogi poza wycofanymi. */
  async mapSnapshot(): Promise<FleetMapScooter[]> {
    const rows = await this.db
      .select({
        id: vFleetList.id,
        number: vFleetList.number,
        lat: vFleetList.lat,
        lon: vFleetList.lon,
        batteryPct: vFleetList.batteryPct,
        fleetStatus: vFleetList.fleetStatus,
        online: vFleetList.online,
        lastSeenAt: vFleetList.lastSeenAt,
      })
      .from(vFleetList)
      .where(ne(vFleetList.status, 'RETIRED'))
      .orderBy(vFleetList.number);
    return rows.map((r) => ({
      ...(r as Omit<FleetMapScooter, 'lastSeenAt' | 'speedKmh' | 'locked'>),
      fleetStatus: r.fleetStatus as FleetStatus,
      lastSeenAt: r.lastSeenAt?.toISOString() ?? null,
      speedKmh: null,
      locked: null,
    }));
  }

  /** Próg niskiej baterii z obowiązującego cennika (`fn_low_battery_threshold`). */
  async lowBatteryThreshold(): Promise<number> {
    const { rows } = await this.db.execute<{ threshold: number }>(sql`SELECT fn_low_battery_threshold() AS threshold`);
    return rows[0]!.threshold;
  }

  /** Identyfikator hulajnogi po numerze (polecenie symulatora z panelu wskazuje numer, ADR 0059). */
  async idByNumber(number: number): Promise<string | null> {
    const [row] = await this.db.select({ id: scooters.id }).from(scooters).where(eq(scooters.number, number));
    return row?.id ?? null;
  }

  async findState(id: string): Promise<ScooterState | null> {
    const [row] = await this.db
      .select({
        id: scooters.id,
        number: scooters.number,
        status: scooters.status,
        online: scooters.online,
        batteryPct: scooters.batteryPct,
        modelId: scooters.modelId,
        version: scooters.version,
        hasOpenRental: sql<boolean>`EXISTS (SELECT 1 FROM ${rentals} WHERE ${rentals.scooterId} = ${scooters.id}
          AND ${inArray(rentals.state, [...OPEN_RENTAL])})`,
      })
      .from(scooters)
      .where(eq(scooters.id, id));
    return row ?? null;
  }

  async create(draft: ScooterDraft): Promise<{ id: string }> {
    try {
      const [row] = await this.db
        .insert(scooters)
        .values(pickDraft(draft) as ScooterDraft)
        .returning({ id: scooters.id });
      return row!;
    } catch (error) {
      rethrowUniqueViolation(error);
    }
  }

  /**
   * Zapis z blokadą optymistyczną; `statusReason` (gdy podany) zapisuje przyczynę stanu razem ze zmianą stanu
   * (`scooters_status_reason_matches`, ADR 0055).
   */
  async update(
    id: string,
    version: number,
    changes: ScooterChanges,
    statusReason?: ScooterStatusReason | null,
  ): Promise<boolean> {
    try {
      const rows = await this.db
        .update(scooters)
        .set({
          ...pickDraft(changes),
          ...(statusReason !== undefined ? { statusReason } : {}),
          version: sql`${scooters.version} + 1`,
          updatedAt: sql`now()`,
        })
        .where(and(eq(scooters.id, id), eq(scooters.version, version)))
        .returning({ id: scooters.id });
      return rows.length > 0;
    } catch (error) {
      rethrowUniqueViolation(error);
    }
  }
}
