import {
  DomainError,
  REPORT_CATALOG,
  type DashboardRidesByHourRow,
  type FleetUsageFilters,
  type FleetUsageModelRow,
  type FleetUsageScooterRow,
  type FleetUsageSeriesRow,
  type LocalDate,
  type ReliabilityLowStockRow,
  type ReliabilityModelRow,
  type ReliabilityPartRow,
  type ReliabilityScooterRow,
  type ReliabilityTaskRow,
  type ReliabilityTicketRow,
  type ReportCode,
  type ReportGranularity,
  type ReportInterval,
  type ReportsRepository,
  type RevenuePaymentRow,
  type RevenueRefundRow,
  type RevenueSalesByVatRow,
  type RevenueSalesByZoneRow,
  type RevenueSalesSeriesRow,
  type RidesByEndZoneRow,
  type RidesEndModeRow,
  type RidesHeatmapRow,
  type RidesZoneEntryRow,
  type RidesZoneFilters,
  type UsersCohortRow,
  type UsersSeriesRow,
  type UsersSummaryRow,
  type WalletAdjustmentRow,
  type WalletArrearsRow,
  type WalletBalanceRangeRow,
  type WalletSummaryRow,
  type WalletTurnoverRow,
} from '@hulajnogi/core';
import {
  reportDefinitionsResource,
  reportParamsJsonSchema,
  reportRunsResource,
  type ListQuery,
  type ListResponse,
  type ReportDefinitionListItem,
  type ReportRunListItem,
  type ResourceDefinition,
} from '@hulajnogi/shared';
import { inArray, sql, type SQL } from 'drizzle-orm';
import { runListQuery, type ListSource } from '../admin/list-query.js';
import type { Database, DbExecutor } from '../client.js';
import { vReportDefinitions, vReportRunList } from '../schema/schema.js';
import { parsePgArray } from './tickets.repository.js';

type Row = Record<string, unknown>;

const camel = (key: string) => key.replace(/_([a-z0-9])/g, (_, c: string) => c.toUpperCase());

/**
 * Wiersz funkcji raportowej w nazwach z camelCase. `bigint` i `numeric` przychodzą ze sterownika jako tekst,
 * więc kolumny z `numeric` zamieniamy na liczby (`null` zostaje `null`); `integer` i `smallint` są już liczbami.
 */
function mapRow<T>(row: Row, numeric: readonly string[]): T {
  const out: Row = {};
  for (const [key, value] of Object.entries(row)) {
    out[camel(key)] = numeric.includes(key) && value !== null && value !== undefined ? Number(value) : value;
  }
  return out as T;
}

const BUCKET = sql.raw('bucket::text AS bucket, bucket_from, bucket_to');

/** Kolumny `bigint` i `numeric` funkcji z migracji 0013 (do zamiany na liczby). */
const NUMERIC = {
  salesByVat: ['vat_rate', 'gross', 'vat', 'net'],
  salesSeries: ['sales_gross', 'corrections_gross', 'gross', 'vat', 'net', 'outside_vat_gross'],
  salesByZone: ['sales_gross', 'corrections_gross', 'gross', 'vat', 'net', 'outside_vat_gross'],
  payments: ['amount'],
  refunds: ['amount'],
  fleetTimes: [
    'period_seconds',
    'tracked_seconds',
    'in_ride_seconds',
    'reserved_seconds',
    'available_seconds',
    'service_seconds',
    'offline_seconds',
    'retired_seconds',
    'untracked_ride_seconds',
    'ride_seconds',
    'distance_m',
    'revenue_gross',
    'odometer_m',
  ],
  heatmap: [],
  endZone: ['avg_ride_seconds', 'total_ride_seconds', 'avg_distance_m', 'total_distance_m'],
  zoneEntries: ['total_seconds_in_zone', 'avg_seconds_in_zone'],
  tickets: ['avg_resolution_seconds'],
  reliability: ['avg_repair_seconds', 'parts_cost', 'service_seconds', 'in_ride_seconds', 'mtbf_hours'],
  tasks: ['avg_wait_seconds', 'avg_repair_seconds', 'parts_cost'],
  parts: ['cost'],
  lowStock: ['unit_cost', 'restock_cost'],
  wallet: ['opening_balance', 'closing_balance', 'credits', 'debits', 'net'],
  ranges: ['min_amount', 'max_amount', 'total_amount'],
  arrears: ['unpaid_amount', 'period_unpaid_amount', 'period_repaid_amount'],
  ridesByHour: ['avg_previous'],
} as const;

