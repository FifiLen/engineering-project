import { describe, expect, it } from 'vitest';
import { StaffPermissions, type Permission } from '../access/permissions.js';
import { DomainError } from '../errors.js';
import { SCOOTER_STATUSES } from '../fleet/fleet-status.js';
import { computeReport } from './build.js';
import { balanceRangeLabel } from './build-wallet.js';
import { heatmapCells } from './build-rides.js';
import { cohortTable } from './build-users.js';
import { fleetModelRows } from './build-fleet.js';
import { REPORT_CATALOG, REPORT_CODES, REPORT_PERMISSIONS, reportSections } from './catalog.js';
import { dashboardLayout, fleetStateSummary, ridesByHourSummary, visibleDashboardTiles } from './dashboard.js';
import {
  addDays,
  addMonthsClamped,
  intervalSeconds,
  isLocalDate,
  localDateOf,
  warsawMidnight,
  warsawWallClock,
} from './dates.js';
import {
  csvCellText,
  csvLine,
  ensureListExportWithinLimit,
  listCellValue,
  listExportFileName,
  protectFormula,
} from './list-export.js';
import { truncateReportTables } from './model.js';
import {
  autoGranularity,
  comparisonRange,
  rerunParamsInput,
  resolveReportParams,
  storedReportParams,
} from './params.js';
import type { FleetUsageScooterRow, ReportsRepository } from './ports.js';
import {
  ensureCanSeeReportRun,
  ensureCanUseReport,
  ensureReportFileDownloadable,
  ensureReportFormat,
  ensureReportRunRetryable,
  isReportRunAbandoned,
  reportFileExpired,
  reportFileName,
  reportRunState,
  visibleReportCodes,
} from './runs.js';
import {
  emptyTimeTotals,
  scooterTimeCategory,
  scooterUsageIndicators,
  timeTotalsFromIntervals,
} from './scooter-time.js';
import { reportWorkbookSheets, spreadsheetSheetName, spreadsheetValue } from './spreadsheet.js';

const NOW = new Date('2026-11-19T13:32:00Z'); // czwartek 19 listopada 2026, 14:32 w Warszawie
const H = 3600;

const domain = (fn: () => unknown) => {
  try {
    fn();
  } catch (error) {
    if (error instanceof DomainError) return { code: error.code, details: error.details };
    throw error;
  }
  return null;
};

const perms = (...codes: Permission[]) => new StaffPermissions(codes);

// --- Daty -----------------------------------------------------------------------------------------

describe('daty raportów w Europe/Warsaw', () => {
  it('północ polska jako chwila UTC, także w dobie zmiany czasu', () => {
    expect(warsawMidnight('2026-10-25').toISOString()).toBe('2026-10-24T22:00:00.000Z');
    expect(warsawMidnight('2026-10-26').toISOString()).toBe('2026-10-25T23:00:00.000Z');
    expect(warsawMidnight('2026-03-29').toISOString()).toBe('2026-03-28T23:00:00.000Z');
    expect(warsawMidnight('2026-03-30').toISOString()).toBe('2026-03-29T22:00:00.000Z');
  });

  it('doba zmiany czasu ma 25 albo 23 godziny, a październik 2026 ma 745 h', () => {
    const day = (d: string) => intervalSeconds({ from: warsawMidnight(d), to: warsawMidnight(addDays(d, 1)) }) / H;
    expect(day('2026-10-25')).toBe(25);
    expect(day('2026-03-29')).toBe(23);
    expect(intervalSeconds({ from: warsawMidnight('2026-10-01'), to: warsawMidnight('2026-11-01') }) / H).toBe(745);
  });

  it('data polska chwili, czas ścienny i walidacja dat', () => {
    expect(localDateOf(new Date('2026-10-31T23:30:00Z'))).toBe('2026-11-01');
    expect(warsawWallClock(new Date('2026-10-31T23:30:00Z')).toISOString()).toBe('2026-11-01T00:30:00.000Z');
    expect(isLocalDate('2026-09-31')).toBe(false);
    expect(isLocalDate('2026-02-28')).toBe(true);
    expect(addMonthsClamped('2026-10-31', -1)).toBe('2026-09-30');
    expect(addMonthsClamped('2026-01-15', -1)).toBe('2025-12-15');
  });
});

// --- Parametry --------------------------------------------------------------------------------------

