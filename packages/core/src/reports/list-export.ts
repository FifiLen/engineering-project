import { DomainError } from '../errors.js';
import { formatDocumentNumber } from '../documents/format.js';
import { localDateOf, warsawWallClock } from './dates.js';
import { spreadsheetSheetName, spreadsheetValue, type SpreadsheetCell, type SpreadsheetColumn } from './spreadsheet.js';

/**
 * Eksport list do XLSX i CSV (ADR 0073): `POST /admin/{zasób}/export` z zapytaniem listy, formatem i kolumnami
 * z etykietami z panelu. Reguły tutaj: limit wierszy, typ komórki z definicji pola, ochrona przed wstrzyknięciem
 * formuł, kodowanie CSV (UTF-8 z BOM, średnik, przecinek dziesiętny, CRLF, RFC 4180) i nazwa pliku.
 */
export const LIST_EXPORT_LIMIT = 50_000;
/** Telemetria eksportuje zakres najwyżej 24 h (17 280 odczytów co 5 s, ADR 0076). */
export const TELEMETRY_EXPORT_LIMIT = 17_280;
/** Partia odczytu w transakcji `REPEATABLE READ READ ONLY`. */
export const LIST_EXPORT_BATCH = 1000;

export const LIST_EXPORT_FORMATS = ['xlsx', 'csv'] as const;
export type ListExportFormat = (typeof LIST_EXPORT_FORMATS)[number];

export const LIST_EXPORT_CONTENT_TYPES: Record<ListExportFormat, string> = {
  xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  csv: 'text/csv; charset=utf-8',
};

/**
 * Najwięcej eksportów list naraz w jednej instancji API: każdy trzyma połączenie z puli na czas transakcji odczytu,
 * więc kolejny dostaje `429 LIST_EXPORT_BUSY` z `details: { limit, retryAfterSeconds }` zamiast czekać na połączenie.
 */
export const LIST_EXPORT_CONCURRENCY = 3;

/** Wolne miejsce na eksport albo `LIST_EXPORT_BUSY` (429 z nagłówkiem `Retry-After`). */
export function ensureListExportSlot(active: number, limit: number = LIST_EXPORT_CONCURRENCY): void {
  if (active >= limit) throw new DomainError('LIST_EXPORT_BUSY', { limit, retryAfterSeconds: 5 });
}

/** Powyżej limitu `LIST_EXPORT_LIMIT` (422) z `details: { count, limit }`; panel wyłącza przycisk przy `total`. */
export function ensureListExportWithinLimit(count: number, limit: number = LIST_EXPORT_LIMIT): void {
  if (count > limit) throw new DomainError('LIST_EXPORT_LIMIT', { count, limit });
}

/** Typ pola z definicji zasobu (`FieldDefinition` w packages/shared). */
export type ListFieldType = 'text' | 'integer' | 'decimal' | 'boolean' | 'enum' | 'datetime' | 'uuid';

export interface ListExportColumn {
  field: string;
  /** Etykieta z panelu (do 80 znaków, ADR 0073). */
  label: string;
  type: ListFieldType;
  money?: boolean;
  /** Teksty wartości pola `enum` z panelu; brakująca wartość zostaje kodem. */
  values?: Readonly<Record<string, string>>;
  array?: boolean;
}

/**
 * Tekst zaczynający się od `=`, `+`, `-`, `@`, tabulatora albo powrotu karetki dostaje apostrof z przodu: arkusz
 * nie potraktuje go jako formuły. Liczby (także ujemne) zostają liczbami, więc tej zmiany nie dostają.
 */
export function protectFormula(text: string): string {
  return /^[=+\-@\t\r]/.test(text) ? `'${text}` : text;
}

function enumText(column: ListExportColumn, value: unknown): string {
  return column.values?.[String(value)] ?? String(value);
}

