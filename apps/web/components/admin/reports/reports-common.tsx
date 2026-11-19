'use client';

/**
 * Wspólne elementy pozycji „Raporty” (iteracja 8, ADR 0071, makiety 32-panel-raporty): ścieżki, nagłówek z zakładkami
 * Raporty, Historia i Definicje, katalog z API (`GET /admin/reports`), formatowanie wartości raportu w panelu (kwoty
 * z groszy, czas trwania, dystans, udziały), opis parametrów uruchomienia, stany uruchomień, komunikaty kodów błędów
 * raportów i pobieranie pliku przez adres z podpisem (ADR 0057).
 */
import {
  REPORT_CODES,
  reportPermission,
  type DocumentFileLink,
  type ListResponse,
  type ReportCatalog,
  type ReportCode,
  type ReportGranularity,
  type ReportPreset,
  type ReportRunState,
  type ReportRunView,
  type ReportValueKind,
} from '@hulajnogi/shared';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useEffect, useState, type ReactNode } from 'react';
import { api, ApiRequestError, errorMessage, fileUrl } from '../../../lib/api';
import { formatClock, formatDate, isToday, t } from '../../../lib/i18n';
import { useSession } from '../../../lib/session';
import { linkFresh } from '../prints/prints-common';

export const REPORTS_BASE = '/admin/raporty';
export const REPORTS_PATHS = {
  catalog: REPORTS_BASE,
  history: `${REPORTS_BASE}/historia`,
  definitions: `${REPORTS_BASE}/definicje`,
  definition: (code: string) => `${REPORTS_BASE}/definicje/${code}`,
  report: (code: string) => `${REPORTS_BASE}/${code}`,
} as const;

/** Pozycja „Raporty” w nawigacji: dowolne `reports.<kod>` albo `reports.manage` (ADR 0071). */
export const REPORTS_NAV_PERMISSIONS = [...REPORT_CODES.map(reportPermission), 'reports.manage'];

export function useCanSeeReports(): { any: boolean; codes: ReportCode[]; manage: boolean } {
  const { can } = useSession();
  const codes = REPORT_CODES.filter((code) => can(reportPermission(code)));
  return { any: codes.length > 0 || can('reports.manage'), codes, manage: can('reports.manage') };
}

// ---------------------------------------------------------------------------------------------
// Katalog z API
// ---------------------------------------------------------------------------------------------

let catalogRequest: Promise<ReportCatalog> | null = null;

/** Katalog raportów (wspólny dla zakładek i strony raportu); zmiana definicji albo nowe uruchomienie go unieważnia. */
export function loadReportCatalog(): Promise<ReportCatalog> {
  catalogRequest ??= api<ReportCatalog>('/admin/reports').catch((error: unknown) => {
    catalogRequest = null;
    throw error;
  });
  return catalogRequest;
}

export function invalidateReportCatalog(): void {
  catalogRequest = null;
}

export function useReportCatalog(revision = 0): { catalog: ReportCatalog | null; error: string | null } {
  const [state, setState] = useState<{ catalog: ReportCatalog | null; error: string | null }>({
    catalog: null,
    error: null,
  });
  useEffect(() => {
    let current = true;
    if (revision > 0) invalidateReportCatalog();
    loadReportCatalog()
      .then((catalog) => current && setState({ catalog, error: null }))
      .catch((e: unknown) => current && setState({ catalog: null, error: errorMessage(e) }));
    return () => {
      current = false;
    };
  }, [revision]);
  return state;
}

// ---------------------------------------------------------------------------------------------
// Nagłówek i zakładki
// ---------------------------------------------------------------------------------------------

const total = (path: string) =>
  api<ListResponse<unknown>>(path)
    .then((r) => r.total)
    .catch(() => null);

