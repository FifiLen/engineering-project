import { formatDocumentDateTime } from '../documents/format.js';
import { REPORT_CATALOG, type ReportColumnSpec, type ReportValueKind } from './catalog.js';
import { warsawWallClock } from './dates.js';
import type { ReportModel, ReportTableModel, ReportValue } from './model.js';
import { shortReportRunId } from './runs.js';
import type { ResolvedReportParams } from './params.js';

/**
 * Port arkusza XLSX (ADR 0071, ADR 0073; D5): adapter w API (ExcelJS 4.4.0, `stream.xlsx.WorkbookWriter`) zapisuje
 * skoroszyt strumieniowo do celu wskazanego przy jego utworzeniu (bufor pliku raportu albo odpowiedź HTTP eksportu
 * listy). Core opisuje arkusze, kolumny z typem i wiersze z wartościami już przeliczonymi: kwoty w złotych jako
 * liczby, daty jako daty z polami równymi czasowi polskiemu, czas trwania jako ułamek doby. Zamrożony wiersz
 * nagłówka i autofiltr ustawia adapter na każdym arkuszu.
 */
export const SPREADSHEET_CELL_TYPES = [
  'text',
  'integer',
  'decimal',
  'money',
  'percent',
  'date',
  'datetime',
  'duration',
  'distance',
  'boolean',
] as const;
export type SpreadsheetCellType = (typeof SPREADSHEET_CELL_TYPES)[number];

/** Formaty liczb Excela według typu komórki (kwoty `#,##0.00 "zł"`, daty `dd.mm.yyyy hh:mm`, ADR 0071). */
export const SPREADSHEET_NUMBER_FORMATS: Record<SpreadsheetCellType, string | null> = {
  text: null,
  integer: '#,##0',
  decimal: '#,##0.0#',
  money: '#,##0.00 "zł"',
  percent: '0.0%',
  date: 'dd.mm.yyyy',
  datetime: 'dd.mm.yyyy hh:mm',
  duration: '[h]:mm:ss',
  distance: '#,##0.0 "km"',
  boolean: null,
};

/** Wartość komórki po przeliczeniu (`Date` z polami UTC w czasie polskim). */
export type SpreadsheetCell = string | number | boolean | Date | null;

export interface SpreadsheetColumn {
  key: string;
  header: string;
  type: SpreadsheetCellType;
  /** Format liczby, gdy inny niż domyślny dla typu (np. liczba miejsc po przecinku). */
  numFmt?: string;
  /** Szerokość w znakach (adapter dobiera domyślną). */
  width?: number;
}

export interface SpreadsheetSheetSpec {
  /** Nazwa arkusza (najwyżej 31 znaków, bez `[]:*?/\`; `spreadsheetSheetName` ją poprawia). */
  name: string;
  columns: SpreadsheetColumn[];
}

export interface SpreadsheetSheet {
  /** Wiersz w kolejności kolumn arkusza. */
  addRow(cells: readonly SpreadsheetCell[]): void | Promise<void>;
  /** Wiersz sumy pogrubiony (`Razem`). */
  addTotalRow?(cells: readonly SpreadsheetCell[]): void | Promise<void>;
  commit(): Promise<void>;
}

export interface SpreadsheetWorkbook {
  addSheet(sheet: SpreadsheetSheetSpec): SpreadsheetSheet;
  /** Kończy zapis skoroszytu (dla celu strumieniowego po ostatnim wierszu). */
  commit(): Promise<void>;
}

export interface SpreadsheetWriter {
  workbook(meta: { title: string; creator: string; createdAt: Date }): SpreadsheetWorkbook;
}

const SHEET_FORBIDDEN = /[[\]:*?/\\]/g;

/** Nazwa arkusza Excela: bez znaków zabronionych, najwyżej 31 znaków, unikalna w skoroszycie. */
export function spreadsheetSheetName(name: string, taken: ReadonlySet<string> = new Set()): string {
  const base = name.replace(SHEET_FORBIDDEN, ' ').replace(/\s+/g, ' ').trim().slice(0, 31) || 'Arkusz';
  let candidate = base;
  for (let n = 2; taken.has(candidate.toLowerCase()); n++)
    candidate = `${base.slice(0, 31 - String(n).length - 1)} ${n}`;
  return candidate;
}

const DAY_SECONDS = 86_400;

/** Rodzaj wartości raportu na typ komórki. */
export function reportCellType(kind: ReportValueKind, decimals?: number): SpreadsheetCellType {
  switch (kind) {
    case 'money':
      return 'money';
    case 'number':
      return decimals ? 'decimal' : 'integer';
    case 'duration':
      return 'duration';
    case 'distance':
      return 'distance';
    case 'percent':
      return 'percent';
    case 'date':
      return 'date';
    case 'text':
      return 'text';
  }
}

/**
 * Wartość komórki z wartości raportu: kwota z groszy na złote, czas trwania z sekund na ułamek doby (format
 * `[h]:mm:ss`), dystans z metrów na kilometry, data `RRRR-MM-DD` na datę Excela (północ, bez strefy).
 */
