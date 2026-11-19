import { CHART_COLORS } from './colors.js';
import { formatChartNumber, px } from './scale.js';
import type { ChartFormat, ChartModel, ChartShape, ChartTarget } from './types.js';

/**
 * Pasek udziałów (ADR 0072; stan floty na pulpicie, udziały czasu hulajnogi): odcinki proporcjonalne do wartości
 * z odstępem, niezerowy odcinek ma co najmniej `minSegment` px. Legenda niesie liczbę i procent.
 */
export interface ShareBarSegment {
  key: string;
  label: string;
  value: number;
  color: string;
  hatch?: boolean;
}

export interface ShareBarInput {
  width: number;
  height?: number;
  title: string;
  segments: readonly ShareBarSegment[];
  /** Tekst wartości w legendzie i tabeli (np. liczba hulajnóg, godziny). */
  format?: ChartFormat;
  formatShare?: ChartFormat;
  gap?: number;
  minSegment?: number;
  /** Kolumny tabeli „Pokaż jako tabelę”. */
  columns?: [string, string, string];
}

const plPercent = new Intl.NumberFormat('pl-PL', { style: 'percent', maximumFractionDigits: 1 });

export function shareBar(input: ShareBarInput): ChartModel {
  const height = input.height ?? 12;
  const gap = input.gap ?? 2;
  const minSegment = input.minSegment ?? 3;
  const format = input.format ?? formatChartNumber;
  const formatShare = input.formatShare ?? ((v: number) => plPercent.format(v));
  const total = input.segments.reduce((s, x) => s + Math.max(0, x.value), 0);
  const visible = input.segments.filter((s) => s.value > 0);
  const available = Math.max(0, input.width - gap * Math.max(0, visible.length - 1));

  // Najpierw minimalna szerokość małych odcinków, resztę dzielą proporcjonalnie pozostałe.
  const raw = visible.map((s) => (total > 0 ? (s.value / total) * available : 0));
  const small = raw.map((w) => w < minSegment);
  const fixed = small.filter(Boolean).length * minSegment;
  const flexTotal = raw.reduce((sum, w, i) => sum + (small[i] ? 0 : w), 0);
  const widths = raw.map((w, i) =>
    small[i] ? minSegment : flexTotal > 0 ? (w / flexTotal) * Math.max(0, available - fixed) : 0,
  );

  const shapes: ChartShape[] = [];
  const targets: ChartTarget[] = [];
  let x = 0;
  visible.forEach((segment, i) => {
    const width = widths[i]!;
    const index = input.segments.indexOf(segment);
    const rect: ChartShape = {
      kind: 'rect',
      x: px(x),
      y: 0,
      width: px(width),
      height,
      rx: Math.min(4, height / 3),
      fill: segment.color,
      index,
    };
    if (segment.hatch) rect.hatch = true;
    shapes.push(rect);
    targets.push({
      index,
      x: px(x),
      y: 0,
      width: px(width),
      height,
      title: segment.label,
      lines: [`${format(segment.value)} · ${total > 0 ? formatShare(segment.value / total) : '—'}`],
    });
    x += width + gap;
  });
  if (total === 0)
    shapes.push({
      kind: 'rect',
      x: 0,
      y: 0,
      width: input.width,
      height,
      rx: Math.min(4, height / 3),
      fill: CHART_COLORS.previous,
    });

  const shareText = (v: number) => (total > 0 ? formatShare(v / total) : '—');
  return {
    width: input.width,
    height,
    shapes,
    targets,
    legend: input.segments.map((s) => {
      const item = { key: s.key, label: s.label, color: s.color, value: `${format(s.value)} · ${shareText(s.value)}` };
      return s.hatch ? { ...item, hatch: true } : item;
    }),
    description:
      `${input.title}: ` +
      (total > 0
        ? input.segments
            .filter((s) => s.value > 0)
            .map((s) => `${s.label} ${format(s.value)} (${shareText(s.value)})`)
            .join(', ')
        : 'brak danych') +
      '.',
    table: {
      columns: input.columns ?? ['', '', ''],
      rows: input.segments.map((s) => [s.label, format(s.value), shareText(s.value)]),
    },
  };
}
