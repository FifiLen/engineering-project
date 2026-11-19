/**
 * Raporty (iteracja 8, ADR 0071): schematy parametrów podglądu i eksportu (ten sam kształt w adresie podglądu,
 * w treści `POST /admin/reports/{code}/runs` i w `report_definitions.parameters` jako JSON Schema), odpowiedź
 * podglądu, katalog raportów, edycja definicji i uruchomienia. Reguły (zakres do 366 dni, granulacja, porównanie)
 * są w packages/core (`resolveReportParams`); wyliczenia są kopią z core, zgodność pilnuje test bazy (seed).
 */
import { z } from 'zod';
import { JOB_STATUSES } from './documents.js';

export const REPORT_CODES = ['revenue', 'fleet_usage', 'rides_by_zone', 'reliability', 'users', 'wallet'] as const;
export type ReportCode = (typeof REPORT_CODES)[number];
export const isReportCode = (code: string): code is ReportCode => (REPORT_CODES as readonly string[]).includes(code);

/** Uprawnienie raportu `reports.<kod>` (historia pokazuje raporty, do których operator ma uprawnienie). */
export const reportPermission = (code: ReportCode): string => `reports.${code}`;
export const REPORT_MANAGE_PERMISSION = 'reports.manage';

export const REPORT_FORMATS = ['PDF', 'XLSX'] as const;
export type ReportFormat = (typeof REPORT_FORMATS)[number];

export const REPORT_PRESETS = ['today', 'yesterday', 'last_7_days', 'this_month', 'previous_month', 'custom'] as const;
export type ReportPreset = (typeof REPORT_PRESETS)[number];

export const REPORT_GRANULARITIES = ['day', 'week', 'month'] as const;
export type ReportGranularity = (typeof REPORT_GRANULARITIES)[number];

/** Najdłuższy okres w dobach (walidację robi core, panel używa jej do kalendarza i podpowiedzi). */
export const REPORT_MAX_DAYS = 366;

export const REPORT_VALUE_KINDS = ['money', 'number', 'duration', 'distance', 'percent', 'date', 'text'] as const;
export type ReportValueKind = (typeof REPORT_VALUE_KINDS)[number];

export const REPORT_RUN_STATES = ['QUEUED', 'RUNNING', 'SUCCEEDED', 'FAILED', 'FILE_DELETED'] as const;
export type ReportRunState = (typeof REPORT_RUN_STATES)[number];

// --- Parametry -------------------------------------------------------------------------------------------

const localDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Data RRRR-MM-DD');
/** Wartość logiczna z adresu (`compare=1`, `compare=false`) albo z treści JSON. */
const booleanParam = z
  .union([z.boolean(), z.enum(['1', '0', 'true', 'false'])])
  .transform((v) => v === true || v === '1' || v === 'true');

const baseParams = {
  preset: z.enum(REPORT_PRESETS).optional(),
  /** Pierwsza doba okresu (czas polski, włącznie). */
  from: localDate.optional(),
  /** Ostatnia doba okresu (włącznie). */
  to: localDate.optional(),
  compare: booleanParam.optional(),
};
const granularity = { granularity: z.enum(REPORT_GRANULARITIES).optional() };
const modelScooter = { modelId: z.uuid().optional(), scooterId: z.uuid().optional() };

/**
 * Parametry każdego raportu: okres i porównanie wszędzie, granulacja w raportach z szeregiem w czasie (przychody,
 * wykorzystanie floty, użytkownicy), strefa końca w raporcie stref, model i hulajnoga we flocie i awaryjności.
 * Nieznane pola są pomijane (`strip`), więc parametr innego raportu z adresu nie psuje podglądu.
 */
export const REPORT_PARAMS_SCHEMAS = {
  revenue: z.object({ ...baseParams, ...granularity }),
  fleet_usage: z.object({ ...baseParams, ...granularity, ...modelScooter }),
  rides_by_zone: z.object({ ...baseParams, zoneId: z.uuid().optional() }),
  reliability: z.object({ ...baseParams, ...modelScooter }),
  users: z.object({ ...baseParams, ...granularity }),
  wallet: z.object({ ...baseParams }),
} as const;

export type ReportParamsInput = {
  preset?: ReportPreset;
  from?: string;
  to?: string;
  compare?: boolean;
  granularity?: ReportGranularity;
  zoneId?: string;
  modelId?: string;
  scooterId?: string;
};