/** Mapowanie błędu limitu czasu zapytania (`statement_timeout`, SQLSTATE 57014) na `REPORT_TIMEOUT`. */
export function rethrowReportTimeout(error: unknown, timeoutMs: number): never {
  const cause = (error as { cause?: { code?: string } }).cause ?? (error as { code?: string });
  if (cause?.code === '57014') throw new DomainError('REPORT_TIMEOUT', { timeoutMs });
  throw error;
}

/**
 * Dane raportów (ADR 0071): implementacja portu `ReportsRepository` z packages/core przez funkcje `fn_report_*`
 * z migracji 0013. Repozytorium dostaje transakcję migawki (`withReportSnapshot`), więc wszystkie sekcje podglądu
 * i pliku widzą te same dane, a chwilą danych jest `now()` tej transakcji.
 */
export class DrizzleReportsRepository implements ReportsRepository {
  constructor(private readonly db: DbExecutor) {}

  private async call<T>(query: SQL, numeric: readonly string[]): Promise<T[]> {
    const { rows } = await this.db.execute<Row>(query);
    return rows.map((r) => mapRow<T>(r, numeric));
  }

  async earliestData(code: ReportCode): Promise<Date | null> {
    const { rows } = await this.db.execute<Row>(sql`SELECT fn_report_earliest_data(${code}) AS at`);
    const at = rows[0]?.at;
    return at === null || at === undefined ? null : new Date(at as string);
  }

  // --- Przychody ------------------------------------------------------------------------------------------

  revenueSalesByVat(p: ReportInterval) {
    return this.call<RevenueSalesByVatRow>(
      sql`SELECT * FROM fn_report_revenue_sales_by_vat(${p.from}, ${p.to})`,
      NUMERIC.salesByVat,
    );
  }

  revenueSalesSeries(p: ReportInterval, granularity: ReportGranularity) {
    return this.call<RevenueSalesSeriesRow>(
      sql`SELECT ${BUCKET}, sales_gross, corrections_gross, gross, vat, net, outside_vat_gross, sale_receipts,
                 correction_receipts, rides
          FROM fn_report_revenue_sales_series(${p.from}, ${p.to}, ${granularity})`,
      NUMERIC.salesSeries,
    );
  }

  revenueSalesByZone(p: ReportInterval) {
    return this.call<RevenueSalesByZoneRow>(
      sql`SELECT * FROM fn_report_revenue_sales_by_zone(${p.from}, ${p.to})`,
      NUMERIC.salesByZone,
    );
  }

  revenuePayments(p: ReportInterval) {
    return this.call<RevenuePaymentRow>(
      sql`SELECT purpose::text AS purpose, method::text AS method, payments, amount, refunded_payments
          FROM fn_report_revenue_payments(${p.from}, ${p.to})`,
      NUMERIC.payments,
    );
  }

  revenueRefunds(p: ReportInterval) {
    return this.call<RevenueRefundRow>(
      sql`SELECT source::text AS source, reason::text AS reason, refunds, amount
          FROM fn_report_revenue_refunds(${p.from}, ${p.to})`,
      NUMERIC.refunds,
    );
  }

  // --- Wykorzystanie floty --------------------------------------------------------------------------------

  fleetUsageByScooter(p: ReportInterval, f: FleetUsageFilters) {
    return this.call<FleetUsageScooterRow>(
      sql`SELECT * FROM fn_report_fleet_usage_by_scooter(${p.from}, ${p.to}, ${f.modelId ?? null}::uuid,
                                                         ${f.scooterId ?? null}::uuid)`,
      NUMERIC.fleetTimes,
    );
  }

  fleetUsageByModel(p: ReportInterval, f: Pick<FleetUsageFilters, 'modelId'>) {
    return this.call<FleetUsageModelRow>(
      sql`SELECT * FROM fn_report_fleet_usage_by_model(${p.from}, ${p.to}, ${f.modelId ?? null}::uuid)`,
      NUMERIC.fleetTimes,
    );
  }

  fleetUsageSeries(p: ReportInterval, granularity: ReportGranularity, f: FleetUsageFilters) {
    return this.call<FleetUsageSeriesRow>(
      sql`SELECT ${BUCKET}, period_seconds, scooters, in_ride_seconds, reserved_seconds, available_seconds,
                 service_seconds, offline_seconds, retired_seconds, rides
          FROM fn_report_fleet_usage_series(${p.from}, ${p.to}, ${granularity}, ${f.modelId ?? null}::uuid,
                                            ${f.scooterId ?? null}::uuid)`,
      NUMERIC.fleetTimes,
    );
  }

  // --- Przejazdy według stref i godzin --------------------------------------------------------------------

