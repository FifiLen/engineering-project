import { REPORT_CATALOG, REPORT_CODES } from '@hulajnogi/core';
import type { PoolClient } from 'pg';
import { catalogDefinitionValues, sameJson, type ReportDefinitionSync } from './repositories/reports.repository.js';

/**
 * Definicje raportów z katalogu w packages/core (ADR 0071, D3): seed wstawia brakujące wiersze `report_definitions`
 * (nazwa, opis i kolejność z katalogu tylko przy utworzeniu) i aktualizuje pola z kodu: `permission_code`,
 * `parameters` (JSON Schema z `reportParamsJsonSchema`) i `formats`. Nazwy, opisu, aktywności i kolejności nie
 * nadpisuje (zmienia je Administrator w panelu, `reports.manage`), a synchronizacja nie podbija `version` ani
 * `updated_at` (formularz edytuje tylko pola operatora, więc blokada optymistyczna nie zgłasza konfliktu). Wpis systemu
 * w dzienniku audytu (`report_definition.created` albo `report_definition.synced`, `data.source = 'catalog'`) powstaje
 * tylko przy zmianie. Wiersz spoza katalogu zostaje bez zmian (historia uruchomień wskazuje definicję).
 */
export async function seedReportDefinitions(client: PoolClient): Promise<ReportDefinitionSync[]> {
  const result: ReportDefinitionSync[] = [];
  for (const code of REPORT_CODES) {
    const spec = REPORT_CATALOG[code];
    const values = catalogDefinitionValues(code);
    const { rows } = await client.query<{ permission_code: string; parameters: unknown; formats: string[] }>(
      `SELECT permission_code, parameters, formats::text[] AS formats FROM report_definitions WHERE code = $1 FOR UPDATE`,
      [code],
    );
    const current = rows[0];
    if (!current) {
      await client.query(
        `INSERT INTO report_definitions (code, name, description, permission_code, parameters, formats, active, sort_order)
         VALUES ($1, $2, $3, $4, $5::jsonb, $6::report_format[], true, $7)`,
        [
          code,
          spec.defaultName,
          spec.defaultDescription,
          values.permissionCode,
          JSON.stringify(values.parameters),
          values.formats,
          spec.sortOrder,
        ],
      );
      await audit(client, 'report_definition.created', { code, source: 'catalog' });
      result.push({ code, change: 'created', fields: [] });
      continue;
    }
    const fields: ReportDefinitionSync['fields'] = [];
    if (current.permission_code !== values.permissionCode) fields.push('permissionCode');
    if (!sameJson(current.parameters, values.parameters)) fields.push('parameters');
    if (!sameJson([...current.formats].sort(), [...values.formats].sort())) fields.push('formats');
    if (fields.length) {
      await client.query(
        `UPDATE report_definitions SET permission_code = $2, parameters = $3::jsonb, formats = $4::report_format[]
         WHERE code = $1`,
        [code, values.permissionCode, JSON.stringify(values.parameters), values.formats],
      );
      await audit(client, 'report_definition.synced', { code, fields, source: 'catalog' });
    }
    result.push({ code, change: fields.length ? 'updated' : 'unchanged', fields });
  }
  return result;
}

async function audit(client: PoolClient, action: string, data: Record<string, unknown>): Promise<void> {
  // `report_definitions.code` jest tekstem, a `audit_log.entity_id` identyfikatorem uuid: kod raportu jest w `data`.
  await client.query(
    `INSERT INTO audit_log (actor, staff_id, action, entity_type, entity_id, data)
     VALUES ('SYSTEM', NULL, $1, 'report_definition', NULL, $2)`,
    [action, JSON.stringify(data)],
  );
}