export function spreadsheetValue(type: SpreadsheetCellType, value: ReportValue | boolean | Date): SpreadsheetCell {
  if (value === null || value === undefined) return null;
  switch (type) {
    case 'money':
      return typeof value === 'number' ? value / 100 : null;
    case 'duration':
      return typeof value === 'number' ? value / DAY_SECONDS : null;
    case 'distance':
      return typeof value === 'number' ? value / 1000 : null;
    case 'date':
      if (value instanceof Date) return warsawWallClock(value);
      if (typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value)) {
        const [y, m, d] = value.split('-').map(Number) as [number, number, number];
        return new Date(Date.UTC(y, m - 1, d));
      }
      return null;
    case 'datetime':
      if (value instanceof Date) return warsawWallClock(value);
      return typeof value === 'string' && !Number.isNaN(Date.parse(value)) ? warsawWallClock(new Date(value)) : null;
    case 'integer':
    case 'decimal':
    case 'percent':
      return typeof value === 'number' ? value : null;
    case 'boolean':
      return typeof value === 'boolean' ? value : null;
    case 'text':
      return typeof value === 'string' ? value : String(value);
  }
}

function columnsOf(columns: readonly ReportColumnSpec[]): SpreadsheetColumn[] {
  return columns.map((c) => {
    const type = reportCellType(c.kind, c.decimals);
    const column: SpreadsheetColumn = { key: c.key, header: c.label, type };
    if (c.decimals !== undefined && (type === 'decimal' || type === 'percent'))
      column.numFmt =
        type === 'percent' ? `0.${'0'.repeat(Math.max(1, c.decimals))}%` : `#,##0.${'0'.repeat(c.decimals)}`;
    return column;
  });
}

export interface ReportWorkbookContext {
  runId: string;
  /** Nazwa i opis z `report_definitions` (treść z panelu). */
  name: string;
  description: string | null;
  params: ResolvedReportParams;
  /** Teksty parametrów do arkusza „Parametry” (okres, porównanie, granulacja, filtry) budowane przez API. */
  paramLabels: Array<{ label: string; value: string }>;
  dataAsOf: Date;
  generatedAt: Date;
  requestedBy: string;
  companyName: string;
}

export interface SpreadsheetSheetData {
  spec: SpreadsheetSheetSpec;
  rows: SpreadsheetCell[][];
  totals: SpreadsheetCell[] | null;
}

function tableSheet(table: ReportTableModel, taken: Set<string>): SpreadsheetSheetData {
  const columns = columnsOf(table.columns);
  const name = spreadsheetSheetName(table.sheetName, taken);
  taken.add(name.toLowerCase());
  const cells = (record: Record<string, ReportValue>) =>
    columns.map((c) => spreadsheetValue(c.type, record[c.key] ?? null));
  return {
    spec: { name, columns },
    rows: table.rows.map((r) => cells(r.cells)),
    totals: table.totals ? cells(table.totals) : null,
  };
}

/**
 * Arkusze pliku XLSX raportu: „Parametry” (raport, opis, parametry, chwila danych, zlecający, identyfikator) i arkusz
 * na każdą tabelę modelu z pełnymi danymi (bez obcięcia z PDF).
 */
export function reportWorkbookSheets(model: ReportModel, ctx: ReportWorkbookContext): SpreadsheetSheetData[] {
  const taken = new Set<string>(['parametry']);
  const spec = REPORT_CATALOG[model.code];
  const parameters: SpreadsheetSheetData = {
    spec: {
      name: 'Parametry',
      columns: [
        { key: 'label', header: 'Parametr', type: 'text', width: 28 },
        { key: 'value', header: 'Wartość', type: 'text', width: 60 },
      ],
    },
    rows: [
      ['Raport', ctx.name],
      ['Opis', ctx.description ?? ''],
      ['Firma', ctx.companyName],
      ...ctx.paramLabels.map((p): SpreadsheetCell[] => [p.label, p.value]),
      ['Strefa czasowa', 'Europe/Warsaw'],
      ['Dane na', formatDocumentDateTime(ctx.dataAsOf)],
      ['Wygenerowano', formatDocumentDateTime(ctx.generatedAt)],
      ['Zlecił', ctx.requestedBy],
      ['Identyfikator uruchomienia', shortReportRunId(ctx.runId)],
      ['Kod raportu', spec.code],
    ],
    totals: null,
  };
  return [parameters, ...model.tables.map((t) => tableSheet(t, taken))];
}

/** Zapis arkuszy przez port (wspólny dla raportu i testów adaptera). */
export async function writeSpreadsheet(workbook: SpreadsheetWorkbook, sheets: readonly SpreadsheetSheetData[]) {
  for (const data of sheets) {
    const sheet = workbook.addSheet(data.spec);
    for (const cells of data.rows) await sheet.addRow(cells);
    if (data.totals) await (sheet.addTotalRow ?? sheet.addRow).call(sheet, data.totals);
    await sheet.commit();
  }
  await workbook.commit();
}