describe('parametry raportów', () => {
  it('gotowe zakresy liczy od doby polskiej teraz', () => {
    const range = (preset: 'today' | 'yesterday' | 'last_7_days' | 'this_month' | 'previous_month') =>
      resolveReportParams('revenue', { preset }, NOW).range;
    expect(range('today')).toEqual({ from: '2026-11-19', to: '2026-11-19' });
    expect(range('yesterday')).toEqual({ from: '2026-11-18', to: '2026-11-18' });
    expect(range('last_7_days')).toEqual({ from: '2026-11-13', to: '2026-11-19' });
    expect(range('this_month')).toEqual({ from: '2026-11-01', to: '2026-11-19' });
    expect(range('previous_month')).toEqual({ from: '2026-10-01', to: '2026-10-31' });
  });

  it('poprzedni miesiąc: okres półotwarty, granulacja dzienna i porównanie z wrześniem wyrównane do dnia', () => {
    const p = resolveReportParams('revenue', { preset: 'previous_month' }, NOW);
    expect(p.period.from.toISOString()).toBe('2026-09-30T22:00:00.000Z');
    expect(p.period.to.toISOString()).toBe('2026-10-31T23:00:00.000Z');
    expect(p.days).toBe(31);
    expect(p.granularity).toBe('day');
    expect(p.granularityAuto).toBe(true);
    expect(p.comparison).toMatchObject({ range: { from: '2026-09-01', to: '2026-09-30' }, alignment: 'month' });
  });

  it('porównanie z okresem tej samej długości tuż przed (zakres niemiesięczny)', () => {
    expect(comparisonRange({ from: '2026-10-20', to: '2026-11-16' })).toEqual({
      range: { from: '2026-09-22', to: '2026-10-19' },
      alignment: 'length',
    });
    expect(comparisonRange({ from: '2026-11-01', to: '2026-11-19' })).toEqual({
      range: { from: '2026-10-01', to: '2026-10-19' },
      alignment: 'month',
    });
    expect(comparisonRange({ from: '2026-03-01', to: '2026-03-31' }).range).toEqual({
      from: '2026-02-01',
      to: '2026-02-28',
    });
  });

  it('granulacja automatyczna: do 62 dni dzień, do 182 tydzień, dalej miesiąc', () => {
    expect([autoGranularity(62), autoGranularity(63), autoGranularity(182), autoGranularity(183)]).toEqual([
      'day',
      'week',
      'week',
      'month',
    ]);
    const p = resolveReportParams('users', { from: '2026-01-01', to: '2026-11-19', granularity: 'week' }, NOW);
    expect(p.granularity).toBe('week');
    expect(p.granularityAuto).toBe(false);
    expect(p.preset).toBe('custom');
  });

  it('błędy walidacji: za długi zakres z liczbą dni, odwrócony, w przyszłości, brak dat, obcy filtr', () => {
    expect(domain(() => resolveReportParams('revenue', { from: '2025-11-18', to: '2026-11-19' }, NOW))).toEqual({
      code: 'REPORT_RANGE_TOO_LONG',
      details: { days: 367, maxDays: 366 },
    });
    expect(domain(() => resolveReportParams('revenue', { from: '2025-11-19', to: '2026-11-19' }, NOW))).toBeNull();
    expect(domain(() => resolveReportParams('revenue', { from: '2026-11-10', to: '2026-11-01' }, NOW))?.code).toBe(
      'REPORT_RANGE_INVALID',
    );
    expect(domain(() => resolveReportParams('revenue', { from: '2026-11-10', to: '2026-11-20' }, NOW))?.code).toBe(
      'REPORT_RANGE_IN_FUTURE',
    );
    expect(domain(() => resolveReportParams('revenue', { preset: 'custom' }, NOW))).toEqual({
      code: 'VALIDATION_FAILED',
      details: { field: 'from' },
    });
    expect(domain(() => resolveReportParams('revenue', { from: '2026-11-01' }, NOW))?.details).toEqual({ field: 'to' });
    expect(domain(() => resolveReportParams('revenue', { modelId: 'x' }, NOW))).toEqual({
      code: 'REPORT_PARAM_NOT_SUPPORTED',
      details: { param: 'modelId' },
    });
    expect(domain(() => resolveReportParams('wallet', { granularity: 'day' }, NOW))?.code).toBe(
      'REPORT_PARAM_NOT_SUPPORTED',
    );
  });

  it('raport bez szeregu nie ma granulacji; porównanie można wyłączyć', () => {
    const p = resolveReportParams('rides_by_zone', { preset: 'last_7_days', compare: false, zoneId: 'z1' }, NOW);
    expect(p.granularity).toBeNull();
    expect(p.comparison).toBeNull();
    expect(p.filters).toEqual({ zoneId: 'z1' });
  });

  it('„Uruchom ponownie z tymi parametrami” liczy ten sam okres bezwzględny z etykietą zakresu', () => {
    const first = resolveReportParams('fleet_usage', { preset: 'previous_month', modelId: 'm1' }, NOW);
    const stored = storedReportParams(first);
    expect(stored).toMatchObject({
      preset: 'previous_month',
      from: '2026-10-01',
      to: '2026-10-31',
      granularity: 'day',
      compare: true,
      modelId: 'm1',
      periodFrom: '2026-09-30T22:00:00.000Z',
      compareFrom: '2026-09-01',
    });
    const later = resolveReportParams('fleet_usage', rerunParamsInput(stored), new Date('2027-01-05T10:00:00Z'));
    expect(later.range).toEqual(first.range);
    expect(later.preset).toBe('previous_month');
    expect(later.filters).toEqual({ modelId: 'm1' });
  });
});

