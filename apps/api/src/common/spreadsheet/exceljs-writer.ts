import { PassThrough, type Writable } from 'node:stream';
import {
  SPREADSHEET_NUMBER_FORMATS,
  writeSpreadsheet,
  type SpreadsheetCell,
  type SpreadsheetColumn,
  type SpreadsheetSheet,
  type SpreadsheetSheetData,
  type SpreadsheetSheetSpec,
  type SpreadsheetWorkbook,
  type SpreadsheetWriter,
} from '@hulajnogi/core';
import ExcelJS from 'exceljs';

/**
 * Adapter portu `SpreadsheetWriter` z core (ADR 0071, ADR 0073; D5): ExcelJS 4.4.0 z zapisem strumieniowym
 * (`stream.xlsx.WorkbookWriter`) do strumienia podanego przy utworzeniu: bufor pliku raportu (`spreadsheetBuffer`)
 * albo odpowiedź HTTP eksportu listy (`createSpreadsheetWriter(reply.raw)`). Wspólny dla raportów i eksportu list,
 * dlatego leży w `common`. Wartości przychodzą już przeliczone w core (kwoty w złotych, daty z polami równymi czasowi
 * polskiemu, bo ExcelJS zapisuje daty jako UTC, czas trwania jako ułamek doby); adapter dokłada format liczby z typu
 * kolumny, pogrubiony i zamrożony wiersz nagłówka, autofiltr i pogrubiony wiersz „Razem”.
 */
const DEFAULT_WIDTH: Record<SpreadsheetColumn['type'], number> = {
  text: 24,
  integer: 12,
  decimal: 12,
  money: 16,
  percent: 12,
  date: 12,
  datetime: 18,
  duration: 12,
  distance: 12,
  boolean: 10,
};

const columnWidth = (column: SpreadsheetColumn): number =>
  column.width ?? Math.min(60, Math.max(DEFAULT_WIDTH[column.type], column.header.length + 2));

/** Litera kolumny Excela (1 → A, 27 → AA) do zakresu autofiltru. */
export function columnLetter(index: number): string {
  let n = index;
  let out = '';
  while (n > 0) {
    const rem = (n - 1) % 26;
    out = String.fromCharCode(65 + rem) + out;
    n = Math.floor((n - 1) / 26);
  }
  return out;
}

class ExcelSheet implements SpreadsheetSheet {
  constructor(private readonly sheet: ExcelJS.Worksheet) {}

  addRow(cells: readonly SpreadsheetCell[]): void {
    this.sheet.addRow([...cells]).commit();
  }

  addTotalRow(cells: readonly SpreadsheetCell[]): void {
    const row = this.sheet.addRow([...cells]);
    row.font = { bold: true };
    row.commit();
  }

  commit(): Promise<void> {
    this.sheet.commit();
    return Promise.resolve();
  }
}

class ExcelWorkbook implements SpreadsheetWorkbook {
  constructor(private readonly workbook: ExcelJS.stream.xlsx.WorkbookWriter) {}

  addSheet(spec: SpreadsheetSheetSpec): SpreadsheetSheet {
    const sheet = this.workbook.addWorksheet(spec.name, { views: [{ state: 'frozen', ySplit: 1 }] });
    sheet.columns = spec.columns.map((column) => {
      const numFmt = column.numFmt ?? SPREADSHEET_NUMBER_FORMATS[column.type];
      return {
        header: column.header,
        key: column.key,
        width: columnWidth(column),
        ...(numFmt ? { style: { numFmt } } : {}),
      };
    });
    if (spec.columns.length) {
      sheet.autoFilter = `A1:${columnLetter(spec.columns.length)}1`;
      const header = sheet.getRow(1);
      header.font = { bold: true };
    }
    return new ExcelSheet(sheet);
  }

  commit(): Promise<void> {
    return this.workbook.commit();
  }
}

/** Skoroszyt zapisywany strumieniowo do `stream` (np. `reply.raw` eksportu listy albo `PassThrough`). */
export function createSpreadsheetWriter(stream: Writable): SpreadsheetWriter {
  return {
    workbook(meta) {
      const workbook = new ExcelJS.stream.xlsx.WorkbookWriter({ stream, useStyles: true, useSharedStrings: false });
      workbook.creator = meta.creator;
      workbook.title = meta.title;
      workbook.created = meta.createdAt;
      workbook.modified = meta.createdAt;
      return new ExcelWorkbook(workbook);
    },
  };
}

/** Cały plik XLSX w pamięci (plik raportu do magazynu; raport ma najwyżej kilka tysięcy wierszy). */
export async function spreadsheetBuffer(
  sheets: readonly SpreadsheetSheetData[],
  meta: { title: string; creator: string; createdAt: Date },
): Promise<Buffer> {
  const stream = new PassThrough();
  const chunks: Buffer[] = [];
  stream.on('data', (chunk: Buffer) => chunks.push(chunk));
  const finished = new Promise<void>((resolve, reject) => {
    stream.on('end', resolve);
    stream.on('error', reject);
  });
  await writeSpreadsheet(createSpreadsheetWriter(stream).workbook(meta), sheets);
  await finished;
  return Buffer.concat(chunks);
}
