import {
  BATTERY_CRITICAL_TICKET_PCT,
  dashboardLayout,
  DASHBOARD_CRITICAL_BATTERY_PCT,
  DASHBOARD_MY_TASKS_ITEMS,
  fleetStateSummary,
  localDateOf,
  localHourOf,
  ridesByHourSummary,
  warsawMidnight,
  type DashboardTileKey,
  type FleetStatus,
  type Permission,
} from '@hulajnogi/core';
import {
  type Database,
  type DashboardSummaryCounts,
  DrizzleDashboardRepository,
  DrizzleReportsRepository,
} from '@hulajnogi/db';
import {
  DASHBOARD_GROUP_ITEMS,
  type DashboardAttention,
  type DashboardSummary,
  type DashboardTile,
} from '@hulajnogi/shared';
import { Inject, Injectable } from '@nestjs/common';
import { StaffPermissionsService } from '../auth/staff-permissions.service.js';
import { DB } from '../database/database.module.js';

/**
 * Pulpit „Wymaga uwagi” (D1 iteracji 6): liczby z `fn_dashboard_attention` i do czterech pozycji na grupę. Grupa
 * wymaga `dashboard.read` (punkt API) i uprawnienia listy docelowej (ADR 0055); bez niego jest `null`. Od iteracji 8
 * także kafelki i wykresy (`summary`) z tą samą zasadą.
 */
@Injectable()
export class DashboardService {
  constructor(
    @Inject(DB) private readonly db: Database,
    private readonly permissions: StaffPermissionsService,
  ) {}

  async attention(staffId: string): Promise<DashboardAttention> {
    const granted = (await this.permissions.get(staffId)).permissions;
    const can = (permission: Permission) => granted.has(permission);
    const repo = new DrizzleDashboardRepository(this.db);
    const limit = DASHBOARD_GROUP_ITEMS;
    const counts = await repo.counts(BATTERY_CRITICAL_TICKET_PCT);
    const [offline, battery, tickets, payments] = await Promise.all([
      can('rentals.read') ? repo.offlineRentals(limit) : null,
      can('scooters.read') ? repo.criticalBattery(BATTERY_CRITICAL_TICKET_PCT, limit) : null,
      can('tickets.read') ? repo.urgentTickets(limit) : null,
      can('payments.read') ? repo.failedPayments(limit) : null,
    ]);
    // Nazwisko klienta tylko z `users.read`, jak w listach zgłoszeń: zgłaszający, klient przejazdu bez łączności
    // i klient nieudanej płatności.
    const seesCustomers = can('users.read');
    const masked = <T extends { userName: string | null }>(items: T[]) =>
      seesCustomers ? items : items.map((i) => ({ ...i, userName: null }));
    return {
      criticalBatteryPct: BATTERY_CRITICAL_TICKET_PCT,
      offlineInRental: offline && {
        count: counts.offlineInRental,
        billingStopped: counts.billingStopped,
        items: masked(offline),
      },
      criticalBattery: battery && { count: counts.criticalBattery, items: battery },
      urgentTickets: tickets && {
        count: counts.urgentNewUnassigned,
        items: seesCustomers ? tickets : tickets.map((t) => ({ ...t, reporterName: null })),
      },
      failedPayments: payments && {
        count: counts.failedPaymentsToday,
        unpaidRentals: counts.unpaidRentals,
        items: masked(payments),
      },
      asOf: new Date().toISOString(),
    };
  }

  /**
   * `GET /admin/dashboard/summary` (pytanie 9, plansze `33-panel-pulpit`): kafelki z `dashboardLayout` (pierwsze pięć
   * dozwolonych w stałej kolejności), przejazdy dziś według godzin ze średnią z 4 tych samych dni tygodnia
   * (`rentals.read`), stan floty (`scooters.read`), „Twoje zadania” Serwisanta i grupa „Treści” Redaktora; pole bez
   * uprawnienia ma wartość `null`, a kafelka bez uprawnienia nie ma w tablicy.
   */
  async summary(staffId: string, now = new Date()): Promise<DashboardSummary> {
    const granted = (await this.permissions.get(staffId)).permissions;
    const layout = dashboardLayout(granted);
    const repo = new DrizzleDashboardRepository(this.db);
    const today = localDateOf(now);
    const counts = layout.tiles.length
      ? await repo.summaryCounts({
          staffId,
          midnight: warsawMidnight(today),
          criticalBatteryPct: DASHBOARD_CRITICAL_BATTERY_PCT,
        })
      : null;
    const [rides, fleet, tasks, content] = await Promise.all([
      layout.ridesByHour ? new DrizzleReportsRepository(this.db).dashboardRidesByHour(today) : null,
      layout.fleetState ? repo.fleetStatusCounts() : null,
      layout.myTasks ? repo.myTasks(staffId, DASHBOARD_MY_TASKS_ITEMS) : null,
      layout.content ? repo.contentSummary(DASHBOARD_GROUP_ITEMS) : null,
    ]);
    return {
      asOf: now.toISOString(),
      tiles: counts ? layout.tiles.map((key) => dashboardTile(key, counts)) : [],
      ridesByHour: rides ? { day: today, ...ridesByHourSummary(rides, localHourOf(now)) } : null,
      fleetState: fleet ? fleetStateSummary(fleet as Partial<Record<FleetStatus, number>>) : null,
      // „Twoje zadania” ma tylko rola z `service.read`, a ta zawsze ma kafelek zadań, więc liczby są policzone.
      myTasks:
        tasks && counts
          ? {
              assigned: counts.tasksMine,
              overdue: counts.tasksMineOverdue,
              unassigned: counts.tasksUnassigned,
              inProgressTotal: counts.tasksInProgress,
              items: tasks,
            }
          : null,
      content,
    };
  }
}

/** Kafelek pulpitu z liczb (`summaryCounts`) według klucza katalogu z core. */
function dashboardTile(key: DashboardTileKey, c: DashboardSummaryCounts): DashboardTile {
  switch (key) {
    case 'activeRides':
      return { key, value: c.activeRides, startedLastHour: c.startedLastHour };
    case 'availableScooters':
      return {
        key,
        value: c.availableScooters,
        fleetTotal: c.fleetTotal,
        share: c.fleetTotal > 0 ? c.availableScooters / c.fleetTotal : null,
      };
    case 'lowBattery':
      return { key, value: c.lowBattery, critical: c.criticalBattery, thresholdPct: c.thresholdPct };
    case 'salesToday':
      return { key, value: c.salesToday, receipts: c.receiptsToday };
    case 'newTickets':
      return { key, value: c.newTickets, urgentUnassigned: c.urgentUnassigned };
    case 'tasksInProgress':
      return { key, value: c.tasksInProgress, mine: c.tasksMine, overdue: c.tasksMineOverdue };
    case 'partsBelowMinimum':
      return { key, value: c.partsBelowMinimum, names: c.partNames.slice(0, 3) };
  }
}
