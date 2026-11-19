import { REPORT_CATALOG, type ReportColumnSpec } from './catalog.js';
import {
  alignPrevious,
  chartSpec,
  finishModel,
  row,
  share,
  sumOf,
  tableFrom,
  tableSpec,
  tilesFrom,
  timeBarChart,
  type ReportModel,
} from './model.js';
import type { ResolvedReportParams } from './params.js';
import type { ReportsRepository, UsersCohortRow, UsersSeriesRow, UsersSummaryRow } from './ports.js';

/**
 * Raport użytkowników: same liczby, bez danych osobowych. Aktywny klient ma przejazd ze startem w okresie, nowy
 * jeździ pierwszy raz, powracający jeździł już wcześniej; kohorty miesięczne podają procent zarejestrowanych
 * w miesiącu, którzy jeździli w kolejnych miesiącach okresu.
 */
export interface UsersData {
  code: 'users';
  current: { summary: UsersSummaryRow; series: UsersSeriesRow[]; cohorts: UsersCohortRow[] };
  previous: { summary: UsersSummaryRow; series: UsersSeriesRow[] } | null;
}

export async function loadUsersData(repo: ReportsRepository, params: ResolvedReportParams): Promise<UsersData> {
  const granularity = params.granularity ?? 'day';
  const current = {
    summary: await repo.usersSummary(params.period),
    series: await repo.usersSeries(params.period, granularity),
    cohorts: await repo.usersCohorts(params.period),
  };
  const previous = params.comparison
    ? {
        summary: await repo.usersSummary(params.comparison.period),
        series: await repo.usersSeries(params.comparison.period, granularity),
      }
    : null;
  return { code: 'users', current, previous };
}

const SUMMARY_METRICS: ReadonlyArray<[keyof UsersSummaryRow, string]> = [
  ['registrations', 'Rejestracje'],
  ['activeUsers', 'Aktywni klienci'],
  ['newUsers', 'Nowi klienci'],
  ['returningUsers', 'Powracający klienci'],
  ['blockedUsers', 'Blokady kont'],
  ['deletedUsers', 'Usunięte konta'],
  ['marketingGranted', 'Zgody marketingowe udzielone'],
  ['marketingRevoked', 'Zgody marketingowe wycofane'],
  ['marketingActiveAtEnd', 'Zgody marketingowe na koniec okresu'],
  ['customersAtEnd', 'Konta na koniec okresu'],
];

/** Kohorty jako tabela: wiersz na miesiąc rejestracji, kolumny `m0…mN` z udziałem aktywnych (0–1). */
export function cohortTable(rows: readonly UsersCohortRow[]): {
  columns: ReportColumnSpec[];
  rows: Array<Record<string, number | string | null>>;
} {
  const maxOffset = rows.reduce((max, r) => Math.max(max, r.monthOffset), -1);
  const months = Array.from({ length: maxOffset + 1 }, (_, i) => i);
  const columns: ReportColumnSpec[] = [
    ...tableSpec(REPORT_CATALOG.users, 'cohorts').columns,
    ...months.map((m) => ({
      key: `m${m}`,
      label: m === 0 ? 'Miesiąc rejestracji' : `Po ${m} mies.`,
      kind: 'percent' as const,
    })),
  ];
  const cohorts = [...new Set(rows.map((r) => r.cohortMonth))].sort();
  return {
    columns,
    rows: cohorts.map((month) => {
      const group = rows.filter((r) => r.cohortMonth === month);
      const size = group[0]?.cohortSize ?? 0;
      const cells: Record<string, number | string | null> = { cohortMonth: month, cohortSize: size };
      for (const m of months) {
        const r = group.find((g) => g.monthOffset === m);
        cells[`m${m}`] = r ? share(r.activeUsers, size) : null;
      }
      return cells;
    }),
  };
}

export function buildUsersReport(params: ResolvedReportParams, data: UsersData): ReportModel {
  const spec = REPORT_CATALOG.users;
  const granularity = params.granularity ?? 'day';
  const { current, previous } = data;
  const aligned = alignPrevious(
    current.series,
    previous?.series ?? null,
    params.comparison?.alignment ?? null,
    granularity,
  );
  const tileValues = (s: UsersSummaryRow) => ({
    registrations: s.registrations,
    activeUsers: s.activeUsers,
    newUsers: s.newUsers,
    returningUsers: s.returningUsers,
    blockedUsers: s.blockedUsers,
    marketingActiveAtEnd: s.marketingActiveAtEnd,
  });
  const cohorts = cohortTable(current.cohorts);
  const s = current.summary;

  return finishModel('users', {
    tiles: tilesFrom(spec, tileValues(s), previous ? tileValues(previous.summary) : null),
    charts: [
      timeBarChart(
        chartSpec(spec, 'activeSeries'),
        granularity,
        current.series,
        previous ? aligned : null,
        (r) => r.activeUsers,
      ),
    ],
    tables: [
      tableFrom(
        spec,
        'series',
        current.series.map((r, i) =>
          row({
            bucket: r.bucket,
            registrations: r.registrations,
            activeUsers: r.activeUsers,
            previousActiveUsers: aligned[i]?.activeUsers ?? null,
            newUsers: r.newUsers,
            returningUsers: r.returningUsers,
            blockedUsers: r.blockedUsers,
            deletedUsers: r.deletedUsers,
            marketingGranted: r.marketingGranted,
            marketingRevoked: r.marketingRevoked,
          }),
        ),
        {
          bucket: null,
          registrations: s.registrations,
          // Aktywni w całym okresie to nie suma przedziałów (klient jeździ w wielu przedziałach).
          activeUsers: s.activeUsers,
          previousActiveUsers: previous?.summary.activeUsers ?? null,
          newUsers: s.newUsers,
          returningUsers: s.returningUsers,
          blockedUsers: s.blockedUsers,
          deletedUsers: s.deletedUsers,
          marketingGranted: s.marketingGranted,
          marketingRevoked: s.marketingRevoked,
        },
      ),
      tableFrom(
        spec,
        'cohorts',
        cohorts.rows.map((cells) => row(cells)),
        null,
        cohorts.columns,
      ),
      tableFrom(
        spec,
        'summary',
        SUMMARY_METRICS.map(([key, metric]) =>
          row({ metric, value: s[key], previous: previous ? previous.summary[key] : null }),
        ),
      ),
    ],
    empty:
      s.registrations === 0 &&
      s.activeUsers === 0 &&
      s.blockedUsers === 0 &&
      s.deletedUsers === 0 &&
      s.marketingGranted === 0 &&
      s.marketingRevoked === 0 &&
      sumOf(current.series, (r) => r.registrations) === 0,
  });
}
