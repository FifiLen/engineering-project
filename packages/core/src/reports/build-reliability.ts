import { REPORT_CATALOG, REPORT_VALUE_LABELS as L } from './catalog.js';
import { scooterLabel } from './build-fleet.js';
import {
  chartSpec,
  finishModel,
  mtbfHours,
  row,
  shareChart,
  sumOf,
  tableFrom,
  tilesFrom,
  weightedAverage,
  type ReportModel,
} from './model.js';
import type { ResolvedReportParams } from './params.js';
import type {
  ReliabilityCounts,
  ReliabilityLowStockRow,
  ReliabilityModelRow,
  ReliabilityPartRow,
  ReliabilityScooterRow,
  ReliabilityTaskRow,
  ReliabilityTicketRow,
  ReportsRepository,
} from './ports.js';

/**
 * Raport awaryjności: zgłoszenia według kategorii i źródła (zamknięte `OFFLINE` także), zadania i czas naprawy,
 * MTBF (czas w przejeździe ÷ awarie, `fn_ticket_is_failure`), koszt części z chwili użycia i części poniżej minimum
 * (stan bieżący, `v_low_stock_parts` z regułą `<`).
 */
export interface ReliabilityData {
  code: 'reliability';
  current: {
    tickets: ReliabilityTicketRow[];
    byScooter: ReliabilityScooterRow[];
    byModel: ReliabilityModelRow[];
    tasks: ReliabilityTaskRow[];
    parts: ReliabilityPartRow[];
    lowStock: ReliabilityLowStockRow[];
  };
  previous: { byScooter: ReliabilityScooterRow[] } | null;
}

export async function loadReliabilityData(
  repo: ReportsRepository,
  params: ResolvedReportParams,
): Promise<ReliabilityData> {
  const filters = { modelId: params.filters.modelId, scooterId: params.filters.scooterId };
  const byScooter = await repo.reliabilityByScooter(params.period, filters);
  const current = {
    tickets: await repo.reliabilityTickets(params.period, filters),
    byScooter,
    byModel: filters.scooterId
      ? reliabilityModelRows(byScooter)
      : await repo.reliabilityByModel(params.period, { modelId: filters.modelId }),
    tasks: await repo.reliabilityTasks(params.period, filters),
    parts: await repo.reliabilityParts(params.period, filters),
    lowStock: await repo.reliabilityLowStock(),
  };
  const previous = params.comparison
    ? { byScooter: await repo.reliabilityByScooter(params.comparison.period, filters) }
    : null;
  return { code: 'reliability', current, previous };
}

/** Suma liczników (średni czas naprawy ważony zakończonymi zadaniami, MTBF z sum). */
export function sumReliability(rows: readonly ReliabilityCounts[]): ReliabilityCounts {
  const inRideSeconds = sumOf(rows, (r) => r.inRideSeconds);
  const failures = sumOf(rows, (r) => r.failures);
  return {
    tickets: sumOf(rows, (r) => r.tickets),
    userTickets: sumOf(rows, (r) => r.userTickets),
    autoTickets: sumOf(rows, (r) => r.autoTickets),
    staffTickets: sumOf(rows, (r) => r.staffTickets),
    offlineTickets: sumOf(rows, (r) => r.offlineTickets),
    urgentTickets: sumOf(rows, (r) => r.urgentTickets),
    failures,
    tasksCreated: sumOf(rows, (r) => r.tasksCreated),
    tasksDone: sumOf(rows, (r) => r.tasksDone),
    avgRepairSeconds: weightedAverage(
      rows,
      (r) => r.avgRepairSeconds,
      (r) => r.tasksDone,
    ),
    partsCost: sumOf(rows, (r) => r.partsCost),
    serviceSeconds: sumOf(rows, (r) => r.serviceSeconds),
    inRideSeconds,
    mtbfHours: mtbfHours(inRideSeconds, failures),
  };
}

/** Wiersze modeli z wierszy hulajnóg (przy filtrze hulajnogi, jak `fn_report_reliability_by_model`). */
export function reliabilityModelRows(byScooter: readonly ReliabilityScooterRow[]): ReliabilityModelRow[] {
  const groups = new Map<string, ReliabilityScooterRow[]>();
  for (const s of byScooter) groups.set(s.modelId, [...(groups.get(s.modelId) ?? []), s]);
  return [...groups.values()]
    .map((rows) => ({
      modelId: rows[0]!.modelId,
      modelCode: rows[0]!.modelCode,
      modelName: rows[0]!.modelName,
      scooters: rows.length,
      ...sumReliability(rows),
    }))
    .sort((a, b) => a.modelCode.localeCompare(b.modelCode));
}

const countCells = (r: ReliabilityCounts) => ({
  tickets: r.tickets,
  userTickets: r.userTickets,
  autoTickets: r.autoTickets,
  staffTickets: r.staffTickets,
  offlineTickets: r.offlineTickets,
  urgentTickets: r.urgentTickets,
  failures: r.failures,
  tasksCreated: r.tasksCreated,
  tasksDone: r.tasksDone,
  avgRepairSeconds: r.avgRepairSeconds,
  partsCost: r.partsCost,
  serviceSeconds: r.serviceSeconds,
  inRideSeconds: r.inRideSeconds,
  mtbfHours: r.mtbfHours,
});

