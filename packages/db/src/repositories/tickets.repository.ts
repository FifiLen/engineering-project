import type { AutoTicketKind, TicketCategory, TicketSource, TicketStatus } from '@hulajnogi/core';
import {
  ticketsResource,
  type CustomerTicketListItem,
  type ListQuery,
  type ListResponse,
  type ResourceDefinition,
  type TicketListItem,
  type TicketTimelineEntry,
  type TimelineActor,
} from '@hulajnogi/shared';
import { sql } from 'drizzle-orm';
import { runListQuery, type ListSource } from '../admin/list-query.js';
import type { DbExecutor } from '../client.js';
import { vTicketList } from '../schema/schema.js';

type Row = Record<string, unknown>;
type TicketField = keyof typeof ticketsResource.fields & string;

const iso = (v: unknown) => (v === null || v === undefined ? null : new Date(v as string).toISOString());
const date = (v: unknown) => (v === null || v === undefined ? null : new Date(v as string));
const num = (v: unknown) => (v === null || v === undefined ? null : Number(v));

/** Tablica wyliczenia z PostgreSQL (`{BRAKES,WHEEL}`): sterownik nie zna typu `ticket_category[]`. */
export function parsePgArray<T extends string>(value: unknown): T[] {
  if (Array.isArray(value)) return value as T[];
  if (typeof value !== 'string' || value === '{}') return [];
  return value.slice(1, -1).split(',') as T[];
}

/** Literał tablicy wyliczenia; wartości są z białej listy (core), więc bez cudzysłowów. */
const enumArray = (values: readonly string[]) => `{${values.join(',')}}`;

const listSource: ListSource<TicketField> = {
  from: vTicketList,
  id: vTicketList.id,
  columns: {
    id: vTicketList.id,
    number: vTicketList.number,
    status: vTicketList.status,
    urgent: vTicketList.urgent,
    categories: vTicketList.categories,
    source: vTicketList.source,
    autoKind: vTicketList.autoKind,
    description: vTicketList.description,
    scooterId: vTicketList.scooterId,
    scooterNumber: vTicketList.scooterNumber,
    scooterStatus: vTicketList.scooterStatus,
    rentalId: vTicketList.rentalId,
    rentalNumber: vTicketList.rentalNumber,
    reportedBy: vTicketList.reportedBy,
    reporterName: vTicketList.reporterName,
    reporterPhone: vTicketList.reporterPhone,
    assigneeId: vTicketList.assigneeId,
    assigneeName: vTicketList.assigneeName,
    photos: vTicketList.photos,
    openTasks: vTicketList.openTasks,
    serviceTaskId: vTicketList.serviceTaskId,
    serviceTaskNumber: vTicketList.serviceTaskNumber,
    serviceTaskStatus: vTicketList.serviceTaskStatus,
    refundedAmount: vTicketList.refundedAmount,
    customerReply: vTicketList.customerReply,
    customerReplyAt: vTicketList.customerReplyAt,
    customerReplyReadAt: vTicketList.customerReplyReadAt,
    resolutionNote: vTicketList.resolutionNote,
    createdAt: vTicketList.createdAt,
    updatedAt: vTicketList.updatedAt,
    resolvedAt: vTicketList.resolvedAt,
    ageSeconds: vTicketList.ageSeconds,
    version: vTicketList.version,
  },
};

/** Wiersz zgłoszenia do reguł w core (`decideTicketUpdate`) i widoków. */
export interface TicketRecord {
  id: string;
  number: number;
  scooterId: string;
  rentalId: string | null;
  reportedBy: string | null;
  source: TicketSource;
  autoKind: AutoTicketKind | null;
  categories: TicketCategory[];
  description: string | null;
  status: TicketStatus;
  urgent: boolean;
  assigneeId: string | null;
  customerReply: string | null;
  customerReplyAt: Date | null;
  customerReplyReadAt: Date | null;
  resolutionNote: string | null;
  createdAt: Date;
  updatedAt: Date;
  resolvedAt: Date | null;
  version: number;
}