  ridesHeatmap(p: ReportInterval, f: RidesZoneFilters) {
    return this.call<RidesHeatmapRow>(
      sql`SELECT * FROM fn_report_rides_heatmap(${p.from}, ${p.to}, ${f.endZoneId ?? null}::uuid)`,
      NUMERIC.heatmap,
    );
  }

  ridesByEndZone(p: ReportInterval, f: RidesZoneFilters) {
    return this.call<RidesByEndZoneRow>(
      sql`SELECT * FROM fn_report_rides_by_end_zone(${p.from}, ${p.to}, ${f.endZoneId ?? null}::uuid)`,
      NUMERIC.endZone,
    );
  }

  ridesZoneEntries(p: ReportInterval, f: RidesZoneFilters) {
    return this.call<RidesZoneEntryRow>(
      sql`SELECT * FROM fn_report_rides_zone_entries(${p.from}, ${p.to}, ${f.endZoneId ?? null}::uuid)`,
      NUMERIC.zoneEntries,
    );
  }

  ridesEndModes(p: ReportInterval, f: RidesZoneFilters) {
    return this.call<RidesEndModeRow>(
      sql`SELECT end_mode::text AS end_mode, rides, towed, outside_parking
          FROM fn_report_rides_end_modes(${p.from}, ${p.to}, ${f.endZoneId ?? null}::uuid)`,
      [],
    );
  }

  // --- Awaryjność -----------------------------------------------------------------------------------------

  reliabilityTickets(p: ReportInterval, f: FleetUsageFilters) {
    return this.call<ReliabilityTicketRow>(
      sql`SELECT category::text AS category, source::text AS source, tickets, urgent, resolved, open,
                 avg_resolution_seconds
          FROM fn_report_reliability_tickets(${p.from}, ${p.to}, ${f.modelId ?? null}::uuid, ${f.scooterId ?? null}::uuid)`,
      NUMERIC.tickets,
    );
  }

  reliabilityByScooter(p: ReportInterval, f: FleetUsageFilters) {
    return this.call<ReliabilityScooterRow>(
      sql`SELECT * FROM fn_report_reliability_by_scooter(${p.from}, ${p.to}, ${f.modelId ?? null}::uuid,
                                                         ${f.scooterId ?? null}::uuid)`,
      NUMERIC.reliability,
    );
  }

  reliabilityByModel(p: ReportInterval, f: Pick<FleetUsageFilters, 'modelId'>) {
    return this.call<ReliabilityModelRow>(
      sql`SELECT * FROM fn_report_reliability_by_model(${p.from}, ${p.to}, ${f.modelId ?? null}::uuid)`,
      NUMERIC.reliability,
    );
  }

  reliabilityTasks(p: ReportInterval, f: FleetUsageFilters) {
    return this.call<ReliabilityTaskRow>(
      sql`SELECT task_type::text AS task_type, created, done, cancelled, open, avg_wait_seconds, avg_repair_seconds,
                 parts_cost
          FROM fn_report_reliability_tasks(${p.from}, ${p.to}, ${f.modelId ?? null}::uuid, ${f.scooterId ?? null}::uuid)`,
      NUMERIC.tasks,
    );
  }

  reliabilityParts(p: ReportInterval, f: FleetUsageFilters) {
    return this.call<ReliabilityPartRow>(
      sql`SELECT * FROM fn_report_reliability_parts(${p.from}, ${p.to}, ${f.modelId ?? null}::uuid, ${f.scooterId ?? null}::uuid)`,
      NUMERIC.parts,
    );
  }

  reliabilityLowStock() {
    return this.call<ReliabilityLowStockRow>(sql`SELECT * FROM fn_report_reliability_low_stock()`, NUMERIC.lowStock);
  }

  // --- Użytkownicy ----------------------------------------------------------------------------------------

  async usersSummary(p: ReportInterval) {
    const [row] = await this.call<UsersSummaryRow>(sql`SELECT * FROM fn_report_users_summary(${p.from}, ${p.to})`, []);
    return row!;
  }

  usersSeries(p: ReportInterval, granularity: ReportGranularity) {
    return this.call<UsersSeriesRow>(
      sql`SELECT ${BUCKET}, registrations, active_users, new_users, returning_users, blocked_users, deleted_users,
                 marketing_granted, marketing_revoked
          FROM fn_report_users_series(${p.from}, ${p.to}, ${granularity})`,
      [],
    );
  }

  usersCohorts(p: ReportInterval) {
    return this.call<UsersCohortRow>(
      sql`SELECT cohort_month::text AS cohort_month, cohort_size, month_offset, active_users
          FROM fn_report_users_cohorts(${p.from}, ${p.to})`,
      [],
    );
  }