function tileValues(byScooter: readonly ReliabilityScooterRow[]): Record<string, number | null> {
  const total = sumReliability(byScooter);
  return {
    tickets: total.tickets,
    failures: total.failures,
    mtbfHours: total.mtbfHours,
    avgRepairSeconds: total.avgRepairSeconds,
    partsCost: total.partsCost,
  };
}

export function buildReliabilityReport(params: ResolvedReportParams, data: ReliabilityData): ReportModel {
  const spec = REPORT_CATALOG.reliability;
  const { current, previous } = data;
  const fleet = sumReliability(current.byScooter);
  const tiles = tilesFrom(
    spec,
    { ...tileValues(current.byScooter), lowStockParts: current.lowStock.length },
    previous ? tileValues(previous.byScooter) : null,
  );

  return finishModel('reliability', {
    tiles,
    charts: [
      shareChart(chartSpec(spec, 'ticketSources'), [
        { key: 'USER', label: L.ticketSource.USER, value: fleet.userTickets },
        { key: 'AUTO', label: L.ticketSource.AUTO, value: fleet.autoTickets },
        { key: 'STAFF', label: L.ticketSource.STAFF, value: fleet.staffTickets },
      ]),
    ],
    tables: [
      tableFrom(
        spec,
        'tickets',
        current.tickets.map((t) =>
          row({
            category: L.ticketCategory[t.category],
            source: L.ticketSource[t.source],
            tickets: t.tickets,
            urgent: t.urgent,
            resolved: t.resolved,
            open: t.open,
            avgResolutionSeconds: t.avgResolutionSeconds,
          }),
        ),
      ),
      tableFrom(
        spec,
        'byScooter',
        current.byScooter.map((s) =>
          row({ scooter: scooterLabel(s.scooterNumber), model: s.modelName, ...countCells(s) }),
        ),
        { scooter: L.total, model: null, ...countCells(fleet) },
      ),
      tableFrom(
        spec,
        'byModel',
        current.byModel.map((m) => row({ model: m.modelName, scooters: m.scooters, ...countCells(m) })),
        { model: L.total, scooters: sumOf(current.byModel, (m) => m.scooters), ...countCells(fleet) },
      ),
      tableFrom(
        spec,
        'tasks',
        current.tasks.map((t) =>
          row({
            taskType: L.taskType[t.taskType],
            created: t.created,
            done: t.done,
            cancelled: t.cancelled,
            open: t.open,
            avgWaitSeconds: t.avgWaitSeconds,
            avgRepairSeconds: t.avgRepairSeconds,
            partsCost: t.partsCost,
          }),
        ),
        {
          taskType: L.total,
          created: sumOf(current.tasks, (t) => t.created),
          done: sumOf(current.tasks, (t) => t.done),
          cancelled: sumOf(current.tasks, (t) => t.cancelled),
          open: sumOf(current.tasks, (t) => t.open),
          avgWaitSeconds: weightedAverage(
            current.tasks,
            (t) => t.avgWaitSeconds,
            (t) => t.created,
          ),
          avgRepairSeconds: weightedAverage(
            current.tasks,
            (t) => t.avgRepairSeconds,
            (t) => t.done,
          ),
          partsCost: sumOf(current.tasks, (t) => t.partsCost),
        },
      ),
      tableFrom(
        spec,
        'parts',
        current.parts.map((p) =>
          row({
            sku: p.sku,
            name: p.name,
            quantity: p.quantity,
            cost: p.cost,
            tasks: p.tasks,
            stock: p.stockQty,
            minStock: p.minStockQty,
            belowMinimum: p.belowMinimum ? L.yes : L.no,
          }),
        ),
        {
          sku: L.total,
          name: null,
          quantity: sumOf(current.parts, (p) => p.quantity),
          cost: sumOf(current.parts, (p) => p.cost),
          tasks: null,
          stock: null,
          minStock: null,
          belowMinimum: null,
        },
      ),
      tableFrom(
        spec,
        'lowStock',
        current.lowStock.map((p) =>
          row({
            sku: p.sku,
            name: p.name,
            stock: p.stockQty,
            minStock: p.minStockQty,
            shortage: p.shortage,
            unitCost: p.unitCost,
            restockCost: p.restockCost,
          }),
        ),
        current.lowStock.length
          ? {
              sku: L.total,
              name: null,
              stock: null,
              minStock: null,
              shortage: sumOf(current.lowStock, (p) => p.shortage),
              unitCost: null,
              restockCost: sumOf(current.lowStock, (p) => p.restockCost),
            }
          : null,
      ),
    ],
    // Części poniżej minimum to stan bieżący, więc nie decydują o „Brak danych” w okresie.
    empty:
      fleet.tickets === 0 &&
      current.tasks.every((t) => t.created === 0 && t.done === 0 && t.cancelled === 0) &&
      current.parts.length === 0,
  });
}
