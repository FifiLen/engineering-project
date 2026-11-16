import type { ScooterModelDraft, ScooterModelRepository, ScooterModelState } from '@hulajnogi/core';
import {
  scooterModelsResource,
  type ListQuery,
  type ListResponse,
  type ScooterModelDetails,
  type ScooterModelListItem,
} from '@hulajnogi/shared';
import { and, eq, sql } from 'drizzle-orm';
import { runListQuery, type ListSource } from '../admin/list-query.js';
import type { DbExecutor } from '../client.js';
import { scooterModels, vScooterModels } from '../schema/schema.js';
import { rethrowUniqueViolation } from './errors.js';

type ModelField = keyof typeof scooterModelsResource.fields;

const listSource: ListSource<ModelField> = {
  from: vScooterModels,
  id: vScooterModels.id,
  columns: {
    id: vScooterModels.id,
    code: vScooterModels.code,
    name: vScooterModels.name,
    manufacturer: vScooterModels.manufacturer,
    maxSpeedKmh: vScooterModels.maxSpeedKmh,
    batteryWh: vScooterModels.batteryWh,
    rangeKm: vScooterModels.rangeKm,
    weightKg: vScooterModels.weightKg,
    active: vScooterModels.active,
    scootersTotal: vScooterModels.scootersTotal,
    scootersActive: vScooterModels.scootersActive,
    updatedAt: vScooterModels.updatedAt,
    version: vScooterModels.version,
  },
};

const DRAFT_FIELDS = [
  'code',
  'name',
  'manufacturer',
  'maxSpeedKmh',
  'batteryWh',
  'rangeKm',
  'weightKg',
  'description',
  'active',
] as const satisfies ReadonlyArray<keyof ScooterModelDraft>;

/** Tylko pola modelu (bez nadmiarowych właściwości obiektu); numeric(4,1) w Drizzle to tekst. */
function toDb(draft: Partial<ScooterModelDraft>) {
  const row = Object.fromEntries(DRAFT_FIELDS.filter((k) => draft[k] !== undefined).map((k) => [k, draft[k]]));
  if (typeof draft.weightKg === 'number') row.weightKg = String(draft.weightKg);
  return row as Omit<Partial<ScooterModelDraft>, 'weightKg'> & { weightKg?: string | null };
}

/** Moduł Flota: modele hulajnóg (słownik, ADR 0031). */
export class DrizzleScooterModelRepository implements ScooterModelRepository {
  constructor(private readonly db: DbExecutor) {}

  list(query: ListQuery): Promise<ListResponse<ScooterModelListItem>> {
    return runListQuery<ModelField, ScooterModelListItem>(this.db, scooterModelsResource, listSource, query);
  }

  async details(id: string): Promise<ScooterModelDetails | null> {
    const [row] = await this.db
      .select({
        ...listSource.columns,
        description: vScooterModels.description,
        createdAt: vScooterModels.createdAt,
      })
      .from(vScooterModels)
      .where(eq(vScooterModels.id, id));
    if (!row) return null;
    return { ...row, weightKg: row.weightKg === null ? null : Number(row.weightKg) } as unknown as ScooterModelDetails;
  }

  async findState(id: string): Promise<ScooterModelState | null> {
    const [row] = await this.db
      .select({
        id: vScooterModels.id,
        code: vScooterModels.code,
        active: vScooterModels.active,
        version: vScooterModels.version,
        scootersTotal: vScooterModels.scootersTotal,
      })
      .from(vScooterModels)
      .where(eq(vScooterModels.id, id));
    return (row as ScooterModelState | undefined) ?? null;
  }

  async create(draft: ScooterModelDraft): Promise<{ id: string }> {
    try {
      const [row] = await this.db
        .insert(scooterModels)
        .values(toDb(draft) as typeof scooterModels.$inferInsert)
        .returning({ id: scooterModels.id });
      return row!;
    } catch (error) {
      rethrowUniqueViolation(error);
    }
  }

  async update(id: string, version: number, changes: Partial<ScooterModelDraft>): Promise<boolean> {
    try {
      const rows = await this.db
        .update(scooterModels)
        .set({ ...toDb(changes), version: sql`${scooterModels.version} + 1`, updatedAt: sql`now()` })
        .where(and(eq(scooterModels.id, id), eq(scooterModels.version, version)))
        .returning({ id: scooterModels.id });
      return rows.length > 0;
    } catch (error) {
      rethrowUniqueViolation(error);
    }
  }

  async delete(id: string): Promise<void> {
    await this.db.delete(scooterModels).where(eq(scooterModels.id, id));
  }
}
