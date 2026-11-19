'use client';

/**
 * Wykresy podglądu raportu (ADR 0072): dane wykresu z API (`ReportChart`) zamienione na geometrię z packages/shared
 * i narysowane komponentem `Chart`. Słupki w czasie mają legendę okresu i poprzedniego okresu, kreskę weekendu
 * i bieżący przedział w kobalcie (gdy okres obejmuje dziś); mapa ciepła ma progi z katalogu i dymek z liczbą
 * wystąpień dnia tygodnia; pasek udziałów ma kolory stanów jak na mapie floty.
 */
import {
  barSeries,
  CHART_COLORS,
  heatmap,
  shareBar,
  type ChartTarget,
  type ReportChart,
  type ReportPreview,
  type ReportTable,
} from '@hulajnogi/shared';
import type { ReactNode } from 'react';
import { t } from '../../../lib/i18n';
import { Chart, type ChartTooltip } from '../charts/chart';
import {
  axisFormat,
  formatChange,
  formatDayMonth,
  formatLocalDay,
  formatMonthYear,
  formatNumber,
  formatReportValue,
  formatWeekdayDay,
  localDate,
  periodLabel,
} from './reports-common';

/** Kolory odcinków paska udziałów: stany hulajnogi jak na mapie floty, źródła zgłoszeń w skali szarości (jak w PDF). */
const SHARE_COLORS: Record<string, string> = {
  ...CHART_COLORS.status,
  USER: CHART_COLORS.ink,
  AUTO: CHART_COLORS.bar,
  STAFF: CHART_COLORS.status.OFFLINE,
};
const shareColor = (key: string, index: number): string =>
  SHARE_COLORS[key] ?? CHART_COLORS.heatmap[Math.min(4, index + 1)]!;

const shortMonth = new Intl.DateTimeFormat('pl', { month: 'short', timeZone: 'UTC' });
const weekdayFull = new Intl.DateTimeFormat('pl', { weekday: 'long', timeZone: 'UTC' });
const weekdayShort = new Intl.DateTimeFormat('pl', { weekday: 'short', timeZone: 'UTC' });
const capitalize = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

/** Podpis osi według granulacji: dzień „5” (pierwszy dzień miesiąca „1 paź”), tydzień „05.10”, miesiąc „paź”. */
function axisLabel(date: string, granularity: string | null): string {
  const d = localDate(date);
  if (granularity === 'month') return shortMonth.format(d);
  if (granularity === 'week') return date.slice(8, 10) + '.' + date.slice(5, 7);
  return d.getUTCDate() === 1 ? `1 ${shortMonth.format(d)}` : String(d.getUTCDate());
}

/** Tytuł dymka i wiersza tabeli: „sob. 24 października 2026”, „tydzień od 5 paź 2026”, „Październik 2026”. */
function bucketTitle(date: string, granularity: string | null): string {
  if (granularity === 'month') return formatMonthYear(date);
  if (granularity === 'week') return t('reports.chart.weekFrom', { date: formatLocalDay(date) });
  return formatWeekdayDay(date);
}

/** Czy przedział zawiera dziś (bieżąca wartość w kobalcie, ADR 0072). */
function containsToday(key: string, granularity: string | null, today: string): boolean {
  if (granularity === 'month') return key.slice(0, 7) === today.slice(0, 7);
  if (granularity === 'week') {
    const end = localDate(key);
    end.setUTCDate(end.getUTCDate() + 6);
    return key <= today && today <= end.toISOString().slice(0, 10);
  }
  return key === today;
}

const todayLocal = () =>
  new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Europe/Warsaw',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(new Date());

/** Liczba przejazdów z tabeli szeregu (dymek „· 270 przejazdów”). */
function seriesRides(table: ReportTable | undefined, key: string): number | null {
  const row = table?.rows.find((r) => r.cells.bucket === key);
  const rides = row?.cells.rides;
  return typeof rides === 'number' ? rides : null;
}

export function ReportChartCard({ chart, preview }: { chart: ReportChart; preview: ReportPreview }) {
  const heading = <h2 className="rp-card-title">{chart.title}</h2>;
  switch (chart.type) {
    case 'bar':
      return <BarChartCard chart={chart} preview={preview} heading={heading} />;
    case 'heatmap':
      return <HeatmapCard chart={chart} heading={heading} />;
    case 'share':
      return <ShareCard chart={chart} heading={heading} />;
  }
}

type BarChart = Extract<ReportChart, { type: 'bar' }>;