const ticketSql = sql`SELECT t.id, t.number, t.scooter_id, t.rental_id, t.reported_by, t.source::text AS source,
                             t.auto_kind::text AS auto_kind, t.categories::text[] AS categories, t.description,
                             t.status::text AS status, t.urgent, t.assignee_id, t.customer_reply, t.customer_reply_at,
                             t.customer_reply_read_at, t.resolution_note, t.created_at, t.updated_at, t.resolved_at,
                             t.version
                      FROM tickets t`;

const toTicket = (r: Row): TicketRecord => ({
  id: r.id as string,
  number: Number(r.number),
  scooterId: r.scooter_id as string,
  rentalId: (r.rental_id as string | null) ?? null,
  reportedBy: (r.reported_by as string | null) ?? null,
  source: r.source as TicketSource,
  autoKind: (r.auto_kind as AutoTicketKind | null) ?? null,
  categories: parsePgArray<TicketCategory>(r.categories),
  description: (r.description as string | null) ?? null,
  status: r.status as TicketStatus,
  urgent: r.urgent as boolean,
  assigneeId: (r.assignee_id as string | null) ?? null,
  customerReply: (r.customer_reply as string | null) ?? null,
  customerReplyAt: date(r.customer_reply_at),
  customerReplyReadAt: date(r.customer_reply_read_at),
  resolutionNote: (r.resolution_note as string | null) ?? null,
  createdAt: new Date(r.created_at as string),
  updatedAt: new Date(r.updated_at as string),
  resolvedAt: date(r.resolved_at),
  version: r.version as number,
});

export interface NewTicket {
  scooterId: string;
  rentalId: string | null;
  reportedBy: string | null;
  source: Exclude<TicketSource, 'AUTO'>;
  categories: readonly TicketCategory[];
  description: string | null;
  urgent: boolean;
  assigneeId: string | null;
}

export interface TicketChanges {
  status?: TicketStatus;
  assigneeId?: string | null;
  /** Nowa odpowiedź dla klienta: czas odpowiedzi teraz, odczyt od nowa (D7). */
  customerReply?: string;
  resolutionNote?: string;
}

/** Zgłoszenie w aplikacji klienta: bez nazwisk i notatek wewnętrznych. */
export interface CustomerTicketRecord extends TicketRecord {
  scooterNumber: number;
  rentalNumber: number | null;
  rentalEndedAt: Date | null;
  /** Suma udanych zwrotów powiązanych ze zgłoszeniem (`refunds.ticket_id`) i ostatni paragon korygujący. */
  refundAmount: number | null;
  refundReceiptId: string | null;
}

/**
 * Moduł Operacje: zgłoszenia (ADR 0055). Repozytorium nie decyduje o przejściach: serwis w API blokuje wiersz,
 * wywołuje reguły z packages/core i zapisuje wynik w jednej transakcji z dziennikiem audytu.
 */
export class DrizzleTicketRepository {
  constructor(private readonly db: DbExecutor) {}

  private async rows(query: ReturnType<typeof sql>): Promise<Row[]> {
    return (await this.db.execute<Row>(query)).rows;
  }

  private async one(query: ReturnType<typeof sql>): Promise<Row | null> {
    return (await this.rows(query))[0] ?? null;
  }

  // --- Panel ----------------------------------------------------------------------------------

  /** Lista na wzorcu (ADR 0031); `def` pozwala zawęzić wyszukiwanie operatorowi bez `users.read`. */
  async list(
    query: ListQuery,
    def: ResourceDefinition<TicketField> = ticketsResource,
  ): Promise<ListResponse<TicketListItem>> {
    const result = await runListQuery<TicketField, TicketListItem>(this.db, def, listSource, query);
    return { ...result, items: result.items.map((item) => ({ ...item, categories: parsePgArray(item.categories) })) };
  }

