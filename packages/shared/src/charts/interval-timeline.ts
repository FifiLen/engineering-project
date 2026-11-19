import { CHART_COLORS, type ChartStatusColor } from './colors.js';
import { estimateTextWidth, px } from './scale.js';
import type { ChartLegendItem, ChartModel, ChartShape, ChartTarget } from './types.js';

/**
 * Oś czasu przedziałów (ADR 0072, ADR 0074; „Historia stanów” na karcie hulajnogi): wiersz na dobę polską od
 * północy do północy (doba zmiany czasu ma 23 albo 25 godzin, więc szerokość wiersza to zawsze cała doba),
 * przedziały przycięte do wiersza, bieżąca chwila kreską z podpisem. Brak łączności przykrywa stan (kolor beton),
 * wyłączona z ruchu ma wzór ukośny.
 */
export const REPORT_TIME_ZONE = 'Europe/Warsaw';

export type ScooterStatusValue = 'AVAILABLE' | 'RESERVED' | 'IN_USE' | 'MAINTENANCE' | 'RETIRED';

/** Kolor przedziału osi czasu: brak łączności wygrywa ze stanem (inaczej niż kategorie czasu w raporcie). */
export function statusTimelineKey(status: ScooterStatusValue, online: boolean): ChartStatusColor {
  if (status === 'RETIRED') return 'RETIRED';
  if (!online) return 'OFFLINE';
  if (status === 'IN_USE') return 'IN_RIDE';
  if (status === 'RESERVED') return 'RESERVED';
  if (status === 'MAINTENANCE') return 'SERVICE';
  return 'AVAILABLE';
}

const partsFormat = new Intl.DateTimeFormat('en-GB', {
  timeZone: REPORT_TIME_ZONE,
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
  hour: '2-digit',
  minute: '2-digit',
  hourCycle: 'h23',
});

function warsawParts(at: Date) {
  const out: Record<string, number> = {};
  for (const p of partsFormat.formatToParts(at)) if (p.type !== 'literal') out[p.type] = Number(p.value);
  return out as { year: number; month: number; day: number; hour: number; minute: number };
}

/** Północ doby polskiej `RRRR-MM-DD` jako chwila (ta sama reguła co `warsawMidnight` w packages/core). */
export function warsawDayStart(date: string): Date {
  const [y, m, d] = date.split('-').map(Number) as [number, number, number];
  const guess = Date.UTC(y, m - 1, d);
  const offset = (at: number) => {
    const p = warsawParts(new Date(at));
    return Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute) - Math.floor(at / 60_000) * 60_000;
  };
  let at = guess - offset(guess);
  const second = guess - offset(at);
  if (second !== at) at = second;
  return new Date(at);
}

/** Data i godzina polska `dd.mm gg:mm`. */
export function warsawDayTime(at: Date): string {
  const p = warsawParts(at);
  return `${String(p.day).padStart(2, '0')}.${String(p.month).padStart(2, '0')} ${warsawTime(at)}`;
}

/** Godzina polska `HH:MM`. */
export function warsawTime(at: Date): string {
  const p = warsawParts(at);
  return `${String(p.hour).padStart(2, '0')}:${String(p.minute).padStart(2, '0')}`;
}

export interface TimelineRow {
  key: string;
  label: string;
  from: Date;
  to: Date;
}

/** Wiersze `count` dób polskich kończących się dobą `lastDay` (najstarsza pierwsza). */
export function warsawDayRows(
  lastDay: string,
  count: number,
  label: (date: string) => string = (d) => d,
): TimelineRow[] {
  const [y, m, d] = lastDay.split('-').map(Number) as [number, number, number];
  return Array.from({ length: count }, (_, i) => {
    const day = new Date(Date.UTC(y, m - 1, d - (count - 1 - i)));
    const next = new Date(Date.UTC(y, m - 1, d - (count - 1 - i) + 1));
    const iso = day.toISOString().slice(0, 10);
    return {
      key: iso,
      label: label(iso),
      from: warsawDayStart(iso),
      to: warsawDayStart(next.toISOString().slice(0, 10)),
    };
  });
}

export interface TimelineInterval {
  from: Date;
  /** `null`: przedział otwarty (do `now`). */
  to: Date | null;
  color: ChartStatusColor;
  /** Tekst stanu w dymku (np. „W użyciu”). */
  label: string;
  /** Dodatkowe wiersze dymka (np. przyczyna „Przejazd R-51854”). */
  details?: string[];
}

export interface IntervalTimelineInput {
  width: number;
  title: string;
  rows: readonly TimelineRow[];
  intervals: readonly TimelineInterval[];
  now: Date;
  legend: ReadonlyArray<{ key: ChartStatusColor; label: string }>;
  rowHeight?: number;
  rowGap?: number;
  fontSize?: number;
  /** Podpisy osi godzin (domyślnie co 6 h). */
  hourTicks?: readonly number[];
  /** Tekst czasu trwania w tabeli (np. „1 h 20 min”). */
  formatDuration?: (seconds: number) => string;
  /** Tekst chwili w tabeli (domyślnie `dd.mm gg:mm` w czasie polskim). */
  formatTime?: (at: Date) => string;
  columns?: [string, string, string, string];
}