function BarChartCard({ chart, preview, heading }: { chart: BarChart; preview: ReportPreview; heading: ReactNode }) {
  const time = chart.axis === 'time';
  const { params } = preview;
  const value = (v: number) => formatReportValue(chart.kind, v, chart.decimals);
  const series = preview.tables.find((tb) => tb.key === chart.tableKey);
  const today = todayLocal();
  const seriesLabel = time ? periodLabel(params.from, params.to) : chart.title;
  const previousLabel =
    chart.hasPrevious && params.comparison
      ? t('reports.chart.previousPeriod', { period: periodLabel(params.comparison.from, params.comparison.to) })
      : undefined;
  const items = chart.items.map((item) => ({
    key: item.key,
    label: time ? axisLabel(item.key, chart.granularity) : item.label,
    value: item.value,
    previous: item.previous,
    weekend: item.weekend,
    highlight: time && containsToday(item.key, chart.granularity, today),
    title: time ? bucketTitle(item.key, chart.granularity) : item.label,
    previousTitle: item.previousKey
      ? chart.granularity === 'day'
        ? formatDayMonth(item.previousKey)
        : bucketTitle(item.previousKey, chart.granularity)
      : undefined,
  }));

  // Dymek jak na planszy: „Sprzedaż brutto 3 200,03 zł · 270 przejazdów” i „24 września: 2 654,38 zł (+20,6%)”.
  const tooltip = (target: ChartTarget): ChartTooltip | null => {
    const item = chart.items[target.index];
    const shown = items[target.index];
    if (!item || !shown) return null;
    const rides = time ? seriesRides(series, item.key) : null;
    const lines = [
      [
        t('reports.chart.value', {
          label: chart.title,
          value: item.value === null ? t('common.none') : value(item.value),
        }),
        rides !== null ? t('reports.chart.rides', { count: rides }) : null,
      ]
        .filter(Boolean)
        .join(' · '),
    ];
    if (item.previous !== null) {
      const change =
        item.value !== null && item.previous !== 0
          ? ` (${formatChange((item.value - item.previous) / Math.abs(item.previous))})`
          : '';
      lines.push(
        t('reports.chart.previousValue', {
          label: shown.previousTitle ?? previousLabel ?? '',
          value: value(item.previous),
          change,
        }),
      );
    }
    return { title: shown.title, lines };
  };

  return (
    <section className="card rp-card rp-chart-card">
      <Chart
        header={heading}
        legend={time || previousLabel ? 'header' : 'none'}
        legendExtra={
          time && items.some((i) => i.weekend) ? (
            <li>
              <span className="chart-swatch line" aria-hidden="true" />
              {t('reports.chart.weekend')}
            </li>
          ) : undefined
        }
        placeholderHeight={220}
        tooltip={tooltip}
        build={(width) =>
          barSeries({
            width,
            height: 220,
            title: chart.title,
            items,
            format: axisFormat(chart.kind, chart.decimals),
            seriesLabel,
            ...(previousLabel ? { previousLabel } : {}),
            categoryLabel: time ? t('reports.chart.period') : chart.title,
          })
        }
      />
    </section>
  );
}

type HeatmapChart = Extract<ReportChart, { type: 'heatmap' }>;

function HeatmapCard({ chart, heading }: { chart: HeatmapChart; heading: ReactNode }) {
  const values = chart.rowLabels.map((_, r) =>
    Array.from(
      { length: 24 },
      (_, hour) => chart.cells.find((c) => c.isodow === r + 1 && c.hour === hour)?.value ?? null,
    ),
  );
  const cell = (row: number, column: number) => chart.cells.find((c) => c.isodow === row + 1 && c.hour === column);
  // 2026-11-16 to poniedziałek: nazwa dnia tygodnia z Intl („Piątek”, w osi „Pt”).
  const day = (row: number) => localDate(`2026-11-${String(16 + row).padStart(2, '0')}`);
  const dayName = (row: number) => capitalize(weekdayFull.format(day(row)));
  const shortDay = (row: number) => capitalize(weekdayShort.format(day(row)).replace('.', ''));
  const tooltip = (target: ChartTarget): ChartTooltip | null => {
    const row = Math.floor(target.index / 24);
    const hour = target.index % 24;
    const c = cell(row, hour);
    return {
      title: t('reports.chart.heatmapTitle', { day: dayName(row), hour }),
      lines: [
        c?.value === null || c === undefined
          ? t('reports.chart.heatmapNone')
          : t('reports.chart.heatmapAvg', { value: formatNumber(c.value, chart.decimals ?? 1) }),
        ...(c ? [t('reports.chart.heatmapTotal', { rides: c.rides, days: c.days, isodow: row + 1 })] : []),
      ],
    };
  };
  return (
    <section className="card rp-card rp-chart-card">
      <Chart
        header={heading}
        meta={t('reports.chart.heatmapMeta')}
        legend="below"
        placeholderHeight={200}
        tooltip={tooltip}
        build={(width) =>
          heatmap({
            width: Math.min(width, 640),
            title: chart.title,
            rowLabels: chart.rowLabels.map((_, r) => shortDay(r)),
            columnLabels: Array.from({ length: 24 }, (_, hour) => t('reports.chart.hour', { hour })),
            values,
            thresholds: chart.thresholds,
            // Progi legendy bez „,0”, wartości komórek w tabeli z jednym miejscem po przecinku.
            format: (v) => formatNumber(v, Number.isInteger(v) ? 0 : (chart.decimals ?? 1)),
            valueLabel: t('reports.chart.heatmapValue'),
            columnLabelStride: 3,
          })
        }
      />
    </section>
  );
}

type ShareChart = Extract<ReportChart, { type: 'share' }>;

function ShareCard({ chart, heading }: { chart: ShareChart; heading: ReactNode }) {
  return (
    <section className="card rp-card rp-chart-card">
      <Chart
        header={heading}
        meta={formatReportValue(chart.kind, chart.total, chart.decimals)}
        legend="rows"
        placeholderHeight={16}
        build={(width) =>
          shareBar({
            width,
            height: 14,
            title: chart.title,
            segments: chart.segments.map((s, i) => ({
              key: s.key,
              label: s.label,
              value: s.value,
              color: shareColor(s.key, i),
            })),
            format: (v) => formatReportValue(chart.kind, v, chart.decimals),
            columns: [t('reports.chart.shareCategory'), t('reports.chart.shareValue'), t('reports.chart.shareShare')],
          })
        }
      />
    </section>
  );
}
