import type { ReportCode } from './catalog.js';
import type { LocalDate } from './dates.js';
import type { ReportGranularity, ReportInterval } from './params.js';

/**
 * Port danych raportów (ADR 0071): metody odpowiadają funkcjom `fn_report_*` z migracji 0013 (okres półotwarty
 * `[from, to)`, kwoty w groszach, czasy w sekundach, dystans w metrach). Implementacja w packages/db wywołuje je
 * w jednej transakcji `REPEATABLE READ READ ONLY`, więc wszystkie sekcje widzą te same dane. Wartości `numeric`
 * z bazy (średnie, MTBF) przychodzą jako liczby albo `null`.
 */

export interface ReportBucketRow {
  /** Data początku przedziału w czasie polskim. */
  bucket: LocalDate;
  bucketFrom: Date;
  bucketTo: Date;
}

// --- Przychody ------------------------------------------------------------------------------------------

export interface RevenueSalesByVatRow {
  /** Stawka VAT w procentach (np. 23); `null` to pozycja poza VAT (opłata za odholowanie, ADR 0061). */
  vatRate: number | null;
  kind: 'SALE' | 'CORRECTION';
  receipts: number;
  gross: number;
  vat: number;
  net: number;
}

export interface RevenueSalesSeriesRow extends ReportBucketRow {
  salesGross: number;
  correctionsGross: number;
  gross: number;
  vat: number;
  net: number;
  outsideVatGross: number;
  saleReceipts: number;
  correctionReceipts: number;
  rides: number;
}

export interface RevenueSalesByZoneRow {
  /** `null`: przejazd zakończony poza strefą parkowania. */
  zoneId: string | null;
  zoneCode: string | null;
  zoneName: string | null;
  rides: number;
  salesGross: number;
  correctionsGross: number;
  gross: number;
  vat: number;
  net: number;
  outsideVatGross: number;
}

export interface RevenuePaymentRow {
  purpose: 'TOPUP' | 'RIDE';
  method: 'CARD' | 'BLIK';
  payments: number;
  amount: number;
  refundedPayments: number;
}

export interface RevenueRefundRow {
  source: 'WALLET' | 'CARD';
  reason: 'SCOOTER_FAILURE' | 'BILLING_ERROR' | 'CUSTOMER_COMPLAINT' | 'OTHER' | 'BALANCE_PAYOUT';
  refunds: number;
  amount: number;
}

// --- Wykorzystanie floty --------------------------------------------------------------------------------

export interface FleetTimeColumns {
  periodSeconds: number;
  trackedSeconds: number;
  inRideSeconds: number;
  reservedSeconds: number;
  availableSeconds: number;
  serviceSeconds: number;
  offlineSeconds: number;
  retiredSeconds: number;
  /** Czas przejazdów sprzed historii stanów (z `rentals`); czas w przejeździe = `inRideSeconds` + to. */
  untrackedRideSeconds: number;
}

export interface FleetUsageScooterRow extends FleetTimeColumns {
  scooterId: string;
  scooterNumber: number;
  modelId: string;
  modelCode: string;
  modelName: string;
  currentStatus: 'AVAILABLE' | 'RESERVED' | 'IN_USE' | 'MAINTENANCE' | 'RETIRED';
  historyFrom: Date | null;
  rides: number;
  rideSeconds: number;
  distanceM: number;
  revenueGross: number;
  odometerM: number;
}

export interface FleetUsageModelRow extends FleetTimeColumns {
  modelId: string;
  modelCode: string;
  modelName: string;
  scooters: number;
  rides: number;
  rideSeconds: number;
  distanceM: number;
  revenueGross: number;
}

export interface FleetUsageSeriesRow extends ReportBucketRow {
  periodSeconds: number;
  scooters: number;
  inRideSeconds: number;
  reservedSeconds: number;
  availableSeconds: number;
  serviceSeconds: number;
  offlineSeconds: number;
  retiredSeconds: number;
  rides: number;
}

// --- Przejazdy według stref i godzin --------------------------------------------------------------------

export interface RidesHeatmapRow {
  /** Dzień tygodnia ISO (1 = poniedziałek). */
  isodow: number;
  hour: number;
  rides: number;
  /** Liczba wystąpień tego dnia tygodnia w okresie. */
  dayOccurrences: number;
}

export type ZoneTypeValue = 'SERVICE_AREA' | 'PARKING' | 'SLOW' | 'NO_RIDE';

