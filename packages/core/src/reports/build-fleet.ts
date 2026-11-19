import { REPORT_CATALOG, REPORT_VALUE_LABELS as L } from './catalog.js';
import {
  alignPrevious,
  chartSpec,
  finishModel,
  row,
  shareChart,
  sumOf,
  tableFrom,
  tilesFrom,
  timeBarChart,
  type ReportModel,
} from './model.js';
import type { ResolvedReportParams } from './params.js';
import type {
  FleetTimeColumns,
  FleetUsageModelRow,
  FleetUsageScooterRow,
  FleetUsageSeriesRow,
  ReportsRepository,
} from './ports.js';
import { scooterUsageIndicators, type ScooterTimeTotals } from './scooter-time.js';

/**
 * Raport wykorzystania floty (ADR 0074): czasy kategorii z historii stanów przycięte do okresu, a dla części okresu
 * sprzed historii (migracja 0013, pytanie 13) czas przejazdów z `rentals`. Czas okresu hulajnogi to `period_seconds`
 * bez czasu wyłączenia z ruchu (`RETIRED` nie należy do floty w ruchu); wykorzystanie i dostępność liczy
 * `scooterUsageIndicators`, ta sama funkcja co pulpit i karta hulajnogi.
 */
export interface FleetUsageData {
  code: 'fleet_usage';
  current: { byScooter: FleetUsageScooterRow[]; byModel: FleetUsageModelRow[]; series: FleetUsageSeriesRow[] };
  previous: { byScooter: FleetUsageScooterRow[]; series: FleetUsageSeriesRow[] } | null;
}

export async function loadFleetUsageData(
  repo: ReportsRepository,
  params: ResolvedReportParams,
): Promise<FleetUsageData> {
  const granularity = params.granularity ?? 'day';
  const filters = { modelId: params.filters.modelId, scooterId: params.filters.scooterId };
  const byScooter = await repo.fleetUsageByScooter(params.period, filters);
  const current = {
    byScooter,
    // `fn_report_fleet_usage_by_model` nie ma filtra hulajnogi: przy nim model to suma wybranej hulajnogi.
    byModel: filters.scooterId
      ? fleetModelRows(byScooter)
      : await repo.fleetUsageByModel(params.period, { modelId: filters.modelId }),
    series: await repo.fleetUsageSeries(params.period, granularity, filters),
  };
  const previous = params.comparison
    ? {
        byScooter: await repo.fleetUsageByScooter(params.comparison.period, filters),
        series: await repo.fleetUsageSeries(params.comparison.period, granularity, filters),
      }
    : null;
  return { code: 'fleet_usage', current, previous };
}

/** Wiersze modeli z wierszy hulajnóg (ta sama reguła co `fn_report_fleet_usage_by_model`). */
export function fleetModelRows(byScooter: readonly FleetUsageScooterRow[]): FleetUsageModelRow[] {
  const groups = new Map<string, FleetUsageScooterRow[]>();
  for (const s of byScooter) groups.set(s.modelId, [...(groups.get(s.modelId) ?? []), s]);
  return [...groups.values()]
    .map((rows) => ({
      modelId: rows[0]!.modelId,
      modelCode: rows[0]!.modelCode,
      modelName: rows[0]!.modelName,
      scooters: rows.length,
      ...sumTimes(rows),
      periodSeconds: Math.max(...rows.map((r) => r.periodSeconds)),
      rides: sumOf(rows, (r) => r.rides),
      rideSeconds: sumOf(rows, (r) => r.rideSeconds),
      distanceM: sumOf(rows, (r) => r.distanceM),
      revenueGross: sumOf(rows, (r) => r.revenueGross),
    }))
    .sort((a, b) => a.modelCode.localeCompare(b.modelCode));
}

/** Sekundy kategorii z kolumn funkcji raportowej (przejazdy sprzed historii doliczone do przejazdu). */
export function fleetTimeTotals(row: FleetTimeColumns): ScooterTimeTotals {
  return {
    IN_RIDE: row.inRideSeconds + row.untrackedRideSeconds,
    RESERVED: row.reservedSeconds,
    AVAILABLE: row.availableSeconds,
    SERVICE: row.serviceSeconds,
    OFFLINE: row.offlineSeconds,
    RETIRED: row.retiredSeconds,
  };
}

/** Czas okresu do wskaźników: okres (do teraz) bez czasu wyłączenia z ruchu. */
export const fleetBasisSeconds = (row: Pick<FleetTimeColumns, 'periodSeconds' | 'retiredSeconds'>): number =>
  Math.max(0, row.periodSeconds - row.retiredSeconds);

function sumTimes(rows: readonly FleetTimeColumns[]): FleetTimeColumns {
  return {
    periodSeconds: sumOf(rows, (r) => r.periodSeconds),
    trackedSeconds: sumOf(rows, (r) => r.trackedSeconds),
    inRideSeconds: sumOf(rows, (r) => r.inRideSeconds),
    reservedSeconds: sumOf(rows, (r) => r.reservedSeconds),
    availableSeconds: sumOf(rows, (r) => r.availableSeconds),
    serviceSeconds: sumOf(rows, (r) => r.serviceSeconds),
    offlineSeconds: sumOf(rows, (r) => r.offlineSeconds),
    retiredSeconds: sumOf(rows, (r) => r.retiredSeconds),
    untrackedRideSeconds: sumOf(rows, (r) => r.untrackedRideSeconds),
  };
}

