import { describe, expect, it } from 'vitest';
import { dashboardSummarySchema } from './dashboard.js';
import {
  parseReportParams,
  REPORT_CODES,
  reportDefinitionUpdateSchema,
  reportParamsJsonSchema,
  reportPreviewSchema,
  reportRunCreateSchema,
} from './reports.js';

describe('parametry raportów (ADR 0071)', () => {
  it('adres podglądu: zakres, granulacja i porównanie z `1`/`0`', () => {
    const result = parseReportParams('revenue', {
      preset: 'previous_month',
      from: '2026-10-01',
      to: '2026-10-31',
      granularity: 'day',
      compare: '1',
    });
    expect(result).toEqual({
      success: true,
      data: { preset: 'previous_month', from: '2026-10-01', to: '2026-10-31', granularity: 'day', compare: true },
    });
    expect(parseReportParams('revenue', { compare: 'false' })).toMatchObject({ data: { compare: false } });
  });

  it('filtry według raportu; obce pola są pomijane, złe wartości odrzucane', () => {
    const zone = '0b6f1c2e-6b3a-4c39-9d5e-2a6c3d6f7a10';
    expect(parseReportParams('rides_by_zone', { zoneId: zone, modelId: zone })).toEqual({
      success: true,
      data: { zoneId: zone },
    });
    expect(parseReportParams('rides_by_zone', { zoneId: 'strefa' }).success).toBe(false);
    expect(parseReportParams('wallet', { from: '1.10.2026' }).success).toBe(false);
    expect(parseReportParams('users', { granularity: 'year' }).success).toBe(false);
  });

  it('JSON Schema każdego raportu do `report_definitions.parameters`', () => {
    for (const code of REPORT_CODES) {
      const schema = reportParamsJsonSchema(code);
      expect(schema.type).toBe('object');
      expect(Object.keys(schema.properties as object)).toEqual(
        expect.arrayContaining(['preset', 'from', 'to', 'compare']),
      );
    }
    expect(Object.keys(reportParamsJsonSchema('fleet_usage').properties as object)).toEqual(
      expect.arrayContaining(['granularity', 'modelId', 'scooterId']),
    );
    expect(reportParamsJsonSchema('wallet').properties).not.toHaveProperty('granularity');
  });

  it('eksport i edycja definicji', () => {
    expect(reportRunCreateSchema.parse({ format: 'PDF' })).toEqual({ format: 'PDF', params: {} });
    expect(reportRunCreateSchema.safeParse({ format: 'CSV' }).success).toBe(false);
    expect(reportDefinitionUpdateSchema.safeParse({ version: 1, name: '' }).success).toBe(false);
    expect(reportDefinitionUpdateSchema.safeParse({ version: 1, name: 'x'.repeat(81) }).success).toBe(false);
    expect(reportDefinitionUpdateSchema.parse({ version: 2, description: '  Opis  ' })).toEqual({
      version: 2,
      description: 'Opis',
    });
  });

  it('odpowiedź podglądu z chwilą danych i najwcześniejszą datą danych', () => {
    const preview = {
      code: 'revenue',
      name: 'Przychody',
      description: null,
      params: {
        preset: 'previous_month',
        from: '2026-10-01',
        to: '2026-10-31',
        days: 31,
        granularity: 'day',
        granularityAuto: true,
        periodFrom: '2026-09-30T22:00:00.000Z',
        periodTo: '2026-10-31T23:00:00.000Z',
        comparison: { from: '2026-09-01', to: '2026-09-30', alignment: 'month' },
        filters: {},
      },
      dataAsOf: '2026-11-19T13:32:00.000Z',
      earliestDataAt: null,
      empty: true,
      rowCount: 0,
      tiles: [{ key: 'salesGross', label: 'Sprzedaż brutto', kind: 'money', value: 0, previous: 0, change: null }],
      charts: [
        {
          key: 'salesSeries',
          title: 'Sprzedaż brutto',
          type: 'bar',
          kind: 'money',
          tableKey: 'salesSeries',
          axis: 'time',
          granularity: 'day',
          hasPrevious: true,
          items: [
            { key: '2026-10-01', label: '2026-10-01', value: 0, previous: null, previousKey: null, weekend: false },
          ],
        },
      ],
      tables: [
        {
          key: 'salesByVat',
          title: 'Sprzedaż według stawek VAT',
          description: null,
          sheetName: 'Sprzedaż według VAT',
          columns: [{ key: 'item', label: 'Pozycja', kind: 'text' }],
          rows: [{ cells: { item: 'Przejazdy' }, style: 'subtotal' }],
          totalRows: 1,
          totals: null,
        },
      ],
    };
    expect(reportPreviewSchema.safeParse(preview).success).toBe(true);
    expect(reportPreviewSchema.safeParse({ ...preview, dataAsOf: undefined }).success).toBe(false);
  });
});

describe('pulpit: odpowiedź `GET /admin/dashboard/summary`', () => {
  it('pola bez uprawnienia to `null`, kafelki tylko dozwolone', () => {
    const summary = {
      asOf: '2026-11-19T13:35:00.000Z',
      tiles: [
        { key: 'availableScooters', value: 163, fleetTotal: 240, share: 0.68 },
        { key: 'tasksInProgress', value: 7, mine: 3, overdue: 1 },
        { key: 'partsBelowMinimum', value: 3, names: ['Klocki hamulcowe', 'Dętka 10″', 'Linka'] },
      ],
      ridesByHour: null,
      fleetState: {
        total: 240,
        retired: 3,
        segments: [{ key: 'AVAILABLE', count: 163, share: 0.68 }],
      },
      myTasks: {
        assigned: 3,
        overdue: 1,
        unassigned: 2,
        inProgressTotal: 7,
        items: [
          {
            taskId: 't',
            number: 1042,
            type: 'BATTERY_SWAP',
            status: 'OPEN',
            scooterId: 's',
            scooterNumber: 142,
            dueAt: '2026-11-16T11:00:00.000Z',
            overdue: true,
          },
        ],
      },
      content: null,
    };
    expect(dashboardSummarySchema.safeParse(summary).success).toBe(true);
    expect(dashboardSummarySchema.safeParse({ ...summary, tiles: [{ key: 'salesToday', value: 1 }] }).success).toBe(
      false,
    );
  });
});
