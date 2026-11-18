import type {
  GeoPoint,
  PartAdjustReason,
  ReturnBlocker,
  ScooterStatus,
  ScooterStatusReason,
  ServiceTaskStatus,
  ServiceTaskType,
  TaskPriority,
} from '@hulajnogi/core';
import {
  serviceTasksResource,
  sparePartMovementsResource,
  sparePartsResource,
  type ListQuery,
  type ListResponse,
  type ServiceTaskListItem,
  type ServiceTaskPartView,
  type ServiceTaskSummary,
  type SparePartListItem,
  type SparePartMovementItem,
} from '@hulajnogi/shared';
import { sql } from 'drizzle-orm';
import { runListQuery, type ListSource } from '../admin/list-query.js';
import type { DbExecutor } from '../client.js';
import { vServiceTaskList, vSparePartList, vSparePartMovements } from '../schema/schema.js';
import { parsePgArray } from './tickets.repository.js';

type Row = Record<string, unknown>;
type Fields<R extends { fields: object }> = keyof R['fields'] & string;

const iso = (v: unknown) => (v === null || v === undefined ? null : new Date(v as string).toISOString());
const date = (v: unknown) => (v === null || v === undefined ? null : new Date(v as string));

const byId = (field: string, value: string | number): ListQuery => ({
  filters: [{ field, op: 'eq', values: [value] }],
  sort: [],
  page: 1,
  pageSize: 1,
  facets: [],
});

// --- Źródła list w panelu (ADR 0031) ---------------------------------------------------------------

const tasksSource: ListSource<Fields<typeof serviceTasksResource>> = {
  from: vServiceTaskList,
  id: vServiceTaskList.id,
  columns: {
    id: vServiceTaskList.id,
    number: vServiceTaskList.number,
    type: vServiceTaskList.type,
    status: vServiceTaskList.status,
    priority: vServiceTaskList.priority,
    description: vServiceTaskList.description,
    resultNote: vServiceTaskList.resultNote,
    cancelReason: vServiceTaskList.cancelReason,
    scooterId: vServiceTaskList.scooterId,
    scooterNumber: vServiceTaskList.scooterNumber,
    scooterStatus: vServiceTaskList.scooterStatus,
    assigneeId: vServiceTaskList.assigneeId,
    assigneeName: vServiceTaskList.assigneeName,
    createdBy: vServiceTaskList.createdBy,
    createdByName: vServiceTaskList.createdByName,
    dueAt: vServiceTaskList.dueAt,
    overdue: vServiceTaskList.overdue,
    ticketId: vServiceTaskList.ticketId,
    ticketNumber: vServiceTaskList.ticketNumber,
    ticketCategories: vServiceTaskList.ticketCategories,
    targetZoneId: vServiceTaskList.targetZoneId,
    targetZoneCode: vServiceTaskList.targetZoneCode,
    targetZoneName: vServiceTaskList.targetZoneName,
    targetLat: vServiceTaskList.targetLat,
    targetLon: vServiceTaskList.targetLon,
    partsCount: vServiceTaskList.partsCount,
    partsCost: vServiceTaskList.partsCost,
    cancelledBy: vServiceTaskList.cancelledBy,
    cancelledByName: vServiceTaskList.cancelledByName,
    createdAt: vServiceTaskList.createdAt,
    startedAt: vServiceTaskList.startedAt,
    completedAt: vServiceTaskList.completedAt,
    updatedAt: vServiceTaskList.updatedAt,
    version: vServiceTaskList.version,
  },
};

const partsSource: ListSource<Fields<typeof sparePartsResource>> = {
  from: vSparePartList,
  id: vSparePartList.id,
  columns: {
    id: vSparePartList.id,
    sku: vSparePartList.sku,
    name: vSparePartList.name,
    unitCost: vSparePartList.unitCost,
    stockQty: vSparePartList.stockQty,
    minStockQty: vSparePartList.minStockQty,
    belowMinimum: vSparePartList.belowMinimum,
    active: vSparePartList.active,
    used30d: vSparePartList.used30D,
    lastMovementAt: vSparePartList.lastMovementAt,
    lastMovementKind: vSparePartList.lastMovementKind,
    lastMovementDelta: vSparePartList.lastMovementDelta,
    lastMovementTaskNumber: vSparePartList.lastMovementTaskNumber,
    usedInTasks: vSparePartList.usedInTasks,
    createdAt: vSparePartList.createdAt,
    updatedAt: vSparePartList.updatedAt,
    version: vSparePartList.version,
  },
};

