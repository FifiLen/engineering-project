import {
  formatDocumentDateTime,
  type LocalDate,
  type ReportFormat,
  type ReportGranularity,
  type ReportPreset,
  type ReportValue,
  type ReportValueKind,
  type ResolvedReportParams,
} from '@hulajnogi/core';

/**
 * Teksty i formatowanie wartości w plikach raportów (ADR 0071): plik powstaje w API, więc etykiety parametrów są tu
 * (jak teksty wyliczeń wydruków w `document-labels.ts`), a etykiety sekcji i kolumn w katalogu w core. Liczby po
 * polsku (przecinek dziesiętny, spacja tysięcy), kwoty w złotych z groszy, daty w strefie Europe/Warsaw.
 */
export const REPORT_PRESET_LABELS: Record<ReportPreset, string> = {
  today: 'dziś',
  yesterday: 'wczoraj',
  last_7_days: 'ostatnie 7 dni',
  this_month: 'bieżący miesiąc',
  previous_month: 'poprzedni miesiąc',
  custom: 'własny okres',
};

export const REPORT_GRANULARITY_LABELS: Record<ReportGranularity, string> = {
  day: 'dzień',
  week: 'tydzień',
  month: 'miesiąc',
};

export const REPORT_FORMAT_LABELS: Record<ReportFormat, string> = { PDF: 'PDF', XLSX: 'XLSX (Excel)' };

export const REPORT_ORIENTATION_LABELS = { portrait: 'A4 pionowo', landscape: 'A4 poziomo' } as const;

const MONTHS = [
  'stycznia',
  'lutego',
  'marca',
  'kwietnia',
  'maja',
  'czerwca',
  'lipca',
  'sierpnia',
  'września',
  'października',
  'listopada',
  'grudnia',
];
const MONTHS_NOMINATIVE = [
  'styczeń',
  'luty',
  'marzec',
  'kwiecień',
  'maj',
  'czerwiec',
  'lipiec',
  'sierpień',
  'wrzesień',
  'październik',
  'listopad',
  'grudzień',
];
const MONTHS_SHORT = ['sty', 'lut', 'mar', 'kwi', 'maj', 'cze', 'lip', 'sie', 'wrz', 'paź', 'lis', 'gru'];

const numberFormats = new Map<number, Intl.NumberFormat>();

/**
 * Liczba po polsku z separatorem tysięcy także dla czterech cyfr („6 103”, jak na planszy PDF; reguła CLDR dla
 * polskiego grupuje dopiero od pięciu cyfr, co w kolumnie tabeli myli).
 */
export function formatNumber(value: number, fractionDigits = 0): string {
  let format = numberFormats.get(fractionDigits);
  if (!format) {
    format = new Intl.NumberFormat('pl-PL', {
      minimumFractionDigits: fractionDigits,
      maximumFractionDigits: fractionDigits,
      useGrouping: 'always',
    });
    numberFormats.set(fractionDigits, format);
  }
  return format.format(value);
}

/** Kwota z groszy: „1 234,56 zł”. */
export const formatMoney = (grosze: number): string => `${formatNumber(grosze / 100, 2)} zł`;

const split = (date: LocalDate) => date.split('-').map(Number) as [number, number, number];

/** `2026-10-05` → `05.10.2026`. */
export const formatLocalDate = (date: LocalDate): string => {
  const [y, m, d] = split(date);
  return `${String(d).padStart(2, '0')}.${String(m).padStart(2, '0')}.${y}`;
};

/** Okres w nagłówku: „1–31 października 2026”, „28 września – 4 października 2026”, „5 października 2026”. */
export function formatRange(from: LocalDate, to: LocalDate): string {
  const [fy, fm, fd] = split(from);
  const [ty, tm, td] = split(to);
  if (from === to) return `${fd} ${MONTHS[fm - 1]} ${fy}`;
  if (fy === ty && fm === tm) return `${fd}–${td} ${MONTHS[tm - 1]} ${ty}`;
  if (fy === ty) return `${fd} ${MONTHS[fm - 1]} – ${td} ${MONTHS[tm - 1]} ${ty}`;
  return `${fd} ${MONTHS[fm - 1]} ${fy} – ${td} ${MONTHS[tm - 1]} ${ty}`;
}

/** Miesiąc kohorty: `2026-10-01` → „październik 2026”. */
export const formatMonth = (date: LocalDate): string => {
  const [y, m] = split(date);
  return `${MONTHS_NOMINATIVE[m - 1]} ${y}`;
};

/** Podpis osi czasu wykresu według granulacji: dzień „5” (pierwszy dzień miesiąca „1 paź”), tydzień „05.10”, miesiąc „paź”. */
export function axisLabel(date: LocalDate, granularity: ReportGranularity | null): string {
  const [, m, d] = split(date);
  if (granularity === 'month') return MONTHS_SHORT[m - 1]!;
  if (granularity === 'week') return `${String(d).padStart(2, '0')}.${String(m).padStart(2, '0')}`;
  return d === 1 ? `1 ${MONTHS_SHORT[m - 1]}` : String(d);
}

/** Pełny opis przedziału na osi (tytuł wiersza „Pokaż jako tabelę”). */
export function bucketTitle(date: LocalDate, granularity: ReportGranularity | null): string {
  if (granularity === 'month') return formatMonth(date);
  if (granularity === 'week') return `tydzień od ${formatLocalDate(date)}`;
  return formatLocalDate(date);
}