/** Zakładki Raporty, Historia i Definicje z liczbami (makieta raporty-katalog); Definicje tylko z `reports.manage`. */
export function ReportsTabs({ reports, revision = 0 }: { reports?: number | null; revision?: number }) {
  const pathname = usePathname();
  const { codes, manage } = useCanSeeReports();
  const [counts, setCounts] = useState<{ history: number | null; definitions: number | null }>({
    history: null,
    definitions: null,
  });
  const anyReport = codes.length > 0;
  // Liczba raportów z katalogu (wspólne żądanie), gdy strona jej nie podała (Historia, Definicje).
  const { catalog } = useReportCatalog();
  const reportCount = reports ?? catalog?.items.length ?? null;
  useEffect(() => {
    void Promise.all([
      anyReport ? total('/admin/report-runs?pageSize=10') : Promise.resolve(null),
      manage ? total('/admin/report-definitions?pageSize=10') : Promise.resolve(null),
    ]).then(([history, definitions]) => setCounts({ history, definitions }));
  }, [anyReport, manage, revision]);
  const tabs = [
    ...(anyReport ? [{ href: REPORTS_PATHS.catalog, label: t('reports.tabs.catalog'), count: reportCount }] : []),
    ...(anyReport ? [{ href: REPORTS_PATHS.history, label: t('reports.tabs.history'), count: counts.history }] : []),
    ...(manage
      ? [{ href: REPORTS_PATHS.definitions, label: t('reports.tabs.definitions'), count: counts.definitions }]
      : []),
  ];
  const active = pathname.startsWith(REPORTS_PATHS.history)
    ? REPORTS_PATHS.history
    : pathname.startsWith(REPORTS_PATHS.definitions)
      ? REPORTS_PATHS.definitions
      : REPORTS_PATHS.catalog;
  return (
    <nav className="tabs" aria-label={t('admin.nav.reports')}>
      {tabs.map((tab) => (
        <Link key={tab.href} href={tab.href} className="tab" aria-current={tab.href === active ? 'page' : undefined}>
          {tab.label}
          {tab.count !== null && <span className="n num">{tab.count}</span>}
        </Link>
      ))}
    </nav>
  );
}

/** Tytuł „Raporty” z opisem i elementem po prawej (wyszukiwarka katalogu). */
export function ReportsHead({ actions }: { actions?: ReactNode }) {
  return (
    <div className="page-head">
      <div>
        <h1>{t('reports.title')}</h1>
        <div className="sub">{t('reports.subtitle')}</div>
      </div>
      {actions && <div className="actions">{actions}</div>}
    </div>
  );
}

// ---------------------------------------------------------------------------------------------
// Formatowanie wartości
// ---------------------------------------------------------------------------------------------

const numberFormats = new Map<number, Intl.NumberFormat>();

/** Liczba po polsku z separatorem tysięcy także dla czterech cyfr („6 327”, jak na planszach i w PDF). */
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
  // Minus typograficzny (`−1 005,53`), jak w PDF raportu.
  return format.format(value).replace(/^-/, '−');
}

/** Kwota z groszy: „74 875,60 zł”. */
export const formatMoney = (grosze: number) => t('reports.format.money', { value: formatNumber(grosze / 100, 2) });

/**
 * Czas trwania z sekund: „45 s”, „14 min 10 s”, od godziny „412,5 h”. W tabeli (`compact`) jedna jednostka do godziny
 * („14 min”), jak w PDF, żeby kolumna była czytelna.
 */
export function formatDurationSeconds(seconds: number, compact = false): string {
  const abs = Math.abs(seconds);
  const sign = seconds < 0 ? '−' : '';
  if (abs < 60) return sign + t('reports.format.seconds', { value: Math.round(abs) });
  if (abs < 3600) {
    const m = Math.floor(abs / 60);
    const s = Math.round(abs % 60);
    if (compact) return sign + t('reports.format.minutes', { m: Math.round(abs / 60) });
    return sign + (s > 0 ? t('reports.format.minutesSeconds', { m, s }) : t('reports.format.minutes', { m }));
  }
  return sign + t('reports.format.hours', { value: formatNumber(abs / 3600, 1) });
}

/** Dystans z metrów: „850 m”, „2,4 km”. */
export const formatDistance = (meters: number) =>
  Math.abs(meters) < 1000
    ? t('reports.format.meters', { value: formatNumber(meters) })
    : t('reports.format.km', { value: formatNumber(meters / 1000, 1) });

/** Udział z ułamka: „28,7%”. */
export const formatShare = (fraction: number, decimals = 1) =>
  t('reports.format.percent', { value: formatNumber(fraction * 100, decimals) });

