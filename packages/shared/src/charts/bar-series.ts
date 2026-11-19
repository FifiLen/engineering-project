import { CHART_COLORS } from './colors.js';
import { estimateTextWidth, fitText, formatChartNumber, labelStride, linearScale, niceTicks, px } from './scale.js';
import type { ChartFormat, ChartModel, ChartShape, ChartTarget } from './types.js';

/**
 * Słupki (ADR 0072): w czasie z poprzednim okresem (szerszy słupek w betonie za bieżącym), przejazdy według godzin
 * ze znacznikiem średniej i bieżącą godziną w kobalcie, kategorie (przedziały sald). Wartość `null` nie ma słupka
 * (przyszła godzina, dzień bez pary). Ujemne wartości (korekty) rosną w dół od osi zera.
 */
export interface BarSeriesItem {
  key: string;
  /** Podpis osi (już sformatowany, np. „24”, „pn 12.10”, „paź”). */
  label: string;
  value: number | null;
  /** Wartość poprzedniego okresu w parze; `null`/brak bez pary. */
  previous?: number | null;
  /** Znacznik (np. średnia z 4 poprzednich tych samych dni tygodnia). */
  marker?: number | null;
  /** Bieżąca albo zaznaczona wartość (kobalt). W PDF zamkniętego okresu nic nie jest zaznaczone. */
  highlight?: boolean;
  /** Kreska pod podpisem (sobota i niedziela). */
  weekend?: boolean;
  /** Tytuł dymka i wiersza tabeli (np. „sob. 24 października 2026”); domyślnie `label`. */
  title?: string;
  /** Tytuł poprzedniego okresu w dymku (np. „24 września”). */
  previousTitle?: string;
}

export interface BarSeriesInput {
  width: number;
  height: number;
  title: string;
  items: readonly BarSeriesItem[];
  format?: ChartFormat;
  /** Etykiety serii w legendzie, dymku i kolumnach tabeli. */
  seriesLabel: string;
  previousLabel?: string;
  markerLabel?: string;
  /** Podpis kolumny okresu w tabeli. */
  categoryLabel?: string;
  fontSize?: number;
}

const PADDING_TOP = 8;
const AXIS_GAP = 8;
const LABEL_HEIGHT = 18;
const WEEKEND_MARK = 4;