// --- Kategorie czasu i wskaźniki --------------------------------------------------------------------

describe('kategorie czasu hulajnogi (ADR 0074)', () => {
  it('przejazd i serwis także bez łączności, brak łączności przykrywa dostępną i rezerwację', () => {
    const table = SCOOTER_STATUSES.flatMap((status) =>
      [true, false].map((online) => `${status}/${online ? 'on' : 'off'}=${scooterTimeCategory(status, online)}`),
    );
    expect(table).toEqual([
      'AVAILABLE/on=AVAILABLE',
      'AVAILABLE/off=OFFLINE',
      'RESERVED/on=RESERVED',
      'RESERVED/off=OFFLINE',
      'IN_USE/on=IN_RIDE',
      'IN_USE/off=IN_RIDE',
      'MAINTENANCE/on=SERVICE',
      'MAINTENANCE/off=SERVICE',
      'RETIRED/on=RETIRED',
      'RETIRED/off=RETIRED',
    ]);
  });

  it('wykorzystanie = przejazd ÷ czas okresu, dostępność = (dostępna + rezerwacja + przejazd) ÷ czas okresu', () => {
    const totals = {
      ...emptyTimeTotals(),
      IN_RIDE: 111.2 * H,
      RESERVED: 6.4 * H,
      AVAILABLE: 611.3 * H,
      OFFLINE: 16.1 * H,
    };
    const result = scooterUsageIndicators(totals, 745 * H);
    expect(result.utilization).toBeCloseTo(0.1493, 4);
    expect(result.availability).toBeCloseTo((111.2 + 6.4 + 611.3) / 745, 6);
    expect(result.shares.OFFLINE).toBeCloseTo(16.1 / 745, 6);
    expect(scooterUsageIndicators(emptyTimeTotals(), 0).utilization).toBeNull();
  });

  it('przedziały przycięte do okresu, otwarty kończy się teraz', () => {
    const totals = timeTotalsFromIntervals(
      [
        {
          status: 'AVAILABLE',
          online: true,
          validFrom: new Date('2026-11-18T22:00:00Z'),
          validTo: new Date('2026-11-19T08:00:00Z'),
        },
        {
          status: 'IN_USE',
          online: false,
          validFrom: new Date('2026-11-19T08:00:00Z'),
          validTo: new Date('2026-11-19T09:00:00Z'),
        },
        { status: 'AVAILABLE', online: false, validFrom: new Date('2026-11-19T09:00:00Z'), validTo: null },
      ],
      { from: new Date('2026-11-18T23:00:00Z'), to: new Date('2026-11-19T23:00:00Z') },
      NOW,
    );
    expect(totals.AVAILABLE).toBe(9 * H);
    expect(totals.IN_RIDE).toBe(1 * H);
    expect(totals.OFFLINE).toBe(4 * H + 32 * 60);
  });
});

// --- Model raportów na danych z atrapy portu ----------------------------------------------------------

const bucket = (day: string) => ({
  bucket: day,
  bucketFrom: warsawMidnight(day),
  bucketTo: warsawMidnight(addDays(day, 1)),
});
const days = (from: string, n: number) => Array.from({ length: n }, (_, i) => addDays(from, i));

const scooterRow = (n: number, values: Partial<FleetUsageScooterRow> = {}): FleetUsageScooterRow => ({
  scooterId: `s${n}`,
  scooterNumber: n,
  modelId: 'm1',
  modelCode: 'BASE',
  modelName: 'podstawowy',
  currentStatus: 'AVAILABLE',
  historyFrom: null,
  periodSeconds: 100 * H,
  trackedSeconds: 100 * H,
  inRideSeconds: 10 * H,
  reservedSeconds: 1 * H,
  availableSeconds: 80 * H,
  serviceSeconds: 5 * H,
  offlineSeconds: 4 * H,
  retiredSeconds: 0,
  untrackedRideSeconds: 0,
  rides: 40,
  rideSeconds: 10 * H,
  distanceM: 80_000,
  revenueGross: 50_000,
  odometerM: 1_000_000,
  ...values,
});

