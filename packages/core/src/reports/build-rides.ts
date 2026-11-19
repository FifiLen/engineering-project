import { HEATMAP_THRESHOLDS, REPORT_CATALOG, REPORT_VALUE_LABELS as L } from './catalog.js';
import {
  average,
  chartSpec,
  finishModel,
  heatmapChart,
  row,
  share,
  sumOf,
  tableFrom,
  tilesFrom,
  type ReportHeatmapCell,
  type ReportModel,
} from './model.js';
import type { ResolvedReportParams } from './params.js';
import type {
  ReportsRepository,
  RidesByEndZoneRow,
  RidesEndModeRow,
  RidesHeatmapRow,
  RidesZoneEntryRow,
} from './ports.js';

/**
 * Raport przejazdów według stref i godzin (ADR 0071): bez kwot (raport zawiera tylko dane obszaru swojego uprawnienia;
 * sprzedaż według strefy końca jest w raporcie przychodów). Filtr strefy końca zawęża wszystkie sekcje. Mapa ciepła
 * pokazuje średnią przejazdów na dzień: liczba przejazdów ÷ liczba wystąpień dnia tygodnia w okresie.
 */
export interface RidesPeriodData {
  byEndZone: RidesByEndZoneRow[];
  zoneEntries: RidesZoneEntryRow[];
  endModes: RidesEndModeRow[];
}

export interface RidesByZoneData {
  code: 'rides_by_zone';
  current: RidesPeriodData & { heatmap: RidesHeatmapRow[] };
  previous: RidesPeriodData | null;
}

async function periodData(
  repo: ReportsRepository,
  period: ResolvedReportParams['period'],
  filters: { endZoneId?: string },
): Promise<RidesPeriodData> {
  return {
    byEndZone: await repo.ridesByEndZone(period, filters),
    zoneEntries: await repo.ridesZoneEntries(period, filters),
    endModes: await repo.ridesEndModes(period, filters),
  };
}

export async function loadRidesByZoneData(
  repo: ReportsRepository,
  params: ResolvedReportParams,
): Promise<RidesByZoneData> {
  const filters = params.filters.zoneId ? { endZoneId: params.filters.zoneId } : {};
  const current = await periodData(repo, params.period, filters);
  const heatmap = await repo.ridesHeatmap(params.period, filters);
  const previous = params.comparison ? await periodData(repo, params.comparison.period, filters) : null;
  return { code: 'rides_by_zone', current: { ...current, heatmap }, previous };
}

/** Strefy ze sterowaniem w raporcie: zakaz jazdy i wolna jazda (parkowanie jest w tabeli stref końca). */
const CONTROLLED_ZONES = new Set(['NO_RIDE', 'SLOW']);

function tileValues(data: RidesPeriodData): Record<string, number | null> {
  const ended = sumOf(data.byEndZone, (r) => r.endedRides);
  return {
    rides: sumOf(data.byEndZone, (r) => r.rides),
    avgRideSeconds: average(
      sumOf(data.byEndZone, (r) => r.totalRideSeconds),
      ended,
    ),
    avgDistance: average(
      sumOf(data.byEndZone, (r) => r.totalDistanceM),
      ended,
    ),
    noRideZoneRides: sumOf(
      data.zoneEntries.filter((z) => z.zoneType === 'NO_RIDE'),
      (z) => z.rides,
    ),
    towedRides: sumOf(data.endModes, (r) => r.towed),
  };
}

/** Komórki 7 × 24 (dzień tygodnia ISO × godzina); brakujące komórki z zerem. */
export function heatmapCells(rows: readonly RidesHeatmapRow[]): ReportHeatmapCell[] {
  const byKey = new Map(rows.map((r) => [`${r.isodow}:${r.hour}`, r]));
  const cells: ReportHeatmapCell[] = [];
  for (let isodow = 1; isodow <= 7; isodow++) {
    const days = rows.find((r) => r.isodow === isodow)?.dayOccurrences ?? 0;
    for (let hour = 0; hour < 24; hour++) {
      const rides = byKey.get(`${isodow}:${hour}`)?.rides ?? 0;
      cells.push({ isodow, hour, rides, days, value: average(rides, days) });
    }
  }
  return cells;
}

