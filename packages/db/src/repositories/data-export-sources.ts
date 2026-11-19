import type { DataExportSources, ReceiptItem } from '@hulajnogi/core';
import { sql, type SQL } from 'drizzle-orm';
import type { DbExecutor } from '../client.js';

/**
 * Zapytania portów eksportu danych klienta (ADR 0069): każda funkcja należy do modułu, który jest właścicielem
 * tabel (Konta, Wypożyczenia, Płatności, Operacje, Powiadomienia), i jest wołana tylko przez port eksportu tego
 * modułu w API. Wybierają jawnie kolumny, które może zobaczyć klient: bez tokenów, skrótów kodów, notatek
 * operatorów i identyfikatorów klienta u operatora płatności.
 */
type Row = Record<string, unknown>;

const rows = async (db: DbExecutor, query: SQL): Promise<Row[]> => (await db.execute<Row>(query)).rows;
const date = (value: unknown): Date | null =>
  value === null || value === undefined ? null : new Date(value as string);
const at = (value: unknown): Date => new Date(value as string);
const num = (value: unknown): number | null => (value === null || value === undefined ? null : Number(value));
const scooterNumber = (value: unknown): string => String(value).padStart(4, '0');

/** Trasa w pliku: najwyżej tyle punktów telemetrii (równomiernie wybrane, z pierwszym i ostatnim). */
export const DATA_EXPORT_ROUTE_MAX_POINTS = 300;

const items = (value: unknown): ReceiptItem[] =>
  ((value as Array<Record<string, unknown>> | null) ?? []).map((item) => ({
    description: item.description as ReceiptItem['description'],
    quantity: Number(item.quantity),
    unitPrice: Number(item.unitPrice),
    vatRate: item.vatRate === null || item.vatRate === undefined ? null : Number(item.vatRate),
    amount: Number(item.amount),
  }));

const receiptItemsJson = (receiptId: SQL) => sql`
  (SELECT COALESCE(jsonb_agg(jsonb_build_object('description', i.description, 'quantity', i.quantity,
                                                'unitPrice', i.unit_price, 'vatRate', i.vat_rate, 'amount', i.amount)
                             ORDER BY i.line_no), '[]')
   FROM receipt_items i WHERE i.receipt_id = ${receiptId})`;

/** Konta: profil, preferencje, urządzenia z powiadomieniami, sesje i zgody. */
export async function exportAccountData(
  db: DbExecutor,
  userId: string,
): Promise<Pick<DataExportSources, 'profile' | 'consents'>> {
  const [user] = await rows(
    db,
    sql`
    SELECT u.phone, u.name, u.email, u.created_at, u.status::text AS status, u.blocked_at, u.blocked_reason::text AS blocked_reason,
           u.notify_reservation_end, u.notify_receipts,
           EXISTS (SELECT 1 FROM consents c WHERE c.user_id = u.id AND c.type = 'MARKETING' AND c.revoked_at IS NULL) AS marketing
    FROM users u WHERE u.id = ${userId}`,
  );
  if (!user) throw new Error(`Brak klienta ${userId}`);
  const devices = await rows(
    db,
    sql`SELECT platform::text AS platform, created_at, last_seen_at FROM push_tokens WHERE user_id = ${userId} ORDER BY created_at`,
  );
  const sessions = await rows(
    db,
    sql`SELECT device_name, created_at, last_used_at, revoked_at FROM sessions WHERE user_id = ${userId} ORDER BY created_at`,
  );
  const consents = await rows(
    db,
    sql`
    SELECT c.type::text AS type, COALESCE(p.slug, c.type::text) AS document,
           COALESCE(v.version_no, CASE WHEN c.document_version ~ '^\\d+$' THEN c.document_version::integer END) AS version_no,
           c.accepted_at, c.revoked_at
    FROM consents c
    LEFT JOIN content_page_versions v ON v.id = c.page_version_id
    LEFT JOIN content_pages p ON p.id = v.page_id
    WHERE c.user_id = ${userId}
    ORDER BY c.accepted_at`,
  );
  const blocked = user.status === 'BLOCKED' || user.blocked_at !== null;
  return {
    profile: {
      phone: (user.phone as string | null) ?? '',
      name: (user.name as string | null) ?? null,
      email: (user.email as string | null) ?? null,
      registeredAt: at(user.created_at),
      blocked,
      blockReason: (user.blocked_reason as string | null) ?? null,
      blockedAt: date(user.blocked_at),
      preferences: {
        reservationEnd: user.notify_reservation_end as boolean,
        receipts: user.notify_receipts as boolean,
        marketing: user.marketing as boolean,
      },
      devices: devices.map((d) => ({
        platform: d.platform as string,
        createdAt: at(d.created_at),
        lastUsedAt: date(d.last_seen_at),
      })),
      sessions: sessions.map((s) => ({
        client: (s.device_name as string | null) ?? null,
        createdAt: at(s.created_at),
        lastUsedAt: date(s.last_used_at),
        endedAt: date(s.revoked_at),
      })),
    },
    consents: consents.map((c) => ({
      type: c.type as string,
      document: c.document as string,
      versionNo: num(c.version_no),
      acceptedAt: at(c.accepted_at),
      withdrawnAt: date(c.revoked_at),
    })),
  };
}