  async listItem(id: string): Promise<TicketListItem | null> {
    const result = await this.list({
      filters: [{ field: 'id', op: 'eq', values: [id] }],
      sort: [],
      page: 1,
      pageSize: 1,
      facets: [],
    });
    return result.items[0] ?? null;
  }

  async find(id: string): Promise<TicketRecord | null> {
    const row = await this.one(sql`${ticketSql} WHERE t.id = ${id}`);
    return row ? toTicket(row) : null;
  }

  async lock(id: string): Promise<TicketRecord | null> {
    const row = await this.one(sql`${ticketSql} WHERE t.id = ${id} FOR UPDATE OF t`);
    return row ? toTicket(row) : null;
  }

  async insert(ticket: NewTicket): Promise<{ id: string; number: number }> {
    const row = await this.one(sql`
      INSERT INTO tickets (scooter_id, rental_id, reported_by, source, categories, description, urgent, assignee_id)
      VALUES (${ticket.scooterId}, ${ticket.rentalId}, ${ticket.reportedBy}, ${ticket.source}::ticket_source,
              ${enumArray(ticket.categories)}::ticket_category[], ${ticket.description}, ${ticket.urgent},
              ${ticket.assigneeId})
      RETURNING id, number`);
    return { id: row!.id as string, number: Number(row!.number) };
  }

  /**
   * Zgłoszenie automatyczne (ADR 0055): drugie otwarte zgłoszenie tego rodzaju na hulajnogę odrzuca indeks
   * `tickets_one_open_auto_per_scooter`; konflikt znaczy „już jest” (`null`), także przy równoległych zadaniach.
   */
  async insertAuto(input: {
    scooterId: string;
    rentalId: string | null;
    kind: AutoTicketKind;
    categories: readonly TicketCategory[];
    urgent: boolean;
  }): Promise<{ id: string; number: number } | null> {
    const row = await this.one(sql`
      INSERT INTO tickets (scooter_id, rental_id, source, auto_kind, categories, urgent)
      VALUES (${input.scooterId}, ${input.rentalId}, 'AUTO', ${input.kind}::ticket_auto_kind,
              ${enumArray(input.categories)}::ticket_category[], ${input.urgent})
      ON CONFLICT (scooter_id, auto_kind) WHERE status <> 'RESOLVED' DO NOTHING
      RETURNING id, number`);
    return row ? { id: row.id as string, number: Number(row.number) } : null;
  }

  /** Otwarte zgłoszenie automatyczne danego rodzaju z blokadą (automatyczne zamknięcie po powrocie łączności). */
  async lockOpenAuto(scooterId: string, kind: AutoTicketKind): Promise<(TicketRecord & { tasks: number }) | null> {
    const row = await this.one(sql`
      ${ticketSql} WHERE t.scooter_id = ${scooterId} AND t.auto_kind = ${kind}::ticket_auto_kind
        AND t.status <> 'RESOLVED' FOR UPDATE OF t`);
    if (!row) return null;
    return { ...toTicket(row), tasks: (await this.taskCounts(row.id as string)).total };
  }

  /** Zmiana operatora albo systemu z blokadą optymistyczną (`version = null`: system po blokadzie wiersza). */
  async update(id: string, version: number | null, changes: TicketChanges): Promise<boolean> {
    const set = [sql`updated_at = now()`, sql`version = version + 1`];
    if (changes.status !== undefined) set.push(sql`status = ${changes.status}::ticket_status`);
    if (changes.assigneeId !== undefined) set.push(sql`assignee_id = ${changes.assigneeId}`);
    if (changes.customerReply !== undefined) {
      set.push(sql`customer_reply = ${changes.customerReply}`, sql`customer_reply_at = now()`);
      set.push(sql`customer_reply_read_at = NULL`);
    }
    if (changes.resolutionNote !== undefined) set.push(sql`resolution_note = ${changes.resolutionNote}`);
    const { rowCount } = await this.db.execute(sql`
      UPDATE tickets SET ${sql.join(set, sql`, `)}
      WHERE id = ${id} ${version === null ? sql`` : sql`AND version = ${version}`}`);
    return (rowCount ?? 0) > 0;
  }