  // --- Portfel --------------------------------------------------------------------------------------------

  async walletSummary(p: ReportInterval) {
    const [row] = await this.call<WalletSummaryRow>(
      sql`SELECT * FROM fn_report_wallet_summary(${p.from}, ${p.to})`,
      NUMERIC.wallet,
    );
    return row!;
  }

  walletTurnover(p: ReportInterval) {
    return this.call<WalletTurnoverRow>(
      sql`SELECT entry_type::text AS entry_type, entries, credits, debits, net
          FROM fn_report_wallet_turnover(${p.from}, ${p.to})`,
      NUMERIC.wallet,
    );
  }

  walletAdjustments(p: ReportInterval) {
    return this.call<WalletAdjustmentRow>(
      sql`SELECT reason::text AS reason, entries, credits, debits, net FROM fn_report_wallet_adjustments(${p.from}, ${p.to})`,
      NUMERIC.wallet,
    );
  }

  walletBalanceRanges(p: ReportInterval) {
    return this.call<WalletBalanceRangeRow>(
      sql`SELECT * FROM fn_report_wallet_balance_ranges(${p.from}, ${p.to})`,
      NUMERIC.ranges,
    );
  }

  async walletArrears(p: ReportInterval) {
    const [row] = await this.call<WalletArrearsRow>(
      sql`SELECT * FROM fn_report_wallet_arrears(${p.from}, ${p.to})`,
      NUMERIC.arrears,
    );
    return row!;
  }

  // --- Pulpit ---------------------------------------------------------------------------------------------

  dashboardRidesByHour(day: LocalDate) {
    return this.call<DashboardRidesByHourRow>(
      sql`SELECT * FROM fn_dashboard_rides_by_hour(${day}::date)`,
      NUMERIC.ridesByHour,
    );
  }
}

/**
 * Migawka danych raportu (ADR 0071): transakcja `REPEATABLE READ READ ONLY` z `SET LOCAL statement_timeout`
 * (podgląd 15 s, zadanie 60 s) i bez JIT, chwila danych `now()` i repozytorium na tej transakcji. Przekroczony limit to
 * `REPORT_TIMEOUT` z `details.timeoutMs`.
 */
export async function withReportSnapshot<T>(
  db: Database,
  options: { timeoutMs: number },
  fn: (repo: DrizzleReportsRepository, dataAsOf: Date) => Promise<T>,
): Promise<T> {
  const timeout = Math.max(1, Math.floor(options.timeoutMs));
  try {
    return await db.transaction(
      async (tx) => {
        await tx.execute(sql.raw(`SET LOCAL statement_timeout = ${timeout}`));
        // Kompilacja JIT zajmowała ponad 1 s z 1,4 s funkcji szeregów na 90 dniach danych z generatora; bez niej
        // każda funkcja raportowa mieści się poniżej 0,35 s (pomiar EXPLAIN ANALYZE, ADR 0075).
        await tx.execute(sql.raw('SET LOCAL jit = off'));
        const { rows } = await tx.execute<Row>(sql`SELECT now() AS now`);
        return fn(new DrizzleReportsRepository(tx), new Date(rows[0]!.now as string));
      },
      { isolationLevel: 'repeatable read', accessMode: 'read only' },
    );
  } catch (error) {
    rethrowReportTimeout(error, timeout);
  }
}

// --- Uruchomienia ------------------------------------------------------------------------------------------

type RunField = keyof typeof reportRunsResource.fields & string;
type DefinitionField = keyof typeof reportDefinitionsResource.fields & string;

const runColumns: ListSource<RunField>['columns'] = {
  id: vReportRunList.id,
  shortId: vReportRunList.shortId,
  reportCode: vReportRunList.reportCode,
  reportName: vReportRunList.reportName,
  format: vReportRunList.format,
  params: vReportRunList.params,
  status: vReportRunList.status,
  state: vReportRunList.state,
  requestedBy: vReportRunList.requestedBy,
  requestedByName: vReportRunList.requestedByName,
  requestedByRoles: vReportRunList.requestedByRoles,
  fileId: vReportRunList.fileId,
  fileSizeBytes: vReportRunList.fileSizeBytes,
  rowCount: vReportRunList.rowCount,
  pageCount: vReportRunList.pageCount,
  dataAsOf: vReportRunList.dataAsOf,
  errorCode: vReportRunList.errorCode,
  retryOf: vReportRunList.retryOf,
  createdAt: vReportRunList.createdAt,
  startedAt: vReportRunList.startedAt,
  finishedAt: vReportRunList.finishedAt,
  durationMs: vReportRunList.durationMs,
  fileDeletedAt: vReportRunList.fileDeletedAt,
};