function fakeRepo(overrides: Partial<ReportsRepository> = {}): ReportsRepository {
  const empty = async () => [];
  return {
    earliestData: async () => null,
    revenueSalesByVat: empty,
    revenueSalesSeries: async (period) => {
      const n = Math.round((period.to.getTime() - period.from.getTime()) / 86_400_000);
      return days(localDateOf(period.from), n).map((d) => ({
        ...bucket(d),
        salesGross: 0,
        correctionsGross: 0,
        gross: 0,
        vat: 0,
        net: 0,
        outsideVatGross: 0,
        saleReceipts: 0,
        correctionReceipts: 0,
        rides: 0,
      }));
    },
    revenueSalesByZone: empty,
    revenuePayments: empty,
    revenueRefunds: empty,
    fleetUsageByScooter: empty,
    fleetUsageByModel: empty,
    fleetUsageSeries: empty,
    ridesHeatmap: empty,
    ridesByEndZone: empty,
    ridesZoneEntries: empty,
    ridesEndModes: empty,
    reliabilityTickets: empty,
    reliabilityByScooter: empty,
    reliabilityByModel: empty,
    reliabilityTasks: empty,
    reliabilityParts: empty,
    reliabilityLowStock: empty,
    usersSummary: async () => ({
      registrations: 0,
      activeUsers: 0,
      newUsers: 0,
      returningUsers: 0,
      blockedUsers: 0,
      deletedUsers: 0,
      marketingGranted: 0,
      marketingRevoked: 0,
      marketingActiveAtEnd: 0,
      customersAtEnd: 0,
    }),
    usersSeries: empty,
    usersCohorts: empty,
    walletSummary: async () => ({
      openingBalance: 0,
      closingBalance: 0,
      openingNonzeroWallets: 0,
      closingNonzeroWallets: 0,
      entries: 0,
      credits: 0,
      debits: 0,
    }),
    walletTurnover: empty,
    walletAdjustments: empty,
    walletBalanceRanges: empty,
    walletArrears: async () => ({
      unpaidRentals: 0,
      unpaidUsers: 0,
      unpaidAmount: 0,
      periodUnpaidRentals: 0,
      periodUnpaidAmount: 0,
      periodRepaidRentals: 0,
      periodRepaidAmount: 0,
    }),
    dashboardRidesByHour: empty,
    ...overrides,
  };
}

