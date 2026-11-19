import type { Permission } from '../access/permissions.js';
import { DomainError } from '../errors.js';
import { isJobAbandoned, isJobClaimable, type JobStatus, type PermissionSet } from '../documents/prints.js';
import {
  isReportCode,
  REPORT_CATALOG,
  REPORT_CODES,
  REPORT_LIMITS,
  type ReportCode,
  type ReportFormat,
} from './catalog.js';
import type { LocalDate } from './dates.js';
import type { ReportPreset, ResolvedReportParams } from './params.js';

/**
 * Uruchomienia raportów (ADR 0071): kto widzi raport, historię i plik, stan „Plik usunięty”, ponowienie, porządki
 * i retencja, nazwy i klucze plików oraz kody błędów. Raporty nie mają danych osobowych, więc bez maskowania.
 */
export const REPORT_ERROR_CODES = [
  /** Nieznany kod raportu, raport wyłączony (`active = false`) albo brak uprawnienia do niego (404, nie 403 w API). */
  'REPORT_NOT_FOUND',
  /** Uruchomienie nie istnieje albo dotyczy raportu bez uprawnienia operatora. */
  'REPORT_RUN_NOT_FOUND',
  'REPORT_RANGE_TOO_LONG',
  'REPORT_RANGE_INVALID',
  'REPORT_RANGE_IN_FUTURE',
  'REPORT_PARAM_NOT_SUPPORTED',
  'REPORT_FORMAT_NOT_ALLOWED',
  /** Eksport pustego raportu (plansza `raport-stany`). */
  'REPORT_EMPTY',
  /** Przekroczony limit czasu zapytań (`statement_timeout`) podglądu albo zadania. */
  'REPORT_TIMEOUT',
  /** Przekroczony limit renderu PDF (60 s). */
  'REPORT_RENDER_TIMEOUT',
  /** Gotenberg niedostępny (zadanie ponawia). */
  'RENDERER_UNAVAILABLE',
  /** Pobranie pliku po retencji (stan „Plik usunięty”). */
  'REPORT_FILE_DELETED',
  /** Pobranie pliku uruchomienia, które nie zakończyło się sukcesem. */
  'REPORT_RUN_NOT_READY',
  /** „Ponów” uruchomienia w kolejce albo w toku. */
  'REPORT_RUN_NOT_RETRYABLE',
  /** Inny błąd zadania (`report_runs.error_code` w wierszach sprzed migracji 0013). */
  'REPORT_FAILED',
] as const;
export type ReportErrorCode = (typeof REPORT_ERROR_CODES)[number];

/** Raport dostępny dla operatora: znany kod i uprawnienie `reports.<kod>` (aktywność definicji sprawdza API). */
export function ensureCanUseReport(permissions: PermissionSet, code: string): ReportCode {
  if (!isReportCode(code) || !permissions.has(REPORT_CATALOG[code].permission))
    throw new DomainError('REPORT_NOT_FOUND', { code });
  return code;
}

/** Raporty, które operator widzi w katalogu i historii (filtr `report_code` listy uruchomień). */
export const visibleReportCodes = (permissions: PermissionSet): ReportCode[] =>
  REPORT_CODES.filter((code) => permissions.has(REPORT_CATALOG[code].permission));

/** Zakładka Definicje: `reports.manage`. */
export const REPORT_MANAGE_PERMISSION: Permission = 'reports.manage';

/** Format z definicji raportu (`report_definitions.formats`), inaczej `REPORT_FORMAT_NOT_ALLOWED`. */
export function ensureReportFormat(code: ReportCode, format: string, allowed: readonly string[]): ReportFormat {
  const catalog = REPORT_CATALOG[code].formats as readonly string[];
  if (!catalog.includes(format) || !allowed.includes(format))
    throw new DomainError('REPORT_FORMAT_NOT_ALLOWED', { code, format });
  return format as ReportFormat;
}

/** Eksport pustego raportu jest wyłączony (`409 REPORT_EMPTY`). */
export function ensureReportNotEmpty(model: { code: ReportCode; empty: boolean }): void {
  if (model.empty) throw new DomainError('REPORT_EMPTY', { code: model.code });
}

export const REPORT_RUN_STATES = ['QUEUED', 'RUNNING', 'SUCCEEDED', 'FAILED', 'FILE_DELETED'] as const;
export type ReportRunState = (typeof REPORT_RUN_STATES)[number];

/** Stan w historii jak `v_report_run_list.state`: „Plik usunięty” to `SUCCEEDED` z `file_deleted_at`. */
export const reportRunState = (run: { status: JobStatus; fileDeletedAt: Date | null }): ReportRunState =>
  run.status === 'SUCCEEDED' && run.fileDeletedAt ? 'FILE_DELETED' : run.status;

export interface ReportRunAccess {
  id: string;
  reportCode: string;
  status: JobStatus;
  fileId: string | null;
  fileDeletedAt: Date | null;
}

/**
 * Szczegóły uruchomienia i jego plik: `reports.<kod>` raportu uruchomienia, także cudzego (pytanie 7). Brak
 * uprawnienia daje `REPORT_RUN_NOT_FOUND`, żeby nie zdradzać istnienia uruchomienia.
 */
export function ensureCanSeeReportRun(permissions: PermissionSet, run: Pick<ReportRunAccess, 'id' | 'reportCode'>) {
  if (!isReportCode(run.reportCode) || !permissions.has(REPORT_CATALOG[run.reportCode].permission))
    throw new DomainError('REPORT_RUN_NOT_FOUND', { id: run.id });
}

