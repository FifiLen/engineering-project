import { CHART_COLORS } from './colors.js';
import { estimateTextWidth, fitText, formatChartNumber, px } from './scale.js';
import type { ChartFormat, ChartLegendItem, ChartModel, ChartShape, ChartTarget } from './types.js';

/**
 * Mapa ciepła wiersze × kolumny (ADR 0072; dzień tygodnia × godzina startu): barwa ze stałych progów (np. 3, 6, 10,
 * 15 przejazdów na dzień), żeby ten sam odcień znaczył to samo w różnych okresach; legenda podaje progi. Pusta
 * komórka (dzień nie wystąpił w okresie) ma najjaśniejszy stopień bez wartości w dymku.
 */
export interface HeatmapInput {
  width: number;
  title: string;
  rowLabels: readonly string[];
  columnLabels: readonly string[];
  /** `values[row][column]`; `null` bez danych. */
  values: ReadonlyArray<ReadonlyArray<number | null>>;
  /** Progi rosnąco: n progów daje n + 1 stopni (domyślna skala ma pięć stopni). */
  thresholds: readonly number[];
  format?: ChartFormat;
  /** Dodatkowe wiersze dymka komórki (np. „Razem 81 w 4 piątki”). */
  details?: (row: number, column: number) => string[];
  /** Zaznaczona komórka (obwódka kobaltu). */
  selected?: { row: number; column: number } | null;
  /** Co która kolumna ma podpis (np. co 3 godziny). */
  columnLabelStride?: number;
  cellGap?: number;
  fontSize?: number;
  /** Etykieta wartości w dymku (np. „Średnio przejazdów na dzień”). */
  valueLabel: string;
}

/** Stopień barwy dla wartości: liczba progów, które wartość osiąga (`< 3` → 0, `≥ 15` → 4). */
export function heatmapStep(value: number | null, thresholds: readonly number[]): number {
  if (value === null) return 0;
  let step = 0;
  for (const t of thresholds) if (value >= t) step++;
  return step;
}

/** Legenda progów: „poniżej 3”, „3–6”, …, „15 i więcej”. */
export function heatmapLegend(
  thresholds: readonly number[],
  format: ChartFormat = formatChartNumber,
): ChartLegendItem[] {
  const colors = CHART_COLORS.heatmap;
  return Array.from({ length: thresholds.length + 1 }, (_, step) => {
    const lo = thresholds[step - 1];
    const hi = thresholds[step];
    const label =
      lo === undefined
        ? `poniżej ${format(hi!)}`
        : hi === undefined
          ? `${format(lo)} i więcej`
          : `${format(lo)}–${format(hi)}`;
    return { key: `step${step}`, label, color: colors[Math.min(step, colors.length - 1)]! };
  });
}

const TOP_LABELS = 16;

export function heatmap(input: HeatmapInput): ChartModel {
  const format = input.format ?? formatChartNumber;
  const fontSize = input.fontSize ?? 11;
  const gap = input.cellGap ?? 3;
  const left = Math.ceil(Math.max(...input.rowLabels.map((l) => estimateTextWidth(l, fontSize)), 0)) + 10;
  const columns = input.columnLabels.length;
  const cell = Math.max(4, (input.width - left - gap * (columns - 1)) / Math.max(1, columns));
  const height = TOP_LABELS + input.rowLabels.length * (cell + gap) - gap;
  const stride =
    input.columnLabelStride ?? Math.max(1, Math.ceil((estimateTextWidth('00', fontSize) + 6) / (cell + gap)));
  const colors = CHART_COLORS.heatmap;
  const shapes: ChartShape[] = [];
  const targets: ChartTarget[] = [];

  input.columnLabels.forEach((label, c) => {
    if (c % stride !== 0) return;
    shapes.push({
      kind: 'text',
      x: px(left + c * (cell + gap)),
      y: TOP_LABELS - 5,
      text: label,
      fill: CHART_COLORS.text,
      fontSize,
      fontWeight: 400,
      anchor: 'start',
      numeric: true,
    });
  });

  input.rowLabels.forEach((rowLabel, r) => {
    const y = TOP_LABELS + r * (cell + gap);
    shapes.push({
      kind: 'text',
      x: left - 10,
      y: px(y + cell / 2 + fontSize * 0.35),
      text: fitText(rowLabel, left - 10, fontSize),
      fill: CHART_COLORS.text,
      fontSize,
      fontWeight: 400,
      anchor: 'end',
    });
    input.columnLabels.forEach((columnLabel, c) => {
      const value = input.values[r]?.[c] ?? null;
      const step = heatmapStep(value, input.thresholds);
      const x = left + c * (cell + gap);
      const index = r * columns + c;
      shapes.push({
        kind: 'rect',
        x: px(x),
        y: px(y),
        width: px(cell),
        height: px(cell),
        rx: Math.min(5, cell / 4),
        fill: colors[Math.min(step, colors.length - 1)]!,
        index,
      });
      targets.push({
        index,
        x: px(x),
        y: px(y),
        width: px(cell),
        height: px(cell),
        title: `${rowLabel}, ${columnLabel}`,
        lines: [`${input.valueLabel}: ${value === null ? '—' : format(value)}`, ...(input.details?.(r, c) ?? [])],
      });
    });
  });

  if (input.selected) {
    const { row, column } = input.selected;
    const x = left + column * (cell + gap) - 2.5;
    const y = TOP_LABELS + row * (cell + gap) - 2.5;
    shapes.push({
      kind: 'rect',
      x: px(x),
      y: px(y),
      width: px(cell + 5),
      height: px(cell + 5),
      rx: Math.min(7, cell / 3),
      fill: 'none',
      stroke: CHART_COLORS.current,
      strokeWidth: 2.5,
    });
  }

  let best: { r: number; c: number; v: number } | null = null;
  input.values.forEach((row, r) =>
    row.forEach((v, c) => {
      if (v !== null && (!best || v > best.v)) best = { r, c, v };
    }),
  );
  const top = best as { r: number; c: number; v: number } | null;
  const description =
    `${input.title}: mapa ciepła ${input.rowLabels.length} × ${columns}` +
    (top
      ? `, najwięcej ${format(top.v)} (${input.rowLabels[top.r]}, ${input.columnLabels[top.c]})`
      : ', brak wartości') +
    '.';

  return {
    width: input.width,
    height: px(height),
    shapes,
    targets,
    legend: heatmapLegend(input.thresholds, format),
    description,
    table: {
      columns: ['', ...input.columnLabels],
      rows: input.rowLabels.map((label, r) => [
        label,
        ...input.columnLabels.map((_, c) => {
          const v = input.values[r]?.[c] ?? null;
          return v === null ? '—' : format(v);
        }),
      ]),
    },
  };
}