describe('model raportów', () => {
  it('każdy raport z pustych danych: sekcje z katalogu i stan „Brak danych”', async () => {
    for (const code of REPORT_CODES) {
      const model = await computeReport(fakeRepo(), resolveReportParams(code, { preset: 'previous_month' }, NOW));
      const spec = REPORT_CATALOG[code];
      expect(model.empty, code).toBe(true);
      expect(model.tiles.map((t) => t.key)).toEqual(spec.tiles.map((t) => t.key));
      expect(model.charts.map((c) => c.key)).toEqual(spec.charts.map((c) => c.key));
      expect(model.tables.map((t) => t.key)).toEqual(spec.tables.map((t) => t.key));
      for (const chart of spec.charts) expect(spec.tables.some((t) => t.key === chart.tableKey)).toBe(true);
    }
  });

  it('przychody: kafelki z porównaniem, VAT według stawek z korektami i odholowaniem, wpływy minus zwroty na kartę', async () => {
    const params = resolveReportParams('revenue', { preset: 'previous_month' }, NOW);
    const october = params.period.from.getTime();
    const repo = fakeRepo({
      revenueSalesByVat: async (period) =>
        period.from.getTime() === october
          ? [
              { vatRate: 23, kind: 'SALE', receipts: 3, gross: 3690, vat: 690, net: 3000 },
              { vatRate: 23, kind: 'CORRECTION', receipts: 1, gross: -123, vat: -23, net: -100 },
              { vatRate: null, kind: 'SALE', receipts: 1, gross: 15000, vat: 0, net: 15000 },
            ]
          : [{ vatRate: 23, kind: 'SALE', receipts: 2, gross: 2460, vat: 460, net: 2000 }],
      revenueSalesSeries: async (period) => {
        const current = period.from.getTime() === october;
        const list = current ? days('2026-10-01', 31) : days('2026-09-01', 30);
        return list.map((d, i) => ({
          ...bucket(d),
          salesGross: i === 0 ? 18690 : 0,
          correctionsGross: i === 30 ? -123 : 0,
          gross: current ? (i === 0 ? 18690 : i === 30 ? -123 : 0) : i === 0 ? 2460 : 0,
          vat: 0,
          net: 0,
          outsideVatGross: 0,
          saleReceipts: i === 0 ? (current ? 3 : 2) : 0,
          correctionReceipts: current && i === 30 ? 1 : 0,
          rides: i === 0 ? (current ? 3 : 2) : 0,
        }));
      },
      revenuePayments: async () => [
        { purpose: 'TOPUP', method: 'CARD', payments: 2, amount: 10000, refundedPayments: 0 },
        { purpose: 'TOPUP', method: 'BLIK', payments: 1, amount: 5000, refundedPayments: 0 },
      ],
      revenueRefunds: async () => [
        { source: 'CARD', reason: 'BILLING_ERROR', refunds: 1, amount: 500 },
        { source: 'WALLET', reason: 'SCOOTER_FAILURE', refunds: 1, amount: 300 },
      ],
    });
    const model = await computeReport(repo, params);
    const tile = (key: string) => model.tiles.find((t) => t.key === key)!;
    expect(model.empty).toBe(false);
    expect(tile('salesGross')).toMatchObject({ value: 18567, previous: 2460 });
    expect(tile('salesGross').change).toBeCloseTo((18567 - 2460) / 2460, 6);
    expect(tile('vat').value).toBe(667);
    expect(tile('rides')).toMatchObject({ value: 3, previous: 2 });
    expect(tile('avgRideValue').value).toBeCloseTo(18567 / 3, 6);
    expect(tile('inflows').value).toBe(14500);

    const vat = model.tables.find((t) => t.key === 'salesByVat')!;
    expect(vat.rows.map((r) => [r.cells.item, r.cells.vatRate, r.cells.gross, r.style ?? ''])).toEqual([
      ['Przejazdy', '23%', 3690, ''],
      ['Korekty przejazdów', '23%', -123, ''],
      ['Razem stawka 23%', '23%', 3567, 'subtotal'],
      ['Odholowania (kara umowna)', 'poza VAT', 15000, ''],
    ]);
    expect(vat.rows[3]!.cells.vat).toBeNull();
    expect(vat.totals).toMatchObject({ receipts: 4, gross: 18567 });

    const inflows = model.tables.find((t) => t.key === 'inflowsByMethod')!;
    expect(inflows.rows.map((r) => [r.cells.method, r.cells.amount])).toEqual([
      ['Doładowania, karta', 10000],
      ['Doładowania, BLIK', 5000],
      ['Zwroty na kartę', -500],
    ]);

    // Porównanie miesięcy wyrównane do dnia: 31 października bez pary we wrześniu.
    const chart = model.charts[0]!;
    if (chart.type !== 'bar') throw new Error('słupki');
    expect(chart.items).toHaveLength(31);
    expect(chart.items[0]).toMatchObject({
      key: '2026-10-01',
      value: 18690,
      previous: 2460,
      previousKey: '2026-09-01',
    });
    expect(chart.items[30]).toMatchObject({ key: '2026-10-31', previous: null, previousKey: null });
    expect(chart.items[2]!.weekend).toBe(true); // sobota 3 października
  });

  it('wykorzystanie floty: przejazdy sprzed historii w czasie przejazdu, czas wyłączenia poza czasem okresu', async () => {
    const rows = [
      scooterRow(1),
      scooterRow(2, {
        inRideSeconds: 0,
        untrackedRideSeconds: 20 * H,
        trackedSeconds: 50 * H,
        availableSeconds: 30 * H,
      }),
      scooterRow(3, {
        modelId: 'm2',
        modelCode: 'PRO',
        modelName: 'pro',
        retiredSeconds: 50 * H,
        availableSeconds: 30 * H,
      }),
    ];
    const model = await computeReport(
      fakeRepo({ fleetUsageByScooter: async () => rows }),
      resolveReportParams('fleet_usage', { preset: 'last_7_days', scooterId: 's1', compare: false }, NOW),
    );
    const byScooter = model.tables.find((t) => t.key === 'byScooter')!;
    expect(byScooter.rows.map((r) => [r.cells.scooter, r.cells.inRideSeconds, r.cells.utilization])).toEqual([
      ['#0001', 10 * H, 0.1],
      ['#0002', 20 * H, 0.2],
      ['#0003', 10 * H, 0.2],
    ]);
    expect(byScooter.rows[0]!.cells.availability).toBeCloseTo(0.91, 6);
    const tile = (key: string) => model.tiles.find((t) => t.key === key)!;
    expect(tile('utilization').value).toBeCloseTo(40 / 250, 6);
    expect(tile('utilization').previous).toBeNull();
    // Przy filtrze hulajnogi tabela modeli powstaje z wierszy hulajnóg.
    expect(model.tables.find((t) => t.key === 'byModel')!.rows.map((r) => [r.cells.model, r.cells.scooters])).toEqual([
      ['podstawowy', 2],
      ['pro', 1],
    ]);
    expect(fleetModelRows(rows)[0]!.periodSeconds).toBe(100 * H);
    const share = model.charts.find((c) => c.key === 'timeShare')!;
    if (share.type !== 'share') throw new Error('pasek');
    expect(share.segments.map((s) => s.key)).toContain('UNTRACKED');
  });

  it('mapa ciepła: średnia na wystąpienie dnia tygodnia, wszystkie 168 komórek', () => {
    const cells = heatmapCells([
      { isodow: 5, hour: 17, rides: 81, dayOccurrences: 4 },
      { isodow: 5, hour: 18, rides: 0, dayOccurrences: 4 },
      { isodow: 1, hour: 0, rides: 0, dayOccurrences: 0 },
    ]);
    expect(cells).toHaveLength(168);
    expect(cells.find((c) => c.isodow === 5 && c.hour === 17)).toMatchObject({ value: 20.25, rides: 81, days: 4 });
    expect(cells.find((c) => c.isodow === 1 && c.hour === 0)!.value).toBeNull();
  });

  it('awaryjność: MTBF z sumy czasu w przejeździe i awarii, średni czas naprawy ważony zadaniami', async () => {
    const base = {
      modelId: 'm1',
      modelCode: 'BASE',
      modelName: 'podstawowy',
      tickets: 2,
      userTickets: 1,
      autoTickets: 1,
      staffTickets: 0,
      offlineTickets: 1,
      urgentTickets: 0,
      tasksCreated: 1,
      partsCost: 1000,
      serviceSeconds: H,
    };
    const model = await computeReport(
      fakeRepo({
        reliabilityByScooter: async () => [
          {
            ...base,
            scooterId: 's1',
            scooterNumber: 1,
            failures: 2,
            tasksDone: 1,
            avgRepairSeconds: 3600,
            inRideSeconds: 10 * H,
            mtbfHours: 5,
          },
          {
            ...base,
            scooterId: 's2',
            scooterNumber: 2,
            failures: 0,
            tasksDone: 3,
            avgRepairSeconds: 1200,
            inRideSeconds: 20 * H,
            mtbfHours: null,
          },
        ],
        reliabilityLowStock: async () => [
          {
            partId: 'p',
            sku: 'BRK',
            name: 'Klocki',
            stockQty: 1,
            minStockQty: 4,
            shortage: 3,
            unitCost: 2500,
            restockCost: 7500,
          },
        ],
      }),
      resolveReportParams('reliability', { preset: 'this_month' }, NOW),
    );
    const tile = (key: string) => model.tiles.find((t) => t.key === key)!;
    expect(tile('mtbfHours').value).toBe(15);
    expect(tile('avgRepairSeconds').value).toBe(1800);
    expect(tile('lowStockParts')).toMatchObject({ value: 1, previous: null });
    expect(model.tables.find((t) => t.key === 'byScooter')!.totals).toMatchObject({ failures: 2, mtbfHours: 15 });
  });

  it('kohorty w procentach i przedziały sald po polsku', () => {
    const cohorts = cohortTable([
      { cohortMonth: '2026-09-01', cohortSize: 10, monthOffset: 0, activeUsers: 8 },
      { cohortMonth: '2026-09-01', cohortSize: 10, monthOffset: 1, activeUsers: 5 },
      { cohortMonth: '2026-10-01', cohortSize: 0, monthOffset: 0, activeUsers: 0 },
    ]);
    expect(cohorts.columns.map((c) => c.key)).toEqual(['cohortMonth', 'cohortSize', 'm0', 'm1']);
    expect(cohorts.rows).toEqual([
      { cohortMonth: '2026-09-01', cohortSize: 10, m0: 0.8, m1: 0.5 },
      { cohortMonth: '2026-10-01', cohortSize: 0, m0: null, m1: null },
    ]);
    expect(balanceRangeLabel({ minAmount: null, maxAmount: -1 })).toBe('poniżej 0,00 zł');
    expect(balanceRangeLabel({ minAmount: 0, maxAmount: 0 })).toBe('0,00 zł');
    expect(balanceRangeLabel({ minAmount: 1, maxAmount: 1000 })).toBe('0,01–10,00 zł');
    expect(balanceRangeLabel({ minAmount: 20001, maxAmount: null })).toBe('powyżej 200,00 zł');
  });

  it('podgląd obcina tabele do 200 wierszy, a liczba wszystkich zostaje', async () => {
    const rows = Array.from({ length: 240 }, (_, i) => scooterRow(i + 1));
    const model = await computeReport(
      fakeRepo({ fleetUsageByScooter: async () => rows }),
      resolveReportParams('fleet_usage', { preset: 'previous_month' }, NOW),
    );
    const cut = truncateReportTables(model, 50).tables.find((t) => t.key === 'byScooter')!;
    expect([cut.rows.length, cut.totalRows]).toEqual([50, 240]);
    expect(model.rowCount).toBeGreaterThanOrEqual(240);
  });
});

