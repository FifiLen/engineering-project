import {
  ensureVersion,
  ensureZoneCanDeactivate,
  ensureZoneUpdateAllowed,
  notFound,
  validateZoneInput,
  type Ring,
} from '@hulajnogi/core';
import { type Database, type DbExecutor, DrizzleZoneRepository, type ZoneDraft } from '@hulajnogi/db';
import type {
  ListQuery,
  ListResponse,
  ZoneDetails,
  ZoneImpactRental,
  ZoneInput,
  ZoneListItem,
  ZonePolygon,
  ZoneUpdate,
} from '@hulajnogi/shared';
import { Inject, Injectable, Logger } from '@nestjs/common';
import { AuditedTransaction } from '../audit/audited-transaction.js';
import { DB } from '../database/database.module.js';
import { FleetGateway } from '../realtime/fleet.gateway.js';
import { ZoneTracker } from './zone-tracker.service.js';

const toDraft = (input: ZoneInput): ZoneDraft => ({
  code: input.code,
  name: input.name,
  type: input.type,
  speedLimitKmh: input.type === 'SLOW' ? input.speedLimitKmh : null,
  capacity: input.type === 'PARKING' ? input.capacity : null,
  // Obszar działania jest zawsze widoczny (makieta `strefa-zakaz`, wariant obszaru).
  visibleInApp: input.type === 'SERVICE_AREA' ? true : input.visibleInApp,
  polygon: input.polygon,
});

function validate(draft: ZoneDraft): void {
  validateZoneInput({ ...draft, ring: draft.polygon.coordinates[0] as unknown as Ring });
}

/**
 * Edytor stref w panelu (ADR 0047): zapis z wersją rekordu i dziennikiem audytu w jednej transakcji,
 * reguły geometrii zależne od innych stref w bazie. Po zapisie klienci dostają `zones.changed`,
 * a hulajnogi w trwających przejazdach są oceniane od nowa (pytanie 7).
 */
@Injectable()
export class AdminZonesService {
  private readonly logger = new Logger(AdminZonesService.name);

  constructor(
    @Inject(DB) private readonly db: Database,
    private readonly transaction: AuditedTransaction,
    private readonly gateway: FleetGateway,
    private readonly tracker: ZoneTracker,
  ) {}

  list(query: ListQuery, db: DbExecutor = this.db): Promise<ListResponse<ZoneListItem>> {
    return new DrizzleZoneRepository(db).list(query);
  }

  async details(id: string): Promise<ZoneDetails> {
    const zones = new DrizzleZoneRepository(this.db);
    const [item, geometry, rentals, endedRentals] = await Promise.all([
      zones.listItem(id),
      zones.geometry(id),
      zones.impact(id, null),
      zones.endedRentals(id),
    ]);
    if (!item || !geometry) throw notFound('zone', id);
    const single = geometry.coordinates.length === 1 && geometry.coordinates[0]!.length === 1;
    return {
      ...item,
      geometry,
      polygon: single ? { type: 'Polygon', coordinates: geometry.coordinates[0] as ZonePolygon['coordinates'] } : null,
      rentals,
      endedRentals,
    };
  }

  /** Przejazdy w trakcie w obecnej geometrii strefy i w proponowanej (ostrzeżenie przed zapisem). */
  impact(id: string | null, polygon: ZonePolygon | null): Promise<ZoneImpactRental[]> {
    return new DrizzleZoneRepository(this.db).impact(id, polygon);
  }

  async create(staffId: string, input: ZoneInput): Promise<ZoneDetails> {
    const draft = toDraft(input);
    validate(draft);
    const id = await this.transaction.run(staffId, async ({ tx, audit }) => {
      const created = await new DrizzleZoneRepository(tx).insert(draft, staffId);
      await audit({
        action: 'zone.created',
        entityType: 'zone',
        entityId: created,
        data: { code: draft.code, type: draft.type, geometry: draft.polygon },
      });
      return created;
    });
    await this.changed(id);
    return this.details(id);
  }

  async update(staffId: string, id: string, { version, ...input }: ZoneUpdate): Promise<ZoneDetails> {
    const draft = toDraft(input);
    validate(draft);
    await this.transaction.run(staffId, async ({ tx, audit }) => {
      const zones = new DrizzleZoneRepository(tx);
      const [state, before, geometry] = await Promise.all([zones.state(id), zones.listItem(id), zones.geometry(id)]);
      if (!state || !before || !geometry) throw notFound('zone', id);
      ensureZoneUpdateAllowed(state, draft);
      ensureVersion(version, state.version);
      if (!(await zones.update(id, version, draft, staffId))) ensureVersion(version, (await zones.state(id))!.version);
      const after = (await zones.geometry(id))!;
      const fields = ['code', 'name', 'speedLimitKmh', 'capacity', 'visibleInApp'] as const;
      const changes: Record<string, [unknown, unknown]> = {};
      for (const field of fields) if (before[field] !== draft[field]) changes[field] = [before[field], draft[field]];
      if (JSON.stringify(geometry) !== JSON.stringify(after)) changes.geometry = [geometry, after];
      await audit({
        action: 'zone.updated',
        entityType: 'zone',
        entityId: id,
        data: { changes, version: [version, version + 1] },
      });
    });
    await this.changed(id);
    return this.details(id);
  }

  async setActive(staffId: string, id: string, version: number, active: boolean): Promise<ZoneDetails> {
    await this.transaction.run(staffId, async ({ tx, audit }) => {
      const zones = new DrizzleZoneRepository(tx);
      const state = await zones.state(id);
      if (!state) throw notFound('zone', id);
      if (!active) ensureZoneCanDeactivate(state);
      ensureVersion(version, state.version);
      if (state.active === active) return;
      if (!(await zones.setActive(id, version, active, staffId)))
        ensureVersion(version, (await zones.state(id))!.version);
      await audit({
        action: active ? 'zone.restored' : 'zone.deactivated',
        entityType: 'zone',
        entityId: id,
        data: { code: state.code, changes: { active: [state.active, active] } },
      });
    });
    await this.changed(id);
    return this.details(id);
  }

  /** Usunięcie tylko nieużytej strefy (`sp_delete_zone`); użytą się dezaktywuje. */
  async remove(staffId: string, id: string, version: number): Promise<void> {
    await this.transaction.run(staffId, async ({ tx, audit }) => {
      const zones = new DrizzleZoneRepository(tx);
      const state = await zones.state(id, true);
      if (!state) throw notFound('zone', id);
      ensureVersion(version, state.version);
      await zones.delete(id);
      await audit({
        action: 'zone.deleted',
        entityType: 'zone',
        entityId: id,
        data: { code: state.code, type: state.type },
      });
    });
    await this.changed(id);
  }

  private async changed(id: string): Promise<void> {
    this.gateway.zonesChanged([id]);
    try {
      await this.tracker.reevaluate();
    } catch (error) {
      this.logger.error(`Ponowna ocena stref po zmianie ${id}: ${(error as Error).message}`);
    }
  }
}