const movementsSource: ListSource<Fields<typeof sparePartMovementsResource>> = {
  from: vSparePartMovements,
  id: vSparePartMovements.id,
  columns: {
    id: vSparePartMovements.id,
    createdAt: vSparePartMovements.createdAt,
    partId: vSparePartMovements.partId,
    sku: vSparePartMovements.sku,
    partName: vSparePartMovements.partName,
    kind: vSparePartMovements.kind,
    delta: vSparePartMovements.delta,
    stockAfter: vSparePartMovements.stockAfter,
    unitCost: vSparePartMovements.unitCost,
    taskId: vSparePartMovements.taskId,
    taskNumber: vSparePartMovements.taskNumber,
    scooterId: vSparePartMovements.scooterId,
    scooterNumber: vSparePartMovements.scooterNumber,
    staffId: vSparePartMovements.staffId,
    staffName: vSparePartMovements.staffName,
    document: vSparePartMovements.document,
    reason: vSparePartMovements.reason,
    note: vSparePartMovements.note,
  },
};

// --- Rekordy do reguł w core ---------------------------------------------------------------------

export interface ServiceTaskRecord {
  id: string;
  number: number;
  scooterId: string;
  ticketId: string | null;
  type: ServiceTaskType;
  status: ServiceTaskStatus;
  priority: TaskPriority;
  assigneeId: string | null;
  version: number;
}

const taskSql = sql`SELECT st.id, st.number, st.scooter_id, st.ticket_id, st.type::text AS type, st.status::text AS status,
                           st.priority::text AS priority, st.assignee_id, st.version
                    FROM service_tasks st`;
const toTask = (r: Row): ServiceTaskRecord => ({
  id: r.id as string,
  number: Number(r.number),
  scooterId: r.scooter_id as string,
  ticketId: (r.ticket_id as string | null) ?? null,
  type: r.type as ServiceTaskType,
  status: r.status as ServiceTaskStatus,
  priority: r.priority as TaskPriority,
  assigneeId: (r.assignee_id as string | null) ?? null,
  version: r.version as number,
});

export interface NewServiceTask {
  scooterId: string;
  ticketId: string | null;
  type: ServiceTaskType;
  priority: TaskPriority;
  description: string | null;
  assigneeId: string | null;
  /** `null`: zadanie systemu (zgłoszenie automatyczne). */
  createdBy: string | null;
  dueAt: Date | null;
  targetZoneId: string | null;
  targetPoint: GeoPoint | null;
}

export interface ServiceTaskChanges {
  status?: ServiceTaskStatus;
  assigneeId?: string | null;
  resultNote?: string;
  cancelReason?: string;
  cancelledBy?: string;
}

/** Stan hulajnogi do wyłączenia z ruchu i powrotu do floty (ADR 0055). */
export interface ScooterServiceState {
  id: string;
  number: number;
  status: ScooterStatus;
  statusReason: ScooterStatusReason | null;
  statusChangedAt: Date;
  online: boolean;
  batteryPct: number | null;
  lastSeenAt: Date | null;
  position: GeoPoint | null;
  version: number;
  hasOpenRental: boolean;
  openTasks: number;
  openTickets: number;
  /** Otwarte pilne zgłoszenia (przeszkoda `URGENT_TICKET` w powrocie do floty). */
  openUrgentTickets: number;
}

export interface SparePartState {
  id: string;
  sku: string;
  stockQty: number;
  active: boolean;
  version: number;
  /** Część ma ruchy albo pozycje w zadaniach: usunięcie to archiwizacja. */
  hasHistory: boolean;
}

export interface SparePartDraft {
  sku: string;
  name: string;
  unitCost: number;
  minStockQty: number;
  active: boolean;
}

const summary = (r: Row): ServiceTaskSummary => ({
  id: r.id as string,
  number: Number(r.number),
  type: r.type as ServiceTaskType,
  status: r.status as ServiceTaskStatus,
  priority: r.priority as TaskPriority,
  assigneeId: (r.assignee_id as string | null) ?? null,
  assigneeName: (r.assignee_name as string | null) ?? null,
  partsCost: Number(r.parts_cost ?? 0),
  createdAt: iso(r.created_at)!,
  completedAt: iso(r.completed_at),
});

