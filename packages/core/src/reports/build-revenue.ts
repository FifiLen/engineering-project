import { formatDocumentNumber } from '../documents/format.js';
import { REPORT_CATALOG, REPORT_VALUE_LABELS as L } from './catalog.js';
import {
  alignPrevious,
  average,
  chartSpec,
  finishModel,
  row,
  share,
  sumOf,
  tableFrom,
  tilesFrom,
  timeBarChart,
  type ReportModel,
  type ReportTableRow,
} from './model.js';
import type { ResolvedReportParams } from './params.js';
import type {
  ReportsRepository,
  RevenuePaymentRow,
  RevenueRefundRow,
  RevenueSalesByVatRow,
  RevenueSalesByZoneRow,
  RevenueSalesSeriesRow,
} from './ports.js';

/**
 * Raport przychodów (pytanie 2): sprzedaż z paragonów (brutto, netto, VAT według stawek, korekty ujemne z datą
 * korekty, odholowanie poza VAT jako kara umowna) i wpływy z płatności według metody minus zwroty na kartę. Zwrot
 * do portfela to uznanie salda bez wypływu pieniędzy, więc nie zmniejsza wpływów (jest w tabeli zwrotów).
 */
export interface RevenuePeriodData {
  salesByVat: RevenueSalesByVatRow[];
  series: RevenueSalesSeriesRow[];
  payments: RevenuePaymentRow[];
  refunds: RevenueRefundRow[];
}

export interface RevenueData {
  code: 'revenue';
  current: RevenuePeriodData & { salesByZone: RevenueSalesByZoneRow[] };
  previous: RevenuePeriodData | null;
}

async function periodData(
  repo: ReportsRepository,
  period: ResolvedReportParams['period'],
  granularity: NonNullable<ResolvedReportParams['granularity']>,
): Promise<RevenuePeriodData> {
  return {
    salesByVat: await repo.revenueSalesByVat(period),
    series: await repo.revenueSalesSeries(period, granularity),
    payments: await repo.revenuePayments(period),
    refunds: await repo.revenueRefunds(period),
  };
}

export async function loadRevenueData(repo: ReportsRepository, params: ResolvedReportParams): Promise<RevenueData> {
  const granularity = params.granularity ?? 'day';
  const current = await periodData(repo, params.period, granularity);
  const salesByZone = await repo.revenueSalesByZone(params.period);
  const previous = params.comparison ? await periodData(repo, params.comparison.period, granularity) : null;
  return { code: 'revenue', current: { ...current, salesByZone }, previous };
}

/** Wypływ pieniędzy przy zwrocie: tylko zwrot na kartę (zwrot do portfela zostaje w systemie). */
const cardRefunds = (refunds: readonly RevenueRefundRow[]) => refunds.filter((r) => r.source === 'CARD');

function tileValues(data: RevenuePeriodData): Record<string, number | null> {
  const gross = sumOf(data.salesByVat, (r) => r.gross);
  const rides = sumOf(data.series, (r) => r.rides);
  return {
    salesGross: gross,
    salesNet: sumOf(data.salesByVat, (r) => r.net),
    vat: sumOf(data.salesByVat, (r) => r.vat),
    rides,
    avgRideValue: average(gross, rides),
    inflows: sumOf(data.payments, (p) => p.amount) - sumOf(cardRefunds(data.refunds), (r) => r.amount),
  };
}

/** Stawka VAT po polsku: `23` → „23%”, `8.5` → „8,5%”; `null` → „poza VAT”. */
export const vatRateLabel = (rate: number | null): string =>
  rate === null ? L.outsideVat : `${formatDocumentNumber(rate, Number.isInteger(rate) ? 0 : 1)}%`;

function vatRows(rows: readonly RevenueSalesByVatRow[]): ReportTableRow[] {
  const rates = [...new Set(rows.map((r) => r.vatRate))].sort((a, b) => (a === null ? 1 : b === null ? -1 : b - a));
  const out: ReportTableRow[] = [];
  for (const rate of rates) {
    const group = rows.filter((r) => r.vatRate === rate);
    for (const r of [...group].sort((a, b) => (a.kind === b.kind ? 0 : a.kind === 'SALE' ? -1 : 1))) {
      const item =
        rate === null
          ? r.kind === 'SALE'
            ? 'Odholowania (kara umowna)'
            : 'Korekty odholowań'
          : r.kind === 'SALE'
            ? 'Przejazdy'
            : 'Korekty przejazdów';
      out.push(
        row({
          item,
          vatRate: vatRateLabel(rate),
          receipts: r.receipts,
          net: r.net,
          vat: rate === null ? null : r.vat,
          gross: r.gross,
        }),
      );
    }
    if (group.length > 1) {
      out.push(
        row(
          {
            item: rate === null ? `${L.total} poza VAT` : `${L.total} stawka ${vatRateLabel(rate)}`,
            vatRate: vatRateLabel(rate),
            receipts: null,
            net: sumOf(group, (r) => r.net),
            vat: rate === null ? null : sumOf(group, (r) => r.vat),
            gross: sumOf(group, (r) => r.gross),
          },
          'subtotal',
        ),
      );
    }
  }
  return out;
}

