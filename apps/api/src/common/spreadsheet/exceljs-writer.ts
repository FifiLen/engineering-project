import type { Writable } from 'node:stream';
import {
  SPREADSHEET_NUMBER_FORMATS,
  type SpreadsheetCell,
  type SpreadsheetCellType,
  type SpreadsheetColumn,
  type SpreadsheetSheet,
  type SpreadsheetSheetSpec,
  type SpreadsheetWorkbook,
  type SpreadsheetWriter,
} from '@hulajnogi/core';
import ExcelJS from 'exceljs';

/** Domyślna szerokość kolumny w znakach według typu komórki (gdy specyfikacja jej nie podaje). */
const DEFAULT_WIDTHS: Record<SpreadsheetCellType, number> = {
  text: 24,
  integer: 12,
  decimal: 12,
  money: 14,
  percent: 10,
  date: 12,
  datetime: 17,
  duration: 12,
  distance: 12,
  boolean: 8,
};

/** Litera kolumny Excela (1 → A, 27 → AA) do zakresu autofiltra. */
function columnLetter(index: number): string {
  let n = index;
  let letters = '';
  while (n > 0) {
    const rest = (n - 1) % 26;
    letters = String.fromCharCode(65 + rest) + letters;
    n = Math.floor((n - 1) / 26);
  }
  return letters;
}

/**
 * Adapter portu `SpreadsheetWriter` (ADR 0071, ADR 0073; D5) na ExcelJS 4.4.0 `stream.xlsx.WorkbookWriter`: skoroszyt
 * zapisuje się strumieniowo do celu podanego przy utworzeniu adaptera (odpowiedź HTTP eksportu listy albo bufor pliku
 * raportu), wiersz po wierszu, bez trzymania arkusza w pamięci. Każdy arkusz ma pogrubiony i zamrożony wiersz
 * nagłówka oraz autofiltr; formaty liczb i dat pochodzą z `SPREADSHEET_NUMBER_FORMATS` w core. Daty przychodzą z core
 * z polami UTC równymi czasowi polskiemu (`warsawWallClock`), bo ExcelJS zapisuje datę jako numer seryjny z czasu UTC.
 * Tekst trafia do komórki jako tekst (nie formuła): ExcelJS tworzy formułę tylko z obiektu `{ formula }`.
 */
export function excelJsWriter(target: Writable): SpreadsheetWriter {
  return {
    workbook(meta): SpreadsheetWorkbook {
      const workbook = new ExcelJS.stream.xlsx.WorkbookWriter({
        stream: target,
        useStyles: true,
        useSharedStrings: false,
      });
      workbook.creator = meta.creator;
      workbook.lastModifiedBy = meta.creator;
      workbook.created = meta.createdAt;
      workbook.modified = meta.createdAt;
      workbook.title = meta.title;
      return {
        addSheet: (spec) => sheetWriter(workbook, spec),
        async commit() {
          await workbook.commit();
        },
      };
    },
  };
}

function sheetWriter(workbook: ExcelJS.stream.xlsx.WorkbookWriter, spec: SpreadsheetSheetSpec): SpreadsheetSheet {
  const columns = spec.columns;
  const sheet = workbook.addWorksheet(spec.name, { views: [{ state: 'frozen', ySplit: 1, xSplit: 0 }] });
  sheet.columns = columns.map((column: SpreadsheetColumn) => {
    const numFmt = column.numFmt ?? SPREADSHEET_NUMBER_FORMATS[column.type];
    return {
      key: column.key,
      header: column.header,
      width: column.width ?? Math.max(DEFAULT_WIDTHS[column.type], Math.min(column.header.length + 2, 40)),
      ...(numFmt ? { style: { numFmt } } : {}),
    };
  });
  if (columns.length) {
    sheet.autoFilter = `A1:${columnLetter(columns.length)}1`;
    const header = sheet.getRow(1);
    header.font = { bold: true };
    header.commit();
  }
  const write = (cells: readonly SpreadsheetCell[], bold: boolean) => {
    const row = sheet.addRow(cells.map((cell) => cell ?? null));
    if (bold) row.font = { bold: true };
    row.commit();
  };
  return {
    addRow: (cells) => write(cells, false),
    addTotalRow: (cells) => write(cells, true),
    async commit() {
      sheet.commit();
    },
  };
}