// --- Uruchomienia, pliki, arkusze ----------------------------------------------------------------------

describe('uruchomienia raportów', () => {
  const dispatcher = perms('reports.fleet_usage', 'reports.rides_by_zone');

  it('raport i uruchomienia tylko z uprawnieniem raportu; brak to 404', () => {
    expect(visibleReportCodes(dispatcher)).toEqual(['fleet_usage', 'rides_by_zone']);
    expect(ensureCanUseReport(dispatcher, 'fleet_usage')).toBe('fleet_usage');
    expect(domain(() => ensureCanUseReport(dispatcher, 'revenue'))?.code).toBe('REPORT_NOT_FOUND');
    expect(domain(() => ensureCanUseReport(dispatcher, 'nieznany'))?.code).toBe('REPORT_NOT_FOUND');
    expect(domain(() => ensureCanSeeReportRun(dispatcher, { id: 'r', reportCode: 'wallet' }))?.code).toBe(
      'REPORT_RUN_NOT_FOUND',
    );
    expect(Object.values(REPORT_PERMISSIONS)).toHaveLength(6);
    expect(reportSections('revenue').tables[0]!.title).toBe('Sprzedaż według stawek VAT');
  });

  it('pobranie: gotowy plik przed retencją; „Plik usunięty” i w toku to błędy', () => {
    const run = { id: 'r', reportCode: 'fleet_usage', status: 'SUCCEEDED' as const, fileId: 'f', fileDeletedAt: null };
    expect(ensureReportFileDownloadable(dispatcher, run)).toBe('f');
    expect(domain(() => ensureReportFileDownloadable(dispatcher, { ...run, fileDeletedAt: NOW }))?.code).toBe(
      'REPORT_FILE_DELETED',
    );
    expect(domain(() => ensureReportFileDownloadable(dispatcher, { ...run, status: 'RUNNING' }))?.code).toBe(
      'REPORT_RUN_NOT_READY',
    );
    expect(reportRunState({ status: 'SUCCEEDED', fileDeletedAt: NOW })).toBe('FILE_DELETED');
    expect(domain(() => ensureReportRunRetryable({ id: 'r', status: 'QUEUED' }))?.code).toBe(
      'REPORT_RUN_NOT_RETRYABLE',
    );
    expect(domain(() => ensureReportRunRetryable({ id: 'r', status: 'FAILED' }))).toBeNull();
    expect(domain(() => ensureReportFormat('revenue', 'CSV', ['PDF', 'XLSX']))?.code).toBe('REPORT_FORMAT_NOT_ALLOWED');
    expect(domain(() => ensureReportFormat('revenue', 'XLSX', ['PDF']))?.code).toBe('REPORT_FORMAT_NOT_ALLOWED');
  });

  it('porządki: porzucone po 15 min, pliki po 30 dniach', () => {
    const created = new Date(NOW.getTime() - 16 * 60_000);
    expect(isReportRunAbandoned({ status: 'QUEUED', startedAt: null, createdAt: created }, NOW)).toBe(true);
    expect(isReportRunAbandoned({ status: 'SUCCEEDED', startedAt: null, createdAt: created }, NOW)).toBe(false);
    const finished = new Date(NOW.getTime() - 31 * 86_400_000);
    expect(reportFileExpired({ status: 'SUCCEEDED', finishedAt: finished, fileDeletedAt: null }, NOW)).toBe(true);
    expect(reportFileExpired({ status: 'FAILED', finishedAt: finished, fileDeletedAt: null }, NOW)).toBe(false);
  });

  it('nazwy plików według okresu', () => {
    const name = (input: Parameters<typeof resolveReportParams>[1], code = 'revenue' as const) =>
      reportFileName(resolveReportParams(code, input, NOW), 'PDF');
    expect(name({ preset: 'previous_month' })).toBe('revenue-2026-10.pdf');
    expect(name({ preset: 'yesterday' })).toBe('revenue-2026-11-18.pdf');
    expect(name({ from: '2026-10-01', to: '2026-10-14' })).toBe('revenue-2026-10-01_2026-10-14.pdf');
    expect(reportFileName(resolveReportParams('fleet_usage', { preset: 'this_month' }, NOW), 'XLSX')).toBe(
      'fleet-usage-2026-11.xlsx',
    );
  });

  it('arkusze XLSX: „Parametry” i arkusz na tabelę z kwotami w złotych i czasem jako ułamkiem doby', async () => {
    const params = resolveReportParams('fleet_usage', { preset: 'previous_month' }, NOW);
    const model = await computeReport(fakeRepo({ fleetUsageByScooter: async () => [scooterRow(7)] }), params);
    const sheets = reportWorkbookSheets(model, {
      runId: '9b27c3e1-0000-4000-8000-000000000000',
      name: 'Wykorzystanie floty',
      description: null,
      params,
      paramLabels: [{ label: 'Okres', value: '1–31 października 2026' }],
      dataAsOf: NOW,
      generatedAt: NOW,
      requestedBy: 'Piotr Mazur',
      companyName: '[nazwa]',
    });
    expect(sheets.map((s) => s.spec.name)).toEqual([
      'Parametry',
      'Według hulajnogi',
      'Według modelu',
      'Wykorzystanie w czasie',
    ]);
    expect(sheets[0]!.rows).toContainEqual(['Identyfikator uruchomienia', '9b27c3e1']);
    const byScooter = sheets[1]!;
    const col = (key: string) => byScooter.spec.columns.findIndex((c) => c.key === key);
    expect(byScooter.spec.columns[col('revenueGross')]!.type).toBe('money');
    expect(byScooter.rows[0]![col('revenueGross')]).toBe(500);
    expect(byScooter.rows[0]![col('inRideSeconds')]).toBeCloseTo(10 / 24, 9);
    expect(byScooter.rows[0]![col('distance')]).toBe(80);
    expect(spreadsheetValue('date', '2026-10-01')).toEqual(new Date(Date.UTC(2026, 9, 1)));
    expect(spreadsheetSheetName('Sprzedaż: według / stawek [VAT] i bardzo długiej nazwy')).toHaveLength(31);
    expect(spreadsheetSheetName('Zgłoszenia', new Set(['zgłoszenia']))).toBe('Zgłoszenia 2');
  });
});

