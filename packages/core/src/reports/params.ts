import { DomainError } from '../errors.js';
import { REPORT_CATALOG, REPORT_LIMITS, type ReportCode, type ReportFilter } from './catalog.js';
import {
  addDays,
  addMonthsClamped,
  dayOfMonth,
  daysBetween,
  daysInMonth,
  isLocalDate,
  localDateOf,
  sameMonth,
  startOfMonth,
  warsawMidnight,
  type LocalDate,
} from './dates.js';

/**
 * Parametry raportu (ADR 0071): gotowe zakresy w dobach Europe/Warsaw albo własny okres do 366 dni, granulacja
 * dobierana do długości (do 62 dni dzień, do 182 tydzień, dalej miesiąc) z możliwością zmiany, porównanie z poprzednim
 * okresem i filtry zależne od raportu. Kształt parametrów sprawdza schemat Zod w packages/shared; tu są reguły.
 *
 * Daty `from` i `to` są bezwzględne i obie włącznie. Gdy przychodzą w żądaniu, wygrywają z gotowym zakresem, który
 * zostaje wtedy tylko etykietą: tak „Uruchom ponownie z tymi parametrami” liczy ten sam okres na dzisiejszych danych
 * (`report_runs.params` ma daty i etykietę zakresu).
 */
export const REPORT_PRESETS = ['today', 'yesterday', 'last_7_days', 'this_month', 'previous_month', 'custom'] as const;
export type ReportPreset = (typeof REPORT_PRESETS)[number];

export const REPORT_GRANULARITIES = ['day', 'week', 'month'] as const;
export type ReportGranularity = (typeof REPORT_GRANULARITIES)[number];

export interface ReportParamsInput {
  preset?: ReportPreset;
  from?: LocalDate;
  to?: LocalDate;
  granularity?: ReportGranularity;
  compare?: boolean;
  zoneId?: string;
  modelId?: string;
  scooterId?: string;
}

/** Okres w dobach polskich, obie daty włącznie. */
export interface ReportRange {
  from: LocalDate;
  to: LocalDate;
}

/** Okres półotwarty `[from, to)` przekazywany funkcjom `fn_report_*`. */
export interface ReportInterval {
  from: Date;
  to: Date;
}

export type ReportFilters = Partial<Record<ReportFilter, string>>;

/** Wyrównanie okresu porównawczego: do dnia miesiąca (zakresy miesięczne) albo ta sama długość tuż przed. */
export type ReportComparisonAlignment = 'month' | 'length';

export interface ReportComparison {
  range: ReportRange;
  period: ReportInterval;
  alignment: ReportComparisonAlignment;
}

export interface ResolvedReportParams {
  code: ReportCode;
  /** Etykieta zakresu; przy własnych datach w żądaniu `custom`, chyba że żądanie podało inną etykietę. */
  preset: ReportPreset;
  range: ReportRange;
  days: number;
  period: ReportInterval;
  /** `null` w raporcie bez szeregu czasowego. */
  granularity: ReportGranularity | null;
  /** Granulacja dobrana automatycznie (operator jej nie zmienił). */
  granularityAuto: boolean;
  /** `null` bez porównania. */
  comparison: ReportComparison | null;
  filters: ReportFilters;
}

/** Granulacja do długości okresu: do 62 dni dzień, do 182 tydzień, dalej miesiąc. */
export function autoGranularity(days: number): ReportGranularity {
  if (days <= 62) return 'day';
  if (days <= 182) return 'week';
  return 'month';
}

/** Gotowy zakres na dziś (doba polska `today`). */
export function presetRange(preset: Exclude<ReportPreset, 'custom'>, today: LocalDate): ReportRange {
  switch (preset) {
    case 'today':
      return { from: today, to: today };
    case 'yesterday': {
      const day = addDays(today, -1);
      return { from: day, to: day };
    }
    case 'last_7_days':
      return { from: addDays(today, -6), to: today };
    case 'this_month':
      return { from: startOfMonth(today), to: today };
    case 'previous_month': {
      const last = addDays(startOfMonth(today), -1);
      return { from: startOfMonth(last), to: last };
    }
  }
}

/** Liczba dób okresu (obie daty włącznie). */
export const rangeDays = (range: ReportRange): number => daysBetween(range.from, range.to) + 1;

/** Okres `[północ from, północ dnia po to)` w czasie polskim. */
export const rangeInterval = (range: ReportRange): ReportInterval => ({
  from: warsawMidnight(range.from),
  to: warsawMidnight(addDays(range.to, 1)),
});

/** Zakres miesięczny: od pierwszego dnia miesiąca do dnia w tym samym miesiącu (ten albo poprzedni miesiąc). */
export const isMonthlyRange = (range: ReportRange): boolean =>
  dayOfMonth(range.from) === 1 && sameMonth(range.from, range.to);

/**
 * Okres porównawczy: przy zakresie miesięcznym poprzedni miesiąc kalendarzowy wyrównany do dnia miesiąca (1–31
 * października porównuje się z 1–30 września; 31 października nie ma pary), w pozostałych przypadkach okres tej samej
 * długości tuż przed.
 */
export function comparisonRange(range: ReportRange): { range: ReportRange; alignment: ReportComparisonAlignment } {
  if (isMonthlyRange(range)) {
    const from = addMonthsClamped(range.from, -1);
    const [y, m] = from.split('-').map(Number) as [number, number];
    const toDay = Math.min(dayOfMonth(range.to), daysInMonth(y, m));
    const to = `${from.slice(0, 8)}${String(toDay).padStart(2, '0')}`;
    return { range: { from, to }, alignment: 'month' };
  }
  const days = rangeDays(range);
  return { range: { from: addDays(range.from, -days), to: addDays(range.from, -1) }, alignment: 'length' };
}