export const reportParamsSchema = (code: ReportCode) => REPORT_PARAMS_SCHEMAS[code];

/** Parametry podglądu z adresu albo z treści (wynik zgodny z `ReportParamsInput` w packages/core). */
export function parseReportParams(code: ReportCode, input: unknown) {
  return REPORT_PARAMS_SCHEMAS[code].safeParse(input) as
    { success: true; data: ReportParamsInput } | { success: false; error: z.ZodError };
}

/** JSON Schema parametrów do `report_definitions.parameters` (seed, plansza `raport-definicja`). */
export const reportParamsJsonSchema = (code: ReportCode): Record<string, unknown> =>
  z.toJSONSchema(REPORT_PARAMS_SCHEMAS[code], { io: 'input' }) as Record<string, unknown>;

// --- Eksport i definicje ---------------------------------------------------------------------------------

/** `POST /admin/reports/{code}/runs`: format i parametry (walidowane schematem raportu i regułami z core). */
export const reportRunCreateSchema = z.object({
  format: z.enum(REPORT_FORMATS),
  params: z.record(z.string(), z.unknown()).default({}),
});
export type ReportRunCreate = z.infer<typeof reportRunCreateSchema>;

/** `PATCH /admin/report-definitions/{code}` (`reports.manage`): pola operatora z blokadą optymistyczną. */
export const reportDefinitionUpdateSchema = z.object({
  version: z.number().int().min(1),
  name: z.string().trim().min(1).max(80).optional(),
  description: z.string().trim().max(300).nullable().optional(),
  active: z.boolean().optional(),
  sortOrder: z.number().int().min(0).max(10_000).optional(),
});
export type ReportDefinitionUpdate = z.infer<typeof reportDefinitionUpdateSchema>;

/** Zmiana kolejności przeciąganiem: jedno polecenie z wersjami wszystkich przesuniętych definicji. */
export const reportDefinitionsReorderSchema = z.object({
  items: z
    .array(z.object({ code: z.enum(REPORT_CODES), version: z.number().int().min(1) }))
    .min(1)
    .max(REPORT_CODES.length),
});
export type ReportDefinitionsReorder = z.infer<typeof reportDefinitionsReorderSchema>;

// --- Odpowiedź podglądu -----------------------------------------------------------------------------------

const reportValue = z.union([z.number(), z.string(), z.null()]);
const kind = z.enum(REPORT_VALUE_KINDS);

export const reportColumnSchema = z.object({
  key: z.string(),
  label: z.string(),
  kind,
  decimals: z.number().int().optional(),
});

export const reportTileSchema = z.object({
  key: z.string(),
  label: z.string(),
  kind,
  decimals: z.number().int().optional(),
  value: z.number().nullable(),
  previous: z.number().nullable(),
  /** Zmiana wobec poprzedniego okresu jako ułamek (0,084 = +8,4%). */
  change: z.number().nullable(),
});

const chartBase = {
  key: z.string(),
  title: z.string(),
  kind,
  decimals: z.number().int().optional(),
  tableKey: z.string(),
};

export const reportChartSchema = z.discriminatedUnion('type', [
  z.object({
    ...chartBase,
    type: z.literal('bar'),
    axis: z.enum(['time', 'category']),
    granularity: z.enum(REPORT_GRANULARITIES).nullable(),
    hasPrevious: z.boolean(),
    items: z.array(
      z.object({
        key: z.string(),
        label: z.string(),
        value: z.number().nullable(),
        previous: z.number().nullable(),
        previousKey: z.string().nullable(),
        weekend: z.boolean(),
      }),
    ),
  }),
  z.object({
    ...chartBase,
    type: z.literal('heatmap'),
    thresholds: z.array(z.number()),
    rowLabels: z.array(z.string()),
    cells: z.array(
      z.object({
        isodow: z.number().int(),
        hour: z.number().int(),
        value: z.number().nullable(),
        rides: z.number().int(),
        days: z.number().int(),
      }),
    ),
  }),
  z.object({
    ...chartBase,
    type: z.literal('share'),
    total: z.number(),
    segments: z.array(
      z.object({ key: z.string(), label: z.string(), value: z.number(), share: z.number().nullable() }),
    ),
  }),
]);

