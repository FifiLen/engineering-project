/**
 * Zasoby panelu raportów (ADR 0071): Raporty → Historia (`report_runs`, `v_report_run_list`) i Raporty → Definicje
 * (`report_definitions`, `v_report_definitions`). Historia pokazuje uruchomienia wszystkich operatorów dla raportów,
 * do których operator ma `reports.<kod>`: API zawęża listę warunkiem `report_code`, a panel pokazuje zakładkę przy
 * dowolnym uprawnieniu raportu (`permissions.read` to wzorzec, nie kod uprawnienia).
 */
import { JOB_STATUSES, type JobStatus } from '../documents.js';
import {
  REPORT_CODES,
  REPORT_FORMATS,
  REPORT_RUN_STATES,
  reportDefinitionUpdateSchema,
  type ReportCatalogItem,
  type ReportCode,
  type ReportFormat,
  type ReportRunState,
} from '../reports.js';
import type { ResourceDefinition } from './list.js';

export const reportRunsResource = {
  name: 'report-runs',
  fields: {
    id: { type: 'uuid', filters: ['eq'] },
    shortId: { type: 'text', filters: ['eq'] },
    reportCode: { type: 'enum', values: REPORT_CODES, filters: ['eq'], facet: true, sortable: true },
    reportName: { type: 'text', sortable: true },
    format: { type: 'enum', values: REPORT_FORMATS, filters: ['eq'], facet: true, sortable: true },
    // Parametry uruchomienia jako obiekt JSON (`StoredReportParams` w core): bez filtrów, sortowania i eksportu.
    params: { type: 'text' },
    status: { type: 'enum', values: JOB_STATUSES, filters: ['eq'] },
    state: { type: 'enum', values: REPORT_RUN_STATES, filters: ['eq'], facet: true, sortable: true },
    requestedBy: { type: 'uuid', filters: ['eq'] },
    requestedByName: { type: 'text', sortable: true },
    requestedByRoles: { type: 'text', array: true },
    fileId: { type: 'uuid' },
    fileSizeBytes: { type: 'integer', sortable: true },
    rowCount: { type: 'integer', sortable: true },
    pageCount: { type: 'integer' },
    dataAsOf: { type: 'datetime', filters: ['gte', 'lte'] },
    errorCode: { type: 'text', filters: ['eq'], facet: true },
    retryOf: { type: 'uuid', filters: ['eq'] },
    createdAt: { type: 'datetime', filters: ['gte', 'lte'], sortable: true },
    startedAt: { type: 'datetime', filters: ['gte', 'lte'] },
    finishedAt: { type: 'datetime', filters: ['gte', 'lte'], sortable: true },
    durationMs: { type: 'integer', sortable: true },
    fileDeletedAt: { type: 'datetime', filters: ['gte', 'lte'] },
  },
  // Identyfikator ze stopki pliku (8 znaków) przez `shortId`.
  search: ['shortId', 'reportName', 'requestedByName'],
  defaultSort: ['-createdAt'],
  deleteMode: 'none',
  permissions: { read: 'reports.*' },
} as const satisfies ResourceDefinition;

export interface ReportRunListItem {
  id: string;
  shortId: string;
  reportCode: ReportCode;
  reportName: string;
  format: ReportFormat;
  params: Record<string, unknown>;
  status: JobStatus;
  state: ReportRunState;
  requestedBy: string;
  requestedByName: string;
  requestedByRoles: string[];
  fileId: string | null;
  fileSizeBytes: number | null;
  rowCount: number | null;
  pageCount: number | null;
  dataAsOf: string | null;
  errorCode: string | null;
  retryOf: string | null;
  createdAt: string;
  startedAt: string | null;
  finishedAt: string | null;
  durationMs: number | null;
  fileDeletedAt: string | null;
}

export const reportDefinitionsResource = {
  name: 'report-definitions',
  fields: {
    code: { type: 'enum', values: REPORT_CODES, filters: ['eq'], sortable: true },
    name: { type: 'text', filters: ['contains'], sortable: true },
    description: { type: 'text', filters: ['contains'] },
    permissionCode: { type: 'text', filters: ['eq'], facet: true },
    formats: { type: 'enum', values: REPORT_FORMATS, array: true, filters: ['eq'] },
    active: { type: 'boolean', filters: ['eq'], facet: true, sortable: true },
    sortOrder: { type: 'integer', sortable: true },
    permissionRoles: { type: 'text', array: true },
    updatedBy: { type: 'uuid', filters: ['eq'] },
    updatedByName: { type: 'text', sortable: true },
    updatedAt: { type: 'datetime', filters: ['gte', 'lte'], sortable: true },
    version: { type: 'integer' },
    runs: { type: 'integer', sortable: true },
    lastRunId: { type: 'uuid' },
    lastRunAt: { type: 'datetime', filters: ['gte', 'lte'], sortable: true },
    lastRunFormat: { type: 'enum', values: REPORT_FORMATS },
    lastRunState: { type: 'enum', values: REPORT_RUN_STATES },
  },
  search: ['name', 'description'],
  defaultSort: ['sortOrder', 'code'],
  // Definicje pochodzą z katalogu w core (seed); panel zmienia nazwę, opis, aktywność i kolejność.
  deleteMode: 'none',
  permissions: { read: 'reports.manage', write: 'reports.manage' },
  updateSchema: reportDefinitionUpdateSchema,
} as const satisfies ResourceDefinition;

export interface ReportDefinitionListItem {
  code: ReportCode;
  name: string;
  description: string | null;
  permissionCode: string;
  formats: ReportFormat[];
  active: boolean;
  sortOrder: number;
  permissionRoles: string[];
  updatedBy: string | null;
  updatedByName: string | null;
  updatedAt: string;
  version: number;
  runs: number;
  lastRunId: string | null;
  lastRunAt: string | null;
  lastRunFormat: ReportFormat | null;
  lastRunState: ReportRunState | null;
}

/** Szczegóły definicji: pola z kodu tylko do odczytu (schemat parametrów, sekcje z katalogu). */
export interface ReportDefinitionDetails extends ReportDefinitionListItem {
  parameters: Record<string, unknown>;
  orientation: ReportCatalogItem['orientation'];
  params: ReportCatalogItem['params'];
  sections: ReportCatalogItem['sections'];
}
