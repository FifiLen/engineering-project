import type { Permission } from '../access/permissions.js';
import type { PermissionSet } from '../documents/prints.js';
import type { FleetStatus } from '../fleet/fleet-status.js';
import type { DashboardRidesByHourRow } from './ports.js';

/**
 * Pulpit z kafelkami i wykresami (pytanie 9, plansze `33-panel-pulpit`): katalog kafelków w stałej kolejności,
 * każdy z uprawnieniem swoich danych; rola widzi pierwsze pięć dozwolonych. `GET /admin/dashboard/summary` zwraca
 * `null` dla kafelka, wykresu i bloku bez uprawnienia (ADR 0071), a „Wymaga uwagi” zostaje w `/attention`.
 */
export const DASHBOARD_TILE_KEYS = [
  'activeRides',
  'availableScooters',
  'lowBattery',
  'salesToday',
  'newTickets',
  'tasksInProgress',
  'partsBelowMinimum',
] as const;
export type DashboardTileKey = (typeof DASHBOARD_TILE_KEYS)[number];

/** Uprawnienie danych kafelka (lista docelowa po kliknięciu wymaga tego samego). */
export const DASHBOARD_TILE_PERMISSIONS: Readonly<Record<DashboardTileKey, Permission>> = {
  activeRides: 'rentals.read',
  availableScooters: 'scooters.read',
  lowBattery: 'scooters.read',
  salesToday: 'payments.read',
  newTickets: 'tickets.read',
  tasksInProgress: 'service.read',
  partsBelowMinimum: 'service.read',
};

/** Najwyżej pięć kafelków w rzędzie (plansza `pulpit-administrator`). */
export const DASHBOARD_MAX_TILES = 5;

/** Próg „krytycznej” baterii w opisie kafelka niskiej baterii (jak zgłoszenie `BATTERY_CRITICAL`). */
export const DASHBOARD_CRITICAL_BATTERY_PCT = 10;

/** Pozycje bloku „Twoje zadania” Serwisanta. */
export const DASHBOARD_MY_TASKS_ITEMS = 5;

/** Pierwsze pięć dozwolonych kafelków w kolejności katalogu. */
export const visibleDashboardTiles = (permissions: PermissionSet): DashboardTileKey[] =>
  DASHBOARD_TILE_KEYS.filter((key) => permissions.has(DASHBOARD_TILE_PERMISSIONS[key])).slice(0, DASHBOARD_MAX_TILES);

export interface DashboardLayout {
  tiles: DashboardTileKey[];
  /** „Przejazdy dziś według godzin” (`rentals.read`). */
  ridesByHour: boolean;
  /** „Stan floty” (`scooters.read`). */
  fleetState: boolean;
  /** „Twoje zadania” (`service.read`) w miejscu wykresu przejazdów, gdy roli brakuje `rentals.read` (Serwisant). */
  myTasks: boolean;
  /**
   * Kafelki i grupa „Treści” (`content.read`) dla roli bez kafelków operacyjnych (Redaktor); Administrator
   * i Dyspozytor mają treści w obszarze Treści, a nie na pulpicie (plansze `33-panel-pulpit`).
   */
  content: boolean;
}

export function dashboardLayout(permissions: PermissionSet): DashboardLayout {
  const tiles = visibleDashboardTiles(permissions);
  const ridesByHour = permissions.has('rentals.read');
  return {
    tiles,
    ridesByHour,
    fleetState: permissions.has('scooters.read'),
    myTasks: !ridesByHour && permissions.has('service.read'),
    content: tiles.length === 0 && permissions.has('content.read'),
  };
}

export interface RidesByHourSummary {
  hours: Array<{ hour: number; rides: number; avgPrevious: number; state: 'past' | 'current' | 'future' }>;
  /** Bieżąca godzina polska (dla doby `today`); `null` dla doby minionej. */
  currentHour: number | null;
  /** Starty do teraz i średnia z czterech poprzednich tych samych dni tygodnia do tej samej godziny. */
  ridesSoFar: number;
  avgSoFar: number;
}

/**
 * Wykres pulpitu z wierszy `fn_dashboard_rides_by_hour`: minione godziny, bieżąca (niepełna, kobalt) i przyszłe
 * (bez słupka, ze znacznikiem średniej). Godzina polska `currentHour` liczy API z `localHourOf(now)`.
 */
export function ridesByHourSummary(
  rows: readonly DashboardRidesByHourRow[],
  currentHour: number | null,
): RidesByHourSummary {
  const sorted = [...rows].sort((a, b) => a.hour - b.hour);
  const until = currentHour ?? 23;
  return {
    hours: sorted.map((r) => ({
      hour: r.hour,
      rides: r.rides,
      avgPrevious: r.avgPrevious,
      state: currentHour === null || r.hour < currentHour ? 'past' : r.hour === currentHour ? 'current' : 'future',
    })),
    currentHour,
    ridesSoFar: sorted.filter((r) => r.hour <= until).reduce((s, r) => s + r.rides, 0),
    avgSoFar: Math.round(sorted.filter((r) => r.hour <= until).reduce((s, r) => s + r.avgPrevious, 0) * 100) / 100,
  };
}

/** Segmenty paska stanu floty w kolejności legendy; wyłączone z ruchu są poza paskiem. */
export const FLEET_STATE_SEGMENTS = [
  'AVAILABLE',
  'IN_USE_OR_RESERVED',
  'LOW_BATTERY',
  'MAINTENANCE',
  'OFFLINE',
] as const;
export type FleetStateSegment = (typeof FLEET_STATE_SEGMENTS)[number];

export interface FleetStateSummary {
  /** Hulajnogi w ruchu (bez `RETIRED`). */
  total: number;
  retired: number;
  segments: Array<{ key: FleetStateSegment; count: number; share: number | null }>;
}

/** Pasek stanu floty z liczników statusu floty (`fn_fleet_status`, jak mapa floty). */
export function fleetStateSummary(counts: Partial<Record<FleetStatus, number>>): FleetStateSummary {
  const c = (s: FleetStatus) => counts[s] ?? 0;
  const values: Record<FleetStateSegment, number> = {
    AVAILABLE: c('AVAILABLE'),
    IN_USE_OR_RESERVED: c('IN_USE') + c('RESERVED'),
    LOW_BATTERY: c('LOW_BATTERY'),
    MAINTENANCE: c('MAINTENANCE'),
    OFFLINE: c('OFFLINE'),
  };
  const total = Object.values(values).reduce((s, v) => s + v, 0);
  return {
    total,
    retired: c('RETIRED'),
    segments: FLEET_STATE_SEGMENTS.map((key) => ({
      key,
      count: values[key],
      share: total > 0 ? values[key] / total : null,
    })),
  };
}