const summarySql = sql`SELECT id, number, type::text AS type, status::text AS status, priority::text AS priority,
                              assignee_id, assignee_name, parts_cost, created_at, completed_at
                       FROM v_service_task_list`;

/**
 * Moduł Operacje: zadania serwisowe, magazyn części i stan hulajnogi w serwisie (ADR 0055). Stan części zmieniają
 * tylko procedury z ruchem (`sp_part_receive`, `sp_part_adjust`, `sp_task_use_part`, `sp_task_return_part`);
 * reguły przejść liczy core, a baza sprawdza je wyzwalaczami.
 */
export class DrizzleServiceRepository {
  constructor(private readonly db: DbExecutor) {}

  private async rows(query: ReturnType<typeof sql>): Promise<Row[]> {
    return (await this.db.execute<Row>(query)).rows;
  }

  private async one(query: ReturnType<typeof sql>): Promise<Row | null> {
    return (await this.rows(query))[0] ?? null;
  }

  // --- Zadania --------------------------------------------------------------------------------

  async listTasks(query: ListQuery): Promise<ListResponse<ServiceTaskListItem>> {
    const result = await runListQuery<Fields<typeof serviceTasksResource>, ServiceTaskListItem>(
      this.db,
      serviceTasksResource,
      tasksSource,
      query,
    );
    return {
      ...result,
      items: result.items.map((item) => ({
        ...item,
        ticketCategories: item.ticketCategories === null ? null : parsePgArray(item.ticketCategories),
      })),
    };
  }

  async taskItem(id: string): Promise<ServiceTaskListItem | null> {
    return (await this.listTasks(byId('id', id))).items[0] ?? null;
  }

  async findTask(id: string): Promise<ServiceTaskRecord | null> {
    const row = await this.one(sql`${taskSql} WHERE st.id = ${id}`);
    return row ? toTask(row) : null;
  }

  async lockTask(id: string): Promise<ServiceTaskRecord | null> {
    const row = await this.one(sql`${taskSql} WHERE st.id = ${id} FOR UPDATE OF st`);
    return row ? toTask(row) : null;
  }

  private insertTaskSql(task: NewServiceTask) {
    const point = task.targetPoint
      ? sql`ST_SetSRID(ST_MakePoint(${task.targetPoint.lon}, ${task.targetPoint.lat}), 4326)`
      : sql`NULL`;
    return sql`
      INSERT INTO service_tasks (scooter_id, ticket_id, type, priority, description, assignee_id, created_by, due_at,
                                 target_zone_id, target_point)
      VALUES (${task.scooterId}, ${task.ticketId}, ${task.type}::service_task_type, ${task.priority}::task_priority,
              ${task.description}, ${task.assigneeId}, ${task.createdBy}, ${task.dueAt}, ${task.targetZoneId}, ${point})`;
  }

  /** Nowe zadanie; drugi otwarty rodzaj na hulajnodze odrzuca `service_tasks_one_open_per_type` (`TASK_ALREADY_OPEN`). */
  async insertTask(task: NewServiceTask): Promise<{ id: string; number: number }> {
    const row = await this.one(sql`${this.insertTaskSql(task)} RETURNING id, number`);
    return { id: row!.id as string, number: Number(row!.number) };
  }

  /** Zadanie systemu ze zgłoszenia automatycznego; rodzaj już otwarty na hulajnodze zostaje (`null`). */
  async insertTaskIfFree(task: NewServiceTask): Promise<{ id: string; number: number } | null> {
    const row = await this.one(sql`
      ${this.insertTaskSql(task)}
      ON CONFLICT (scooter_id, type) WHERE status IN ('OPEN', 'IN_PROGRESS') DO NOTHING
      RETURNING id, number`);
    return row ? { id: row.id as string, number: Number(row.number) } : null;
  }

