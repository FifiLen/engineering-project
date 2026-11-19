import {
  REPORT_LIMITS,
  type ReportChartSpec,
  type ReportCode,
  type ReportColumnSpec,
  type ReportSpec,
  type ReportTableSpec,
  type ReportTileSpec,
  type ReportValueKind,
} from './catalog.js';
import { dayOfMonth, isWeekend, type LocalDate } from './dates.js';
import type { ReportComparisonAlignment, ReportGranularity } from './params.js';

/**
 * Model raportu (ADR 0071): kafelki z porównaniem, wykresy jako dane (geometrię liczy packages/shared, ADR 0072)
 * i tabele z kolumnami z katalogu. Ten sam model zwraca podgląd (`GET /admin/reports/{code}/preview`), a plik PDF
 * i XLSX powstaje z niego w API. Kształt odpowiada schematowi `reportPreviewSchema` w packages/shared.
 */
export type ReportValue = number | string | null;

export interface ReportTileModel {
  key: string;
  label: string;
  kind: ReportValueKind;
  decimals?: number;
  value: number | null;
  /** Wartość poprzedniego okresu; `null` bez porównania albo bez danych. */
  previous: number | null;
  /** Zmiana względem poprzedniego okresu jako ułamek (0,084 = +8,4%); `null`, gdy nie da się jej policzyć. */
  change: number | null;
}

export interface ReportBarItem {
  /** Data początku przedziału (`RRRR-MM-DD`) na osi czasu albo klucz kategorii. */
  key: string;
  /** Tekst kategorii; na osi czasu ta sama data co `key` (renderer formatuje ją według granulacji). */
  label: string;
  value: number | null;
  previous: number | null;
  /** Przedział poprzedniego okresu w parze (data), `null` bez pary (np. 31 października). */
  previousKey: string | null;
  weekend: boolean;
}

interface ChartBase {
  key: string;
  title: string;
  kind: ReportValueKind;
  decimals?: number;
  tableKey: string;
}

export interface ReportBarChartModel extends ChartBase {
  type: 'bar';
  axis: 'time' | 'category';
  granularity: ReportGranularity | null;
  hasPrevious: boolean;
  items: ReportBarItem[];
}

export interface ReportHeatmapCell {
  isodow: number;
  hour: number;
  /** Średnia przejazdów na dzień (przejazdy ÷ wystąpienia dnia tygodnia); `null`, gdy dzień nie wystąpił. */
  value: number | null;
  rides: number;
  days: number;
}

export interface ReportHeatmapChartModel extends ChartBase {
  type: 'heatmap';
  thresholds: number[];
  /** Etykiety wierszy (dni tygodnia od poniedziałku). */
  rowLabels: string[];
  cells: ReportHeatmapCell[];
}

export interface ReportShareSegment {
  key: string;
  label: string;
  value: number;
  share: number | null;
}

export interface ReportShareChartModel extends ChartBase {
  type: 'share';
  total: number;
  segments: ReportShareSegment[];
}

export type ReportChartModel = ReportBarChartModel | ReportHeatmapChartModel | ReportShareChartModel;

export interface ReportTableRow {
  cells: Record<string, ReportValue>;
  /** Wiersz sumy częściowej (np. „Razem stawka 23%”). */
  style?: 'subtotal';
}

export interface ReportTableModel {
  key: string;
  title: string;
  description: string | null;
  sheetName: string;
  columns: ReportColumnSpec[];
  rows: ReportTableRow[];
  /** Liczba wszystkich wierszy (podgląd i PDF pokazują początek tabeli). */
  totalRows: number;
  /** Wiersz „Razem”; `null`, gdy tabela go nie ma. */
  totals: Record<string, ReportValue> | null;
}

export interface ReportModel {
  code: ReportCode;
  tiles: ReportTileModel[];
  charts: ReportChartModel[];
  tables: ReportTableModel[];
  /** Brak danych w okresie: podgląd pokazuje stan „Brak danych”, eksport daje `409 REPORT_EMPTY`. */
  empty: boolean;
  /** Suma wierszy wszystkich tabel (`report_runs.row_count`). */
  rowCount: number;
}

