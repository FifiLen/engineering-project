import {
  isLocalDate,
  REPORT_CATALOG,
  reportFileName,
  reportRunState,
  reportSections,
  shortReportRunId,
  type ReportPreset,
} from '@hulajnogi/core';
import type { ReportDefinitionRecord, ReportRunRecord } from '@hulajnogi/db';
import type { ReportCatalogItem, ReportDefinitionDetails, ReportRunState, ReportRunView } from '@hulajnogi/shared';
import { fileLink } from '../documents/document-files.js';
import type { FilesService } from '../files/files.service.js';

/** Nazwa pliku uruchomienia z zapisanych parametrów (`revenue-2026-10.pdf`); `null` bez dat w parametrach. */
export function runFileName(run: Pick<ReportRunRecord, 'reportCode' | 'format' | 'params'>): string | null {
  const { preset, from, to } = run.params as { preset?: ReportPreset; from?: unknown; to?: unknown };
  if (!isLocalDate(from) || !isLocalDate(to)) return null;
  return reportFileName({ code: run.reportCode, range: { from, to }, preset: preset ?? 'custom' }, run.format);
}

/**
 * Widok uruchomienia (`GET /admin/report-runs/{id}`, odpowiedź eksportu i `report.ready`): stan z „Plik usunięty”,
 * nazwa raportu z definicji (treść z panelu) i plik z adresem z podpisem tylko dla gotowego uruchomienia przed
 * retencją.
 */
export function reportRunView(
  run: ReportRunRecord,
  reportName: string,
  files: FilesService,
  now = new Date(),
): ReportRunView {
  const fileName = runFileName(run);
  const downloadable = run.status === 'SUCCEEDED' && !run.fileDeletedAt && run.fileId && run.fileSizeBytes !== null;
  return {
    id: run.id,
    shortId: shortReportRunId(run.id),
    reportCode: run.reportCode,
    reportName,
    format: run.format,
    status: run.status,
    state: reportRunState(run),
    params: run.params,
    requestedBy: run.requestedBy,
    requestedByName: run.requestedByName,
    fileName: run.status === 'SUCCEEDED' ? fileName : null,
    fileSizeBytes: run.fileSizeBytes,
    rowCount: run.rowCount,
    pageCount: run.pageCount,
    dataAsOf: run.dataAsOf?.toISOString() ?? null,
    errorCode: run.errorCode,
    retryOf: run.retryOf,
    createdAt: run.createdAt.toISOString(),
    startedAt: run.startedAt?.toISOString() ?? null,
    finishedAt: run.finishedAt?.toISOString() ?? null,
    fileDeletedAt: run.fileDeletedAt?.toISOString() ?? null,
    file: downloadable
      ? fileLink(
          files,
          { id: run.fileId!, sizeBytes: run.fileSizeBytes!, status: 'READY' },
          fileName ?? `${run.reportCode}.${run.format.toLowerCase()}`,
          now,
        )
      : null,
  };
}

/** Pozycja katalogu: definicja z bazy (nazwa, opis, formaty) i sekcje z katalogu w core. */
export function catalogItem(def: ReportDefinitionRecord): ReportCatalogItem {
  const spec = REPORT_CATALOG[def.code];
  return {
    code: def.code,
    name: def.name,
    description: def.description,
    formats: def.formats,
    orientation: spec.orientation,
    params: { granularity: spec.params.granularity, compare: spec.params.compare, filters: [...spec.params.filters] },
    sections: reportSections(def.code),
    lastRun:
      def.lastRunId && def.lastRunAt && def.lastRunFormat && def.lastRunState
        ? {
            id: def.lastRunId,
            createdAt: def.lastRunAt.toISOString(),
            format: def.lastRunFormat,
            state: def.lastRunState as ReportRunState,
          }
        : null,
  };
}

/** Szczegóły definicji w zakładce Definicje: pola operatora i pola z kodu tylko do odczytu. */
export function definitionDetails(def: ReportDefinitionRecord): ReportDefinitionDetails {
  const item = catalogItem(def);
  return {
    code: def.code,
    name: def.name,
    description: def.description,
    permissionCode: def.permissionCode,
    formats: def.formats,
    active: def.active,
    sortOrder: def.sortOrder,
    permissionRoles: def.permissionRoles,
    updatedBy: def.updatedBy,
    updatedByName: def.updatedByName,
    updatedAt: def.updatedAt.toISOString(),
    version: def.version,
    runs: def.runs,
    lastRunId: def.lastRunId,
    lastRunAt: def.lastRunAt?.toISOString() ?? null,
    lastRunFormat: def.lastRunFormat,
    lastRunState: def.lastRunState as ReportRunState | null,
    parameters: def.parameters,
    orientation: item.orientation,
    params: item.params,
    sections: item.sections,
  };
}
