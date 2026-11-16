import { ensureVersion, notFound, planModelRemoval } from '@hulajnogi/core';
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

/** Serwis aplikacyjny modeli hulajnóg; usunięcie według reguły z packages/core. */
@Injectable()
export class ScooterModelsService {
  constructor(private readonly models: DrizzleScooterModelRepository) {}

  list(query: ListQuery): Promise<ListResponse<ScooterModelListItem>> {
    return this.models.list(query);
  }

  async details(id: string): Promise<ScooterModelDetails> {
    const row = await this.models.details(id);
    if (!row) throw notFound('scooterModel', id);
    return row;
  }

  async create(input: ScooterModelCreate): Promise<ScooterModelDetails> {
    const { id } = await this.models.create(input);
    return this.details(id);
  }

  async update(id: string, { version, ...changes }: ScooterModelUpdate): Promise<ScooterModelDetails> {
    const state = await this.models.findState(id);
    if (!state) throw notFound('scooterModel', id);
    ensureVersion(version, state.version);
    if (!(await this.models.update(id, version, changes))) {
      ensureVersion(version, (await this.models.findState(id))!.version);
    }
    return this.details(id);
  }

  /** Model wskazywany przez hulajnogi jest archiwizowany, model bez hulajnóg usuwany. */
  async remove(id: string, version: number): Promise<RemovalResult> {
    const state = await this.models.findState(id);
    if (!state) throw notFound('scooterModel', id);
    ensureVersion(version, state.version);
    if (planModelRemoval(state.scootersTotal) === 'DELETE') {
      await this.models.delete(id);
      return { outcome: 'DELETED' };
    }
    if (state.active && !(await this.models.update(id, version, { active: false }))) {
      ensureVersion(version, (await this.models.findState(id))!.version);
    }
    return { outcome: 'ARCHIVED' };
  }
}