export interface RidesByEndZoneRow {
  zoneId: string | null;
  zoneCode: string | null;
  zoneName: string | null;
  zoneType: ZoneTypeValue | null;
  rides: number;
  endedRides: number;
  avgRideSeconds: number | null;
  totalRideSeconds: number;
  avgDistanceM: number | null;
  totalDistanceM: number;
}

export interface RidesZoneEntryRow {
  zoneId: string;
  zoneCode: string;
  zoneName: string;
  zoneType: ZoneTypeValue;
  entries: number;
  rides: number;
  totalSecondsInZone: number;
  avgSecondsInZone: number | null;
}

export interface RidesEndModeRow {
  /** `null` w przejazdach sprzed migracji 0008. */
  endMode: 'CUSTOMER' | 'CUSTOMER_OFFLINE' | 'REMOTE' | 'UNCONFIRMED' | null;
  rides: number;
  towed: number;
  outsideParking: number;
}

// --- Awaryjność -----------------------------------------------------------------------------------------

export type TicketCategoryValue =
  | 'BRAKES'
  | 'LIGHTS'
  | 'WHEEL'
  | 'HANDLEBAR'
  | 'QR_CODE'
  | 'BATTERY'
  | 'CONNECTION'
  | 'OTHER'
  | 'BILLING'
  | 'OUT_OF_ZONE';

export interface ReliabilityTicketRow {
  category: TicketCategoryValue;
  source: 'USER' | 'AUTO' | 'STAFF';
  tickets: number;
  urgent: number;
  resolved: number;
  open: number;
  avgResolutionSeconds: number | null;
}

export interface ReliabilityCounts {
  tickets: number;
  userTickets: number;
  autoTickets: number;
  staffTickets: number;
  offlineTickets: number;
  urgentTickets: number;
  failures: number;
  tasksCreated: number;
  tasksDone: number;
  avgRepairSeconds: number | null;
  partsCost: number;
  serviceSeconds: number;
  /** Z przejazdami sprzed historii stanów. */
  inRideSeconds: number;
  mtbfHours: number | null;
}

export interface ReliabilityScooterRow extends ReliabilityCounts {
  scooterId: string;
  scooterNumber: number;
  modelId: string;
  modelCode: string;
  modelName: string;
}

export interface ReliabilityModelRow extends ReliabilityCounts {
  modelId: string;
  modelCode: string;
  modelName: string;
  scooters: number;
}

export interface ReliabilityTaskRow {
  taskType: 'REPAIR' | 'BATTERY_SWAP' | 'INSPECTION' | 'RELOCATION';
  created: number;
  done: number;
  cancelled: number;
  open: number;
  avgWaitSeconds: number | null;
  avgRepairSeconds: number | null;
  partsCost: number;
}

export interface ReliabilityPartRow {
  partId: string;
  sku: string;
  name: string;
  quantity: number;
  cost: number;
  tasks: number;
  stockQty: number;
  minStockQty: number;
  belowMinimum: boolean;
}

export interface ReliabilityLowStockRow {
  partId: string;
  sku: string;
  name: string;
  stockQty: number;
  minStockQty: number;
  shortage: number;
  unitCost: number;
  restockCost: number;
}

// --- Użytkownicy ----------------------------------------------------------------------------------------

export interface UsersCounts {
  registrations: number;
  activeUsers: number;
  newUsers: number;
  returningUsers: number;
  blockedUsers: number;
  deletedUsers: number;
  marketingGranted: number;
  marketingRevoked: number;
}

export interface UsersSummaryRow extends UsersCounts {
  marketingActiveAtEnd: number;
  customersAtEnd: number;
}

export type UsersSeriesRow = ReportBucketRow & UsersCounts;

export interface UsersCohortRow {
  /** Pierwszy dzień miesiąca rejestracji (czas polski). */
  cohortMonth: LocalDate;
  cohortSize: number;
  /** 0 to miesiąc rejestracji. */
  monthOffset: number;
  activeUsers: number;
}

// --- Portfel --------------------------------------------------------------------------------------------

export interface WalletSummaryRow {
  openingBalance: number;
  closingBalance: number;
  openingNonzeroWallets: number;
  closingNonzeroWallets: number;
  entries: number;
  credits: number;
  /** Ujemne. */
  debits: number;
}

export interface WalletTurnoverRow {
  entryType: 'TOPUP' | 'RIDE_CHARGE' | 'REFUND' | 'ADJUSTMENT' | 'PAYOUT' | 'TOWING_FEE';
  entries: number;
  credits: number;
  debits: number;
  net: number;
}

