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
import { warsawWallClock } from './dates.js';
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
 * Raport wykorzystania floty (ADR 0074): czasy kategorii z historii stanów przycięte do okresu. Podstawą wskaźników
 * jest czas objęty historią stanów (`tracked_seconds`) bez czasu wyłączenia z ruchu (`RETIRED` nie należy do floty
 * w ruchu), a nie cały czas okresu: część okresu sprzed historii (migracja 0013, pytanie 13, albo hulajnoga dodana
 * w trakcie okresu) nie ma kategorii, więc liczona w mianowniku zaniżałaby dostępność. Kafelki, pasek udziałów,
 * tabele i szereg używają tej samej podstawy, a gdy historia nie obejmuje całego okresu, tabele mają adnotację
 * „Część okresu bez historii stanów (pełna historia od …)”. Przejazdy, czas jazdy, dystans i przychód obejmują cały
 * okres (z `rentals` i paragonów). Wykorzystanie i dostępność liczy `scooterUsageIndicators`, ta sama funkcja co pulpit
 * i karta hulajnogi.
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

/**
 * Sekundy kategorii z kolumn funkcji raportowej, tylko z historii stanów: czas przejazdów sprzed historii
 * (`untracked_ride_seconds`) leży poza podstawą wskaźników, więc nie trafia do licznika (suma kategorii z `RETIRED`
 * równa się `tracked_seconds`, bo baza zaokrągla sumy narastające).
 */
export function fleetTimeTotals(row: FleetTimeColumns): ScooterTimeTotals {
  return {
    IN_RIDE: row.inRideSeconds,
    RESERVED: row.reservedSeconds,
    AVAILABLE: row.availableSeconds,
    SERVICE: row.serviceSeconds,
    OFFLINE: row.offlineSeconds,
    RETIRED: row.retiredSeconds,
  };
}

/** Podstawa wskaźników: czas objęty historią stanów (do teraz) bez czasu wyłączenia z ruchu. */
export const fleetBasisSeconds = (row: Pick<FleetTimeColumns, 'trackedSeconds' | 'retiredSeconds'>): number =>
  Math.max(0, row.trackedSeconds - row.retiredSeconds);

/** Tolerancja zaokrąglenia do pełnych sekund przy porównaniu czasu z historią z czasem okresu. */
const ROUNDING_SLACK_SECONDS = 1;

const pad2 = (n: number) => String(n).padStart(2, '0');
/** Chwila w czasie polskim: „17.11.2026, 14:05”. */
function formatWarsawMinute(at: Date): string {
  const w = warsawWallClock(at);
  return `${pad2(w.getUTCDate())}.${pad2(w.getUTCMonth() + 1)}.${w.getUTCFullYear()}, ${pad2(w.getUTCHours())}:${pad2(w.getUTCMinutes())}`;
}

/**
 * Adnotacja tabel, gdy historia stanów nie obejmuje całego okresu (suma `tracked_seconds` mniejsza od sumy
 * `period_seconds`): od kiedy historia obejmuje wszystkie hulajnogi raportu (najpóźniejszy początek historii wśród
 * hulajnóg z luką) i jaka część czasu okresu jest objęta historią. `null`, gdy historia obejmuje cały okres.
 */
export function fleetHistoryNote(byScooter: readonly FleetUsageScooterRow[]): string | null {
  const gaps = byScooter.filter((s) => s.trackedSeconds + ROUNDING_SLACK_SECONDS < s.periodSeconds);
  if (gaps.length === 0) return null;
  const period = sumOf(byScooter, (s) => s.periodSeconds);
  const tracked = sumOf(byScooter, (s) => s.trackedSeconds);
  const starts = gaps.flatMap((s) => (s.historyFrom ? [s.historyFrom.getTime()] : []));
  const since =
    starts.length > 0 ? `pełna historia od ${formatWarsawMinute(new Date(Math.max(...starts)))}` : 'brak historii';
  const coverage = period > 0 ? ((tracked / period) * 100).toFixed(1).replace('.', ',') : '0';
  return (
    `Część okresu bez historii stanów (${since}; historia obejmuje ${coverage}% czasu okresu): czasy stanów, ` +
    'wykorzystanie i dostępność liczone względem czasu z historią. Przejazdy, przychód i dystans obejmują cały okres.'
  );
}

const withNote = <T extends { description: string | null }>(table: T, note: string | null): T =>
  note ? { ...table, description: table.description ? `${table.description}. ${note}` : note } : table;

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

/** Przedział szeregu: podstawa to suma kategorii przedziału (czas z historią), jak w kafelkach. */
function seriesCells(r: FleetUsageSeriesRow) {
  return timeCells({
    periodSeconds: r.periodSeconds * r.scooters,
    trackedSeconds:
      r.inRideSeconds + r.reservedSeconds + r.availableSeconds + r.serviceSeconds + r.offlineSeconds + r.retiredSeconds,
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
  const note = fleetHistoryNote(current.byScooter);
  const categories = L.timeCategory;
  const shareSegments = [
    { key: 'IN_RIDE', label: categories.IN_RIDE, value: fleetTotals.IN_RIDE },
    { key: 'RESERVED', label: categories.RESERVED, value: fleetTotals.RESERVED },
    { key: 'AVAILABLE', label: categories.AVAILABLE, value: fleetTotals.AVAILABLE },
    { key: 'SERVICE', label: categories.SERVICE, value: fleetTotals.SERVICE },
    { key: 'OFFLINE', label: categories.OFFLINE, value: fleetTotals.OFFLINE },
  ];

  const byModelTotals = {
    model: L.total,
    scooters: sumOf(current.byModel, (r) => r.scooters),
    ...timeCells(sumTimes(current.byModel)),
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
      withNote(
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
        note,
      ),
      withNote(
        tableFrom(
          spec,
          'byModel',
          current.byModel.map((m) =>
            row({
              model: m.modelName,
              scooters: m.scooters,
              ...timeCells(m),
              rides: m.rides,
              revenueGross: m.revenueGross,
              distance: m.distanceM,
            }),
          ),
          byModelTotals,
        ),
        note,
      ),
      withNote(
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
        note,
      ),
    ],
    empty: current.byScooter.every((s) => s.trackedSeconds === 0 && s.untrackedRideSeconds === 0 && s.rides === 0),
  });
}