const AXIS_HEIGHT = 16;

function defaultDuration(seconds: number): string {
  const minutes = Math.round(seconds / 60);
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return h > 0 ? `${h} h ${m} min` : `${m} min`;
}

export function intervalTimeline(input: IntervalTimelineInput): ChartModel {
  const fontSize = input.fontSize ?? 11;
  const rowHeight = input.rowHeight ?? 16;
  const rowGap = input.rowGap ?? 6;
  const left = Math.ceil(Math.max(...input.rows.map((r) => estimateTextWidth(r.label, fontSize)), 0)) + 10;
  const plot = Math.max(1, input.width - left);
  const ticks = input.hourTicks ?? [0, 6, 12, 18, 24];
  const height = AXIS_HEIGHT + input.rows.length * (rowHeight + rowGap) - rowGap + 18;
  const shapes: ChartShape[] = [];
  const targets: ChartTarget[] = [];
  const nowMs = input.now.getTime();
  const formatDuration = input.formatDuration ?? defaultDuration;
  const formatTime = input.formatTime ?? warsawDayTime;

  // Godziny osi według doby 24-godzinnej (na dobie zmiany czasu podziałka jest przybliżeniem).
  for (const hour of ticks) {
    const x = px(left + (hour / 24) * plot);
    shapes.push({
      kind: 'text',
      x,
      y: AXIS_HEIGHT - 5,
      text: `${hour}:00`,
      fill: CHART_COLORS.text,
      fontSize,
      fontWeight: 400,
      anchor: hour === 24 ? 'end' : hour === 0 ? 'start' : 'middle',
      numeric: true,
    });
  }

  input.rows.forEach((row, r) => {
    const y = AXIS_HEIGHT + r * (rowHeight + rowGap);
    const rowFrom = row.from.getTime();
    const rowTo = row.to.getTime();
    const span = rowTo - rowFrom;
    const xOf = (t: number) => left + ((t - rowFrom) / span) * plot;
    shapes.push({
      kind: 'text',
      x: left - 10,
      y: px(y + rowHeight / 2 + fontSize * 0.35),
      text: row.label,
      fill: CHART_COLORS.text,
      fontSize,
      fontWeight: 400,
      anchor: 'end',
    });
    // Tło wiersza (przyszłość i brak historii).
    shapes.push({
      kind: 'rect',
      x: px(left),
      y: px(y),
      width: px(plot),
      height: rowHeight,
      fill: CHART_COLORS.status.UNTRACKED,
      rx: 3,
    });
    input.intervals.forEach((interval, i) => {
      const from = Math.max(interval.from.getTime(), rowFrom);
      const to = Math.min((interval.to ?? input.now).getTime(), rowTo, nowMs);
      if (to <= from) return;
      const x1 = xOf(from);
      const x2 = xOf(to);
      const rect: ChartShape = {
        kind: 'rect',
        x: px(x1),
        y: px(y),
        width: Math.max(0.5, px(x2 - x1)),
        height: rowHeight,
        fill: CHART_COLORS.status[interval.color],
        index: i,
      };
      if (interval.color === 'RETIRED') rect.hatch = true;
      shapes.push(rect);
      targets.push({
        index: i,
        x: px(x1),
        y: px(y),
        width: Math.max(4, px(x2 - x1)),
        height: rowHeight,
        title: interval.label,
        lines: [
          `${warsawTime(interval.from)}–${interval.to ? warsawTime(interval.to) : warsawTime(input.now)} (${formatDuration(((interval.to ?? input.now).getTime() - interval.from.getTime()) / 1000)})`,
          ...(interval.details ?? []),
        ],
      });
    });
    if (nowMs > rowFrom && nowMs < rowTo) {
      const x = px(xOf(nowMs));
      shapes.push({
        kind: 'line',
        x1: x,
        y1: px(y - 3),
        x2: x,
        y2: px(y + rowHeight + 3),
        stroke: CHART_COLORS.ink,
        strokeWidth: 1.5,
      });
      shapes.push({
        kind: 'text',
        x: x + 5,
        y: px(y + rowHeight + 14),
        text: warsawTime(input.now),
        fill: CHART_COLORS.ink,
        fontSize,
        fontWeight: 600,
        anchor: 'start',
        numeric: true,
      });
    }
  });

  const legend: ChartLegendItem[] = input.legend.map((l) => {
    const item: ChartLegendItem = { key: l.key, label: l.label, color: CHART_COLORS.status[l.key] };
    if (l.key === 'RETIRED') item.hatch = true;
    return item;
  });

  return {
    width: input.width,
    height: px(height),
    shapes,
    targets,
    legend,
    description: `${input.title}: oś czasu ${input.rows.length} ${input.rows.length === 1 ? 'doby' : 'dób'}, ${input.intervals.length} przedziałów stanu.`,
    table: {
      columns: input.columns ?? ['Stan', 'Od', 'Do', 'Czas trwania'],
      rows: input.intervals.map((interval) => {
        const end = interval.to ?? input.now;
        return [
          interval.label,
          formatTime(interval.from),
          interval.to ? formatTime(interval.to) : '',
          formatDuration((end.getTime() - interval.from.getTime()) / 1000),
        ];
      }),
    },
  };
}