export interface WalletAdjustmentRow {
  /** `null` w korektach sprzed migracji 0007. */
  reason: 'COMPLAINT' | 'SYSTEM_ERROR' | 'GOODWILL' | 'OTHER' | null;
  entries: number;
  credits: number;
  debits: number;
  net: number;
}

export interface WalletBalanceRangeRow {
  rangeNo: number;
  /** Granice w groszach, obie włącznie; `null` to brak granicy. */
  minAmount: number | null;
  maxAmount: number | null;
  wallets: number;
  totalAmount: number;
}

export interface WalletArrearsRow {
  unpaidRentals: number;
  unpaidUsers: number;
  unpaidAmount: number;
  periodUnpaidRentals: number;
  periodUnpaidAmount: number;
  periodRepaidRentals: number;
  periodRepaidAmount: number;
}

// --- Pulpit ---------------------------------------------------------------------------------------------

export interface DashboardRidesByHourRow {
  hour: number;
  rides: number;
  /** Średnia z czterech poprzednich tych samych dni tygodnia. */
  avgPrevious: number;
}

export interface FleetUsageFilters {
  modelId?: string;
  scooterId?: string;
}

export interface RidesZoneFilters {
  endZoneId?: string;
}

export interface ReportsRepository {
  /** `fn_report_earliest_data`: najwcześniejsza data źródła raportu (stan „Brak danych”). */
  earliestData(code: ReportCode): Promise<Date | null>;

  revenueSalesByVat(period: ReportInterval): Promise<RevenueSalesByVatRow[]>;
  revenueSalesSeries(period: ReportInterval, granularity: ReportGranularity): Promise<RevenueSalesSeriesRow[]>;
  revenueSalesByZone(period: ReportInterval): Promise<RevenueSalesByZoneRow[]>;
  revenuePayments(period: ReportInterval): Promise<RevenuePaymentRow[]>;
  revenueRefunds(period: ReportInterval): Promise<RevenueRefundRow[]>;

  fleetUsageByScooter(period: ReportInterval, filters: FleetUsageFilters): Promise<FleetUsageScooterRow[]>;
  fleetUsageByModel(period: ReportInterval, filters: Pick<FleetUsageFilters, 'modelId'>): Promise<FleetUsageModelRow[]>;
  fleetUsageSeries(
    period: ReportInterval,
    granularity: ReportGranularity,
    filters: FleetUsageFilters,
  ): Promise<FleetUsageSeriesRow[]>;

  ridesHeatmap(period: ReportInterval, filters: RidesZoneFilters): Promise<RidesHeatmapRow[]>;
  ridesByEndZone(period: ReportInterval, filters: RidesZoneFilters): Promise<RidesByEndZoneRow[]>;
  ridesZoneEntries(period: ReportInterval, filters: RidesZoneFilters): Promise<RidesZoneEntryRow[]>;
  ridesEndModes(period: ReportInterval, filters: RidesZoneFilters): Promise<RidesEndModeRow[]>;

  reliabilityTickets(period: ReportInterval, filters: FleetUsageFilters): Promise<ReliabilityTicketRow[]>;
  reliabilityByScooter(period: ReportInterval, filters: FleetUsageFilters): Promise<ReliabilityScooterRow[]>;
  reliabilityByModel(
    period: ReportInterval,
    filters: Pick<FleetUsageFilters, 'modelId'>,
  ): Promise<ReliabilityModelRow[]>;
  reliabilityTasks(period: ReportInterval, filters: FleetUsageFilters): Promise<ReliabilityTaskRow[]>;
  reliabilityParts(period: ReportInterval, filters: FleetUsageFilters): Promise<ReliabilityPartRow[]>;
  reliabilityLowStock(): Promise<ReliabilityLowStockRow[]>;

  usersSummary(period: ReportInterval): Promise<UsersSummaryRow>;
  usersSeries(period: ReportInterval, granularity: ReportGranularity): Promise<UsersSeriesRow[]>;
  usersCohorts(period: ReportInterval): Promise<UsersCohortRow[]>;

  walletSummary(period: ReportInterval): Promise<WalletSummaryRow>;
  walletTurnover(period: ReportInterval): Promise<WalletTurnoverRow[]>;
  walletAdjustments(period: ReportInterval): Promise<WalletAdjustmentRow[]>;
  walletBalanceRanges(period: ReportInterval): Promise<WalletBalanceRangeRow[]>;
  walletArrears(period: ReportInterval): Promise<WalletArrearsRow>;

  /** `fn_dashboard_rides_by_hour`: 24 wiersze doby polskiej `day`. */
  dashboardRidesByHour(day: LocalDate): Promise<DashboardRidesByHourRow[]>;
}