describe('eksport list (ADR 0073)', () => {
  it('limit 50 000 wierszy z liczbą w szczegółach', () => {
    expect(domain(() => ensureListExportWithinLimit(50_001))).toEqual({
      code: 'LIST_EXPORT_LIMIT',
      details: { count: 50_001, limit: 50_000 },
    });
    expect(domain(() => ensureListExportWithinLimit(50_000))).toBeNull();
  });

  it('ochrona przed formułami, CSV ze średnikiem, przecinkiem dziesiętnym i czasem polskim', () => {
    expect(['=SUM(A1)', '+48', '-5', '@x', '\tx', 'ok'].map(protectFormula)).toEqual([
      "'=SUM(A1)",
      "'+48",
      "'-5",
      "'@x",
      "'\tx",
      'ok',
    ]);
    const money = { field: 'amount', label: 'Kwota', type: 'integer' as const, money: true };
    expect(csvCellText(money, -125050)).toBe('-1250,50');
    expect(csvCellText({ field: 'n', label: 'N', type: 'integer' }, -5)).toBe('-5');
    expect(csvCellText({ field: 't', label: 'T', type: 'datetime' }, new Date('2026-10-31T23:30:00Z'))).toBe(
      '01.11.2026 00:30',
    );
    expect(csvCellText({ field: 's', label: 'S', type: 'enum', values: { ENDED: 'Zakończony' } }, 'ENDED')).toBe(
      'Zakończony',
    );
    expect(csvCellText({ field: 'b', label: 'B', type: 'boolean' }, true)).toBe('tak');
    expect(csvLine(['a;b', 'c"d', 'e'])).toBe('"a;b";"c""d";e\r\n');
    expect(listCellValue(money, 1250)).toBe(12.5);
    expect(listCellValue({ field: 'x', label: 'X', type: 'text' }, '=1+1')).toBe('=1+1');
    expect(listExportFileName('rentals', 'csv', NOW)).toBe('rentals-2026-11-19-1432.csv');
  });
});

