import { buildFleetUsageReport, loadFleetUsageData, type FleetUsageData } from './build-fleet.js';
import { buildReliabilityReport, loadReliabilityData, type ReliabilityData } from './build-reliability.js';
import { buildRevenueReport, loadRevenueData, type RevenueData } from './build-revenue.js';
import { buildRidesByZoneReport, loadRidesByZoneData, type RidesByZoneData } from './build-rides.js';
import { buildUsersReport, loadUsersData, type UsersData } from './build-users.js';
import { buildWalletReport, loadWalletData, type WalletData } from './build-wallet.js';
import type { ReportModel } from './model.js';
import type { ResolvedReportParams } from './params.js';
import type { ReportsRepository } from './ports.js';

/**
 * Dane i model raportu (ADR 0071). `loadReportData` woła funkcje raportowe przez port dla okresu i okresu
 * porównawczego (API robi to w jednej transakcji `REPEATABLE READ READ ONLY`, a chwilą danych jest czas tej
 * transakcji); `buildReportModel` jest czystą funkcją z wierszy na kafelki, wykresy i tabele.
 */
export type ReportData = RevenueData | FleetUsageData | RidesByZoneData | ReliabilityData | UsersData | WalletData;

export function loadReportData(repo: ReportsRepository, params: ResolvedReportParams): Promise<ReportData> {
  switch (params.code) {
    case 'revenue':
      return loadRevenueData(repo, params);
    case 'fleet_usage':
      return loadFleetUsageData(repo, params);
    case 'rides_by_zone':
      return loadRidesByZoneData(repo, params);
    case 'reliability':
      return loadReliabilityData(repo, params);
    case 'users':
      return loadUsersData(repo, params);
    case 'wallet':
      return loadWalletData(repo, params);
  }
}

export function buildReportModel(params: ResolvedReportParams, data: ReportData): ReportModel {
  if (data.code !== params.code) throw new Error(`Dane raportu ${data.code} dla parametrów ${params.code}`);
  switch (data.code) {
    case 'revenue':
      return buildRevenueReport(params, data);
    case 'fleet_usage':
      return buildFleetUsageReport(params, data);
    case 'rides_by_zone':
      return buildRidesByZoneReport(params, data);
    case 'reliability':
      return buildReliabilityReport(params, data);
    case 'users':
      return buildUsersReport(params, data);
    case 'wallet':
      return buildWalletReport(params, data);
  }
}

/** Dane i model w jednym kroku (podgląd i zadanie `report.generate`). */
export async function computeReport(repo: ReportsRepository, params: ResolvedReportParams): Promise<ReportModel> {
  return buildReportModel(params, await loadReportData(repo, params));
}
