import { once } from 'node:events';
import { PassThrough } from 'node:stream';
import {
  CSV_BOM,
  csvCellText,
  csvLine,
  DomainError,
  ensureListExportSlot,
  ensureListExportWithinLimit,
  LIST_EXPORT_BATCH,
  LIST_EXPORT_CONCURRENCY,
  LIST_EXPORT_CONTENT_TYPES,
  LIST_EXPORT_LIMIT,
  listCellValue,
  listExportFileName,
  listExportSheetName,
  listSpreadsheetColumn,
  protectFormula,
  type ListExportColumn as ExportColumn,
} from '@hulajnogi/core';
import { type Database, type DbExecutor, listPages } from '@hulajnogi/db';
import {
  exportListParams,
  parseListQuery,
  validateExportColumns,
  type FieldDefinition,
  type ListExportRequest,
  type ListQuery,
  type ListResponse,
  type ResourceDefinition,
} from '@hulajnogi/shared';
import { HttpStatus, Inject, Injectable, Logger } from '@nestjs/common';
import type { FastifyReply } from 'fastify';
import { AuditedTransaction } from '../../audit/audited-transaction.js';
import { DB } from '../../database/database.module.js';
import { ApiError } from '../api-error.js';
import { createSpreadsheetWriter } from '../spreadsheet/exceljs-writer.js';

/** Funkcja listy zasobu z wykonawcą zapytań: ta sama co w `GET` listy, ale w transakcji eksportu. */
export type ExportListFn<T> = (db: DbExecutor, query: ListQuery) => Promise<ListResponse<T>>;

export interface ExportJob<T> {
  staffId: string;
  /** Nazwa zasobu: nazwa pliku i arkusza, zasób we wpisie `list.exported`. */
  resource: string;
  /** Pola z typami (kolumny eksportu muszą być polami definicji). */
  def: ResourceDefinition;
  request: ListExportRequest;
  /** Zapytanie do wpisu w dzienniku audytu (filtry, wyszukiwanie, sortowanie albo zakres telemetrii). */
  query: Record<string, unknown>;
  limit?: number;
  /** Liczba wierszy przed otwarciem transakcji odczytu (limit i `rowCount` wpisu w dzienniku audytu). */
  count(db: DbExecutor): Promise<number>;
  /** Strony w stałej kolejności z transakcji `REPEATABLE READ READ ONLY`. */
  pages(tx: DbExecutor): AsyncIterable<readonly T[]>;
}

const READ_ONLY = { isolationLevel: 'repeatable read', accessMode: 'read only' } as const;

/**
 * Eksport list do XLSX i CSV (ADR 0073). Każdy kontroler listy wystawia `POST /admin/{zasób}/export` i woła `list`
 * z tą samą funkcją listy co `GET`, więc plik ma te same wiersze, kolejność, warunek stały i maskowanie danych
 * klienta. Kolejność kroków: miejsce w limicie równoległych eksportów (`429 LIST_EXPORT_BUSY`), kolumny z definicji
 * zasobu, zapytanie listy z treści żądania (bez stronicowania), liczba wierszy i limit (`422 LIST_EXPORT_LIMIT`),
 * wpis `list.exported` w dzienniku audytu we własnej krótkiej transakcji, dopiero potem transakcja tylko do odczytu
 * i zapis strumieniem do odpowiedzi partiami po 1000. Eksport trzyma więc najwyżej jedno połączenie z puli naraz
 * (wcześniej wpis w drugiej transakcji w trakcie pierwszej mógł przy pełnej puli zakleszczyć eksporty).
 */
@Injectable()
export class ListExportService {
  private readonly logger = new Logger(ListExportService.name);
  /** Limit wierszy; testy zmniejszają go, żeby sprawdzić 422 bez 50 000 rekordów. */
  limit = LIST_EXPORT_LIMIT;
  /** Limit równoległych eksportów (testy go zmieniają). */
  concurrency = LIST_EXPORT_CONCURRENCY;
  private active = 0;

  constructor(
    @Inject(DB) private readonly db: Database,
    private readonly audited: AuditedTransaction,
  ) {}

  /** Eksport listy wzorca widoku tabeli (`ListSource` z repozytorium przez funkcję listy serwisu). */
  async list<T>(
    reply: FastifyReply,
    staffId: string,
    def: ResourceDefinition,
    request: ListExportRequest,
    list: ExportListFn<T>,
  ): Promise<void> {
    const parsed = parseListQuery(def, exportListParams(request.query));
    if (!parsed.ok) {
      throw new ApiError(HttpStatus.BAD_REQUEST, 'VALIDATION_ERROR', 'Nieprawidłowe parametry listy', parsed.issues);
    }
    const query = { ...parsed.query, facets: [] };
    await this.run(reply, {
      staffId,
      resource: def.name,
      def,
      request,
      query: { q: query.q ?? null, filters: query.filters, sort: query.sort },
      // Ta sama funkcja listy (warunek stały, maskowanie, 403 za filtr po danych klienta) z jednym wierszem.
      count: async (db) => (await list(db, { ...query, page: 1, pageSize: 1 })).total,
      // Kolejne strony bez `count(*)`: liczba jest już znana, a partia krótsza od `batch` kończy odczyt.
      pages: (tx) => listPages((q) => list(tx, { ...q, withTotal: false }), query, LIST_EXPORT_BATCH),
    });
  }