describe('pulpit', () => {
  const ADMIN = perms(
    'dashboard.read',
    'rentals.read',
    'scooters.read',
    'payments.read',
    'tickets.read',
    'service.read',
    'content.read',
  );
  const SERVICE = perms('dashboard.read', 'scooters.read', 'tickets.read', 'service.read');
  const EDITOR = perms('dashboard.read', 'content.read', 'content.write', 'templates.read');

  it('pierwsze pięć dozwolonych kafelków w stałej kolejności', () => {
    expect(visibleDashboardTiles(ADMIN)).toEqual([
      'activeRides',
      'availableScooters',
      'lowBattery',
      'salesToday',
      'newTickets',
    ]);
    expect(visibleDashboardTiles(SERVICE)).toEqual([
      'availableScooters',
      'lowBattery',
      'newTickets',
      'tasksInProgress',
      'partsBelowMinimum',
    ]);
    expect(visibleDashboardTiles(EDITOR)).toEqual([]);
  });

  it('układ według uprawnień: „Twoje zadania” zamiast wykresu przejazdów, treści u Redaktora', () => {
    expect(dashboardLayout(ADMIN)).toMatchObject({
      ridesByHour: true,
      myTasks: false,
      content: false,
      fleetState: true,
    });
    expect(dashboardLayout(SERVICE)).toMatchObject({ ridesByHour: false, myTasks: true, content: false });
    expect(dashboardLayout(EDITOR)).toMatchObject({
      ridesByHour: false,
      fleetState: false,
      myTasks: false,
      content: true,
    });
  });

  it('przejazdy według godzin i pasek stanu floty', () => {
    const summary = ridesByHourSummary(
      Array.from({ length: 24 }, (_, hour) => ({ hour, rides: hour < 15 ? 10 : 0, avgPrevious: 9.75 })),
      14,
    );
    expect(summary.hours[13]!.state).toBe('past');
    expect(summary.hours[14]!.state).toBe('current');
    expect(summary.hours[15]!.state).toBe('future');
    expect(summary.ridesSoFar).toBe(150);
    expect(summary.avgSoFar).toBe(146.25);
    const fleet = fleetStateSummary({
      AVAILABLE: 163,
      IN_USE: 30,
      RESERVED: 13,
      LOW_BATTERY: 14,
      MAINTENANCE: 12,
      OFFLINE: 8,
      RETIRED: 3,
    });
    expect(fleet.total).toBe(240);
    expect(fleet.retired).toBe(3);
    expect(fleet.segments[1]).toMatchObject({ key: 'IN_USE_OR_RESERVED', count: 43 });
    expect(fleet.segments[0]!.share).toBeCloseTo(163 / 240, 6);
  });
});