/** Pobranie pliku: dostęp do uruchomienia, stan `SUCCEEDED` i plik przed retencją. Zwraca identyfikator pliku. */
export function ensureReportFileDownloadable(permissions: PermissionSet, run: ReportRunAccess): string {
  ensureCanSeeReportRun(permissions, run);
  if (run.status !== 'SUCCEEDED') throw new DomainError('REPORT_RUN_NOT_READY', { id: run.id, status: run.status });
  if (run.fileDeletedAt || !run.fileId) throw new DomainError('REPORT_FILE_DELETED', { id: run.id });
  return run.fileId;
}

/**
 * „Ponów” (błąd) i „Uruchom ponownie z tymi parametrami” (gotowy albo plik usunięty) tworzą nowy wiersz z `retry_of`;
 * uruchomienie w toku nie ma ponowienia (`REPORT_RUN_NOT_RETRYABLE`).
 */
export function ensureReportRunRetryable(run: Pick<ReportRunAccess, 'id' | 'status'>): void {
  if (run.status === 'QUEUED' || run.status === 'RUNNING')
    throw new DomainError('REPORT_RUN_NOT_RETRYABLE', { id: run.id, status: run.status });
}

export interface ReportJobRow {
  status: JobStatus;
  startedAt: Date | null;
  createdAt: Date;
}

/** Zadanie `report.generate`: wiersz `QUEUED` albo porzucony `RUNNING` (po limicie wykonania 120 s). */
export const shouldRunReportJob = (row: Pick<ReportJobRow, 'status' | 'startedAt'>, now: Date): boolean =>
  isJobClaimable(row, now, REPORT_LIMITS.jobExpireMs);

/** `reports.sweep`: `QUEUED` i `RUNNING` starsze niż 15 min kończą się `FAILED` z `REPORT_TIMEOUT`. */
export const isReportRunAbandoned = (row: ReportJobRow, now: Date): boolean =>
  isJobAbandoned(row, now, REPORT_LIMITS.abandonedMs);

/** `reports.retention`: plik gotowego raportu starszy niż 30 dni. */
export const reportFileExpired = (
  run: { status: JobStatus; finishedAt: Date | null; fileDeletedAt: Date | null },
  now: Date,
): boolean =>
  run.status === 'SUCCEEDED' &&
  run.finishedAt !== null &&
  run.fileDeletedAt === null &&
  now.getTime() - run.finishedAt.getTime() > REPORT_LIMITS.fileRetentionMs;

/** Ponawialne błędy zadania: tylko niedostępny silnik dokumentów. */
export const isRetryableReportError = (code: string): boolean => code === 'RENDERER_UNAVAILABLE';

/** Błąd renderu z kodu silnika dokumentów (`renderErrorCode`) na kod uruchomienia raportu. */
export function reportRenderErrorCode(code: string): ReportErrorCode {
  if (code === 'RENDER_TIMEOUT') return 'REPORT_RENDER_TIMEOUT';
  if (code === 'RENDERER_UNAVAILABLE') return 'RENDERER_UNAVAILABLE';
  return 'REPORT_FAILED';
}

// --- Pliki ---------------------------------------------------------------------------------------------

export const REPORT_CONTENT_TYPES: Record<ReportFormat, string> = {
  PDF: 'application/pdf',
  XLSX: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
};

/** Identyfikator uruchomienia ze stopki pliku i z historii (pierwsze 8 znaków uuid, jak `v_report_run_list.short_id`). */
export const shortReportRunId = (id: string): string => id.slice(0, 8).toLowerCase();

const MONTHLY_PRESETS: readonly ReportPreset[] = ['this_month', 'previous_month'];

/**
 * Nazwa pliku `<kod>-<okres>.<pdf|xlsx>`: miesiąc `revenue-2026-10.pdf` przy zakresie miesięcznym od pierwszego dnia,
 * doba `revenue-2026-10-24.pdf`, inaczej `revenue-2026-10-01_2026-10-14.pdf`. Kod raportu z podkreśleniem zamienia
 * się na łącznik (`fleet-usage-2026-10.xlsx`).
 */
export function reportFileName(
  params: Pick<ResolvedReportParams, 'code' | 'range' | 'preset'>,
  format: ReportFormat,
): string {
  const { from, to } = params.range;
  const monthly =
    from.endsWith('-01') &&
    from.slice(0, 7) === to.slice(0, 7) &&
    (MONTHLY_PRESETS.includes(params.preset) || isMonthEnd(to));
  const period = from === to ? from : monthly ? from.slice(0, 7) : `${from}_${to}`;
  return `${params.code.replace(/_/g, '-')}-${period}.${format.toLowerCase()}`;
}

function isMonthEnd(date: LocalDate): boolean {
  const [y, m, d] = date.split('-').map(Number) as [number, number, number];
  return new Date(Date.UTC(y, m, 0)).getUTCDate() === d;
}

/** Klucz pliku w magazynie `report/{rrrr}/{mm}/{uuid}.{pdf|xlsx}` (czas UTC, jak wydruki). */
export function reportFileKey(id: string, format: ReportFormat, at: Date): string {
  return `report/${at.getUTCFullYear()}/${String(at.getUTCMonth() + 1).padStart(2, '0')}/${id}.${format.toLowerCase()}`;
}