const definitionSource: ListSource<DefinitionField> = {
  from: vReportDefinitions,
  id: vReportDefinitions.code,
  columns: {
    code: vReportDefinitions.code,
    name: vReportDefinitions.name,
    description: vReportDefinitions.description,
    permissionCode: vReportDefinitions.permissionCode,
    formats: vReportDefinitions.formats,
    active: vReportDefinitions.active,
    sortOrder: vReportDefinitions.sortOrder,
    permissionRoles: vReportDefinitions.permissionRoles,
    updatedBy: vReportDefinitions.updatedBy,
    updatedByName: vReportDefinitions.updatedByName,
    updatedAt: vReportDefinitions.updatedAt,
    version: vReportDefinitions.version,
    runs: vReportDefinitions.runs,
    lastRunId: vReportDefinitions.lastRunId,
    lastRunAt: vReportDefinitions.lastRunAt,
    lastRunFormat: vReportDefinitions.lastRunFormat,
    lastRunState: vReportDefinitions.lastRunState,
  },
};

export interface ReportRunRecord {
  id: string;
  reportCode: ReportCode;
  format: 'PDF' | 'XLSX';
  params: Record<string, unknown>;
  status: 'QUEUED' | 'RUNNING' | 'SUCCEEDED' | 'FAILED';
  requestedBy: string;
  requestedByName: string;
  fileId: string | null;
  fileStorageKey: string | null;
  fileSizeBytes: number | null;
  rowCount: number | null;
  pageCount: number | null;
  dataAsOf: Date | null;
  errorCode: string | null;
  error: string | null;
  retryOf: string | null;
  createdAt: Date;
  startedAt: Date | null;
  finishedAt: Date | null;
  fileDeletedAt: Date | null;
}

export interface NewReportRun {
  id: string;
  reportCode: ReportCode;
  format: 'PDF' | 'XLSX';
  params: Record<string, unknown>;
  requestedBy: string;
  retryOf?: string | null;
}

const runSql = sql`
  SELECT rr.id, rr.report_code, rr.format::text AS format, rr.params, rr.status::text AS status, rr.requested_by,
         s.name AS requested_by_name, rr.file_id, f.storage_key AS file_storage_key, f.size_bytes AS file_size_bytes,
         rr.row_count, rr.page_count, rr.data_as_of, rr.error_code, rr.error, rr.retry_of, rr.created_at,
         rr.started_at, rr.finished_at, rr.file_deleted_at
  FROM report_runs rr
  JOIN staff s ON s.id = rr.requested_by
  LEFT JOIN files f ON f.id = rr.file_id`;

const date = (v: unknown) => (v === null || v === undefined ? null : new Date(v as string));
const toRun = (r: Row): ReportRunRecord => ({
  id: r.id as string,
  reportCode: r.report_code as ReportCode,
  format: r.format as 'PDF' | 'XLSX',
  params: (r.params ?? {}) as Record<string, unknown>,
  status: r.status as ReportRunRecord['status'],
  requestedBy: r.requested_by as string,
  requestedByName: r.requested_by_name as string,
  fileId: (r.file_id as string | null) ?? null,
  fileStorageKey: (r.file_storage_key as string | null) ?? null,
  fileSizeBytes: r.file_size_bytes === null || r.file_size_bytes === undefined ? null : Number(r.file_size_bytes),
  rowCount: (r.row_count as number | null) ?? null,
  pageCount: (r.page_count as number | null) ?? null,
  dataAsOf: date(r.data_as_of),
  errorCode: (r.error_code as string | null) ?? null,
  error: (r.error as string | null) ?? null,
  retryOf: (r.retry_of as string | null) ?? null,
  createdAt: new Date(r.created_at as string),
  startedAt: date(r.started_at),
  finishedAt: date(r.finished_at),
  fileDeletedAt: date(r.file_deleted_at),
});

/**
 * Uruchomienia raportów (`report_runs`, ADR 0071): zlecenie, przejęcie przez zadanie `report.generate`, wynik,
 * porządki (`reports.sweep`) i retencja plików (`reports.retention`), Historia z kontraktu list zawężona do raportów
 * z uprawnieniem operatora.
 */
export class DrizzleReportRunsRepository {
  constructor(private readonly db: DbExecutor) {}

  private async rows(query: SQL): Promise<Row[]> {
    return (await this.db.execute<Row>(query)).rows;
  }