/** Kolumna arkusza dla pola listy. */
export function listSpreadsheetColumn(column: ListExportColumn): SpreadsheetColumn {
  const type =
    column.array || column.type === 'text' || column.type === 'enum' || column.type === 'uuid'
      ? 'text'
      : column.type === 'integer'
        ? column.money
          ? 'money'
          : 'integer'
        : column.type;
  return { key: column.field, header: column.label, type };
}

/** Wartość komórki XLSX: liczby jako liczby, kwoty w złotych, daty w czasie polskim, tekst jako tekst. */
export function listCellValue(column: ListExportColumn, value: unknown): SpreadsheetCell {
  if (value === null || value === undefined) return null;
  if (column.array && Array.isArray(value)) return value.map((v) => enumText(column, v)).join(', ');
  const type = listSpreadsheetColumn(column).type;
  if (column.type === 'enum') return enumText(column, value);
  if (type === 'text') return String(value);
  if (type === 'datetime') return spreadsheetValue('datetime', value instanceof Date ? value : String(value));
  if (type === 'boolean') return Boolean(value);
  const n = typeof value === 'number' ? value : Number(value);
  return Number.isFinite(n) ? spreadsheetValue(type, n) : null;
}

const pad = (n: number) => String(n).padStart(2, '0');

/** Data i czas CSV `dd.mm.rrrr gg:mm` w czasie polskim. */
export function csvDateTime(at: Date): string {
  const w = warsawWallClock(at);
  return `${pad(w.getUTCDate())}.${pad(w.getUTCMonth() + 1)}.${w.getUTCFullYear()} ${pad(w.getUTCHours())}:${pad(w.getUTCMinutes())}`;
}

/** Tekst komórki CSV: kwoty z przecinkiem dziesiętnym bez separatora tysięcy, `tak`/`nie`, daty po polsku. */
export function csvCellText(
  column: ListExportColumn,
  value: unknown,
  texts: { yes: string; no: string } = { yes: 'tak', no: 'nie' },
): string {
  if (value === null || value === undefined) return '';
  if (column.array && Array.isArray(value)) return protectFormula(value.map((v) => enumText(column, v)).join(', '));
  switch (column.type) {
    case 'enum':
      return protectFormula(enumText(column, value));
    case 'boolean':
      return value ? texts.yes : texts.no;
    case 'datetime':
      return csvDateTime(value instanceof Date ? value : new Date(String(value)));
    case 'integer': {
      const n = Number(value);
      return column.money ? formatDecimalComma(n / 100, 2) : String(n);
    }
    case 'decimal':
      return String(Number(value)).replace('.', ',');
    case 'text':
    case 'uuid':
      return protectFormula(String(value));
  }
}

function formatDecimalComma(value: number, digits: number): string {
  return formatDocumentNumber(value, digits).replace(/\s/g, '');
}

/** Pole CSV według RFC 4180: cudzysłów, gdy zawiera średnik, cudzysłów albo koniec wiersza. */
export function csvField(text: string): string {
  return /[";\r\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

/** Wiersz CSV ze średnikiem i CRLF. */
export const csvLine = (fields: readonly string[]): string => `${fields.map(csvField).join(';')}\r\n`;

/** Znacznik kolejności bajtów UTF-8 na początku pliku CSV (polski Excel rozpoznaje kodowanie). */
export const CSV_BOM = '﻿';

/** Nazwa pliku `{zasób}-{rrrr-mm-dd-ggmm}.{xlsx|csv}` w czasie polskim. */
export function listExportFileName(resource: string, format: ListExportFormat, at: Date): string {
  const w = warsawWallClock(at);
  return `${resource}-${localDateOf(at)}-${pad(w.getUTCHours())}${pad(w.getUTCMinutes())}.${format}`;
}

/** Nazwa arkusza eksportu listy: nazwa zasobu (ADR 0073). */
export const listExportSheetName = (resource: string): string => spreadsheetSheetName(resource);