  /** Przejście albo przypisanie z blokadą optymistyczną (`version = null` po blokadzie wiersza). */
  async updateTask(id: string, version: number | null, changes: ServiceTaskChanges): Promise<boolean> {
    const set = [sql`updated_at = now()`, sql`version = version + 1`];
    if (changes.status !== undefined) set.push(sql`status = ${changes.status}::service_task_status`);
    if (changes.assigneeId !== undefined) set.push(sql`assignee_id = ${changes.assigneeId}`);
    if (changes.resultNote !== undefined) set.push(sql`result_note = ${changes.resultNote}`);
    if (changes.cancelReason !== undefined) set.push(sql`cancel_reason = ${changes.cancelReason}`);
    if (changes.cancelledBy !== undefined) set.push(sql`cancelled_by = ${changes.cancelledBy}`);
    const { rowCount } = await this.db.execute(sql`
      UPDATE service_tasks SET ${sql.join(set, sql`, `)}
      WHERE id = ${id} ${version === null ? sql`` : sql`AND version = ${version}`}`);
    return (rowCount ?? 0) > 0;
  }

  /** Szczegóły zadania: opis, notatka, powód, termin, cel przewiezienia (pozostałe pola z listy). */
  async taskExtras(id: string): Promise<{
    description: string | null;
    resultNote: string | null;
    cancelReason: string | null;
    dueAt: Date | null;
    startedAt: Date | null;
    target: { zoneId: string; zoneCode: string; zoneName: string } | { point: GeoPoint } | null;
  } | null> {
    const row = await this.one(sql`
      SELECT st.description, st.result_note, st.cancel_reason, st.due_at, st.started_at, st.target_zone_id,
             z.code AS zone_code, z.name AS zone_name, ST_Y(st.target_point) AS lat, ST_X(st.target_point) AS lon
      FROM service_tasks st LEFT JOIN zones z ON z.id = st.target_zone_id WHERE st.id = ${id}`);
    if (!row) return null;
    return {
      description: (row.description as string | null) ?? null,
      resultNote: (row.result_note as string | null) ?? null,
      cancelReason: (row.cancel_reason as string | null) ?? null,
      dueAt: date(row.due_at),
      startedAt: date(row.started_at),
      target: row.target_zone_id
        ? { zoneId: row.target_zone_id as string, zoneCode: row.zone_code as string, zoneName: row.zone_name as string }
        : row.lat !== null && row.lat !== undefined
          ? { point: { lat: Number(row.lat), lon: Number(row.lon) } }
          : null,
    };
  }

  async taskParts(taskId: string): Promise<ServiceTaskPartView[]> {
    const rows = await this.rows(sql`
      SELECT part_id, sku, name, quantity, unit_cost, amount FROM v_service_task_parts
      WHERE task_id = ${taskId} ORDER BY name`);
    return rows.map((r) => ({
      partId: r.part_id as string,
      sku: r.sku as string,
      name: r.name as string,
      quantity: r.quantity as number,
      unitCost: Number(r.unit_cost),
      cost: Number(r.amount),
    }));
  }

  async tasksForTicket(ticketId: string): Promise<ServiceTaskSummary[]> {
    return (await this.rows(sql`${summarySql} WHERE ticket_id = ${ticketId} ORDER BY created_at, number`)).map(summary);
  }

  async tasksForScooter(scooterId: string, limit: number): Promise<ServiceTaskSummary[]> {
    const rows = await this.rows(sql`
      ${summarySql} WHERE scooter_id = ${scooterId} ORDER BY created_at DESC, number DESC LIMIT ${limit}`);
    return rows.map(summary);
  }

  /** Zakończone zadania hulajnogi i koszt ich części (zakładka „Serwis”). */
  async scooterServiceTotals(scooterId: string): Promise<{ tasksDone: number; partsCost: number }> {
    const row = await this.one(sql`
      SELECT count(*)::integer AS done, COALESCE(sum(parts_cost), 0)::bigint AS cost
      FROM v_service_task_list WHERE scooter_id = ${scooterId} AND status = 'DONE'`);
    return { tasksDone: row!.done as number, partsCost: Number(row!.cost) };
  }

  /** Rodzaje otwarte na hulajnodze (`OPEN`, `IN_PROGRESS`): niedostępne w oknie „Utwórz zadanie”. */
  async openTaskTypes(scooterId: string): Promise<ServiceTaskType[]> {
    const rows = await this.rows(sql`
      SELECT DISTINCT type::text AS type FROM service_tasks
      WHERE scooter_id = ${scooterId} AND status IN ('OPEN', 'IN_PROGRESS')`);
    return rows.map((r) => r.type as ServiceTaskType);
  }