  /**
   * Historia (`GET /admin/report-runs`): tylko raporty z `codes` (uprawnienia `reports.<kod>` operatora), opcjonalnie
   * uruchomienia jednego zlecającego (szybki filtr „Moje” to filtr `requestedBy` z adresu).
   */
  async list(
    query: ListQuery,
    codes: readonly ReportCode[],
    def: ResourceDefinition<RunField> = reportRunsResource,
  ): Promise<ListResponse<ReportRunListItem>> {
    const source: ListSource<RunField> = {
      from: vReportRunList,
      id: vReportRunList.id,
      columns: runColumns,
      where: codes.length ? inArray(vReportRunList.reportCode, [...codes]) : sql`false`,
    };
    const result = await runListQuery<RunField, ReportRunListItem>(this.db, def, source, query);
    return {
      ...result,
      items: result.items.map((item) => ({ ...item, requestedByRoles: parsePgArray(item.requestedByRoles) })),
    };
  }

  async get(id: string): Promise<ReportRunRecord | null> {
    const [row] = await this.rows(sql`${runSql} WHERE rr.id = ${id}`);
    return row ? toRun(row) : null;
  }

  /** Wiersz z blokadą (zadanie `report.generate`). */
  async lock(id: string): Promise<ReportRunRecord | null> {
    await this.rows(sql`SELECT 1 FROM report_runs WHERE id = ${id} FOR UPDATE`);
    return this.get(id);
  }

  /** Nowe uruchomienie `QUEUED` (w tej samej transakcji API planuje zadanie przez `sendInTransaction`). */
  async insert(run: NewReportRun): Promise<void> {
    await this.db.execute(sql`
      INSERT INTO report_runs (id, report_code, format, params, requested_by, retry_of)
      VALUES (${run.id}, ${run.reportCode}, ${run.format}::report_format, ${JSON.stringify(run.params)}::jsonb,
              ${run.requestedBy}, ${run.retryOf ?? null})`);
  }

  /** Start zadania: `QUEUED` albo porzucony `RUNNING` (decyzja `shouldRunReportJob` w core). */
  async markRunning(id: string): Promise<void> {
    await this.db.execute(sql`
      UPDATE report_runs SET status = 'RUNNING', started_at = now() WHERE id = ${id} AND status IN ('QUEUED', 'RUNNING')`);
  }

  /** Powrót do kolejki przed ponowieniem (`RENDERER_UNAVAILABLE`). */
  async requeue(id: string): Promise<void> {
    await this.db.execute(
      sql`UPDATE report_runs SET status = 'QUEUED', started_at = NULL WHERE id = ${id} AND status = 'RUNNING'`,
    );
  }

  /** Gotowy plik: plik w magazynie, chwila danych, liczba wierszy tabel i stron PDF (XLSX bez stron). */
  async succeed(
    id: string,
    result: { fileId: string; dataAsOf: Date; rowCount: number; pageCount: number | null },
  ): Promise<void> {
    await this.db.execute(sql`
      UPDATE report_runs
      SET status = 'SUCCEEDED', finished_at = now(), file_id = ${result.fileId}, data_as_of = ${result.dataAsOf},
          row_count = ${result.rowCount}, page_count = ${result.pageCount}, error_code = NULL, error = NULL,
          started_at = COALESCE(started_at, now())
      WHERE id = ${id}`);
  }

  async fail(id: string, code: string, error: string | null, dataAsOf: Date | null = null): Promise<void> {
    await this.db.execute(sql`
      UPDATE report_runs
      SET status = 'FAILED', finished_at = now(), error_code = ${code}, error = ${error?.slice(0, 500) ?? null},
          data_as_of = COALESCE(${dataAsOf}, data_as_of), started_at = COALESCE(started_at, now())
      WHERE id = ${id}`);
  }

  /** `reports.sweep`: `QUEUED` i `RUNNING` porzucone przed `before` kończą się `FAILED` z kodem. */
  async failAbandoned(before: Date, code = 'REPORT_TIMEOUT', limit = 200): Promise<string[]> {
    const rows = await this.rows(sql`
      UPDATE report_runs r
      SET status = 'FAILED', finished_at = now(), error_code = ${code}, error = 'abandoned',
          started_at = COALESCE(r.started_at, now())
      WHERE r.id IN (
        SELECT id FROM report_runs
        WHERE status IN ('QUEUED', 'RUNNING') AND COALESCE(started_at, created_at) < ${before}
        ORDER BY created_at LIMIT ${limit}
        FOR UPDATE SKIP LOCKED)
      RETURNING r.id`);
    return rows.map((r) => r.id as string);
  }