/** Wypożyczenia: przejazdy z miejscami, wyceną z paragonu sprzedaży i trasą z telemetrii (uproszczoną). */
export async function exportRentalData(db: DbExecutor, userId: string): Promise<Pick<DataExportSources, 'rentals'>> {
  const list = await rows(
    db,
    sql`
    SELECT r.id, r.number, r.state::text AS state, r.reserved_at, r.started_at, r.ended_at, s.number AS scooter_number,
           m.name AS model, ST_Y(r.start_position) AS start_lat, ST_X(r.start_position) AS start_lon, sz.code AS start_zone,
           ST_Y(r.end_position) AS end_lat, ST_X(r.end_position) AS end_lon, ez.code AS end_zone,
           r.distance_m, r.end_mode::text AS end_mode, t.version AS tariff_version, r.total_amount,
           ${receiptItemsJson(sql`(SELECT rc.id FROM receipts rc WHERE rc.rental_id = r.id AND rc.kind = 'SALE' LIMIT 1)`)} AS items
    FROM rentals r
    JOIN scooters s ON s.id = r.scooter_id
    JOIN scooter_models m ON m.id = s.model_id
    JOIN tariffs t ON t.id = r.tariff_id
    LEFT JOIN zones ez ON ez.id = r.end_zone_id
    LEFT JOIN LATERAL (
      SELECT z.code FROM zones z
      WHERE z.type = 'PARKING' AND r.start_position IS NOT NULL AND ST_Contains(z.geom, r.start_position)
      ORDER BY z.active DESC, z.code LIMIT 1
    ) sz ON true
    WHERE r.user_id = ${userId}
    ORDER BY r.created_at`,
  );
  const ids = list.map((r) => r.id as string);
  const routes = new Map<string, Array<{ lat: number; lon: number; at: Date }>>();
  if (ids.length) {
    const points = await rows(
      db,
      sql`
      SELECT rental_id, lat, lon, recorded_at FROM (
        SELECT t.rental_id, ST_Y(t.position) AS lat, ST_X(t.position) AS lon, t.recorded_at,
               row_number() OVER (PARTITION BY t.rental_id ORDER BY t.recorded_at) AS n,
               count(*) OVER (PARTITION BY t.rental_id) AS total
        FROM telemetry t
        WHERE t.rental_id IN (${sql.join(
          ids.map((id) => sql`${id}::uuid`),
          sql`, `,
        )})
      ) p
      WHERE total <= ${DATA_EXPORT_ROUTE_MAX_POINTS} OR n = 1 OR n = total
         OR (n - 1) % ceil(total::numeric / ${DATA_EXPORT_ROUTE_MAX_POINTS})::integer = 0
      ORDER BY rental_id, recorded_at`,
    );
    for (const p of points) {
      const route = routes.get(p.rental_id as string) ?? [];
      route.push({ lat: Number(p.lat), lon: Number(p.lon), at: at(p.recorded_at) });
      routes.set(p.rental_id as string, route);
    }
  }
  return {
    rentals: list.map((r) => ({
      number: `R-${String(r.number)}`,
      state: r.state as string,
      reservedAt: date(r.reserved_at),
      startedAt: date(r.started_at),
      endedAt: date(r.ended_at),
      scooterNumber: scooterNumber(r.scooter_number),
      model: (r.model as string | null) ?? null,
      start:
        r.start_lat === null
          ? null
          : { lat: Number(r.start_lat), lon: Number(r.start_lon), zone: (r.start_zone as string | null) ?? null },
      end:
        r.end_lat === null
          ? null
          : { lat: Number(r.end_lat), lon: Number(r.end_lon), zone: (r.end_zone as string | null) ?? null },
      distanceM: num(r.distance_m),
      endMode: (r.end_mode as string | null) ?? null,
      tariffVersion: num(r.tariff_version),
      total: num(r.total_amount),
      items: items(r.items),
      route: routes.get(r.id as string) ?? null,
    })),
  };
}

