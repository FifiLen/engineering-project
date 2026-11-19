import { describe, expect, it } from 'vitest';
import { consentRevokeSchema, consentsResource, permissionUpdateSchema, sessionsResource } from './accounts.js';
import { exportListParams, listExportRequestSchema, validateExportColumns } from './export.js';
import { parseListQuery, personalFields, type FieldDefinition } from './list.js';
import { rentalsResource } from './rentals.js';
import { ADMIN_RESOURCES, adminResource } from './registry.js';
import { reportRunsResource } from './reports.js';
import { scooterStatusHistoryResource, telemetryReadingsQuerySchema } from './system-lists.js';

describe('rejestr zasobów (ADR 0031, ADR 0076)', () => {
  it('47 zasobów z unikalnymi nazwami i poprawnymi definicjami', () => {
    expect(ADMIN_RESOURCES).toHaveLength(47);
    expect(new Set(ADMIN_RESOURCES.map((r) => r.name)).size).toBe(47);
    for (const resource of ADMIN_RESOURCES) {
      const fields = resource.fields as Record<string, FieldDefinition>;
      for (const name of resource.search) expect(fields[name], `${resource.name}.${name}`).toBeDefined();
      for (const key of resource.defaultSort) {
        const field = fields[key.replace(/^-/, '')];
        expect(field?.sortable, `${resource.name} sort ${key}`).toBe(true);
      }
      for (const [name, field] of Object.entries(fields)) {
        if (field.money) expect(field.type, `${resource.name}.${name}`).toBe('integer');
        if (field.facet) expect(field.array, `${resource.name}.${name}`).not.toBe(true);
        if (field.type === 'enum') expect(field.values?.length, `${resource.name}.${name}`).toBeGreaterThan(0);
      }
      // Parametry domyślne każdej listy przechodzą kontrakt.
      expect(parseListQuery(resource, {}).ok, resource.name).toBe(true);
    }
    expect(adminResource('report-runs')).toBe(reportRunsResource);
    expect(adminResource('telemetry')).toBeUndefined();
  });

  it('dane osobowe klienta oznaczone na listach (ADR 0073)', () => {
    expect(personalFields(rentalsResource)).toEqual(['userName', 'userPhone']);
    expect(personalFields(consentsResource)).toEqual(['userName', 'userPhone']);
    expect(personalFields(sessionsResource)).toEqual(['userName', 'userPhone', 'deviceName']);
    expect(personalFields(reportRunsResource)).toEqual([]);
    expect(personalFields(adminResource('users')!)).toEqual(['name', 'phone', 'email']);
    expect(personalFields(adminResource('roles')!)).toEqual([]);
  });

  it('historia stanów i zgody: filtry i sortowania z widoków 0013', () => {
    expect(
      parseListQuery(
        scooterStatusHistoryResource,
        new URLSearchParams('category=OFFLINE&durationSeconds.gte=600&sort=-durationSeconds'),
      ).ok,
    ).toBe(true);
    expect(parseListQuery(consentsResource, new URLSearchParams('state=OUTDATED&type=MARKETING&facets=state')).ok).toBe(
      true,
    );
    expect(consentRevokeSchema.safeParse({ reason: 'ok' }).success).toBe(false);
    expect(permissionUpdateSchema.safeParse({ version: 1, description: 'x'.repeat(161) }).success).toBe(false);
  });
});

describe('eksport list (ADR 0073)', () => {
  it('kolumny z definicji zasobu z etykietą do 80 znaków i tekstami wyliczeń', () => {
    const request = listExportRequestSchema.parse({
      query: { state: 'ENDED', sort: '-createdAt', page: '3', pageSize: '100' },
      format: 'csv',
      columns: [
        { field: 'number', label: 'Numer' },
        { field: 'state', label: 'Stan', values: { ENDED: 'Zakończony' } },
      ],
    });
    expect(exportListParams(request.query)).toEqual({ state: 'ENDED', sort: '-createdAt' });
    expect(validateExportColumns(rentalsResource, request.columns)).toEqual([]);
    expect(
      validateExportColumns(rentalsResource, [
        { field: 'passwordHash', label: 'x' },
        { field: 'number', label: 'Numer' },
        { field: 'number', label: 'Numer' },
        { field: 'state', label: 'Stan', values: { BROKEN: 'x' } },
      ]),
    ).toEqual([
      { field: 'passwordHash', code: 'UNKNOWN_FIELD' },
      { field: 'number', code: 'DUPLICATE_FIELD' },
      { field: 'state', code: 'UNKNOWN_VALUE' },
    ]);
    expect(
      listExportRequestSchema.safeParse({ format: 'xlsx', columns: [{ field: 'number', label: 'x'.repeat(81) }] })
        .success,
    ).toBe(false);
    expect(
      listExportRequestSchema.safeParse({ format: 'pdf', columns: [{ field: 'number', label: 'N' }] }).success,
    ).toBe(false);
  });
});

describe('telemetria z kursorem (ADR 0076)', () => {
  it('zakres wymagany, najwyżej 24 h', () => {
    const base = { scooterId: '0b6f1c2e-6b3a-4c39-9d5e-2a6c3d6f7a10', from: '2026-11-19T10:00:00Z' };
    expect(telemetryReadingsQuerySchema.safeParse({ ...base, to: '2026-11-19T11:00:00Z' }).data).toMatchObject({
      direction: 'older',
      pageSize: 50,
    });
    expect(telemetryReadingsQuerySchema.safeParse({ ...base, to: '2026-11-20T10:00:01Z' }).success).toBe(false);
    expect(telemetryReadingsQuerySchema.safeParse({ ...base, to: '2026-11-19T09:00:00Z' }).success).toBe(false);
    expect(
      telemetryReadingsQuerySchema.safeParse({ ...base, to: '2026-11-19T11:00:00Z', inRide: '1' }).data?.inRide,
    ).toBe(true);
  });
});
