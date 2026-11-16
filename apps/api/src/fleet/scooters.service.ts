import {
  ensureModelAssignable,
  ensureOperatorStatusChange,
  ensureVersion,
  estimateRangeKm,
  notFound,
  planScooterRemoval,
} from '@hulajnogi/core';
import { DrizzleScooterModelRepository, DrizzleScooterRepository } from '@hulajnogi/db';
import type {
  ListQuery,
  ListResponse,
  RemovalResult,
  ScooterCreate,
  ScooterDetails,
  ScooterListItem,
  ScooterUpdate,
} from '@hulajnogi/shared';
import { Injectable } from '@nestjs/common';

/**
 * Serwis aplikacyjny hulajnóg: dane z repozytoriów, reguły z packages/core. Zapisy przechodzą tylko
 * tędy; w iteracji 2 dochodzi tu sprawdzenie uprawnień i wpis w `audit_log` (ADR 0028, ADR 0031).
 */
@Injectable()
export class ScootersService {
  constructor(
    private readonly scooters: DrizzleScooterRepository,
    private readonly models: DrizzleScooterModelRepository,
  ) {}

  list(query: ListQuery): Promise<ListResponse<ScooterListItem>> {
    return this.scooters.list(query);
  }

  async details(id: string): Promise<ScooterDetails> {
    const row = await this.scooters.details(id);
    if (!row) throw notFound('scooter', id);
    const { modelRangeKm, ...rest } = row;
    return {
      ...rest,
      lastSeenAt: (row.lastSeenAt as unknown as Date | null)?.toISOString() ?? null,
      rangeKm: estimateRangeKm(row.batteryPct, modelRangeKm),
    };
  }

  async create(input: ScooterCreate): Promise<ScooterDetails> {
    await this.ensureModel(input.modelId);
    const { id } = await this.scooters.create(input);
    return this.details(id);
  }

  async update(id: string, { version, ...changes }: ScooterUpdate): Promise<ScooterDetails> {
    const state = await this.scooters.findState(id);
    if (!state) throw notFound('scooter', id);
    ensureVersion(version, state.version);
    if (changes.status) ensureOperatorStatusChange(state.status, changes.status, state.hasOpenRental);
    if (changes.modelId && changes.modelId !== state.modelId) await this.ensureModel(changes.modelId);
    if (!(await this.scooters.update(id, version, changes))) {
      // Ktoś zapisał zmianę między odczytem a zapisem.
      ensureVersion(version, (await this.scooters.findState(id))!.version);
    }
    return this.details(id);
  }

  /** Usunięcie hulajnogi to wycofanie z floty (ADR 0031). */
  async remove(id: string, version: number): Promise<RemovalResult> {
    const state = await this.scooters.findState(id);
    if (!state) throw notFound('scooter', id);
    ensureVersion(version, state.version);
    planScooterRemoval(state.status, state.hasOpenRental);
    if (state.status !== 'RETIRED' && !(await this.scooters.update(id, version, { status: 'RETIRED' }))) {
      ensureVersion(version, (await this.scooters.findState(id))!.version);
    }
    return { outcome: 'RETIRED' };
  }

  private async ensureModel(modelId: string): Promise<void> {
    const model = await this.models.findState(modelId);
    if (!model) throw notFound('scooterModel', modelId);
    ensureModelAssignable(model);
  }
}