function timeCells(times: FleetTimeColumns) {
  const totals = fleetTimeTotals(times);
  const indicators = scooterUsageIndicators(totals, fleetBasisSeconds(times));
  return {
    inRideSeconds: totals.IN_RIDE,
    reservedSeconds: totals.RESERVED,
    availableSeconds: totals.AVAILABLE,
    serviceSeconds: totals.SERVICE,
    offlineSeconds: totals.OFFLINE,
    utilization: indicators.utilization,
    availability: indicators.availability,
  };
}

function tileValues(byScooter: readonly FleetUsageScooterRow[]): Record<string, number | null> {
  const cells = timeCells(sumTimes(byScooter));
  return {
    utilization: cells.utilization,
    availability: cells.availability,
    rides: sumOf(byScooter, (r) => r.rides),
    inRideSeconds: cells.inRideSeconds,
    serviceSeconds: cells.serviceSeconds,
    offlineSeconds: cells.offlineSeconds,
  };
}

/** Szereg nie ma przejazdów sprzed historii: wykorzystanie przedziału z samej historii stanów. */
function seriesCells(r: FleetUsageSeriesRow) {
  return timeCells({
    periodSeconds: r.periodSeconds * r.scooters,
    trackedSeconds: 0,
    inRideSeconds: r.inRideSeconds,
    reservedSeconds: r.reservedSeconds,
    availableSeconds: r.availableSeconds,
    serviceSeconds: r.serviceSeconds,
    offlineSeconds: r.offlineSeconds,
    retiredSeconds: r.retiredSeconds,
    untrackedRideSeconds: 0,
  });
}

export const scooterLabel = (n: number): string => `#${String(n).padStart(4, '0')}`;

export function buildFleetUsageReport(params: ResolvedReportParams, data: FleetUsageData): ReportModel {
  const spec = REPORT_CATALOG.fleet_usage;
  const granularity = params.granularity ?? 'day';
  const { current, previous } = data;
  const aligned = alignPrevious(
    current.series,
    previous?.series ?? null,
    params.comparison?.alignment ?? null,
    granularity,
  );

  const fleet = sumTimes(current.byScooter);
  const fleetTotals = fleetTimeTotals(fleet);
  const untracked = Math.max(
    0,
    fleetBasisSeconds(fleet) -
      fleetTotals.IN_RIDE -
      fleetTotals.RESERVED -
      fleetTotals.AVAILABLE -
      fleetTotals.SERVICE -
      fleetTotals.OFFLINE,
  );
  const categories = L.timeCategory;
  const shareSegments = [
    { key: 'IN_RIDE', label: categories.IN_RIDE, value: fleetTotals.IN_RIDE },
    { key: 'RESERVED', label: categories.RESERVED, value: fleetTotals.RESERVED },
    { key: 'AVAILABLE', label: categories.AVAILABLE, value: fleetTotals.AVAILABLE },
    { key: 'SERVICE', label: categories.SERVICE, value: fleetTotals.SERVICE },
    { key: 'OFFLINE', label: categories.OFFLINE, value: fleetTotals.OFFLINE },
    ...(untracked > 0 ? [{ key: 'UNTRACKED', label: 'Brak historii stanów', value: untracked }] : []),
  ];

  const byModelTotals = {
    model: L.total,
    scooters: sumOf(current.byModel, (r) => r.scooters),
    ...timeCells(sumTimes(current.byModel.map((m) => ({ ...m, periodSeconds: m.periodSeconds * m.scooters })))),
    rides: sumOf(current.byModel, (r) => r.rides),
    revenueGross: sumOf(current.byModel, (r) => r.revenueGross),
    distance: sumOf(current.byModel, (r) => r.distanceM),
  };

  return finishModel('fleet_usage', {
    tiles: tilesFrom(spec, tileValues(current.byScooter), previous ? tileValues(previous.byScooter) : null),
    charts: [
      shareChart(chartSpec(spec, 'timeShare'), shareSegments),
      timeBarChart(
        chartSpec(spec, 'utilizationSeries'),
        granularity,
        current.series,
        previous ? aligned : null,
        (r) => seriesCells(r).utilization,
      ),
    ],
    tables: [
      tableFrom(
        spec,
        'byScooter',
        current.byScooter.map((s) =>
          row({
            scooter: scooterLabel(s.scooterNumber),
            model: s.modelName,
            ...timeCells(s),
            rides: s.rides,
            revenueGross: s.revenueGross,
            distance: s.distanceM,
            odometer: s.odometerM,
          }),
        ),
        {
          scooter: L.total,
          model: null,
          ...timeCells(fleet),
          rides: sumOf(current.byScooter, (r) => r.rides),
          revenueGross: sumOf(current.byScooter, (r) => r.revenueGross),
          distance: sumOf(current.byScooter, (r) => r.distanceM),
          odometer: null,
        },
      ),
      tableFrom(
        spec,
        'byModel',
        current.byModel.map((m) =>
          row({
            model: m.modelName,
            scooters: m.scooters,
            // `period_seconds` modelu to czas okresu jednej hulajnogi (max z hulajnóg modelu).
            ...timeCells({ ...m, periodSeconds: m.periodSeconds * m.scooters }),
            rides: m.rides,
            revenueGross: m.revenueGross,
            distance: m.distanceM,
          }),
        ),
        byModelTotals,
      ),
      tableFrom(
        spec,
        'series',
        current.series.map((r, i) => {
          const prev = aligned[i];
          return row({
            bucket: r.bucket,
            scooters: r.scooters,
            ...seriesCells(r),
            previousUtilization: prev ? seriesCells(prev).utilization : null,
            rides: r.rides,
          });
        }),
      ),
    ],
    empty: current.byScooter.every((s) => s.trackedSeconds === 0 && s.untrackedRideSeconds === 0 && s.rides === 0),
  });
}
