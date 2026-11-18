import { BATTERY_CRITICAL_TICKET_PCT, type Permission } from '@hulajnogi/core';
import { type Database, DrizzleDashboardRepository } from '@hulajnogi/db';
import { DASHBOARD_GROUP_ITEMS, type DashboardAttention } from '@hulajnogi/shared';
import { Inject, Injectable } from '@nestjs/common';
import { StaffPermissionsService } from '../auth/staff-permissions.service.js';
import { DB } from '../database/database.module.js';

/**
 * Pulpit „Wymaga uwagi” (D1 iteracji 6): liczby z `fn_dashboard_attention` i do czterech pozycji na grupę. Grupa
 * wymaga `dashboard.read` (punkt API) i uprawnienia listy docelowej (ADR 0055); bez niego jest `null`.
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
    // Nazwisko klienta tylko z `users.read`, jak w listach zgłoszeń.
    const seesCustomers = can('users.read');
    return {
      criticalBatteryPct: BATTERY_CRITICAL_TICKET_PCT,
      offlineInRental: offline && {
        count: counts.offlineInRental,
        billingStopped: counts.billingStopped,
        items: offline,
      },
      criticalBattery: battery && { count: counts.criticalBattery, items: battery },
      urgentTickets: tickets && {
        count: counts.urgentNewUnassigned,
        items: seesCustomers ? tickets : tickets.map((t) => ({ ...t, reporterName: null })),
      },
      failedPayments: payments && {
        count: counts.failedPaymentsToday,
        unpaidRentals: counts.unpaidRentals,
        items: payments,
      },
      asOf: new Date().toISOString(),
    };
  }
}