  /** Użycie części w zadaniu w toku (`sp_task_use_part`): stan maleje od razu, ruch `USE`. */
  async useParts(
    taskId: string,
    partId: string,
    quantity: number,
    staffId: string,
  ): Promise<{ lineQuantity: number; stockAfter: number }> {
    const row = await this.one(sql`CALL sp_task_use_part(${taskId}, ${partId}, ${quantity}, ${staffId}, NULL, NULL)`);
    return { lineQuantity: row!.line_quantity as number, stockAfter: row!.stock_after as number };
  }

  /** Zwrot części z zadania w toku (`sp_task_return_part`); bez ilości cała pozycja. */
  async returnPart(
    taskId: string,
    partId: string,
    quantity: number | null,
    staffId: string,
  ): Promise<{ lineQuantity: number; stockAfter: number }> {
    const row = await this.one(
      sql`CALL sp_task_return_part(${taskId}, ${partId}, ${quantity}::integer, ${staffId}, NULL, NULL)`,
    );
    return { lineQuantity: row!.line_quantity as number, stockAfter: row!.stock_after as number };
  }

  // --- Hulajnoga w serwisie ---------------------------------------------------------------------

  private scooterStateSql(id: string, lock: boolean) {
    return sql`
      SELECT s.id, s.number, s.status::text AS status, s.status_reason::text AS status_reason, s.status_changed_at,
             s.online, s.battery_pct, s.last_seen_at, ST_Y(s.position) AS lat, ST_X(s.position) AS lon, s.version,
             EXISTS (SELECT 1 FROM rentals r WHERE r.scooter_id = s.id
                     AND r.state IN ('RESERVED', 'UNLOCKING', 'ACTIVE', 'PAUSED', 'ENDING')) AS has_open_rental,
             (SELECT count(*)::integer FROM service_tasks st
              WHERE st.scooter_id = s.id AND st.status IN ('OPEN', 'IN_PROGRESS')) AS open_tasks,
             (SELECT count(*)::integer FROM tickets t WHERE t.scooter_id = s.id AND t.status <> 'RESOLVED') AS open_tickets,
             (SELECT count(*)::integer FROM tickets t
              WHERE t.scooter_id = s.id AND t.urgent AND t.status <> 'RESOLVED') AS open_urgent_tickets
      FROM scooters s WHERE s.id = ${id} ${lock ? sql`FOR UPDATE OF s` : sql``}`;
  }

  private toScooterState(r: Row): ScooterServiceState {
    return {
      id: r.id as string,
      number: r.number as number,
      status: r.status as ScooterStatus,
      statusReason: (r.status_reason as ScooterStatusReason | null) ?? null,
      statusChangedAt: new Date(r.status_changed_at as string),
      online: r.online as boolean,
      batteryPct: (r.battery_pct as number | null) ?? null,
      lastSeenAt: date(r.last_seen_at),
      position: r.lat === null || r.lat === undefined ? null : { lat: Number(r.lat), lon: Number(r.lon) },
      version: r.version as number,
      hasOpenRental: r.has_open_rental as boolean,
      openTasks: r.open_tasks as number,
      openTickets: r.open_tickets as number,
      openUrgentTickets: r.open_urgent_tickets as number,
    };
  }

  async scooterState(id: string): Promise<ScooterServiceState | null> {
    const row = await this.one(this.scooterStateSql(id, false));
    return row ? this.toScooterState(row) : null;
  }

  /** Blokada hulajnogi przed zmianą stanu (ta sama kolejność co w module Wypożyczenia: najpierw hulajnoga). */
  async lockScooter(id: string): Promise<ScooterServiceState | null> {
    const row = await this.one(this.scooterStateSql(id, true));
    return row ? this.toScooterState(row) : null;
  }

  /** Powód zatrzymania w serwisie (`fn_scooter_service_hold`): pilne zgłoszenie albo otwarte zadanie. */
  async serviceHold(scooterId: string): Promise<'URGENT_TICKET' | 'SERVICE_TASK' | null> {
    const row = await this.one(sql`SELECT fn_scooter_service_hold(${scooterId})::text AS hold`);
    return (row?.hold as 'URGENT_TICKET' | 'SERVICE_TASK' | null) ?? null;
  }

