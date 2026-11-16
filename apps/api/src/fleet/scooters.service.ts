import {
  diffForAudit,
  ensureModelAssignable,
  ensureOperatorStatusChange,
  ensureVersion,
  estimateRangeKm,
  notFound,
  planScooterRemoval,
} from '@hulajnogi/core';
import { type DbExecutor, DrizzleScooterModelRepository, DrizzleScooterRepository } from '@hulajnogi/db';
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
import { AuditedTransaction } from '../audit/audited-transaction.js';

/**
 * Serwis aplikacyjny hulajnóg: dane z repozytoriów, reguły z packages/core. Każdy zapis operatora
 * powstaje w transakcji z wpisem w dzienniku audytu (ADR 0028, ADR 0031).
 */
@Injectable()
export class ScootersService {
  constructor(
    private readonly scooters: DrizzleScooterRepository,
    private readonly transaction: AuditedTransaction,
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

  async create(staffId: string, input: ScooterCreate): Promise<ScooterDetails> {
    const id = await this.transaction.run(staffId, async ({ tx, audit }) => {
      await ensureModel(tx, input.modelId);
      const created = await new DrizzleScooterRepository(tx).create(input);
      await audit({ action: 'scooter.created', entityType: 'scooter', entityId: created.id, data: { ...input } });
      return created.id;
    });
    return this.details(id);
  }

  async update(staffId: string, id: string, { version, ...changes }: ScooterUpdate): Promise<ScooterDetails> {
    await this.transaction.run(staffId, async ({ tx, audit }) => {
      const scooters = new DrizzleScooterRepository(tx);
      const [state, before] = await Promise.all([scooters.findState(id), scooters.details(id)]);
      if (!state || !before) throw notFound('scooter', id);
      ensureVersion(version, state.version);
      if (changes.status) ensureOperatorStatusChange(state.status, changes.status, state.hasOpenRental);
      if (changes.modelId && changes.modelId !== state.modelId) await ensureModel(tx, changes.modelId);
      if (!(await scooters.update(id, version, changes))) {
        // Ktoś zapisał zmianę między odczytem a zapisem.
        ensureVersion(version, (await scooters.findState(id))!.version);
      }
      const diff = diffForAudit(before, changes);
      const action = Object.keys(diff).length === 1 && diff.status ? 'scooter.status_changed' : 'scooter.updated';
      await audit({ action, entityType: 'scooter', entityId: id, data: { changes: diff, version: [version, version + 1] } });
    });
    return this.details(id);
  }

  /** Usunięcie hulajnogi to wycofanie z floty (ADR 0031). */
  async remove(staffId: string, id: string, version: number): Promise<RemovalResult> {
    return this.transaction.run(staffId, async ({ tx, audit }) => {
      const scooters = new DrizzleScooterRepository(tx);
      const state = await scooters.findState(id);
      if (!state) throw notFound('scooter', id);
      ensureVersion(version, state.version);
      planScooterRemoval(state.status, state.hasOpenRental);
      if (state.status !== 'RETIRED') {
        if (!(await scooters.update(id, version, { status: 'RETIRED' }))) {
          ensureVersion(version, (await scooters.findState(id))!.version);
        }
        await audit({
          action: 'scooter.retired',
          entityType: 'scooter',
          entityId: id,
          data: { changes: { status: [state.status, 'RETIRED'] } },
        });
      }
      return { outcome: 'RETIRED' } as const;
    });
  }
}

async function ensureModel(tx: DbExecutor, modelId: string): Promise<void> {
  const model = await new DrizzleScooterModelRepository(tx).findState(modelId);
  if (!model) throw notFound('scooterModel', modelId);
  ensureModelAssignable(model);
}