/** Płatności: saldo i księga portfela, płatności z kartą, zwroty i paragony z pozycjami. */
export async function exportPaymentData(
  db: DbExecutor,
  userId: string,
): Promise<Pick<DataExportSources, 'wallet' | 'payments' | 'refunds' | 'receipts'>> {
  const [balance] = await rows(db, sql`SELECT fn_wallet_balance(${userId}) AS balance`);
  const entries = await rows(
    db,
    sql`
    SELECT l.created_at, l.type::text AS type, l.amount, l.balance_after, r.number AS rental_number, l.payment_id, l.refund_id
    FROM wallet_ledger l LEFT JOIN rentals r ON r.id = l.rental_id
    WHERE l.user_id = ${userId} ORDER BY l.id`,
  );
  const payments = await rows(
    db,
    sql`
    SELECT p.id, p.created_at, p.purpose::text AS purpose, p.status::text AS status, p.amount, m.brand, m.last4
    FROM payments p LEFT JOIN payment_methods m ON m.id = p.payment_method_id
    WHERE p.user_id = ${userId} ORDER BY p.created_at`,
  );
  const refunds = await rows(
    db,
    sql`SELECT id, created_at, status::text AS status, amount, reason::text AS reason
        FROM refunds WHERE user_id = ${userId} ORDER BY created_at`,
  );
  const receipts = await rows(
    db,
    sql`
    SELECT rc.number, rc.kind::text AS kind, rc.issued_at, o.number AS corrects, ${receiptItemsJson(sql`rc.id`)} AS items
    FROM receipts rc LEFT JOIN receipts o ON o.id = rc.corrects_receipt_id
    WHERE rc.user_id = ${userId} ORDER BY rc.issued_at`,
  );
  return {
    wallet: {
      balance: Number(balance?.balance ?? 0),
      entries: entries.map((e) => ({
        at: at(e.created_at),
        kind: e.type as string,
        amount: Number(e.amount),
        balanceAfter: Number(e.balance_after),
        reference:
          e.rental_number !== null
            ? `R-${String(e.rental_number)}`
            : ((e.payment_id as string | null) ?? (e.refund_id as string | null) ?? null),
      })),
    },
    payments: payments.map((p) => ({
      id: p.id as string,
      createdAt: at(p.created_at),
      kind: p.purpose as string,
      status: p.status as string,
      amount: Number(p.amount),
      card: p.brand ? { brand: p.brand as string, last4: (p.last4 as string | null)?.trim() ?? null } : null,
    })),
    refunds: refunds.map((r) => ({
      id: r.id as string,
      createdAt: at(r.created_at),
      status: r.status as string,
      amount: Number(r.amount),
      reason: (r.reason as string | null) ?? null,
    })),
    receipts: receipts.map((r) => ({
      number: r.number as string,
      kind: r.kind as string,
      issuedAt: at(r.issued_at),
      corrects: (r.corrects as string | null) ?? null,
      items: items(r.items),
    })),
  };
}

/** Operacje: zgłoszenia klienta (bez notatek wewnętrznych) i metadane zdjęć parkowania i zgłoszeń. */
export async function exportTicketData(
  db: DbExecutor,
  userId: string,
): Promise<Pick<DataExportSources, 'tickets' | 'photos'>> {
  const tickets = await rows(
    db,
    sql`
    SELECT t.number, t.created_at, t.categories::text[] AS categories, t.description, t.status::text AS status,
           t.customer_reply, t.resolved_at, s.number AS scooter_number, r.number AS rental_number
    FROM tickets t JOIN scooters s ON s.id = t.scooter_id LEFT JOIN rentals r ON r.id = t.rental_id
    WHERE t.reported_by = ${userId} ORDER BY t.created_at`,
  );
  const photos = await rows(
    db,
    sql`
    SELECT f.id, f.purpose::text AS purpose, f.created_at, f.status::text AS status, f.deleted_at,
           r.number AS rental_number, NULL::bigint AS ticket_number
    FROM rentals r JOIN files f ON f.id = r.parking_photo_id
    WHERE r.user_id = ${userId}
    UNION ALL
    SELECT f.id, f.purpose::text, f.created_at, f.status::text, f.deleted_at, NULL::bigint, t.number
    FROM tickets t JOIN ticket_photos p ON p.ticket_id = t.id JOIN files f ON f.id = p.file_id
    WHERE t.reported_by = ${userId}
    ORDER BY created_at`,
  );
  return {
    tickets: tickets.map((t) => ({
      number: `Z-${String(t.number)}`,
      createdAt: at(t.created_at),
      categories: (t.categories as string[] | null) ?? [],
      description: (t.description as string | null) ?? null,
      status: t.status as string,
      reply: (t.customer_reply as string | null) ?? null,
      resolvedAt: date(t.resolved_at),
      scooterNumber: scooterNumber(t.scooter_number),
      rentalNumber: t.rental_number === null ? null : `R-${String(t.rental_number)}`,
    })),
    photos: photos.map((p) => ({
      id: p.id as string,
      purpose: p.purpose as string,
      createdAt: at(p.created_at),
      rentalNumber: p.rental_number === null ? null : `R-${String(p.rental_number)}`,
      ticketNumber: p.ticket_number === null ? null : `Z-${String(p.ticket_number)}`,
      status: p.status as string,
      deletedAt: date(p.deleted_at),
    })),
  };
}

/** Powiadomienia: wysłane do klienta z treścią z chwili wysyłki. */
export async function exportNotificationData(
  db: DbExecutor,
  userId: string,
): Promise<Pick<DataExportSources, 'notifications'>> {
  const list = await rows(
    db,
    sql`SELECT template_code, title, body, sent_at, read_at FROM notifications
        WHERE user_id = ${userId} AND status = 'SENT' ORDER BY created_at`,
  );
  return {
    notifications: list.map((n) => ({
      code: n.template_code as string,
      title: (n.title as string | null) ?? null,
      body: (n.body as string | null) ?? '',
      sentAt: date(n.sent_at),
      readAt: date(n.read_at),
    })),
  };
}