  /** Przeszkody powrotu do floty w bazie (`fn_scooter_return_blockers`), kopia reguły z core. */
  async returnBlockers(scooterId: string): Promise<ReturnBlocker[] | null> {
    const row = await this.one(sql`SELECT fn_scooter_return_blockers(${scooterId}) AS blockers`);
    return row?.blockers ? parsePgArray<ReturnBlocker>(row.blockers) : null;
  }

  /**
   * Hulajnogi w serwisie z przyczyną `BATTERY_BELOW_THRESHOLD`, których bateria z telemetrii jest już co najmniej
   * na progu z obowiązującego cennika (np. po `battery_swapped`): kandydaci do automatycznego powrotu do floty.
   */
  async batteryRecovered(scooterIds: readonly string[]): Promise<string[]> {
    if (!scooterIds.length) return [];
    const rows = await this.rows(sql`
      SELECT s.id FROM scooters s
      WHERE s.id IN (${sql.join(
        scooterIds.map((id) => sql`${id}::uuid`),
        sql`, `,
      )})
        AND s.status = 'MAINTENANCE' AND s.status_reason = 'BATTERY_BELOW_THRESHOLD'
        AND s.battery_pct >= fn_low_battery_threshold()`);
    return rows.map((r) => r.id as string);
  }

  /** Próg baterii z obowiązującej wersji cennika (`fn_low_battery_threshold`). */
  async minBatteryPct(): Promise<number> {
    const row = await this.one(sql`SELECT fn_low_battery_threshold() AS threshold`);
    return row!.threshold as number;
  }

  /** Stan z przyczyną; wyzwalacz zapisuje czas zmiany i czyści przyczynę poza `MAINTENANCE` i `RETIRED`. */
  async setScooterStatus(id: string, status: ScooterStatus, reason: ScooterStatusReason | null): Promise<void> {
    await this.db.execute(sql`
      UPDATE scooters SET status = ${status}::scooter_status, status_reason = ${reason}::scooter_status_reason,
                          updated_at = now(), version = version + 1
      WHERE id = ${id}`);
  }

  /** Najbliższa aktywna strefa parkowania (cel zadania `RELOCATION` po zdalnym zakończeniu poza strefą). */
  async nearestParkingZone(point: GeoPoint): Promise<{ id: string; code: string } | null> {
    const row = await this.one(sql`
      SELECT id, code FROM zones, ST_SetSRID(ST_MakePoint(${point.lon}, ${point.lat}), 4326) p
      WHERE active AND type = 'PARKING'
      ORDER BY ST_Distance(geom::geography, p::geography), code LIMIT 1`);
    return row ? { id: row.id as string, code: row.code as string } : null;
  }

  /** Strefa celu przewiezienia musi istnieć i być aktywna. */
  async zoneExists(id: string): Promise<boolean> {
    return (await this.one(sql`SELECT 1 FROM zones WHERE id = ${id} AND active`)) !== null;
  }

  /** Aktywny operator do przypisania zadania albo zgłoszenia. */
  async activeStaff(id: string): Promise<{ id: string; name: string } | null> {
    const row = await this.one(sql`SELECT id, name FROM staff WHERE id = ${id} AND active`);
    return row ? { id: row.id as string, name: row.name as string } : null;
  }

  // --- Magazyn --------------------------------------------------------------------------------

  listParts(query: ListQuery): Promise<ListResponse<SparePartListItem>> {
    return runListQuery<Fields<typeof sparePartsResource>, SparePartListItem>(
      this.db,
      sparePartsResource,
      partsSource,
      query,
    );
  }

  async partItem(id: string): Promise<SparePartListItem | null> {
    return (await this.listParts(byId('id', id))).items[0] ?? null;
  }