  /** `reports.retention`: gotowe raporty z plikiem starszym niż `before` (partia po 200). */
  async expiredFiles(before: Date, limit = 200): Promise<ReportRunRecord[]> {
    const rows = await this.rows(sql`
      ${runSql}
      WHERE rr.status = 'SUCCEEDED' AND rr.file_deleted_at IS NULL AND rr.finished_at < ${before}
      ORDER BY rr.finished_at LIMIT ${limit}`);
    return rows.map(toRun);
  }

  /** Plik usunięty przez retencję: wiersz zostaje (stan „Plik usunięty”). */
  async markFileDeleted(id: string): Promise<boolean> {
    const { rowCount } = await this.db.execute(sql`
      UPDATE report_runs SET file_deleted_at = now()
      WHERE id = ${id} AND status = 'SUCCEEDED' AND file_deleted_at IS NULL`);
    return (rowCount ?? 0) > 0;
  }

  /**
   * Nazwy filtrów do nagłówka pliku i arkusza „Parametry” (strefa `KOD · nazwa`, model, hulajnoga `#0012`);
   * nieznany identyfikator daje `null` (raport z takim filtrem jest pusty).
   */
  async filterNames(filters: {
    zoneId?: string;
    modelId?: string;
    scooterId?: string;
  }): Promise<{ zone: string | null; model: string | null; scooter: string | null }> {
    const [row] = await this.rows(sql`
      SELECT (SELECT code || ' · ' || name FROM zones WHERE id = ${filters.zoneId ?? null}::uuid) AS zone,
             (SELECT name FROM scooter_models WHERE id = ${filters.modelId ?? null}::uuid) AS model,
             (SELECT '#' || lpad(number::text, 4, '0') FROM scooters WHERE id = ${filters.scooterId ?? null}::uuid)
               AS scooter`);
    return {
      zone: (row?.zone as string | null) ?? null,
      model: (row?.model as string | null) ?? null,
      scooter: (row?.scooter as string | null) ?? null,
    };
  }

  /** „Twoje ostatnie eksporty” w katalogu: trzy ostatnie uruchomienia operatora w dostępnych raportach. */
  async recentForStaff(staffId: string, codes: readonly ReportCode[], limit = 3): Promise<ReportRunRecord[]> {
    if (!codes.length) return [];
    const rows = await this.rows(sql`
      ${runSql}
      WHERE rr.requested_by = ${staffId}
        AND rr.report_code IN (${sql.join(
          codes.map((c) => sql`${c}`),
          sql`, `,
        )})
      ORDER BY rr.created_at DESC LIMIT ${limit}`);
    return rows.map(toRun);
  }
}

// --- Definicje ---------------------------------------------------------------------------------------------

export interface ReportDefinitionRecord {
  code: ReportCode;
  name: string;
  description: string | null;
  permissionCode: string;
  parameters: Record<string, unknown>;
  formats: Array<'PDF' | 'XLSX'>;
  active: boolean;
  sortOrder: number;
  updatedBy: string | null;
  updatedByName: string | null;
  updatedAt: Date;
  version: number;
  permissionRoles: string[];
  runs: number;
  lastRunId: string | null;
  lastRunAt: Date | null;
  lastRunFormat: 'PDF' | 'XLSX' | null;
  lastRunState: string | null;
}

const toDefinition = (r: Row): ReportDefinitionRecord => ({
  code: r.code as ReportCode,
  name: r.name as string,
  description: (r.description as string | null) ?? null,
  permissionCode: r.permission_code as string,
  parameters: (r.parameters ?? {}) as Record<string, unknown>,
  formats: parsePgArray<'PDF' | 'XLSX'>(r.formats),
  active: r.active as boolean,
  sortOrder: r.sort_order as number,
  updatedBy: (r.updated_by as string | null) ?? null,
  updatedByName: (r.updated_by_name as string | null) ?? null,
  updatedAt: new Date(r.updated_at as string),
  version: r.version as number,
  permissionRoles: parsePgArray(r.permission_roles),
  runs: r.runs as number,
  lastRunId: (r.last_run_id as string | null) ?? null,
  lastRunAt: date(r.last_run_at),
  lastRunFormat: (r.last_run_format as 'PDF' | 'XLSX' | null) ?? null,
  lastRunState: (r.last_run_state as string | null) ?? null,
});

const definitionSql = sql`
  SELECT code, name, description, permission_code, parameters, formats::text[] AS formats, active, sort_order,
         updated_by, updated_by_name, updated_at, version, permission_roles, runs, last_run_id, last_run_at,
         last_run_format::text AS last_run_format, last_run_state
  FROM v_report_definitions`;

/**
 * Definicje raportów (`report_definitions`, ADR 0071): katalog w panelu (aktywne raporty z uprawnieniem operatora
 * w kolejności `sort_order`), zakładka Definicje (`reports.manage`) i edycja pól operatora z blokadą optymistyczną.
 * Parametry i formaty synchronizuje seed z katalogu w core (`seedReportDefinitions`).
 */
