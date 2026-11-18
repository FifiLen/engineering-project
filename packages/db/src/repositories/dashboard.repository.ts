import type {
  AttentionCriticalBattery,
  AttentionFailedPayment,
  AttentionOfflineRental,
  AttentionUrgentTicket,
  PaymentMethodKind,
  PaymentPurpose,
  RentalState,
  ServiceTaskStatus,
  TicketCategory,
} from '@hulajnogi/shared';
import { sql } from 'drizzle-orm';
import type { DbExecutor } from '../client.js';
import { parsePgArray } from './tickets.repository.js';

type Row = Record<string, unknown>;
const iso = (v: unknown) => (v === null || v === undefined ? null : new Date(v as string).toISOString());
const num = (v: unknown) => (v === null || v === undefined ? null : Number(v));

export interface AttentionCounts {
  offlineInRental: number;
  billingStopped: number;
  criticalBattery: number;
  urgentNewUnassigned: number;
  failedPaymentsToday: number;
  unpaidRentals: number;
}

/**
 * Pulpit „Wymaga uwagi” (D1 iteracji 6): liczby z `fn_dashboard_attention` i najnowsze pozycje każdej grupy
 * z tymi samymi warunkami co funkcja, więc lista nie pokazuje pozycji spoza liczby.
 */
export class DrizzleDashboardRepository {
  constructor(private readonly db: DbExecutor) {}

  private async rows(query: ReturnType<typeof sql>): Promise<Row[]> {
    return (await this.db.execute<Row>(query)).rows;
  }

  async counts(criticalBatteryPct: number): Promise<AttentionCounts> {
    const [row] = await this.rows(sql`SELECT * FROM fn_dashboard_attention(${criticalBatteryPct})`);
    return {
      offlineInRental: row!.offline_in_rental as number,
      billingStopped: row!.billing_stopped as number,
      criticalBattery: row!.critical_battery as number,
      urgentNewUnassigned: row!.urgent_new_unassigned as number,
      failedPaymentsToday: row!.failed_payments_today as number,
      unpaidRentals: row!.unpaid_rentals as number,
    };
  }

  /** Hulajnogi offline w przejeździe, najdłużej bez sygnału najpierw. */
  async offlineRentals(limit: number): Promise<AttentionOfflineRental[]> {
    const rows = await this.rows(sql`
      SELECT r.id, r.number, r.state::text AS state, s.id AS scooter_id, s.number AS scooter_number, u.name AS user_name,
             s.last_seen_at, f.parking_zone_code, f.parking_zone_name, t.id AS ticket_id, t.number AS ticket_number,
             EXISTS (SELECT 1 FROM rental_events e WHERE e.rental_id = r.id AND e.type::text = 'BILLING_STOPPED')
               AS billing_stopped
      FROM rentals r
      JOIN scooters s ON s.id = r.scooter_id
      JOIN v_fleet_status f ON f.id = s.id
      LEFT JOIN users u ON u.id = r.user_id
      LEFT JOIN tickets t ON t.scooter_id = s.id AND t.auto_kind = 'OFFLINE' AND t.status <> 'RESOLVED'
      WHERE r.state IN ('UNLOCKING', 'ACTIVE', 'PAUSED', 'ENDING') AND NOT s.online
      ORDER BY s.last_seen_at NULLS FIRST, r.number LIMIT ${limit}`);
    return rows.map((r) => ({
      rentalId: r.id as string,
      rentalNumber: Number(r.number),
      rentalState: r.state as RentalState,
      scooterId: r.scooter_id as string,
      scooterNumber: r.scooter_number as number,
      userName: (r.user_name as string | null) ?? null,
      lastSeenAt: iso(r.last_seen_at),
      parkingZoneCode: (r.parking_zone_code as string | null) ?? null,
      parkingZoneName: (r.parking_zone_name as string | null) ?? null,
      ticketId: (r.ticket_id as string | null) ?? null,
      ticketNumber: num(r.ticket_number),
      billingStopped: r.billing_stopped as boolean,
    }));
  }