  /** Zdjęcia w kolejności (`ticket_photos.position`). */
  /** Zdjęcia zgłoszenia w kolejności pozycji; `uploadedBy`: tylko zdjęcia tego klienta (widok w aplikacji). */
  async photoIds(ticketId: string, uploadedBy?: string): Promise<string[]> {
    const rows = await this.rows(sql`
      SELECT p.file_id FROM ticket_photos p
      ${uploadedBy ? sql`JOIN files f ON f.id = p.file_id AND f.uploaded_by = ${uploadedBy}` : sql``}
      WHERE p.ticket_id = ${ticketId} ORDER BY p.position`);
    return rows.map((r) => r.file_id as string);
  }

  /**
   * Zdjęcia na pierwszych wolnych pozycjach 1–3 (po usunięciu zdjęcia pozycja się zwalnia); brak wolnej pozycji
   * daje 4, którą odrzuca `ticket_photos_position_range` (`TICKET_TOO_MANY_PHOTOS`).
   */
  async addPhotos(ticketId: string, fileIds: readonly string[]): Promise<void> {
    for (const fileId of fileIds) {
      await this.db.execute(sql`
        INSERT INTO ticket_photos (ticket_id, file_id, position)
        VALUES (${ticketId}, ${fileId},
                COALESCE((SELECT min(p) FROM generate_series(1, 3) p
                          WHERE NOT EXISTS (SELECT 1 FROM ticket_photos x WHERE x.ticket_id = ${ticketId} AND x.position = p)),
                         4))`);
    }
  }

  /** Zwrot z reklamacji (pytanie 6): powiązanie w transakcji zwrotu. */
  async linkRefund(refundId: string, ticketId: string): Promise<void> {
    await this.db.execute(sql`UPDATE refunds SET ticket_id = ${ticketId}, updated_at = now() WHERE id = ${refundId}`);
  }

  async removePhoto(ticketId: string, fileId: string): Promise<boolean> {
    const { rowCount } = await this.db.execute(
      sql`DELETE FROM ticket_photos WHERE ticket_id = ${ticketId} AND file_id = ${fileId}`,
    );
    return (rowCount ?? 0) > 0;
  }

  /** Zadania zgłoszenia do reguł statusu (`decideTicketUpdate`, `ticketStatusOnTaskClosed`). */
  async taskCounts(ticketId: string): Promise<{ open: number; done: number; total: number }> {
    const row = await this.one(sql`
      SELECT count(*) FILTER (WHERE status IN ('OPEN', 'IN_PROGRESS'))::integer AS open,
             count(*) FILTER (WHERE status = 'DONE')::integer AS done, count(*)::integer AS total
      FROM service_tasks WHERE ticket_id = ${ticketId}`);
    return { open: row!.open as number, done: row!.done as number, total: row!.total as number };
  }

  /** Oś czasu zgłoszenia (D6): utworzenie, dziennik audytu zgłoszenia, zadań i zwrotów, powiadomienia. */
  async timeline(ticketId: string): Promise<TicketTimelineEntry[]> {
    const rows = await this.rows(sql`
      SELECT at, kind, action, entity_type, entity_id, actor, staff_id, staff_name, data
      FROM v_ticket_timeline WHERE ticket_id = ${ticketId} ORDER BY at, kind_order, seq`);
    return rows.map((r) => ({
      at: new Date(r.at as string).toISOString(),
      actor: (r.actor === 'CUSTOMER' || r.actor === 'SYSTEM' ? r.actor : 'STAFF') as TimelineActor,
      staffId: (r.staff_id as string | null) ?? null,
      staffName: (r.staff_name as string | null) ?? null,
      action: r.action as string,
      entityType: r.entity_type as string,
      entityId: (r.entity_id as string | null) ?? null,
      data: (r.data as Record<string, unknown> | null) ?? {},
    }));
  }

