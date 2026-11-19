import {
  diffForAudit,
  ensureModelAssignable,
  ensureVersion,
  estimateRangeKm,
  fleetFormStatusChange,
  notFound,
  type ScooterStatus,
  type ScooterStatusReason,
} from '@hulajnogi/core';
import {
  type DbExecutor,
  DrizzleScooterModelRepository,
  DrizzleScooterRepository,
  DrizzleServiceRepository,
} from '@hulajnogi/db';
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
import { ContentPublisher } from '../content/content-publisher.service.js';
import { returnCheck } from '../operations/operations.service.js';

/**
 * Serwis aplikacyjny hulajnóg: dane z repozytoriów, reguły z packages/core. Każdy zapis operatora
 * powstaje w transakcji z wpisem w dzienniku audytu (ADR 0028, ADR 0031).
 */
@Injectable()
export class ScootersService {
  constructor(
    private readonly scooters: DrizzleScooterRepository,
    private readonly transaction: AuditedTransaction,
    private readonly publisher: ContentPublisher,
  ) {}

  list(query: ListQuery, db?: DbExecutor): Promise<ListResponse<ScooterListItem>> {
    return (db ? new DrizzleScooterRepository(db) : this.scooters).list(query);
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
      const status = changes.status ? await statusChange(tx, id, changes.status) : null;
      if (changes.modelId && changes.modelId !== state.modelId) await ensureModel(tx, changes.modelId);
      if (!(await scooters.update(id, version, changes, status ? status.reason : undefined))) {
        // Ktoś zapisał zmianę między odczytem a zapisem.
        ensureVersion(version, (await scooters.findState(id))!.version);
      }
      const fields = diffForAudit(before, changes);
      const action = Object.keys(fields).length === 1 && fields.status ? 'scooter.status_changed' : 'scooter.updated';
      const diff = {
        ...fields,
        ...(status && status.reason !== status.before ? { statusReason: [status.before, status.reason] } : {}),
      };
      await audit({
        action,
        entityType: 'scooter',
        entityId: id,
        data: { changes: diff, version: [version, version + 1] },
      });
      // Strona `/h/{numer}` pokazuje model i znika po wycofaniu (ADR 0065).
      if (changes.modelId !== undefined || changes.status !== undefined) {
        await this.publisher.revalidateSite(tx, ['scooters']);
      }
    });
    return this.details(id);
  }

  /**
   * Usunięcie hulajnogi to wycofanie z floty (ADR 0031) według reguł „Wyłącz z ruchu” (ADR 0055): nie w przejeździe
   * ani przy otwartych zadaniach, z powodem `OTHER` (formularz nie pyta o powód).
   */
  async remove(staffId: string, id: string, version: number): Promise<RemovalResult> {
    return this.transaction.run(staffId, async ({ tx, audit }) => {
      const scooters = new DrizzleScooterRepository(tx);
      const state = await scooters.findState(id);
      if (!state) throw notFound('scooter', id);
      ensureVersion(version, state.version);
      const status = await statusChange(tx, id, 'RETIRED');
      if (status) {
        if (!(await scooters.update(id, version, { status: 'RETIRED' }, status.reason))) {
          ensureVersion(version, (await scooters.findState(id))!.version);
        }
        await audit({
          action: 'scooter.retired',
          entityType: 'scooter',
          entityId: id,
          data: { changes: { status: [state.status, 'RETIRED'], statusReason: [status.before, status.reason] } },
        });
        await this.publisher.revalidateSite(tx, ['scooters']);
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

/**
 * Zmiana stanu z formularza floty według reguł obiegu serwisowego (`fleetFormStatusChange`): powrót z serwisu przez
 * regułę powrotu do floty, przyczyna stanu zgodna z nowym stanem. Blokuje hulajnogę (kolejność: najpierw hulajnoga).
 * `null`: stan bez zmian.
 */
async function statusChange(
  tx: DbExecutor,
  id: string,
  to: ScooterStatus,
): Promise<{ reason: ScooterStatusReason | null; before: ScooterStatusReason | null } | null> {
  const service = new DrizzleServiceRepository(tx);
  const scooter = await service.lockScooter(id);
  if (!scooter) throw notFound('scooter', id);
  const decision = fleetFormStatusChange({
    from: scooter.status,
    to,
    hasOpenRental: scooter.hasOpenRental,
    openTasks: scooter.openTasks,
    blockers: returnCheck(scooter, await service.minBatteryPct()).blockers,
    serviceHold: await service.serviceHold(id),
  });
  return decision ? { reason: decision.reason, before: scooter.statusReason } : null;
}