export class DrizzleReportDefinitionsRepository {
  constructor(private readonly db: DbExecutor) {}

  private async rows(query: SQL): Promise<Row[]> {
    return (await this.db.execute<Row>(query)).rows;
  }

  async list(
    query: ListQuery,
    def: ResourceDefinition<DefinitionField> = reportDefinitionsResource,
  ): Promise<ListResponse<ReportDefinitionListItem>> {
    const result = await runListQuery<DefinitionField, ReportDefinitionListItem>(this.db, def, definitionSource, query);
    return {
      ...result,
      items: result.items.map((item) => ({
        ...item,
        formats: parsePgArray(item.formats),
        permissionRoles: parsePgArray(item.permissionRoles),
      })),
    };
  }

  /** Wszystkie definicje w kolejności katalogu (`sort_order`, kod). */
  async all(): Promise<ReportDefinitionRecord[]> {
    return (await this.rows(sql`${definitionSql} ORDER BY sort_order, code`)).map(toDefinition);
  }

  /** Katalog `GET /admin/reports`: aktywne definicje raportów z `codes` (uprawnienia operatora). */
  async catalog(codes: readonly ReportCode[]): Promise<ReportDefinitionRecord[]> {
    if (!codes.length) return [];
    return (
      await this.rows(sql`
        ${definitionSql}
        WHERE active AND code IN (${sql.join(
          codes.map((c) => sql`${c}`),
          sql`, `,
        )})
        ORDER BY sort_order, code`)
    ).map(toDefinition);
  }

  async get(code: string, options: { lock?: boolean } = {}): Promise<ReportDefinitionRecord | null> {
    if (options.lock) await this.rows(sql`SELECT 1 FROM report_definitions WHERE code = ${code} FOR UPDATE`);
    const [row] = await this.rows(sql`${definitionSql} WHERE code = ${code}`);
    return row ? toDefinition(row) : null;
  }

  /**
   * Zmiana pól operatora z wersją rekordu (`version` z formularza); `false`, gdy wersja się nie zgadza (konflikt,
   * baner „Zmieniło się w międzyczasie”). Dziennik audytu (`report_definition.updated`) zapisuje API w tej samej
   * transakcji.
   */
  async update(
    code: string,
    version: number,
    changes: { name?: string; description?: string | null; active?: boolean; sortOrder?: number },
    staffId: string,
  ): Promise<boolean> {
    const set: SQL[] = [];
    if (changes.name !== undefined) set.push(sql`name = ${changes.name}`);
    if (changes.description !== undefined) set.push(sql`description = ${changes.description}`);
    if (changes.active !== undefined) set.push(sql`active = ${changes.active}`);
    if (changes.sortOrder !== undefined) set.push(sql`sort_order = ${changes.sortOrder}`);
    set.push(sql`updated_by = ${staffId}`, sql`updated_at = now()`, sql`version = version + 1`);
    const { rowCount } = await this.db.execute(sql`
      UPDATE report_definitions SET ${sql.join(set, sql`, `)} WHERE code = ${code} AND version = ${version}`);
    return (rowCount ?? 0) > 0;
  }
}

// --- Synchronizacja z katalogiem (seed) ------------------------------------------------------------------

export interface ReportDefinitionSync {
  code: ReportCode;
  /** `created`: nowy wiersz z nazwą i opisem z katalogu; `updated`: zmienione uprawnienie, parametry albo formaty. */
  change: 'created' | 'updated' | 'unchanged';
  fields: Array<'permissionCode' | 'parameters' | 'formats'>;
}

/** Wartości z katalogu, które seed utrzymuje zgodne z kodem (D3). */
export function catalogDefinitionValues(code: ReportCode) {
  const spec = REPORT_CATALOG[code];
  return {
    permissionCode: spec.permission as string,
    parameters: reportParamsJsonSchema(code),
    formats: [...spec.formats],
  };
}

/** Porównanie JSON bez zależności od kolejności kluczy (jsonb zmienia kolejność). */
export function sameJson(a: unknown, b: unknown): boolean {
  const norm = (v: unknown): unknown =>
    Array.isArray(v)
      ? v.map(norm)
      : v && typeof v === 'object'
        ? Object.fromEntries(
            Object.entries(v as Record<string, unknown>)
              .sort(([x], [y]) => x.localeCompare(y))
              .map(([k, x]) => [k, norm(x)]),
          )
        : v;
  return JSON.stringify(norm(a)) === JSON.stringify(norm(b));
}
