import type {
  AttentionCriticalBattery,
  AttentionFailedPayment,
  AttentionOfflineRental,
  AttentionUrgentTicket,
  DashboardSummary,
  PaymentMethodKind,
  PaymentPurpose,
  RentalState,
  ServiceTaskStatus,
  TicketCategory,
} from '@hulajnogi/shared';
import { sql, type SQL } from 'drizzle-orm';
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

  private async rows(query: SQL): Promise<Row[]> {
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

  // --- Pulpit z kafelkami i wykresami (iteracja 8, plansze `33-panel-pulpit`) ------------------------------

  /**
   * Liczby kafelków operacyjnych w jednym zapytaniu (jedna chwila dla wszystkich kafelków). `midnight` to północ
   * doby polskiej (granica sprzedaży dziś), `staffId` zalogowany (zadania „Twoje”).
   */
  async summaryCounts(input: {
    staffId: string;
    midnight: Date;
    criticalBatteryPct: number;
  }): Promise<DashboardSummaryCounts> {
    const [row] = await this.rows(sql`
      WITH threshold AS (SELECT fn_low_battery_threshold() AS pct)
      SELECT
        (SELECT count(*) FROM rentals WHERE state IN ('UNLOCKING', 'ACTIVE', 'PAUSED', 'ENDING'))::int AS active_rides,
        (SELECT count(*) FROM rentals WHERE state <> 'RESERVED' AND started_at >= now() - interval '60 minutes')::int
          AS started_last_hour,
        (SELECT count(*) FROM v_fleet_list WHERE fleet_status = 'AVAILABLE')::int AS available_scooters,
        (SELECT count(*) FROM scooters WHERE status <> 'RETIRED')::int AS fleet_total,
        (SELECT count(*) FROM scooters, threshold
          WHERE status IN ('AVAILABLE', 'RESERVED', 'IN_USE') AND COALESCE(battery_pct, 0) < threshold.pct)::int
          AS low_battery,
        (SELECT count(*) FROM scooters
          WHERE status IN ('AVAILABLE', 'RESERVED', 'IN_USE')
            AND COALESCE(battery_pct, 0) < ${input.criticalBatteryPct})::int AS critical_battery,
        (SELECT pct FROM threshold)::int AS threshold_pct,
        (SELECT COALESCE(sum(total_amount), 0) FROM receipts WHERE issued_at >= ${input.midnight})::bigint
          AS sales_today,
        (SELECT count(*) FROM receipts WHERE kind = 'SALE' AND issued_at >= ${input.midnight})::int AS receipts_today,
        (SELECT count(*) FROM tickets WHERE status = 'NEW')::int AS new_tickets,
        (SELECT count(*) FROM tickets WHERE status = 'NEW' AND urgent AND assignee_id IS NULL)::int
          AS urgent_unassigned,
        (SELECT count(*) FROM service_tasks WHERE status IN ('OPEN', 'IN_PROGRESS'))::int AS tasks_in_progress,
        (SELECT count(*) FROM service_tasks WHERE status IN ('OPEN', 'IN_PROGRESS') AND assignee_id = ${input.staffId})::int
          AS tasks_mine,
        (SELECT count(*) FROM v_service_task_list
          WHERE status IN ('OPEN', 'IN_PROGRESS') AND assignee_id = ${input.staffId} AND overdue)::int AS tasks_mine_overdue,
        (SELECT count(*) FROM service_tasks WHERE status IN ('OPEN', 'IN_PROGRESS') AND assignee_id IS NULL)::int
          AS tasks_unassigned,
        (SELECT count(*) FROM v_low_stock_parts)::int AS parts_below_minimum,
        (SELECT COALESCE(array_agg(name ORDER BY shortage DESC, name), '{}')
          FROM (SELECT name, shortage FROM v_low_stock_parts ORDER BY shortage DESC, name LIMIT 3) p) AS part_names`);
    const n = (key: string) => Number(row![key] ?? 0);
    return {
      activeRides: n('active_rides'),
      startedLastHour: n('started_last_hour'),
      availableScooters: n('available_scooters'),
      fleetTotal: n('fleet_total'),
      lowBattery: n('low_battery'),
      criticalBattery: n('critical_battery'),
      thresholdPct: n('threshold_pct'),
      salesToday: n('sales_today'),
      receiptsToday: n('receipts_today'),
      newTickets: n('new_tickets'),
      urgentUnassigned: n('urgent_unassigned'),
      tasksInProgress: n('tasks_in_progress'),
      tasksMine: n('tasks_mine'),
      tasksMineOverdue: n('tasks_mine_overdue'),
      tasksUnassigned: n('tasks_unassigned'),
      partsBelowMinimum: n('parts_below_minimum'),
      partNames: parsePgArray<string>(row!.part_names),
    };
  }

  /** Liczniki statusu floty (`v_fleet_list.fleet_status`, ta sama reguła co mapa floty). */
  async fleetStatusCounts(): Promise<Record<string, number>> {
    const rows = await this.rows(sql`SELECT fleet_status, count(*)::int AS n FROM v_fleet_list GROUP BY fleet_status`);
    return Object.fromEntries(rows.map((r) => [r.fleet_status as string, r.n as number]));
  }

  /** „Twoje zadania” Serwisanta: otwarte i w toku przypisane do operatora, najbliższy termin najpierw. */
  async myTasks(staffId: string, limit: number): Promise<DashboardMyTask[]> {
    const rows = await this.rows(sql`
      SELECT id, number, type::text AS type, status::text AS status, scooter_id, scooter_number, due_at, overdue
      FROM v_service_task_list
      WHERE status IN ('OPEN', 'IN_PROGRESS') AND assignee_id = ${staffId}
      ORDER BY due_at NULLS LAST, number LIMIT ${limit}`);
    return rows.map((r) => ({
      taskId: r.id as string,
      number: Number(r.number),
      type: r.type as DashboardMyTask['type'],
      status: r.status as DashboardMyTask['status'],
      scooterId: r.scooter_id as string,
      scooterNumber: r.scooter_number as number,
      dueAt: iso(r.due_at),
      overdue: (r.overdue as boolean | null) ?? false,
    }));
  }

  /**
   * Grupa „Treści” Redaktora (dług z iteracji 7): liczby kafelków treści i cztery podgrupy z najwyżej `limit`
   * pozycjami: zaplanowane i wygasające aktualności w ciągu 7 dni, szkice (aktualności, bloki sekcji, wersje
   * dokumentów prawnych) i nieużywane grafiki (bez systemowych).
   */
  async contentSummary(limit: number): Promise<DashboardContentSummary> {
    const [counts] = await this.rows(sql`
      SELECT
        (SELECT count(*) FROM v_news_list WHERE state = 'PUBLISHED')::int AS news_published,
        (SELECT count(*) FROM v_news_list WHERE state = 'SCHEDULED')::int AS news_scheduled,
        (SELECT count(*) FROM v_news_list WHERE state = 'SCHEDULED' AND publish_from <= now() + interval '7 days')::int
          AS news_scheduled_soon,
        (SELECT count(*) FROM v_news_list
          WHERE state = 'PUBLISHED' AND publish_to IS NOT NULL AND publish_to <= now() + interval '7 days')::int
          AS news_expiring,
        (SELECT count(*) FROM faq_items WHERE status = 'PUBLISHED')::int AS faq_published,
        (SELECT count(DISTINCT category_id) FROM faq_items WHERE status = 'PUBLISHED')::int AS faq_categories,
        (SELECT count(*) FROM faq_items WHERE status = 'DRAFT')::int AS faq_unpublished,
        (SELECT count(*) FROM content_blocks WHERE status = 'PUBLISHED')::int AS blocks_published,
        (SELECT count(*) FROM content_blocks WHERE status = 'PUBLISHED' AND client = 'WEB')::int AS blocks_web,
        (SELECT count(*) FROM content_blocks WHERE status = 'PUBLISHED' AND client = 'MOBILE')::int AS blocks_mobile,
        (SELECT count(*) FROM content_blocks WHERE status = 'DRAFT')::int AS blocks_drafts,
        (SELECT count(*) FROM media_assets)::int AS media,
        (SELECT count(*) FROM v_media_list WHERE usages = 0 AND NOT is_system)::int AS media_unused,
        ((SELECT count(*) FROM news WHERE status = 'DRAFT') + (SELECT count(*) FROM content_blocks WHERE status = 'DRAFT')
          + (SELECT count(*) FROM content_page_versions WHERE status = 'DRAFT'))::int AS drafts,
        GREATEST((SELECT max(first_published_at) FROM news),
                 (SELECT max(published_at) FROM content_page_versions)) AS last_published_at`);
    const n = (key: string) => Number(counts![key] ?? 0);

    const scheduled = await this.rows(sql`
      SELECT id, title, publish_from, COALESCE(updated_by_name, created_by_name) AS author_name
      FROM v_news_list
      WHERE state = 'SCHEDULED' AND publish_from <= now() + interval '7 days'
      ORDER BY publish_from, title LIMIT ${limit}`);
    const expiring = await this.rows(sql`
      SELECT id, title, publish_to, COALESCE(updated_by_name, created_by_name) AS author_name
      FROM v_news_list
      WHERE state = 'PUBLISHED' AND publish_to IS NOT NULL AND publish_to <= now() + interval '7 days'
      ORDER BY publish_to, title LIMIT ${limit}`);
    const drafts = await this.rows(sql`
      SELECT * FROM (
        SELECT 'NEWS' AS kind, n.id, n.title, NULL::text AS client, n.updated_at, s.name AS author_name
        FROM news n LEFT JOIN staff s ON s.id = COALESCE(n.updated_by, n.created_by)
        WHERE n.status = 'DRAFT'
        UNION ALL
        SELECT 'CONTENT_BLOCK', b.id, COALESCE(b.title, b.key), b.client::text, b.updated_at, s.name
        FROM content_blocks b LEFT JOIN staff s ON s.id = b.updated_by
        WHERE b.status = 'DRAFT'
        UNION ALL
        SELECT 'LEGAL_DOCUMENT', v.id, p.name || ' (wersja ' || v.version_no || ')', NULL, v.created_at, s.name
        FROM content_page_versions v JOIN content_pages p ON p.id = v.page_id LEFT JOIN staff s ON s.id = v.created_by
        WHERE v.status = 'DRAFT'
      ) d ORDER BY updated_at, title LIMIT ${limit}`);
    const media = await this.rows(sql`
      SELECT id, original_name, width, height, size_bytes, created_at
      FROM v_media_list WHERE usages = 0 AND NOT is_system
      ORDER BY created_at, id LIMIT ${limit}`);

    return {
      tiles: {
        publishedNews: {
          value: n('news_published'),
          scheduled: n('news_scheduled'),
          expiringSoon: n('news_expiring'),
        },
        faq: { value: n('faq_published'), categories: n('faq_categories'), unpublished: n('faq_unpublished') },
        sectionBlocks: {
          value: n('blocks_published'),
          web: n('blocks_web'),
          mobile: n('blocks_mobile'),
          drafts: n('blocks_drafts'),
        },
        media: { value: n('media'), unused: n('media_unused') },
      },
      scheduledNews: {
        count: n('news_scheduled_soon'),
        items: scheduled.map((r) => ({
          id: r.id as string,
          title: r.title as string,
          publishFrom: iso(r.publish_from)!,
          authorName: (r.author_name as string | null) ?? null,
        })),
      },
      expiringNews: {
        count: n('news_expiring'),
        items: expiring.map((r) => ({
          id: r.id as string,
          title: r.title as string,
          publishTo: iso(r.publish_to)!,
          authorName: (r.author_name as string | null) ?? null,
        })),
      },
      drafts: {
        count: n('drafts'),
        items: drafts.map((r) => ({
          kind: r.kind as 'NEWS' | 'CONTENT_BLOCK' | 'LEGAL_DOCUMENT',
          id: r.id as string,
          title: r.title as string,
          client: (r.client as 'WEB' | 'MOBILE' | 'ADMIN' | null) ?? null,
          updatedAt: iso(r.updated_at)!,
          authorName: (r.author_name as string | null) ?? null,
        })),
      },
      unusedMedia: {
        count: n('media_unused'),
        items: media.map((r) => ({
          id: r.id as string,
          originalName: (r.original_name as string | null) ?? null,
          width: num(r.width),
          height: num(r.height),
          sizeBytes: Number(r.size_bytes ?? 0),
          createdAt: iso(r.created_at)!,
        })),
      },
      lastPublishedAt: iso(counts!.last_published_at),
    };
  }
}

export interface DashboardSummaryCounts {
  activeRides: number;
  startedLastHour: number;
  availableScooters: number;
  fleetTotal: number;
  lowBattery: number;
  criticalBattery: number;
  thresholdPct: number;
  /** Brutto w groszach z paragonów od północy (korekty ujemne). */
  salesToday: number;
  receiptsToday: number;
  newTickets: number;
  urgentUnassigned: number;
  tasksInProgress: number;
  tasksMine: number;
  tasksMineOverdue: number;
  tasksUnassigned: number;
  partsBelowMinimum: number;
  partNames: string[];
}

export type DashboardMyTask = NonNullable<DashboardSummary['myTasks']>['items'][number];
export type DashboardContentSummary = NonNullable<DashboardSummary['content']>;