const dayFormat = new Intl.DateTimeFormat('pl', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' });
const dayLong = new Intl.DateTimeFormat('pl', { day: 'numeric', month: 'long', year: 'numeric', timeZone: 'UTC' });
const monthYear = new Intl.DateTimeFormat('pl', { month: 'long', year: 'numeric', timeZone: 'UTC' });
const weekdayLong = new Intl.DateTimeFormat('pl', {
  weekday: 'short',
  day: 'numeric',
  month: 'long',
  year: 'numeric',
  timeZone: 'UTC',
});
const dayMonth = new Intl.DateTimeFormat('pl', { day: 'numeric', month: 'long', timeZone: 'UTC' });

/** Data polska `RRRR-MM-DD` jako północ UTC (formatowanie bez przesunięcia strefy). */
export const localDate = (date: string) => new Date(`${date}T00:00:00Z`);
const capitalize = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

/** „1–31 paź 2026”, „20 paź – 16 lis 2026” (pasek parametrów, historia). */
export const formatRangeShort = (from: string, to: string) =>
  from === to ? dayFormat.format(localDate(from)) : dayFormat.formatRange(localDate(from), localDate(to));
/** „1–31 października 2026” (tytuły, okno eksportu, stany). */
export const formatRangeLong = (from: string, to: string) =>
  from === to ? dayLong.format(localDate(from)) : dayLong.formatRange(localDate(from), localDate(to));
/** „5 paź 2026”. */
export const formatLocalDay = (date: string) => dayFormat.format(localDate(date));
/** „Październik 2026” (legenda okresu miesięcznego). */
export const formatMonthYear = (date: string) => capitalize(monthYear.format(localDate(date)));
/** „sob. 24 października 2026” (dymek słupka dnia). */
export const formatWeekdayDay = (date: string) => weekdayLong.format(localDate(date)).replace(',', '');
/** „24 września” (dymek poprzedniego okresu). */
export const formatDayMonth = (date: string) => dayMonth.format(localDate(date));

/** Czy okres jest pełnym miesiącem kalendarzowym (legenda „Październik 2026”). */
export function isWholeMonth(from: string, to: string): boolean {
  if (!from.endsWith('-01') || from.slice(0, 7) !== to.slice(0, 7)) return false;
  const next = localDate(from);
  next.setUTCMonth(next.getUTCMonth() + 1);
  next.setUTCDate(0);
  return next.toISOString().slice(0, 10) === to;
}

/** Nazwa okresu w legendzie wykresu: pełny miesiąc „Październik 2026”, inaczej zakres. */
export const periodLabel = (from: string, to: string) =>
  isWholeMonth(from, to) ? formatMonthYear(from) : formatRangeShort(from, to);

/** Wartość komórki, kafelka albo dymka według rodzaju z katalogu raportu; `null` to „—”. */
export function formatReportValue(
  kind: ReportValueKind,
  value: number | string | null,
  decimals?: number,
  compact = false,
): string {
  if (value === null || value === undefined) return t('common.none');
  if (typeof value === 'string') {
    if (kind === 'date' && /^\d{4}-\d{2}-\d{2}$/.test(value)) return formatLocalDay(value);
    return value;
  }
  switch (kind) {
    case 'money':
      return formatMoney(value);
    case 'number':
      return formatNumber(value, decimals ?? 0);
    case 'duration':
      return formatDurationSeconds(value, compact);
    case 'distance':
      return formatDistance(value);
    case 'percent':
      return formatShare(value, decimals ?? 1);
    case 'date':
    case 'text':
      return String(value);
  }
}

const compactNumber = new Intl.NumberFormat('pl-PL', { notation: 'compact', maximumFractionDigits: 1 });

/** Podpisy osi wykresu: kwoty skrótem („4 tys. zł”), udziały bez miejsc po przecinku, godziny z czasu trwania. */
export function axisFormat(kind: ReportValueKind, decimals?: number): (value: number) => string {
  switch (kind) {
    case 'money':
      return (v) =>
        t('reports.format.money', {
          value: Math.abs(v) >= 100_000 ? compactNumber.format(v / 100).replace(/^-/, '−') : formatNumber(v / 100),
        });
    case 'percent':
      return (v) => formatShare(v, 0);
    case 'duration':
      return (v) =>
        t('reports.format.hours', { value: formatNumber(v / 3600, v !== 0 && Math.abs(v) < 36_000 ? 1 : 0) });
    case 'distance':
      return (v) => t('reports.format.km', { value: formatNumber(v / 1000) });
    default:
      return (v) =>
        Math.abs(v) >= 10_000 ? compactNumber.format(v).replace(/^-/, '−') : formatNumber(v, decimals ?? 0);
  }
}

/** Zmiana wobec poprzedniego okresu bez strzałki: „+8,4%”, „−17,1%” (strzałka jest ikoną w kolorze tekstu). */
export function formatChange(change: number): string {
  if (Math.abs(change) < 0.0005) return t('reports.format.percent', { value: formatNumber(0, 1) });
  return `${change > 0 ? '+' : '−'}${t('reports.format.percent', { value: formatNumber(Math.abs(change) * 100, 1) })}`;
}

// ---------------------------------------------------------------------------------------------
// Parametry uruchomienia, stany i błędy
// ---------------------------------------------------------------------------------------------

/** Parametry zapisane w `report_runs.params` (`StoredReportParams` w core). */
export interface StoredParams {
  preset?: ReportPreset;
  from?: string;
  to?: string;
  granularity?: ReportGranularity | null;
  compare?: boolean;
  compareFrom?: string | null;
  compareTo?: string | null;
  zoneId?: string;
  modelId?: string;
  scooterId?: string;
}

export const storedParams = (params: Record<string, unknown>) => params as StoredParams;

/** Pierwsza linia kolumny „Parametry”: okres i granulacja („1–31 paź 2026 · dzień”). */
export function paramsLine(params: StoredParams): string {
  return [
    params.from && params.to ? formatRangeShort(params.from, params.to) : null,
    params.granularity ? t.dynamic(`reports.granularity.${params.granularity}`).toLowerCase() : null,
  ]
    .filter(Boolean)
    .join(' · ');
}

/** Druga linia: porównanie i filtry („porównanie: wrzesień”, „bez porównania · filtr modelu”). */
export function paramsSub(params: StoredParams): string {
  const compare =
    params.compare && params.compareFrom && params.compareTo
      ? t('reports.run.compareWith', {
          period: isWholeMonth(params.compareFrom, params.compareTo)
            ? monthYear.format(localDate(params.compareFrom)).replace(/\s\d{4}$/, '')
            : formatRangeShort(params.compareFrom, params.compareTo),
        })
      : t('reports.run.noCompare');
  const filters = (['zoneId', 'modelId', 'scooterId'] as const)
    .filter((f) => params[f])
    .map((f) => t.dynamic(`reports.run.filter.${f}`));
  return [compare, ...filters].join(' · ');
}

/** Adres podglądu z tym samym okresem (daty bezwzględne, „Otwórz podgląd z tymi parametrami”). */
export function previewHref(code: string, params: StoredParams): string {
  const q = new URLSearchParams();
  if (params.from) q.set('from', params.from);
  if (params.to) q.set('to', params.to);
  if (params.granularity) q.set('granularity', params.granularity);
  if (params.compare === false) q.set('compare', '0');
  for (const f of ['zoneId', 'modelId', 'scooterId'] as const) if (params[f]) q.set(f, params[f]);
  return `${REPORTS_PATHS.report(code)}?${q}`;
}

export const RUN_STATE_PILL: Record<ReportRunState, string> = {
  QUEUED: 'pill sm',
  RUNNING: 'pr-live',
  SUCCEEDED: 'pill accent sm',
  FAILED: 'pill danger sm',
  FILE_DELETED: 'pill muted sm',
};

export function RunState({ state }: { state: ReportRunState }) {
  return <span className={RUN_STATE_PILL[state]}>{t.dynamic(`reports.state.${state}`)}</span>;
}

/** „dziś, 14:32”, „wczoraj, 09:14” albo „17 paź, 12:10”. */
export function formatWhen(iso: string, now = Date.now()): string {
  if (isToday(iso, now)) return t('reports.when.today', { time: formatClock(iso) });
  if (isToday(iso, now - 86_400_000)) return t('reports.when.yesterday', { time: formatClock(iso) });
  return t('reports.when.date', { date: formatDate(iso), time: formatClock(iso) });
}

/** „212 KB”, „1,2 MB”. */
export function formatFileSize(bytes: number): string {
  if (bytes < 1024 * 1024) return t('reports.size.kb', { value: Math.max(1, Math.round(bytes / 1024)) });
  return t('reports.size.mb', { value: formatNumber(bytes / 1024 / 1024, 1) });
}

/**
 * Komunikat błędu raportu: najpierw teksty kodów raportów (`reports.errors.<kod>` ze szczegółami, np. liczbą dni),
 * potem wspólne komunikaty API.
 */
export function reportErrorMessage(error: unknown): string {
  if (error instanceof ApiRequestError && t.has(`reports.errors.${error.code}`)) {
    const details = (error.details ?? {}) as Record<string, unknown>;
    const values: Record<string, string | number> = {};
    for (const [key, value] of Object.entries(details))
      if (typeof value === 'string' || typeof value === 'number') values[key] = value;
    return t.dynamic(`reports.errors.${error.code}`, values);
  }
  return errorMessage(error);
}

/** Opis kodu błędu uruchomienia (`report_runs.error_code`) albo ogólny. */
export const runErrorText = (code: string | null) =>
  code && t.has(`reports.errors.${code}`) ? t.dynamic(`reports.errors.${code}`) : t('reports.errors.other');

/**
 * Pobranie pliku raportu: świeży adres z podpisem (`GET /admin/report-runs/{id}/file`). PDF otwiera się w nowej
 * karcie (otwartej od razu, żeby przeglądarka jej nie zablokowała), XLSX pobiera się bez opuszczania panelu.
 */
export async function openReportFile(run: Pick<ReportRunView, 'id' | 'format'> & { file?: DocumentFileLink | null }) {
  const tab = run.format === 'PDF' ? window.open('', '_blank') : null;
  try {
    const link = linkFresh(run.file) ? run.file : await api<DocumentFileLink>(`/admin/report-runs/${run.id}/file`);
    if (tab) tab.location.href = fileUrl(link.url);
    else window.location.assign(fileUrl(link.url));
  } catch (error) {
    tab?.close();
    throw error;
  }
}
