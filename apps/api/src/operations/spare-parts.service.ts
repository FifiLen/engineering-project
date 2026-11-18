import { diffForAudit, ensurePartReceipt, ensureStockAdjustment, ensureVersion, notFound } from '@hulajnogi/core';
import { type Database, DrizzleServiceRepository } from '@hulajnogi/db';
import type {
  ListQuery,
  ListResponse,
  PartAdjustment,
  PartReceipt,
  RemovalResult,
  SparePartCreate,
  SparePartDetails,
  SparePartListItem,
  SparePartMovementItem,
  SparePartUpdate,
} from '@hulajnogi/shared';
import { Inject, Injectable } from '@nestjs/common';
import { AuditedTransaction } from '../audit/audited-transaction.js';
import { DB } from '../database/database.module.js';

/** Ostatnie ruchy w szczegółach części. */
const PART_MOVEMENTS_LIMIT = 20;

/**
 * Magazyn części (ADR 0055): słownik z wymaganym CRUD (wymaganie 12) i stan zmieniany tylko ruchem przez
 * procedury bazy (przyjęcie dostawy, korekta, zużycie w zadaniu). Każdy zapis z wpisem w dzienniku audytu.
 */
@Injectable()
export class SparePartsService {
  constructor(
    @Inject(DB) private readonly db: Database,
    private readonly audited: AuditedTransaction,
  ) {}

  list(query: ListQuery): Promise<ListResponse<SparePartListItem>> {
    return new DrizzleServiceRepository(this.db).listParts(query);
  }

  movements(query: ListQuery): Promise<ListResponse<SparePartMovementItem>> {
    return new DrizzleServiceRepository(this.db).listMovements(query);
  }

  async details(id: string): Promise<SparePartDetails> {
    const repo = new DrizzleServiceRepository(this.db);
    const [item, movements] = await Promise.all([repo.partItem(id), repo.recentMovements(id, PART_MOVEMENTS_LIMIT)]);
    if (!item) throw notFound('spare_part', id);
    return { ...item, movements };
  }

  /** Nowa część; stan początkowy jako przyjęcie dostawy (ruch `RECEIPT`). */
  async create(staffId: string, body: SparePartCreate): Promise<SparePartDetails> {
    const id = await this.audited.run(staffId, async ({ tx, audit }) => {
      const repo = new DrizzleServiceRepository(tx);
      const { initialQty, document, ...draft } = body;
      const partId = await repo.insertPart(draft);
      await audit({ action: 'spare_part.created', entityType: 'spare_part', entityId: partId, data: { ...draft } });
      if (initialQty > 0) {
        const result = await repo.receive({ partId, quantity: initialQty, unitCost: null, document, staffId });
        await audit({
          action: 'spare_part.received',
          entityType: 'spare_part',
          entityId: partId,
          data: { quantity: initialQty, ...(document ? { document } : {}), ...result },
        });
      }
      return partId;
    });
    return this.details(id);
  }

  /** Edycja słownika z blokadą optymistyczną; stan zmienia przyjęcie albo korekta. */
  async update(staffId: string, id: string, { version, ...changes }: SparePartUpdate): Promise<SparePartDetails> {
    await this.audited.run(staffId, async ({ tx, audit }) => {
      const repo = new DrizzleServiceRepository(tx);
      const state = await repo.partState(id, true);
      const before = await repo.partDraft(id);
      if (!state || !before) throw notFound('spare_part', id);
      ensureVersion(version, state.version);
      await repo.updatePart(id, version, changes);
      await audit({
        action: 'spare_part.updated',
        entityType: 'spare_part',
        entityId: id,
        data: { changes: diffForAudit(before, changes), version: [version, version + 1] },
      });
    });
    return this.details(id);
  }

  /** Część z ruchami albo w zadaniach jest archiwizowana (`active = false`), część bez historii usuwana. */
  async remove(staffId: string, id: string, version: number): Promise<RemovalResult> {
    return this.audited.run(staffId, async ({ tx, audit }) => {
      const repo = new DrizzleServiceRepository(tx);
      const state = await repo.partState(id, true);
      if (!state) throw notFound('spare_part', id);
      ensureVersion(version, state.version);
      if (!state.hasHistory) {
        await repo.deletePart(id);
        await audit({ action: 'spare_part.deleted', entityType: 'spare_part', entityId: id, data: { sku: state.sku } });
        return { outcome: 'DELETED' } as const;
      }
      if (state.active) {
        await repo.updatePart(id, version, { active: false });
        await audit({
          action: 'spare_part.archived',
          entityType: 'spare_part',
          entityId: id,
          data: { changes: { active: [true, false] } },
        });
      }
      return { outcome: 'ARCHIVED' } as const;
    });
  }

  /** Przyjęcie dostawy: stan rośnie, opcjonalna nowa cena dla kolejnych użyć (`sp_part_receive`). */
  async receive(staffId: string, id: string, body: PartReceipt): Promise<SparePartDetails> {
    ensurePartReceipt({ quantity: body.quantity, unitCost: body.unitCost });
    await this.audited.run(staffId, async ({ tx, audit }) => {
      const repo = new DrizzleServiceRepository(tx);
      const state = await repo.partState(id, true);
      if (!state) throw notFound('spare_part', id);
      ensureVersion(body.version, state.version);
      const result = await repo.receive({
        partId: id,
        quantity: body.quantity,
        unitCost: body.unitCost,
        document: body.document,
        staffId,
      });
      await audit({
        action: 'spare_part.received',
        entityType: 'spare_part',
        entityId: id,
        data: {
          quantity: body.quantity,
          ...(body.unitCost !== null ? { unitCost: body.unitCost } : {}),
          ...(body.document ? { document: body.document } : {}),
          ...result,
        },
      });
    });
    return this.details(id);
  }

  /** Korekta stanu: nowy stan bezwzględny z powodem (`sp_part_adjust`); `OTHER` wymaga notatki. */
  async adjust(staffId: string, id: string, body: PartAdjustment): Promise<SparePartDetails> {
    await this.audited.run(staffId, async ({ tx, audit }) => {
      const repo = new DrizzleServiceRepository(tx);
      const state = await repo.partState(id, true);
      if (!state) throw notFound('spare_part', id);
      ensureVersion(body.version, state.version);
      ensureStockAdjustment({ stockQty: state.stockQty, newQty: body.newQty, reason: body.reason, note: body.note });
      const result = await repo.adjust({
        partId: id,
        newQty: body.newQty,
        reason: body.reason,
        note: body.note,
        staffId,
      });
      await audit({
        action: 'spare_part.adjusted',
        entityType: 'spare_part',
        entityId: id,
        data: {
          changes: { stockQty: [state.stockQty, body.newQty] },
          reason: body.reason,
          ...(body.note ? { note: body.note } : {}),
          ...result,
        },
      });
    });
    return this.details(id);
  }
}