// --- Obliczenia -----------------------------------------------------------------------------------------

/** Zmiana względem poprzedniego okresu (ułamek); `null`, gdy brak wartości albo poprzednia jest zerem. */
export function relativeChange(value: number | null, previous: number | null): number | null {
  if (value === null || previous === null || previous === 0) return null;
  return (value - previous) / Math.abs(previous);
}

/** Udział (0–1); `null` przy zerowej całości. */
export const share = (part: number, whole: number): number | null => (whole !== 0 ? part / whole : null);

/** Średnia ważona (`sum / count`); `null` przy zerowej liczbie. */
export const average = (sum: number, count: number): number | null => (count > 0 ? sum / count : null);

export const sumOf = <T>(rows: readonly T[], pick: (row: T) => number | null | undefined): number =>
  rows.reduce((total, row) => total + (pick(row) ?? 0), 0);

/** MTBF w godzinach: czas w przejeździe ÷ liczba awarii; `null` bez awarii (jak `fn_report_reliability_*`). */
export const mtbfHours = (inRideSeconds: number, failures: number): number | null =>
  failures > 0 ? inRideSeconds / 3600 / failures : null;

/** Średnia z wierszy ważona ich liczbą (np. średni czas naprawy modelu ważony zakończonymi zadaniami). */
export function weightedAverage<T>(rows: readonly T[], value: (row: T) => number | null, weight: (row: T) => number) {
  let sum = 0;
  let count = 0;
  for (const row of rows) {
    const v = value(row);
    const w = weight(row);
    if (v === null || w <= 0) continue;
    sum += v * w;
    count += w;
  }
  return average(sum, count);
}

// --- Budowanie sekcji -------------------------------------------------------------------------------------

export function tileFrom(
  spec: ReportTileSpec,
  value: number | null,
  previous: number | null | undefined,
  compare: boolean,
): ReportTileModel {
  const prev = compare && spec.compare ? (previous ?? null) : null;
  const tile: ReportTileModel = {
    key: spec.key,
    label: spec.label,
    kind: spec.kind,
    value,
    previous: prev,
    change: relativeChange(value, prev),
  };
  if (spec.decimals !== undefined) tile.decimals = spec.decimals;
  return tile;
}

/** Kafelki w kolejności katalogu z wartości bieżących i poprzednich (klucze kafelków). */
export function tilesFrom(
  spec: ReportSpec,
  current: Readonly<Record<string, number | null>>,
  previous: Readonly<Record<string, number | null>> | null,
): ReportTileModel[] {
  return spec.tiles.map((t) => tileFrom(t, current[t.key] ?? null, previous?.[t.key] ?? null, previous !== null));
}

export function tableSpec(spec: ReportSpec, key: string): ReportTableSpec {
  const table = spec.tables.find((t) => t.key === key);
  if (!table) throw new Error(`Raport ${spec.code} nie ma tabeli ${key}`);
  return table;
}

export function chartSpec(spec: ReportSpec, key: string): ReportChartSpec {
  const chart = spec.charts.find((c) => c.key === key);
  if (!chart) throw new Error(`Raport ${spec.code} nie ma wykresu ${key}`);
  return chart;
}

export function tableFrom(
  spec: ReportSpec,
  key: string,
  rows: ReportTableRow[],
  totals: Record<string, ReportValue> | null = null,
  columns?: ReportColumnSpec[],
): ReportTableModel {
  const table = tableSpec(spec, key);
  return {
    key: table.key,
    title: table.title,
    description: table.description ?? null,
    sheetName: table.sheetName,
    columns: columns ?? [...table.columns],
    rows,
    totalRows: rows.length,
    totals,
  };
}

export const row = (cells: Record<string, ReportValue>, style?: 'subtotal'): ReportTableRow =>
  style ? { cells, style } : { cells };

function chartBase(spec: ReportChartSpec): ChartBase {
  const base: ChartBase = { key: spec.key, title: spec.title, kind: spec.kind, tableKey: spec.tableKey };
  if (spec.decimals !== undefined) base.decimals = spec.decimals;
  return base;
}