const zoneLabel = (r: { zoneCode: string | null; zoneName: string | null }) =>
  r.zoneCode ? `${r.zoneCode} ${r.zoneName ?? ''}`.trim() : L.outsideParking;

export function buildRidesByZoneReport(params: ResolvedReportParams, data: RidesByZoneData): ReportModel {
  const spec = REPORT_CATALOG.rides_by_zone;
  const { current, previous } = data;
  const cells = heatmapCells(current.heatmap);
  const rides = sumOf(current.byEndZone, (r) => r.rides);
  const ended = sumOf(current.byEndZone, (r) => r.endedRides);
  const controlled = current.zoneEntries.filter((z) => CONTROLLED_ZONES.has(z.zoneType));

  return finishModel('rides_by_zone', {
    tiles: tilesFrom(spec, tileValues(current), previous ? tileValues(previous) : null),
    charts: [heatmapChart(chartSpec(spec, 'heatmap'), HEATMAP_THRESHOLDS, L.weekday, cells)],
    tables: [
      tableFrom(
        spec,
        'byEndZone',
        current.byEndZone.map((r) =>
          row({
            zone: zoneLabel(r),
            // Strefa NULL: koniec poza strefą parkowania albo przejazd jeszcze w toku.
            zoneType: r.zoneType ? L.zoneType[r.zoneType] : null,
            rides: r.rides,
            share: share(r.rides, rides),
            endedRides: r.endedRides,
            avgRideSeconds: r.avgRideSeconds,
            avgDistance: r.avgDistanceM,
            totalDistance: r.totalDistanceM,
          }),
        ),
        {
          zone: L.total,
          zoneType: null,
          rides,
          share: rides > 0 ? 1 : null,
          endedRides: ended,
          avgRideSeconds: average(
            sumOf(current.byEndZone, (r) => r.totalRideSeconds),
            ended,
          ),
          avgDistance: average(
            sumOf(current.byEndZone, (r) => r.totalDistanceM),
            ended,
          ),
          totalDistance: sumOf(current.byEndZone, (r) => r.totalDistanceM),
        },
      ),
      tableFrom(
        spec,
        'zoneEntries',
        controlled.map((z) =>
          row({
            zone: zoneLabel(z),
            zoneType: L.zoneType[z.zoneType],
            entries: z.entries,
            rides: z.rides,
            share: share(z.rides, rides),
            avgSecondsInZone: z.avgSecondsInZone,
            totalSecondsInZone: z.totalSecondsInZone,
          }),
        ),
      ),
      tableFrom(
        spec,
        'endModes',
        current.endModes.map((r) =>
          row({
            endMode: r.endMode ? L.endMode[r.endMode] : L.missing,
            rides: r.rides,
            towed: r.towed,
            outsideParking: r.outsideParking,
          }),
        ),
        {
          endMode: L.total,
          rides: sumOf(current.endModes, (r) => r.rides),
          towed: sumOf(current.endModes, (r) => r.towed),
          outsideParking: sumOf(current.endModes, (r) => r.outsideParking),
        },
      ),
      tableFrom(
        spec,
        'heatmap',
        L.weekday.map((weekday, i) => {
          const day = cells.filter((c) => c.isodow === i + 1);
          return row({
            weekday,
            days: day[0]?.days ?? 0,
            ...Object.fromEntries(day.map((c) => [`h${String(c.hour).padStart(2, '0')}`, c.value])),
            total: sumOf(day, (c) => c.rides),
          });
        }),
      ),
    ],
    empty: rides === 0 && current.endModes.length === 0,
  });
}