  /** Wspólny przebieg eksportu (listy i zakres telemetrii). */
  async run<T>(reply: FastifyReply, job: ExportJob<T>): Promise<void> {
    ensureListExportSlot(this.active, this.concurrency);
    this.active++;
    try {
      await this.export(reply, job);
    } finally {
      this.active--;
    }
  }

  private async export<T>(reply: FastifyReply, job: ExportJob<T>): Promise<void> {
    const columns = exportColumns(job.def, job.request);
    const limit = job.limit ?? this.limit;
    const count = await job.count(this.db);
    ensureListExportWithinLimit(count, limit);
    await this.audited.run(job.staffId, ({ audit }) =>
      audit({
        action: 'list.exported',
        entityType: 'list',
        entityId: null,
        data: {
          resource: job.resource,
          format: job.request.format,
          ...job.query,
          columns: columns.map((c) => c.field),
          rowCount: count,
        },
      }),
    );
    let stream: PassThrough | undefined;
    try {
      await this.db.transaction(async (tx) => {
        const now = new Date();
        const out = new PassThrough();
        stream = out;
        void reply
          .status(200)
          .header('content-type', LIST_EXPORT_CONTENT_TYPES[job.request.format])
          .header(
            'content-disposition',
            `attachment; filename="${listExportFileName(job.resource, job.request.format, now)}"`,
          )
          .header('cache-control', 'private, no-store')
          .send(out);
        const pages = job.pages(tx);
        if (job.request.format === 'csv') await writeCsv(out, columns, pages);
        else await writeXlsx(out, job.resource, columns, pages, now);
      }, READ_ONLY);
    } catch (error) {
      // Przed wysłaniem nagłówków błąd idzie przez filtr wyjątków ({ code, message, details }); później zostaje
      // tylko przerwanie odpowiedzi, a klient dostaje niepełny plik jako błąd sieci.
      if (!stream) throw error;
      this.logger.error(`Eksport ${job.resource} przerwany: ${(error as Error).message}`);
      (stream as PassThrough).destroy(error as Error);
    }
  }
}

/** Kolumny z treści żądania z typem pola z definicji zasobu; pole spoza definicji to `400 VALIDATION_FAILED`. */
export function exportColumns(def: ResourceDefinition, request: ListExportRequest): ExportColumn[] {
  const issues = validateExportColumns(def, request.columns);
  if (issues.length) throw new DomainError('VALIDATION_FAILED', { columns: issues });
  const fields = def.fields as Record<string, FieldDefinition>;
  return request.columns.map((column) => {
    const field = fields[column.field]!;
    return {
      field: column.field,
      label: column.label,
      type: field.type,
      ...(field.money ? { money: true } : {}),
      ...(field.array ? { array: true } : {}),
      ...(column.values ? { values: column.values } : {}),
    };
  });
}

const cell = (row: unknown, field: string): unknown => (row as Record<string, unknown>)[field];

async function writeCsv(out: PassThrough, columns: readonly ExportColumn[], pages: AsyncIterable<readonly unknown[]>) {
  // Etykiety z panelu to tekst operatora: w CSV też z ochroną przed formułami (ADR 0073).
  await write(out, CSV_BOM + csvLine(columns.map((c) => protectFormula(c.label))));
  for await (const rows of pages) {
    if (out.destroyed) return;
    await write(out, rows.map((row) => csvLine(columns.map((c) => csvCellText(c, cell(row, c.field))))).join(''));
  }
  out.end();
}

async function writeXlsx(
  out: PassThrough,
  resource: string,
  columns: readonly ExportColumn[],
  pages: AsyncIterable<readonly unknown[]>,
  now: Date,
) {
  const workbook = createSpreadsheetWriter(out).workbook({ title: resource, creator: 'hulajnogi', createdAt: now });
  const sheet = workbook.addSheet({ name: listExportSheetName(resource), columns: columns.map(listSpreadsheetColumn) });
  for await (const rows of pages) {
    if (out.destroyed) return;
    for (const row of rows) await sheet.addRow(columns.map((c) => listCellValue(c, cell(row, c.field))));
    // ExcelJS pisze do strumienia bez sprawdzania wyniku `write`: po partii czekamy, aż klient odbierze bufor.
    await drained(out);
  }
  await sheet.commit();
  // `commit` skoroszytu kończy archiwum ZIP i zamyka strumień odpowiedzi.
  await workbook.commit();
}

/** Zapis z poszanowaniem przepływu: przy pełnym buforze czeka na `drain` albo zamknięcie przez klienta. */
async function write(out: PassThrough, chunk: string): Promise<void> {
  if (out.destroyed || !chunk) return;
  if (!out.write(chunk)) await waitForDrain(out);
}

/** Pełny bufor strumienia (np. po wierszach zapisanych przez ExcelJS): czeka na `drain` albo zamknięcie. */
export async function drained(out: PassThrough): Promise<void> {
  if (!out.destroyed && out.writableNeedDrain) await waitForDrain(out);
}

function waitForDrain(out: PassThrough): Promise<unknown> {
  return Promise.race([once(out, 'drain'), once(out, 'close')]);
}