  /** Krytyczna bateria (wolne, zarezerwowane, w przejeździe), najniższa najpierw, z otwartą wymianą baterii. */
  async criticalBattery(criticalBatteryPct: number, limit: number): Promise<AttentionCriticalBattery[]> {
    const rows = await this.rows(sql`
      SELECT s.id, s.number, s.status::text AS status, s.battery_pct, f.parking_zone_code, f.parking_zone_name,
             f.rental_id, f.rental_number, st.id AS task_id, st.number AS task_number, st.status AS task_status,
             st.assignee_name, st.overdue
      FROM scooters s
      JOIN v_fleet_status f ON f.id = s.id
      LEFT JOIN v_service_task_list st ON st.scooter_id = s.id AND st.type = 'BATTERY_SWAP'
                                     AND st.status IN ('OPEN', 'IN_PROGRESS')
      WHERE s.status IN ('AVAILABLE', 'RESERVED', 'IN_USE') AND COALESCE(s.battery_pct, 0) < ${criticalBatteryPct}
      ORDER BY COALESCE(s.battery_pct, 0), s.number LIMIT ${limit}`);
    return rows.map((r) => ({
      scooterId: r.id as string,
      scooterNumber: r.number as number,
      status: r.status as string,
      batteryPct: (r.battery_pct as number | null) ?? null,
      parkingZoneCode: (r.parking_zone_code as string | null) ?? null,
      parkingZoneName: (r.parking_zone_name as string | null) ?? null,
      rentalId: (r.rental_id as string | null) ?? null,
      rentalNumber: num(r.rental_number),
      taskId: (r.task_id as string | null) ?? null,
      taskNumber: num(r.task_number),
      taskStatus: (r.task_status as ServiceTaskStatus | null) ?? null,
      taskAssigneeName: (r.assignee_name as string | null) ?? null,
      taskOverdue: (r.overdue as boolean | null) ?? false,
    }));
  }

  /** Nowe pilne zgłoszenia bez przypisania, najstarsze najpierw. */
  async urgentTickets(limit: number): Promise<AttentionUrgentTicket[]> {
    const rows = await this.rows(sql`
      SELECT id, number, categories::text[] AS categories, scooter_id, scooter_number, reporter_name, photos, created_at
      FROM v_ticket_list WHERE status = 'NEW' AND urgent AND assignee_id IS NULL
      ORDER BY created_at, number LIMIT ${limit}`);
    return rows.map((r) => ({
      ticketId: r.id as string,
      ticketNumber: Number(r.number),
      categories: parsePgArray<TicketCategory>(r.categories),
      scooterId: r.scooter_id as string,
      scooterNumber: r.scooter_number as number,
      reporterName: (r.reporter_name as string | null) ?? null,
      photos: r.photos as number,
      createdAt: iso(r.created_at)!,
    }));
  }

  /** Nieudane płatności z dzisiejszego dnia w strefie operatora, najnowsze najpierw. */
  async failedPayments(limit: number): Promise<AttentionFailedPayment[]> {
    const rows = await this.rows(sql`
      SELECT id, purpose::text AS purpose, method::text AS method, amount, user_id, user_name, rental_id, rental_number,
             failure_code, updated_at
      FROM v_payment_list
      WHERE status = 'FAILED'
        AND (updated_at AT TIME ZONE 'Europe/Warsaw')::date = (now() AT TIME ZONE 'Europe/Warsaw')::date
      ORDER BY updated_at DESC LIMIT ${limit}`);
    return rows.map((r) => ({
      paymentId: r.id as string,
      purpose: r.purpose as PaymentPurpose,
      method: r.method as PaymentMethodKind,
      amount: Number(r.amount),
      userId: r.user_id as string,
      userName: (r.user_name as string | null) ?? null,
      rentalId: (r.rental_id as string | null) ?? null,
      rentalNumber: num(r.rental_number),
      failureCode: (r.failure_code as string | null) ?? null,
      updatedAt: iso(r.updated_at)!,
    }));
  }
}