export const reportTableSchema = z.object({
  key: z.string(),
  title: z.string(),
  description: z.string().nullable(),
  sheetName: z.string(),
  columns: z.array(reportColumnSchema),
  rows: z.array(z.object({ cells: z.record(z.string(), reportValue), style: z.literal('subtotal').optional() })),
  /** Wszystkie wiersze tabeli; podgląd pokazuje najwyżej 200 (ADR 0071). */
  totalRows: z.number().int(),
  totals: z.record(z.string(), reportValue).nullable(),
});

/** Parametry po walidacji w core (daty bezwzględne, granice okresu, porównanie). */
export const resolvedReportParamsSchema = z.object({
  preset: z.enum(REPORT_PRESETS),
  from: localDate,
  to: localDate,
  days: z.number().int(),
  granularity: z.enum(REPORT_GRANULARITIES).nullable(),
  granularityAuto: z.boolean(),
  /** Granice `[periodFrom, periodTo)` jako chwile ISO (północe czasu polskiego). */
  periodFrom: z.string(),
  periodTo: z.string(),
  comparison: z.object({ from: localDate, to: localDate, alignment: z.enum(['month', 'length']) }).nullable(),
  filters: z.object({
    zoneId: z.string().optional(),
    modelId: z.string().optional(),
    scooterId: z.string().optional(),
  }),
});
export type ResolvedReportParamsView = z.infer<typeof resolvedReportParamsSchema>;

/** `GET /admin/reports/{code}/preview` (podgląd synchroniczny, ADR 0071). */
export const reportPreviewSchema = z.object({
  code: z.enum(REPORT_CODES),
  /** Nazwa i opis z `report_definitions` (treść z panelu). */
  name: z.string(),
  description: z.string().nullable(),
  params: resolvedReportParamsSchema,
  /** Chwila danych: czas transakcji odczytu (`now()` w `REPEATABLE READ`). */
  dataAsOf: z.string(),
  /** Najwcześniejsza data danych źródła (`fn_report_earliest_data`), do stanu „Brak danych”. */
  earliestDataAt: z.string().nullable(),
  empty: z.boolean(),
  rowCount: z.number().int(),
  tiles: z.array(reportTileSchema),
  charts: z.array(reportChartSchema),
  tables: z.array(reportTableSchema),
});
export type ReportPreview = z.infer<typeof reportPreviewSchema>;
export type ReportTile = z.infer<typeof reportTileSchema>;
export type ReportChart = z.infer<typeof reportChartSchema>;
export type ReportTable = z.infer<typeof reportTableSchema>;
export type ReportColumn = z.infer<typeof reportColumnSchema>;

// --- Katalog i uruchomienia -------------------------------------------------------------------------------

/** Ostatnie uruchomienie raportu (dowolnego zlecającego, pytanie 7). */
export interface ReportLastRun {
  id: string;
  createdAt: string;
  format: ReportFormat;
  state: ReportRunState;
}

/** `GET /admin/reports`: aktywne raporty z uprawnieniem operatora w kolejności `sort_order`. */
export interface ReportCatalogItem {
  code: ReportCode;
  name: string;
  description: string | null;
  formats: ReportFormat[];
  orientation: 'portrait' | 'landscape';
  params: { granularity: boolean; compare: boolean; filters: Array<'zoneId' | 'modelId' | 'scooterId'> };
  sections: {
    tiles: string[];
    charts: Array<{ key: string; title: string; type: 'bar' | 'heatmap' | 'share' }>;
    tables: Array<{ key: string; title: string; sheetName: string }>;
  };
  lastRun: ReportLastRun | null;
}

/** Odpowiedź `POST /admin/reports/{code}/runs`, szczegóły uruchomienia i zdarzenie `report.ready`. */
export interface ReportRunView {
  id: string;
  shortId: string;
  reportCode: ReportCode;
  reportName: string;
  format: ReportFormat;
  status: (typeof JOB_STATUSES)[number];
  state: ReportRunState;
  params: Record<string, unknown>;
  requestedBy: string;
  requestedByName: string;
  fileName: string | null;
  fileSizeBytes: number | null;
  rowCount: number | null;
  pageCount: number | null;
  dataAsOf: string | null;
  errorCode: string | null;
  retryOf: string | null;
  createdAt: string;
  startedAt: string | null;
  finishedAt: string | null;
  fileDeletedAt: string | null;
}
