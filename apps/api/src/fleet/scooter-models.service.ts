import { diffForAudit, ensureVersion, notFound, planModelRemoval } from '@hulajnogi/core';
import { DrizzleScooterModelRepository } from '@hulajnogi/db';
import type {
  ListQuery,
  ListResponse,
  RemovalResult,
  ScooterModelCreate,
  ScooterModelDetails,
  ScooterModelListItem,
  ScooterModelUpdate,
} from '@hulajnogi/shared';
import { Injectable } from '@nestjs/common';
import { AuditedTransaction } from '../audit/audited-transaction.js';

/** Serwis aplikacyjny modeli hulajnóg; usunięcie według reguły z packages/core, zapisy z dziennikiem audytu. */
@Injectable()
export class ScooterModelsService {
  constructor(
    private readonly models: DrizzleScooterModelRepository,
    private readonly transaction: AuditedTransaction,
  ) {}

  list(query: ListQuery): Promise<ListResponse<ScooterModelListItem>> {
    return this.models.list(query);
  }

  async details(id: string): Promise<ScooterModelDetails> {
    const row = await this.models.details(id);
    if (!row) throw notFound('scooterModel', id);
    return row;
  }

  async create(staffId: string, input: ScooterModelCreate): Promise<ScooterModelDetails> {
    const id = await this.transaction.run(staffId, async ({ tx, audit }) => {
      const created = await new DrizzleScooterModelRepository(tx).create(input);
      await audit({ action: 'scooter_model.created', entityType: 'scooter_model', entityId: created.id, data: { ...input } });
      return created.id;
    });
    return this.details(id);
  }

  async update(staffId: string, id: string, { version, ...changes }: ScooterModelUpdate): Promise<ScooterModelDetails> {
    await this.transaction.run(staffId, async ({ tx, audit }) => {
      const models = new DrizzleScooterModelRepository(tx);
      const [state, before] = await Promise.all([models.findState(id), models.details(id)]);
      if (!state || !before) throw notFound('scooterModel', id);
      ensureVersion(version, state.version);
      if (!(await models.update(id, version, changes))) {
        ensureVersion(version, (await models.findState(id))!.version);
      }
      await audit({
        action: 'scooter_model.updated',
        entityType: 'scooter_model',
        entityId: id,
        data: { changes: diffForAudit(before, changes), version: [version, version + 1] },
      });
    });
    return this.details(id);
  }

  /** Model wskazywany przez hulajnogi jest archiwizowany, model bez hulajnóg usuwany. */
  async remove(staffId: string, id: string, version: number): Promise<RemovalResult> {
    return this.transaction.run(staffId, async ({ tx, audit }) => {
      const models = new DrizzleScooterModelRepository(tx);
      const state = await models.findState(id);
      if (!state) throw notFound('scooterModel', id);
      ensureVersion(version, state.version);
      if (planModelRemoval(state.scootersTotal) === 'DELETE') {
        await models.delete(id);
        await audit({ action: 'scooter_model.deleted', entityType: 'scooter_model', entityId: id, data: { code: state.code } });
        return { outcome: 'DELETED' } as const;
      }
      if (state.active) {
        if (!(await models.update(id, version, { active: false }))) {
          ensureVersion(version, (await models.findState(id))!.version);
        }
        await audit({
          action: 'scooter_model.archived',
          entityType: 'scooter_model',
          entityId: id,
          data: { changes: { active: [true, false] } },
        });
      }
      return { outcome: 'ARCHIVED' } as const;
    });
  }
}