  // --- Aplikacja klienta ------------------------------------------------------------------------

  /** „Moje zgłoszenia”: zgłoszenia klienta od najnowszego. */
  async forCustomer(userId: string, limit: number): Promise<CustomerTicketListItem[]> {
    const rows = await this.rows(sql`
      SELECT t.id, t.number, t.status::text AS status, t.categories::text[] AS categories, s.number AS scooter_number,
             t.created_at, t.updated_at, (t.customer_reply_at IS NOT NULL AND t.customer_reply_read_at IS NULL) AS unread
      FROM tickets t JOIN scooters s ON s.id = t.scooter_id
      WHERE t.reported_by = ${userId}
      ORDER BY t.created_at DESC LIMIT ${limit}`);
    return rows.map((r) => ({
      id: r.id as string,
      number: Number(r.number),
      status: r.status as TicketStatus,
      categories: parsePgArray<TicketCategory>(r.categories),
      scooterNumber: r.scooter_number as number,
      createdAt: iso(r.created_at)!,
      updatedAt: iso(r.updated_at)!,
      hasUnreadReply: r.unread as boolean,
    }));
  }

  /** Zgłoszenie klienta (cudze zgłoszenie jak nieistniejące). */
  async customerTicket(id: string, userId: string): Promise<CustomerTicketRecord | null> {
    const row = await this.one(sql`
      SELECT x.*, s.number AS scooter_number, r.number AS rental_number, r.ended_at AS rental_ended_at,
             (SELECT sum(f.amount) FROM refunds f WHERE f.ticket_id = x.id AND f.status = 'SUCCEEDED') AS refund_amount,
             (SELECT c.id FROM receipts c JOIN refunds f ON f.id = c.refund_id
              WHERE f.ticket_id = x.id AND c.kind = 'CORRECTION' ORDER BY c.issued_at DESC LIMIT 1) AS refund_receipt_id
      FROM (${ticketSql} WHERE t.id = ${id} AND t.reported_by = ${userId}) x
      JOIN scooters s ON s.id = x.scooter_id
      LEFT JOIN rentals r ON r.id = x.rental_id`);
    if (!row) return null;
    return {
      ...toTicket(row),
      scooterNumber: row.scooter_number as number,
      rentalNumber: num(row.rental_number),
      rentalEndedAt: date(row.rental_ended_at),
      refundAmount: num(row.refund_amount),
      refundReceiptId: (row.refund_receipt_id as string | null) ?? null,
    };
  }

  /** Odczyt odpowiedzi przez klienta (D7); `true`, gdy odpowiedź była nieprzeczytana. */
  async markReplyRead(id: string, userId: string): Promise<boolean> {
    const { rowCount } = await this.db.execute(sql`
      UPDATE tickets SET customer_reply_read_at = now()
      WHERE id = ${id} AND reported_by = ${userId} AND customer_reply_at IS NOT NULL AND customer_reply_read_at IS NULL`);
    return (rowCount ?? 0) > 0;
  }

  /** Przejazd klienta dla zgłoszenia z przejazdu: właściciel i hulajnoga. */
  async customerRental(rentalId: string): Promise<{ userId: string; scooterId: string } | null> {
    const row = await this.one(sql`SELECT user_id, scooter_id FROM rentals WHERE id = ${rentalId}`);
    return row ? { userId: row.user_id as string, scooterId: row.scooter_id as string } : null;
  }

  /** Otwarty przejazd hulajnogi (zgłoszenie `OFFLINE` w trakcie jazdy dostaje `rental_id`). */
  async openRentalOf(scooterId: string): Promise<string | null> {
    const row = await this.one(sql`
      SELECT id FROM rentals WHERE scooter_id = ${scooterId}
        AND state IN ('RESERVED', 'UNLOCKING', 'ACTIVE', 'PAUSED', 'ENDING')`);
    return (row?.id as string | undefined) ?? null;
  }
}