/** Czas trwania z sekund: „45 s”, „14 min”, od godziny „2,1 h” (jedna jednostka w kolumnie tabeli z godzinami). */
export function formatDuration(seconds: number): string {
  const abs = Math.abs(seconds);
  const sign = seconds < 0 ? '−' : '';
  if (abs < 60) return `${sign}${Math.round(abs)} s`;
  if (abs < 3600) return `${sign}${Math.round(abs / 60)} min`;
  return `${sign}${formatNumber(abs / 3600, 1)} h`;
}

/** Dystans z metrów: „850 m”, „12,3 km”. */
export const formatDistance = (meters: number): string =>
  Math.abs(meters) < 1000 ? `${Math.round(meters)} m` : `${formatNumber(meters / 1000, 1)} km`;

/** Udział (0–1) w procentach: „15,3%”. */
export const formatPercent = (value: number, decimals = 1): string => `${formatNumber(value * 100, decimals)}%`;

/** Liczba z minusem typograficznym (`−1 005,53`), jak na planszy PDF. */
const minus = (text: string) => text.replace(/^-/, '−');

/** Wartość komórki, kafelka albo wykresu według rodzaju z katalogu; `null` to „—”. */
export function formatReportValue(kind: ReportValueKind, value: ReportValue, decimals?: number): string {
  if (value === null || value === undefined) return '—';
  if (typeof value === 'string') {
    if (kind === 'date' && /^\d{4}-\d{2}-\d{2}$/.test(value)) return formatLocalDate(value);
    return value;
  }
  switch (kind) {
    case 'money':
      return minus(formatMoney(value));
    case 'number':
      return minus(formatNumber(value, decimals ?? 0));
    case 'duration':
      return formatDuration(value);
    case 'distance':
      return minus(formatDistance(value));
    case 'percent':
      return minus(formatPercent(value, decimals ?? 1));
    case 'date':
    case 'text':
      return String(value);
  }
}

const compactNumber = new Intl.NumberFormat('pl-PL', { notation: 'compact', maximumFractionDigits: 1 });

/** Podpisy osi wykresu: kwoty skrótem („4 tys. zł”), godziny, procenty bez miejsc po przecinku. */
export function axisFormat(kind: ReportValueKind, decimals?: number): (value: number) => string {
  switch (kind) {
    case 'money':
      return (v) => minus(`${Math.abs(v) >= 100_000 ? compactNumber.format(v / 100) : formatNumber(v / 100)} zł`);
    case 'percent':
      return (v) => minus(formatPercent(v, 0));
    case 'duration':
      return (v) => minus(`${formatNumber(v / 3600, v !== 0 && Math.abs(v) < 36_000 ? 1 : 0)} h`);
    case 'distance':
      return (v) => minus(`${formatNumber(v / 1000, 0)} km`);
    default:
      return (v) => minus(Math.abs(v) >= 10_000 ? compactNumber.format(v) : formatNumber(v, decimals ?? 0));
  }
}

/** Zmiana wobec poprzedniego okresu: „▲ +8,4%”, „▼ −2,1%” (strzałka w kolorze tekstu, ADR 0072). */
export function formatChange(change: number): string {
  if (change === 0) return '0,0%';
  const arrow = change > 0 ? '▲' : '▼';
  return `${arrow} ${change > 0 ? '+' : '−'}${formatNumber(Math.abs(change) * 100, 1)}%`;
}

export interface ReportFilterNames {
  zone?: string | null;
  model?: string | null;
  scooter?: string | null;
}

/**
 * Parametry w nagłówku PDF i w arkuszu „Parametry”: okres z etykietą zakresu, porównanie, granulacja, filtry
 * (nazwy z bazy), strefa czasowa.
 */
export function reportParamLabels(
  params: ResolvedReportParams,
  filters: ReportFilterNames = {},
): Array<{ label: string; value: string }> {
  const labels = [
    {
      label: 'Okres',
      value: `${formatRange(params.range.from, params.range.to)} · ${REPORT_PRESET_LABELS[params.preset]} · ${params.days} ${
        params.days === 1
          ? 'doba'
          : params.days % 10 >= 2 && params.days % 10 <= 4 && (params.days % 100 < 10 || params.days % 100 >= 20)
            ? 'doby'
            : 'dób'
      }`,
    },
    {
      label: 'Porównanie',
      value: params.comparison
        ? `${formatRange(params.comparison.range.from, params.comparison.range.to)}${
            params.comparison.alignment === 'month' ? ' · do dnia miesiąca' : ''
          }`
        : 'bez porównania',
    },
  ];
  if (params.granularity)
    labels.push({
      label: 'Granulacja',
      value: `${REPORT_GRANULARITY_LABELS[params.granularity]}${params.granularityAuto ? ' · dobrana do okresu' : ''}`,
    });
  if (params.filters.zoneId) labels.push({ label: 'Strefa końca', value: filters.zone ?? params.filters.zoneId });
  if (params.filters.modelId) labels.push({ label: 'Model', value: filters.model ?? params.filters.modelId });
  if (params.filters.scooterId) labels.push({ label: 'Hulajnoga', value: filters.scooter ?? params.filters.scooterId });
  return labels;
}

/** Chwila w nagłówku i stopce: `19.11.2026, 14:32`. */
export const formatInstant = formatDocumentDateTime;