export function barSeries(input: BarSeriesInput): ChartModel {
  const format = input.format ?? formatChartNumber;
  const fontSize = input.fontSize ?? 11;
  const items = input.items;
  const values = items
    .flatMap((i) => [i.value, i.previous ?? null, i.marker ?? null])
    .filter((v): v is number => v !== null);
  const scaleTicks = niceTicks(Math.min(0, ...values), Math.max(0, ...values));
  const tickLabels = scaleTicks.ticks.map(format);
  const left = Math.ceil(Math.max(...tickLabels.map((l) => estimateTextWidth(l, fontSize)), 0)) + AXIS_GAP;
  const bottom = LABEL_HEIGHT + WEEKEND_MARK + 2;
  const plotWidth = Math.max(1, input.width - left);
  const plotHeight = Math.max(1, input.height - PADDING_TOP - bottom);
  const y = linearScale([scaleTicks.min, scaleTicks.max], [PADDING_TOP + plotHeight, PADDING_TOP]);
  const zero = y(0);
  const band = plotWidth / Math.max(1, items.length);
  const hasPrevious = items.some((i) => i.previous !== undefined && i.previous !== null);
  const barWidth = Math.max(1, band * (hasPrevious ? 0.5 : 0.62));
  const previousWidth = Math.max(1, band * 0.8);
  const stride = labelStride(
    items.map((i) => i.label),
    band,
    fontSize,
  );

  const shapes: ChartShape[] = [];
  const targets: ChartTarget[] = [];

  // Linie podziałek i podpisy osi Y.
  scaleTicks.ticks.forEach((tick, i) => {
    const ty = px(y(tick));
    shapes.push({
      kind: 'line',
      x1: left,
      y1: ty,
      x2: input.width,
      y2: ty,
      stroke: CHART_COLORS.axis,
      strokeWidth: tick === 0 ? 1.5 : 1,
    });
    shapes.push({
      kind: 'text',
      x: left - AXIS_GAP,
      y: ty + fontSize * 0.35,
      text: tickLabels[i]!,
      fill: CHART_COLORS.text,
      fontSize,
      fontWeight: 500,
      anchor: 'end',
      numeric: true,
    });
  });

  const rect = (cx: number, w: number, value: number, fill: string, index: number) => {
    const top = Math.min(y(value), zero);
    const height = Math.abs(y(value) - zero);
    shapes.push({
      kind: 'rect',
      x: px(cx - w / 2),
      y: px(top),
      width: px(w),
      height: Math.max(px(height), value === 0 ? 0 : 1),
      fill,
      rx: Math.min(3, w / 4),
      index,
    });
  };

  items.forEach((item, index) => {
    const cx = left + band * index + band / 2;
    if (item.previous !== undefined && item.previous !== null)
      rect(cx, previousWidth, item.previous, CHART_COLORS.previous, index);
    if (item.value !== null)
      rect(cx, barWidth, item.value, item.highlight ? CHART_COLORS.current : CHART_COLORS.bar, index);
    if (item.marker !== undefined && item.marker !== null) {
      const my = px(y(item.marker));
      shapes.push({
        kind: 'line',
        x1: px(cx - previousWidth / 2),
        y1: my,
        x2: px(cx + previousWidth / 2),
        y2: my,
        stroke: CHART_COLORS.average,
        strokeWidth: 2,
        index,
      });
    }
    const labelY = PADDING_TOP + plotHeight + LABEL_HEIGHT - 4;
    if (index % stride === 0) {
      shapes.push({
        kind: 'text',
        x: px(cx),
        y: labelY,
        text: fitText(item.label, band * stride - 2, fontSize),
        fill: item.highlight ? CHART_COLORS.current : CHART_COLORS.text,
        fontSize,
        fontWeight: item.highlight ? 600 : 400,
        anchor: 'middle',
        numeric: true,
      });
    }
    if (item.weekend) {
      const wy = labelY + 4;
      shapes.push({
        kind: 'line',
        x1: px(cx - barWidth / 2),
        y1: wy,
        x2: px(cx + barWidth / 2),
        y2: wy,
        stroke: CHART_COLORS.text,
        strokeWidth: 1.5,
      });
    }
    const title = item.title ?? item.label;
    const lines = [`${input.seriesLabel}: ${item.value === null ? '—' : format(item.value)}`];
    if (item.previous !== undefined && item.previous !== null)
      lines.push(`${item.previousTitle ?? input.previousLabel ?? ''}: ${format(item.previous)}`.replace(/^: /, ''));
    if (item.marker !== undefined && item.marker !== null)
      lines.push(`${input.markerLabel ?? ''}: ${format(item.marker)}`.replace(/^: /, ''));
    targets.push({
      index,
      x: px(left + band * index),
      y: PADDING_TOP,
      width: px(band),
      height: plotHeight,
      title,
      lines,
    });
  });

  const legend = [
    { key: 'value', label: input.seriesLabel, color: CHART_COLORS.bar },
    ...(hasPrevious && input.previousLabel
      ? [{ key: 'previous', label: input.previousLabel, color: CHART_COLORS.previous }]
      : []),
    ...(items.some((i) => i.marker !== undefined && i.marker !== null) && input.markerLabel
      ? [{ key: 'marker', label: input.markerLabel, color: CHART_COLORS.average }]
      : []),
  ];

  const present = items.filter((i): i is BarSeriesItem & { value: number } => i.value !== null);
  const top = present.reduce<(BarSeriesItem & { value: number }) | null>(
    (best, i) => (!best || i.value > best.value ? i : best),
    null,
  );
  const description =
    `${input.title}: wykres słupkowy, ${items.length} ${items.length === 1 ? 'słupek' : 'słupków'}` +
    (top ? `, najwyższa wartość ${format(top.value)} (${top.title ?? top.label})` : ', brak wartości') +
    (hasPrevious && input.previousLabel ? `, z porównaniem: ${input.previousLabel}` : '') +
    '.';

  const columns = [input.categoryLabel ?? '', input.seriesLabel];
  if (hasPrevious) columns.push(input.previousLabel ?? '');
  const hasMarker = items.some((i) => i.marker !== undefined && i.marker !== null);
  if (hasMarker) columns.push(input.markerLabel ?? '');
  const rows = items.map((i) => {
    const r = [i.title ?? i.label, i.value === null ? '—' : format(i.value)];
    if (hasPrevious) r.push(i.previous === undefined || i.previous === null ? '—' : format(i.previous));
    if (hasMarker) r.push(i.marker === undefined || i.marker === null ? '—' : format(i.marker));
    return r;
  });

  return { width: input.width, height: input.height, shapes, targets, legend, description, table: { columns, rows } };
}