  async partState(id: string, lock = false): Promise<SparePartState | null> {
    const row = await this.one(sql`
      SELECT p.id, p.sku, p.stock_qty, p.active, p.version,
             (EXISTS (SELECT 1 FROM spare_part_movements m WHERE m.part_id = p.id)
              OR EXISTS (SELECT 1 FROM service_task_parts l WHERE l.part_id = p.id)) AS has_history
      FROM spare_parts p WHERE p.id = ${id} ${lock ? sql`FOR UPDATE OF p` : sql``}`);
    return row
      ? {
          id: row.id as string,
          sku: row.sku as string,
          stockQty: row.stock_qty as number,
          active: row.active as boolean,
          version: row.version as number,
          hasHistory: row.has_history as boolean,
        }
      : null;
  }

  /** Słownik części do historii zmian (dziennik audytu). */
  async partDraft(id: string): Promise<SparePartDraft | null> {
    const row = await this.one(
      sql`SELECT sku, name, unit_cost, min_stock_qty, active FROM spare_parts WHERE id = ${id}`,
    );
    return row
      ? {
          sku: row.sku as string,
          name: row.name as string,
          unitCost: Number(row.unit_cost),
          minStockQty: row.min_stock_qty as number,
          active: row.active as boolean,
        }
      : null;
  }

  async insertPart(draft: SparePartDraft): Promise<string> {
    const row = await this.one(sql`
      INSERT INTO spare_parts (sku, name, unit_cost, min_stock_qty, active)
      VALUES (${draft.sku}, ${draft.name}, ${draft.unitCost}, ${draft.minStockQty}, ${draft.active})
      RETURNING id`);
    return row!.id as string;
  }

  async updatePart(id: string, version: number, changes: Partial<SparePartDraft>): Promise<boolean> {
    const set = [sql`updated_at = now()`, sql`version = version + 1`];
    if (changes.sku !== undefined) set.push(sql`sku = ${changes.sku}`);
    if (changes.name !== undefined) set.push(sql`name = ${changes.name}`);
    if (changes.unitCost !== undefined) set.push(sql`unit_cost = ${changes.unitCost}`);
    if (changes.minStockQty !== undefined) set.push(sql`min_stock_qty = ${changes.minStockQty}`);
    if (changes.active !== undefined) set.push(sql`active = ${changes.active}`);
    const { rowCount } = await this.db.execute(
      sql`UPDATE spare_parts SET ${sql.join(set, sql`, `)} WHERE id = ${id} AND version = ${version}`,
    );
    return (rowCount ?? 0) > 0;
  }

  async deletePart(id: string): Promise<void> {
    await this.db.execute(sql`DELETE FROM spare_parts WHERE id = ${id}`);
  }

  /** Przyjęcie dostawy (`sp_part_receive`): stan rośnie, nowa cena dla kolejnych użyć. */
  async receive(input: {
    partId: string;
    quantity: number;
    unitCost: number | null;
    document: string | null;
    staffId: string;
  }): Promise<{ movementId: number; stockAfter: number }> {
    const row = await this.one(sql`
      CALL sp_part_receive(${input.partId}, ${input.quantity}, ${input.unitCost}::bigint, ${input.document},
                           ${input.staffId}, NULL, NULL)`);
    return { movementId: Number(row!.movement_id), stockAfter: row!.stock_after as number };
  }

  /** Korekta stanu (`sp_part_adjust`): nowy stan bezwzględny z powodem. */
  async adjust(input: {
    partId: string;
    newQty: number;
    reason: PartAdjustReason;
    note: string | null;
    staffId: string;
  }): Promise<{ movementId: number; stockAfter: number }> {
    const row = await this.one(sql`
      CALL sp_part_adjust(${input.partId}, ${input.newQty}, ${input.reason}::part_adjust_reason, ${input.note},
                          ${input.staffId}, NULL, NULL)`);
    return { movementId: Number(row!.movement_id), stockAfter: row!.stock_after as number };
  }

  listMovements(query: ListQuery): Promise<ListResponse<SparePartMovementItem>> {
    return runListQuery<Fields<typeof sparePartMovementsResource>, SparePartMovementItem>(
      this.db,
      sparePartMovementsResource,
      movementsSource,
      query,
    );
  }

  async recentMovements(partId: string, limit: number): Promise<SparePartMovementItem[]> {
    const result = await this.listMovements({
      filters: [{ field: 'partId', op: 'eq', values: [partId] }],
      sort: [
        { field: 'createdAt', desc: true },
        { field: 'id', desc: true },
      ],
      page: 1,
      pageSize: limit,
      facets: [],
    });
    return result.items;
  }
}
