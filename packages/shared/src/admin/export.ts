/**
 * Eksport list do XLSX i CSV (ADR 0073): `POST /admin/{zasób}/export` z bieżącym zapytaniem listy (te same
 * parametry co adres listy, bez strony), formatem i kolumnami z etykietami z panelu (`pl.json`), więc API nie trzyma
 * kopii etykiet. Kolumny spoza definicji zasobu dają `400 VALIDATION_FAILED`, powyżej 50 000 wierszy
 * `422 LIST_EXPORT_LIMIT` z `details: { count, limit }`.
 */
import { z } from 'zod';
import type { FieldDefinition, ResourceDefinition } from './list.js';

export const LIST_EXPORT_LIMIT = 50_000;
export const LIST_EXPORT_FORMATS = ['xlsx', 'csv'] as const;
export type ListExportFormat = (typeof LIST_EXPORT_FORMATS)[number];

const queryValue = z.union([z.string().max(2000), z.array(z.string().max(2000)).max(50)]);

export const listExportColumnSchema = z.object({
  field: z.string().min(1).max(64),
  label: z.string().trim().min(1).max(80),
  /** Teksty wartości pola `enum` (np. `{ "ENDED": "Zakończony" }`); brakujące zostają kodem. */
  values: z.record(z.string().max(64), z.string().max(80)).optional(),
});
export type ListExportColumn = z.infer<typeof listExportColumnSchema>;

export const listExportRequestSchema = z.object({
  /** Parametry listy jak w adresie (`q`, filtry, `sort`); `page`, `pageSize` i `facets` są pomijane. */
  query: z.record(z.string().max(80), queryValue).default({}),
  format: z.enum(LIST_EXPORT_FORMATS),
  columns: z.array(listExportColumnSchema).min(1).max(80),
});
export type ListExportRequest = z.infer<typeof listExportRequestSchema>;

export interface ListExportColumnIssue {
  field: string;
  code: 'UNKNOWN_FIELD' | 'DUPLICATE_FIELD' | 'UNKNOWN_VALUE';
}

/** Kolumny eksportu muszą być polami definicji zasobu, bez powtórzeń; teksty tylko dla wartości wyliczenia. */
export function validateExportColumns(
  def: ResourceDefinition,
  columns: readonly ListExportColumn[],
): ListExportColumnIssue[] {
  const fields = def.fields as Record<string, FieldDefinition>;
  const seen = new Set<string>();
  const issues: ListExportColumnIssue[] = [];
  for (const column of columns) {
    const field = fields[column.field];
    if (!field) issues.push({ field: column.field, code: 'UNKNOWN_FIELD' });
    else if (seen.has(column.field)) issues.push({ field: column.field, code: 'DUPLICATE_FIELD' });
    else if (column.values && Object.keys(column.values).some((v) => !field.values?.includes(v)))
      issues.push({ field: column.field, code: 'UNKNOWN_VALUE' });
    seen.add(column.field);
  }
  return issues;
}

/** Parametry listy z żądania eksportu bez stronicowania i liczników (eksport bierze wszystkie strony). */
export function exportListParams(query: ListExportRequest['query']): Record<string, string | string[]> {
  return Object.fromEntries(Object.entries(query).filter(([key]) => !['page', 'pageSize', 'facets'].includes(key)));
}