function inflowRows(payments: readonly RevenuePaymentRow[], refunds: readonly RevenueRefundRow[]): ReportTableRow[] {
  const rows = payments.map((p) =>
    row({
      method: `${L.paymentPurpose[p.purpose]}, ${L.paymentMethod[p.method]}`,
      operations: p.payments,
      amount: p.amount,
    }),
  );
  const card = cardRefunds(refunds);
  if (card.length)
    rows.push(
      row({
        method: 'Zwroty na kartę',
        operations: sumOf(card, (r) => r.refunds),
        amount: -sumOf(card, (r) => r.amount),
      }),
    );
  return rows;
}

const zoneLabel = (r: { zoneCode: string | null; zoneName: string | null }) =>
  r.zoneCode ? `${r.zoneCode} ${r.zoneName ?? ''}`.trim() : L.outsideParking;

export function buildRevenueReport(params: ResolvedReportParams, data: RevenueData): ReportModel {
  const spec = REPORT_CATALOG.revenue;
  const granularity = params.granularity ?? 'day';
  const { current, previous } = data;
  const aligned = alignPrevious(
    current.series,
    previous?.series ?? null,
    params.comparison?.alignment ?? null,
    granularity,
  );

  const salesByVat = vatRows(current.salesByVat);
  const vatTotals = {
    item: 'Razem sprzedaż',
    vatRate: null,
    receipts: sumOf(current.series, (r) => r.saleReceipts + r.correctionReceipts),
    net: sumOf(current.salesByVat, (r) => r.net),
    vat: sumOf(current.salesByVat, (r) => r.vat),
    gross: sumOf(current.salesByVat, (r) => r.gross),
  };

  const inflows = inflowRows(current.payments, current.refunds);
  const zoneRides = sumOf(current.salesByZone, (r) => r.rides);

  return finishModel('revenue', {
    tiles: tilesFrom(spec, tileValues(current), previous ? tileValues(previous) : null),
    charts: [
      timeBarChart(
        chartSpec(spec, 'salesSeries'),
        granularity,
        current.series,
        previous ? aligned : null,
        (r) => r.gross,
      ),
    ],
    tables: [
      tableFrom(spec, 'salesByVat', salesByVat, vatTotals),
      tableFrom(spec, 'inflowsByMethod', inflows, {
        method: 'Razem wpływy',
        operations: sumOf(inflows, (r) => r.cells.operations as number),
        amount: sumOf(inflows, (r) => r.cells.amount as number),
      }),
      tableFrom(
        spec,
        'refunds',
        current.refunds.map((r) =>
          row({
            source: L.paymentSource[r.source],
            reason: L.refundReason[r.reason],
            refunds: r.refunds,
            amount: r.amount,
          }),
        ),
        {
          source: L.total,
          reason: null,
          refunds: sumOf(current.refunds, (r) => r.refunds),
          amount: sumOf(current.refunds, (r) => r.amount),
        },
      ),
      tableFrom(
        spec,
        'salesByZone',
        current.salesByZone.map((r) =>
          row({
            zone: zoneLabel(r),
            rides: r.rides,
            share: share(r.rides, zoneRides),
            gross: r.gross,
            net: r.net,
            vat: r.vat,
            outsideVatGross: r.outsideVatGross,
            correctionsGross: r.correctionsGross,
            perRide: average(r.gross, r.rides),
          }),
        ),
        {
          zone: L.total,
          rides: zoneRides,
          share: zoneRides > 0 ? 1 : null,
          gross: sumOf(current.salesByZone, (r) => r.gross),
          net: sumOf(current.salesByZone, (r) => r.net),
          vat: sumOf(current.salesByZone, (r) => r.vat),
          outsideVatGross: sumOf(current.salesByZone, (r) => r.outsideVatGross),
          correctionsGross: sumOf(current.salesByZone, (r) => r.correctionsGross),
          perRide: average(
            sumOf(current.salesByZone, (r) => r.gross),
            zoneRides,
          ),
        },
      ),
      tableFrom(
        spec,
        'salesSeries',
        current.series.map((r, i) =>
          row({
            bucket: r.bucket,
            gross: r.gross,
            previousGross: aligned[i]?.gross ?? null,
            salesGross: r.salesGross,
            correctionsGross: r.correctionsGross,
            net: r.net,
            vat: r.vat,
            outsideVatGross: r.outsideVatGross,
            saleReceipts: r.saleReceipts,
            correctionReceipts: r.correctionReceipts,
            rides: r.rides,
          }),
        ),
        {
          bucket: null,
          gross: sumOf(current.series, (r) => r.gross),
          previousGross: previous ? sumOf(previous.series, (r) => r.gross) : null,
          salesGross: sumOf(current.series, (r) => r.salesGross),
          correctionsGross: sumOf(current.series, (r) => r.correctionsGross),
          net: sumOf(current.series, (r) => r.net),
          vat: sumOf(current.series, (r) => r.vat),
          outsideVatGross: sumOf(current.series, (r) => r.outsideVatGross),
          saleReceipts: sumOf(current.series, (r) => r.saleReceipts),
          correctionReceipts: sumOf(current.series, (r) => r.correctionReceipts),
          rides: sumOf(current.series, (r) => r.rides),
        },
      ),
    ],
    empty: current.salesByVat.length === 0 && current.payments.length === 0 && current.refunds.length === 0,
  });
}