/**
 * Walidacja i rozwinięcie parametrów. Błędy: `VALIDATION_FAILED` (`field`: brak dat własnego okresu albo zła data),
 * `REPORT_RANGE_INVALID` (`to` przed `from`), `REPORT_RANGE_IN_FUTURE` (`to` po dziś), `REPORT_RANGE_TOO_LONG`
 * (`details: { days, maxDays }`), `REPORT_PARAM_NOT_SUPPORTED` (`param`: filtr albo granulacja spoza raportu).
 */
export function resolveReportParams(code: ReportCode, input: ReportParamsInput, now: Date): ResolvedReportParams {
  const spec = REPORT_CATALOG[code].params;
  const today = localDateOf(now);

  for (const filter of ['zoneId', 'modelId', 'scooterId'] as const) {
    if (input[filter] !== undefined && !spec.filters.includes(filter))
      throw new DomainError('REPORT_PARAM_NOT_SUPPORTED', { param: filter });
  }
  if (input.granularity !== undefined && !spec.granularity)
    throw new DomainError('REPORT_PARAM_NOT_SUPPORTED', { param: 'granularity' });

  const preset: ReportPreset = input.preset ?? (input.from || input.to ? 'custom' : 'this_month');
  let range: ReportRange;
  if (input.from !== undefined || input.to !== undefined) {
    if (input.from === undefined) throw new DomainError('VALIDATION_FAILED', { field: 'from' });
    if (input.to === undefined) throw new DomainError('VALIDATION_FAILED', { field: 'to' });
    range = { from: input.from, to: input.to };
  } else if (preset === 'custom') {
    throw new DomainError('VALIDATION_FAILED', { field: 'from' });
  } else {
    range = presetRange(preset, today);
  }
  for (const field of ['from', 'to'] as const) {
    if (!isLocalDate(range[field])) throw new DomainError('VALIDATION_FAILED', { field });
  }
  if (range.to < range.from) throw new DomainError('REPORT_RANGE_INVALID', { from: range.from, to: range.to });
  if (range.to > today) throw new DomainError('REPORT_RANGE_IN_FUTURE', { to: range.to, today });
  const days = rangeDays(range);
  if (days > REPORT_LIMITS.maxDays)
    throw new DomainError('REPORT_RANGE_TOO_LONG', { days, maxDays: REPORT_LIMITS.maxDays });

  const granularity = spec.granularity ? (input.granularity ?? autoGranularity(days)) : null;
  const compare = spec.compare && (input.compare ?? true);
  const comparison = compare ? comparisonRange(range) : null;
  const filters: ReportFilters = {};
  for (const filter of spec.filters) {
    const value = input[filter];
    if (value !== undefined) filters[filter] = value;
  }

  return {
    code,
    preset,
    range,
    days,
    period: rangeInterval(range),
    granularity,
    granularityAuto: spec.granularity && input.granularity === undefined,
    comparison: comparison
      ? { range: comparison.range, period: rangeInterval(comparison.range), alignment: comparison.alignment }
      : null,
    filters,
  };
}

/**
 * Parametry zapisywane w `report_runs.params`: daty bezwzględne z etykietą zakresu, granulacja, porównanie i filtry
 * oraz granice okresu jako chwile (do nagłówka pliku i historii). Ten sam kształt przyjmuje `resolveReportParams`
 * przy „Uruchom ponownie z tymi parametrami”.
 */
export interface StoredReportParams {
  preset: ReportPreset;
  from: LocalDate;
  to: LocalDate;
  granularity: ReportGranularity | null;
  compare: boolean;
  zoneId?: string;
  modelId?: string;
  scooterId?: string;
  periodFrom: string;
  periodTo: string;
  compareFrom: LocalDate | null;
  compareTo: LocalDate | null;
}

export function storedReportParams(params: ResolvedReportParams): StoredReportParams {
  return {
    preset: params.preset,
    from: params.range.from,
    to: params.range.to,
    granularity: params.granularity,
    compare: params.comparison !== null,
    ...params.filters,
    periodFrom: params.period.from.toISOString(),
    periodTo: params.period.to.toISOString(),
    compareFrom: params.comparison?.range.from ?? null,
    compareTo: params.comparison?.range.to ?? null,
  };
}

/** Wejście `resolveReportParams` z zapisanych parametrów (ten sam okres bezwzględny). */
export function rerunParamsInput(stored: StoredReportParams): ReportParamsInput {
  return {
    preset: stored.preset,
    from: stored.from,
    to: stored.to,
    ...(stored.granularity ? { granularity: stored.granularity } : {}),
    compare: stored.compare,
    ...(stored.zoneId ? { zoneId: stored.zoneId } : {}),
    ...(stored.modelId ? { modelId: stored.modelId } : {}),
    ...(stored.scooterId ? { scooterId: stored.scooterId } : {}),
  };
}

/** Parametry po walidacji w kształcie odpowiedzi podglądu (`resolvedReportParamsSchema` w packages/shared). */
export function reportParamsView(params: ResolvedReportParams) {
  return {
    preset: params.preset,
    from: params.range.from,
    to: params.range.to,
    days: params.days,
    granularity: params.granularity,
    granularityAuto: params.granularityAuto,
    periodFrom: params.period.from.toISOString(),
    periodTo: params.period.to.toISOString(),
    comparison: params.comparison
      ? { from: params.comparison.range.from, to: params.comparison.range.to, alignment: params.comparison.alignment }
      : null,
    filters: { ...params.filters },
  };
}
