import { formatDocumentNumber } from '../documents/format.js';
import { REPORT_CATALOG, REPORT_VALUE_LABELS as L } from './catalog.js';
import {
  categoryBarChart,
  chartSpec,
  finishModel,
  row,
  share,
  sumOf,
  tableFrom,
  tilesFrom,
  type ReportModel,
} from './model.js';
import type { ResolvedReportParams } from './params.js';
import type {
  ReportsRepository,
  WalletAdjustmentRow,
  WalletArrearsRow,
  WalletBalanceRangeRow,
  WalletSummaryRow,
  WalletTurnoverRow,
} from './ports.js';

/**
 * Raport portfela: saldo portfeli na początek i koniec okresu (zobowiązanie wobec klientów, `balance_after`
 * ostatniego wpisu przed granicą), obroty według typu, korekty według przyczyny, przedziały sald na koniec okresu
 * i zaległości. Same liczby, bez danych osobowych.
 */
export interface WalletData {
  code: 'wallet';
  current: {
    summary: WalletSummaryRow;
    turnover: WalletTurnoverRow[];
    adjustments: WalletAdjustmentRow[];
    balanceRanges: WalletBalanceRangeRow[];
    arrears: WalletArrearsRow;
  };
  previous: { summary: WalletSummaryRow } | null;
}

export async function loadWalletData(repo: ReportsRepository, params: ResolvedReportParams): Promise<WalletData> {
  const current = {
    summary: await repo.walletSummary(params.period),
    turnover: await repo.walletTurnover(params.period),
    adjustments: await repo.walletAdjustments(params.period),
    balanceRanges: await repo.walletBalanceRanges(params.period),
    arrears: await repo.walletArrears(params.period),
  };
  const previous = params.comparison ? { summary: await repo.walletSummary(params.comparison.period) } : null;
  return { code: 'wallet', current, previous };
}

const zl = (grosze: number) => `${formatDocumentNumber(grosze / 100, 2)} zł`;

/** Etykieta przedziału salda: „poniżej 0 zł”, „0 zł”, „0,01–10,00 zł”, „powyżej 200,00 zł”. */
export function balanceRangeLabel(range: Pick<WalletBalanceRangeRow, 'minAmount' | 'maxAmount'>): string {
  const { minAmount: min, maxAmount: max } = range;
  if (min === null && max !== null) return `poniżej ${zl(max + 1)}`;
  if (max === null && min !== null) return `powyżej ${zl(min - 1)}`;
  if (min !== null && max !== null && min === max) return zl(min);
  return `${formatDocumentNumber((min ?? 0) / 100, 2)}–${zl(max ?? 0)}`;
}

export function buildWalletReport(params: ResolvedReportParams, data: WalletData): ReportModel {
  const spec = REPORT_CATALOG.wallet;
  const { current, previous } = data;
  const tileValues = (s: WalletSummaryRow) => ({
    openingBalance: s.openingBalance,
    closingBalance: s.closingBalance,
    credits: s.credits,
    debits: s.debits,
    nonzeroWallets: s.closingNonzeroWallets,
  });
  const wallets = sumOf(current.balanceRanges, (r) => r.wallets);
  const a = current.arrears;
  const movement = (rows: ReadonlyArray<{ entries: number; credits: number; debits: number; net: number }>) => ({
    entries: sumOf(rows, (r) => r.entries),
    credits: sumOf(rows, (r) => r.credits),
    debits: sumOf(rows, (r) => r.debits),
    net: sumOf(rows, (r) => r.net),
  });

  return finishModel('wallet', {
    tiles: tilesFrom(
      spec,
      { ...tileValues(current.summary), unpaidAmount: a.unpaidAmount },
      previous ? tileValues(previous.summary) : null,
    ),
    charts: [
      categoryBarChart(
        chartSpec(spec, 'balanceRanges'),
        current.balanceRanges.map((r) => ({ key: String(r.rangeNo), label: balanceRangeLabel(r), value: r.wallets })),
      ),
    ],
    tables: [
      tableFrom(
        spec,
        'turnover',
        current.turnover.map((t) =>
          row({
            entryType: L.ledgerEntryType[t.entryType],
            entries: t.entries,
            credits: t.credits,
            debits: t.debits,
            net: t.net,
          }),
        ),
        { entryType: L.total, ...movement(current.turnover) },
      ),
      tableFrom(
        spec,
        'adjustments',
        current.adjustments.map((t) =>
          row({
            reason: t.reason ? L.ledgerReason[t.reason] : L.missing,
            entries: t.entries,
            credits: t.credits,
            debits: t.debits,
            net: t.net,
          }),
        ),
        current.adjustments.length ? { reason: L.total, ...movement(current.adjustments) } : null,
      ),
      tableFrom(
        spec,
        'balanceRanges',
        current.balanceRanges.map((r) =>
          row({
            range: balanceRangeLabel(r),
            wallets: r.wallets,
            share: share(r.wallets, wallets),
            total: r.totalAmount,
          }),
        ),
        {
          range: L.total,
          wallets,
          share: wallets > 0 ? 1 : null,
          total: sumOf(current.balanceRanges, (r) => r.totalAmount),
        },
      ),
      tableFrom(spec, 'arrears', [
        row({ metric: 'Nieopłacone teraz', rentals: a.unpaidRentals, users: a.unpaidUsers, amount: a.unpaidAmount }),
        row({
          metric: 'Powstałe w okresie i nadal nieopłacone',
          rentals: a.periodUnpaidRentals,
          users: null,
          amount: a.periodUnpaidAmount,
        }),
        row({
          metric: 'Spłacone w okresie',
          rentals: a.periodRepaidRentals,
          users: null,
          amount: a.periodRepaidAmount,
        }),
      ]),
    ],
    empty: current.summary.entries === 0 && current.summary.closingNonzeroWallets === 0 && a.unpaidRentals === 0,
  });
}
