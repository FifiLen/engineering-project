// Moduł Raporty (ADR 0071–0074): katalog, parametry, port danych, model raportu, wskaźniki czasu hulajnogi,
// arkusze XLSX, eksport list i pulpit. Pomocnicze funkcje budowania modelu (`model.ts`) zostają wewnątrz modułu.
export * from './catalog.js';
export * from './dates.js';
export * from './params.js';
export * from './ports.js';
export * from './scooter-time.js';
export * from './runs.js';
export * from './spreadsheet.js';
export * from './list-export.js';
export * from './dashboard.js';
export * from './build.js';
export type {
  ReportBarChartModel,
  ReportBarItem,
  ReportChartModel,
  ReportHeatmapCell,
  ReportHeatmapChartModel,
  ReportModel,
  ReportShareChartModel,
  ReportShareSegment,
  ReportTableModel,
  ReportTableRow,
  ReportTileModel,
  ReportValue,
} from './model.js';
export { isTableTruncated, mtbfHours, relativeChange, truncateReportTables } from './model.js';
export { fleetBasisSeconds, fleetHistoryNote, fleetTimeTotals, scooterLabel } from './build-fleet.js';
export { vatRateLabel } from './build-revenue.js';
export { balanceRangeLabel } from './build-wallet.js';
export { cohortTable } from './build-users.js';
export { heatmapCells } from './build-rides.js';
export type { RevenueData } from './build-revenue.js';
export type { FleetUsageData } from './build-fleet.js';
export type { RidesByZoneData } from './build-rides.js';
export type { ReliabilityData } from './build-reliability.js';
export type { UsersData } from './build-users.js';
export type { WalletData } from './build-wallet.js';