/**
 * Para przedziału bieżącego z poprzednim: przy porównaniu miesięcy z granulacją dzienną według dnia miesiąca
 * (31 października bez pary), w pozostałych przypadkach według kolejności przedziałów.
 */
export function alignPrevious<T extends { bucket: LocalDate }>(
  current: readonly T[],
  previous: readonly T[] | null,
  alignment: ReportComparisonAlignment | null,
  granularity: ReportGranularity | null,
): Array<T | null> {
  if (!previous) return current.map(() => null);
  if (alignment === 'month' && granularity === 'day') {
    const byDay = new Map(previous.map((p) => [dayOfMonth(p.bucket), p]));
    return current.map((c) => byDay.get(dayOfMonth(c.bucket)) ?? null);
  }
  return current.map((_, i) => previous[i] ?? null);
}

export function timeBarChart<T extends { bucket: LocalDate }>(
  spec: ReportChartSpec,
  granularity: ReportGranularity,
  current: readonly T[],
  previous: Array<T | null> | null,
  value: (row: T) => number | null,
): ReportBarChartModel {
  return {
    ...chartBase(spec),
    type: 'bar',
    axis: 'time',
    granularity,
    hasPrevious: previous !== null,
    items: current.map((c, i) => {
      const p = previous?.[i] ?? null;
      return {
        key: c.bucket,
        label: c.bucket,
        value: value(c),
        previous: p ? value(p) : null,
        previousKey: p?.bucket ?? null,
        weekend: granularity === 'day' && isWeekend(c.bucket),
      };
    }),
  };
}

export function categoryBarChart(
  spec: ReportChartSpec,
  items: Array<{ key: string; label: string; value: number | null; previous?: number | null }>,
): ReportBarChartModel {
  return {
    ...chartBase(spec),
    type: 'bar',
    axis: 'category',
    granularity: null,
    hasPrevious: items.some((i) => i.previous !== undefined && i.previous !== null),
    items: items.map((i) => ({
      key: i.key,
      label: i.label,
      value: i.value,
      previous: i.previous ?? null,
      previousKey: i.previous !== undefined && i.previous !== null ? i.key : null,
      weekend: false,
    })),
  };
}

export function shareChart(
  spec: ReportChartSpec,
  segments: Array<{ key: string; label: string; value: number }>,
): ReportShareChartModel {
  const total = sumOf(segments, (s) => s.value);
  return {
    ...chartBase(spec),
    type: 'share',
    total,
    segments: segments.map((s) => ({ ...s, share: share(s.value, total) })),
  };
}

export function heatmapChart(
  spec: ReportChartSpec,
  thresholds: readonly number[],
  rowLabels: readonly string[],
  cells: ReportHeatmapCell[],
): ReportHeatmapChartModel {
  return { ...chartBase(spec), type: 'heatmap', thresholds: [...thresholds], rowLabels: [...rowLabels], cells };
}

export function finishModel(
  code: ReportCode,
  parts: { tiles: ReportTileModel[]; charts: ReportChartModel[]; tables: ReportTableModel[]; empty: boolean },
): ReportModel {
  return { code, ...parts, rowCount: sumOf(parts.tables, (t) => t.totalRows) };
}

/**
 * Tabele obcięte do `limit` wierszy (podgląd: 200, PDF: 50; ADR 0071). `totalRows` zostaje liczbą wszystkich,
 * więc renderer pokazuje „Pokazano 50 z 240” i dopisek o pełnych danych w XLSX.
 */
export function truncateReportTables(model: ReportModel, limit: number = REPORT_LIMITS.previewRows): ReportModel {
  return {
    ...model,
    tables: model.tables.map((t) => (t.rows.length > limit ? { ...t, rows: t.rows.slice(0, limit) } : t)),
  };
}

/** Tabela została skrócona (renderer dopisuje „Pokazano N z M”). */
export const isTableTruncated = (table: ReportTableModel): boolean => table.rows.length < table.totalRows;
