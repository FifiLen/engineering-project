import type { PoolClient } from 'pg';

/**
 * Zapis partiami (ADR 0075): wiersze dnia symulacji trafiają do tabel jednym `INSERT … SELECT FROM unnest(…)` na
 * tabelę (po 5000 wierszy), w kolejności kluczy obcych, w jednej transakcji na dzień. Wiersz zmieniony po zapisie
 * (np. przejazd `ENDED` → `UNPAID` następnego dnia) trafia do `UPDATE … FROM unnest(…)` przy kolejnym zapisie.
 * Wyzwalacze bazy (ciągłość salda księgi, reguły zgłoszeń i zadań, wykluczanie nakładania się przedziałów) działają
 * dla każdego wiersza jak przy zapisie z API.
 */

interface Column {
  name: string;
  /** Typ tablicy parametru (`uuid`, `text`, `rental_state` …). */
  type: string;
  /** Wyrażenie z wartością `u.<kolumna>`, gdy parametr wymaga zamiany (geometria, jsonb, tablica enumów). */
  expr?: (ref: string) => string;
}

const geom = (ref: string) => `ST_GeomFromText(${ref}, 4326)`;
const jsonb = (ref: string) => `${ref}::jsonb`;
const col = (name: string, type: string, expr?: Column['expr']): Column => ({ name, type, expr });

/** Tabele w kolejności zapisu (klucze obce); kolumny tożsamości (`GENERATED ALWAYS`) nadaje baza. */
const TABLES: Record<string, Column[]> = {
  users: [
    col('id', 'uuid'),
    col('phone', 'text'),
    col('email', 'text'),
    col('name', 'text'),
    col('status', 'user_status'),
    col('created_at', 'timestamptz'),
    col('updated_at', 'timestamptz'),
    col('blocked_at', 'timestamptz'),
    col('blocked_reason', 'block_reason'),
    col('notify_reservation_end', 'boolean'),
    col('notify_receipts', 'boolean'),
  ],
  consents: [
    col('user_id', 'uuid'),
    col('type', 'consent_type'),
    col('document_version', 'text'),
    col('accepted_at', 'timestamptz'),
    col('revoked_at', 'timestamptz'),
    col('page_version_id', 'uuid'),
    col('source', 'consent_source'),
  ],
  payment_customers: [
    col('user_id', 'uuid'),
    col('provider', 'text'),
    col('provider_customer_id', 'text'),
    col('created_at', 'timestamptz'),
  ],
  payment_methods: [
    col('id', 'uuid'),
    col('user_id', 'uuid'),
    col('provider_ref', 'text'),
    col('brand', 'text'),
    col('last4', 'text'),
    col('exp_month', 'int2'),
    col('exp_year', 'int2'),
    col('is_default', 'boolean'),
    col('created_at', 'timestamptz'),
    col('provider', 'text'),
  ],
  rentals: [
    col('id', 'uuid'),
    col('user_id', 'uuid'),
    col('scooter_id', 'uuid'),
    col('tariff_id', 'uuid'),
    col('state', 'rental_state'),
    col('payment_source', 'payment_source'),
    col('payment_method_id', 'uuid'),
    col('reserved_at', 'timestamptz'),
    col('reservation_expires_at', 'timestamptz'),
    col('started_at', 'timestamptz'),
    col('ended_at', 'timestamptz'),
    col('ride_seconds', 'int4'),
    col('pause_seconds', 'int4'),
    col('distance_m', 'int4'),
    col('start_position', 'text', geom),
    col('end_position', 'text', geom),
    col('end_zone_id', 'uuid'),
    col('route', 'text', geom),
    col('total_amount', 'int8'),
    col('end_mode', 'rental_end_mode'),
    col('towing_fee', 'int8'),
    col('created_at', 'timestamptz'),
    col('updated_at', 'timestamptz'),
  ],
  rental_events: [
    col('rental_id', 'uuid'),
    col('type', 'rental_event_type'),
    col('from_state', 'rental_state'),
    col('to_state', 'rental_state'),
    col('zone_id', 'uuid'),
    col('data', 'text', jsonb),
    col('created_at', 'timestamptz'),
  ],
  scooter_commands: [
    col('scooter_id', 'uuid'),
    col('rental_id', 'uuid'),
    col('type', 'command_type'),
    col('payload', 'text', jsonb),
    col('status', 'command_status'),
    col('sent_at', 'timestamptz'),
    col('acked_at', 'timestamptz'),
    col('expires_at', 'timestamptz'),
    col('ack_reason', 'text'),
    col('source', 'command_source'),
    col('zone_id', 'uuid'),
  ],
  payments: [
    col('id', 'uuid'),
    col('user_id', 'uuid'),
    col('purpose', 'payment_purpose'),
    col('rental_id', 'uuid'),
    col('method', 'payment_method_kind'),
    col('payment_method_id', 'uuid'),
    col('amount', 'int8'),
    col('status', 'payment_status'),
    col('provider', 'text'),
    col('provider_payment_id', 'text'),
    col('idempotency_key', 'text'),
    col('failure_code', 'text'),
    col('failure_reason', 'text'),
    col('created_at', 'timestamptz'),
    col('updated_at', 'timestamptz'),
  ],
  tickets: [
    col('id', 'uuid'),
    col('scooter_id', 'uuid'),
    col('rental_id', 'uuid'),
    col('reported_by', 'uuid'),
    col('source', 'ticket_source'),
    col('auto_kind', 'ticket_auto_kind'),
    col('categories', 'text', (ref) => `${ref}::ticket_category[]`),
    col('description', 'text'),
    col('status', 'ticket_status'),
    col('urgent', 'boolean'),
    col('assignee_id', 'uuid'),
    col('customer_reply', 'text'),
    col('customer_reply_at', 'timestamptz'),
    col('resolution_note', 'text'),
    col('resolved_at', 'timestamptz'),
    col('created_at', 'timestamptz'),
    col('updated_at', 'timestamptz'),
  ],
  service_tasks: [
    col('id', 'uuid'),
    col('scooter_id', 'uuid'),
    col('ticket_id', 'uuid'),
    col('type', 'service_task_type'),
    col('status', 'service_task_status'),
    col('priority', 'task_priority'),
    col('description', 'text'),
    col('result_note', 'text'),
    col('assignee_id', 'uuid'),
    col('created_by', 'uuid'),
    col('due_at', 'timestamptz'),
    col('target_zone_id', 'uuid'),
    col('created_at', 'timestamptz'),
    col('started_at', 'timestamptz'),
    col('completed_at', 'timestamptz'),
    col('updated_at', 'timestamptz'),
  ],
  service_task_parts: [
    col('task_id', 'uuid'),
    col('part_id', 'uuid'),
    col('quantity', 'int4'),
    col('unit_cost', 'int8'),
  ],
  spare_part_movements: [
    col('part_id', 'uuid'),
    col('kind', 'part_movement_kind'),
    col('delta', 'int4'),
    col('stock_after', 'int4'),
    col('unit_cost', 'int8'),
    col('task_id', 'uuid'),
    col('staff_id', 'uuid'),
    col('document', 'text'),
    col('reason', 'part_adjust_reason'),
    col('note', 'text'),
    col('created_at', 'timestamptz'),
  ],
  refunds: [
    col('id', 'uuid'),
    col('user_id', 'uuid'),
    col('rental_id', 'uuid'),
    col('payment_id', 'uuid'),
    col('ticket_id', 'uuid'),
    col('source', 'payment_source'),
    col('amount', 'int8'),
    col('reason', 'refund_reason'),
    col('note', 'text'),
    col('staff_id', 'uuid'),
    col('status', 'refund_status'),
    col('provider_refund_id', 'text'),
    col('created_at', 'timestamptz'),
    col('updated_at', 'timestamptz'),
  ],
  wallet_ledger: [
    col('user_id', 'uuid'),
    col('type', 'ledger_entry_type'),
    col('amount', 'int8'),
    col('balance_after', 'int8'),
    col('rental_id', 'uuid'),
    col('payment_id', 'uuid'),
    col('refund_id', 'uuid'),
    col('staff_id', 'uuid'),
    col('reason', 'ledger_reason'),
    col('note', 'text'),
    col('created_at', 'timestamptz'),
  ],
  receipts: [
    col('id', 'uuid'),
    col('number', 'text'),
    col('user_id', 'uuid'),
    col('kind', 'receipt_kind'),
    col('rental_id', 'uuid'),
    col('payment_id', 'uuid'),
    col('refund_id', 'uuid'),
    col('corrects_receipt_id', 'uuid'),
    col('payment_source', 'payment_source'),
    col('seller', 'text', jsonb),
    col('buyer_name', 'text'),
    col('buyer_email', 'text'),
    col('buyer_phone', 'text'),
    col('total_amount', 'int8'),
    col('issued_at', 'timestamptz'),
  ],
  receipt_items: [
    col('receipt_id', 'uuid'),
    col('line_no', 'int2'),
    col('description', 'text'),
    col('quantity', 'numeric'),
    col('unit_price', 'int8'),
    col('vat_rate', 'numeric'),
    col('amount', 'int8'),
  ],
  audit_log: [
    col('actor', 'audit_actor'),
    col('staff_id', 'uuid'),
    col('action', 'text'),
    col('entity_type', 'text'),
    col('entity_id', 'uuid'),
    col('data', 'text', jsonb),
    col('created_at', 'timestamptz'),
  ],
  scooter_status_history: [
    col('scooter_id', 'uuid'),
    col('status', 'scooter_status'),
    col('online', 'boolean'),
    col('valid_from', 'timestamptz'),
    col('valid_to', 'timestamptz'),
  ],
};

export type TableName = keyof typeof TABLES;
export type Row = Record<string, unknown>;

const CHUNK = 5000;
const FLUSHED = Symbol('flushed');

type TrackedRow = Row & { [FLUSHED]?: boolean };

export class BatchWriter {
  private readonly pending = new Map<string, TrackedRow[]>();
  private readonly updates = new Map<string, Map<TrackedRow, Set<string>>>();
  /** Liczba wstawionych wierszy na tabelę (podsumowanie w terminalu). */
  readonly inserted: Record<string, number> = {};

  add<T extends Row>(table: TableName, row: T): T {
    if (!this.pending.has(table)) this.pending.set(table, []);
    this.pending.get(table)!.push(row);
    return row;
  }

  /** Zmiana wiersza: przed zapisem zmienia obiekt w partii, po zapisie planuje `UPDATE` po `id`. */
  patch(table: TableName, row: Row, fields: Row): void {
    Object.assign(row, fields);
    const tracked = row as TrackedRow;
    if (!tracked[FLUSHED]) return;
    if (!this.updates.has(table)) this.updates.set(table, new Map());
    const changed = this.updates.get(table)!;
    const set = changed.get(tracked) ?? new Set<string>();
    for (const key of Object.keys(fields)) set.add(key);
    changed.set(tracked, set);
  }

  /**
   * Zadanie serwisowe z przejściami: wyzwalacz zadań wstawia tylko `OPEN` i pozwala na kolejne przejścia
   * (`OPEN` → `IN_PROGRESS` → `DONE`), więc każde przejście to osobne `UPDATE` po wstawieniu. Indeks „jedno otwarte
   * zadanie danego rodzaju na hulajnogę” wymaga, żeby kolejne zadanie tego rodzaju tej hulajnogi powstało dopiero
   * po zamknięciu poprzedniego, dlatego partia zadań idzie rundami.
   */
  addTask(row: Row, steps: Row[]): void {
    this.tasks.push({ row, steps });
  }

  private tasks: Array<{ row: Row; steps: Row[] }> = [];

  async flush(client: PoolClient): Promise<void> {
    await this.insertPending(client);
    for (const [table, changed] of this.updates) {
      const groups = new Map<string, TrackedRow[]>();
      for (const [row, fields] of changed) {
        const key = [...fields].sort().join(',');
        const group = groups.get(key);
        if (group) group.push(row);
        else groups.set(key, [row]);
      }
      for (const [key, rows] of groups) await update(client, table, key.split(','), rows);
      changed.clear();
    }
  }

  private async insertTasks(client: PoolClient): Promise<void> {
    let rest = this.tasks;
    this.tasks = [];
    while (rest.length) {
      const seen = new Set<string>();
      const round: typeof rest = [];
      const later: typeof rest = [];
      for (const task of rest) {
        const key = `${String(task.row.scooter_id)}:${String(task.row.type)}`;
        (seen.has(key) ? later : round).push(task);
        seen.add(key);
      }
      for (let i = 0; i < round.length; i += CHUNK) {
        await insert(
          client,
          'service_tasks',
          TABLES.service_tasks!,
          round.slice(i, i + CHUNK).map((t) => t.row),
        );
      }
      this.inserted.service_tasks = (this.inserted.service_tasks ?? 0) + round.length;
      const phases = Math.max(0, ...round.map((t) => t.steps.length));
      for (let phase = 0; phase < phases; phase++) {
        const groups = new Map<string, Row[]>();
        for (const task of round) {
          const step = task.steps[phase];
          if (!step) continue;
          const key = Object.keys(step).sort().join(',');
          const row = { id: task.row.id, ...step };
          const group = groups.get(key);
          if (group) group.push(row);
          else groups.set(key, [row]);
        }
        for (const [key, rows] of groups) await update(client, 'service_tasks', key.split(','), rows);
      }
      rest = later;
    }
  }

  private async insertPending(client: PoolClient): Promise<void> {
    for (const [table, columns] of Object.entries(TABLES)) {
      if (table === 'service_tasks') {
        await this.insertTasks(client);
        continue;
      }
      const rows = this.pending.get(table);
      if (!rows?.length) continue;
      for (let i = 0; i < rows.length; i += CHUNK) await insert(client, table, columns, rows.slice(i, i + CHUNK));
      for (const row of rows) row[FLUSHED] = true;
      this.inserted[table] = (this.inserted[table] ?? 0) + rows.length;
      this.pending.set(table, []);
    }
  }
}

function params(columns: readonly Column[], rows: readonly Row[]): unknown[] {
  return columns.map((c) => rows.map((r) => toParam(r[c.name])));
}

function toParam(value: unknown): unknown {
  if (value === undefined) return null;
  if (value instanceof Date) return value.toISOString();
  if (typeof value === 'object' && value !== null) return JSON.stringify(value);
  return value;
}

async function insert(client: PoolClient, table: string, columns: readonly Column[], rows: readonly Row[]) {
  const names = columns.map((c) => c.name).join(', ');
  const unnest = columns.map((c, i) => `$${i + 1}::${c.type}[]`).join(', ');
  const select = columns.map((c) => (c.expr ? c.expr(`u.${c.name}`) : `u.${c.name}`)).join(', ');
  await client.query(
    `INSERT INTO ${table} (${names}) SELECT ${select} FROM unnest(${unnest}) AS u(${names})`,
    params(columns, rows),
  );
}

async function update(client: PoolClient, table: string, fields: readonly string[], rows: readonly Row[]) {
  const spec = TABLES[table]!;
  const columns = [spec.find((c) => c.name === 'id')!, ...fields.map((f) => spec.find((c) => c.name === f)!)];
  if (columns.some((c) => !c)) throw new Error(`Nieznana kolumna przy zmianie ${table}: ${fields.join(', ')}`);
  const names = columns.map((c) => c.name).join(', ');
  const unnest = columns.map((c, i) => `$${i + 1}::${c.type}[]`).join(', ');
  const set = fields
    .map((f) => {
      const c = spec.find((x) => x.name === f)!;
      return `${f} = ${c.expr ? c.expr(`u.${f}`) : `u.${f}`}`;
    })
    .join(', ');
  for (let i = 0; i < rows.length; i += CHUNK) {
    await client.query(
      `UPDATE ${table} t SET ${set} FROM unnest(${unnest}) AS u(${names}) WHERE t.id = u.id`,
      params(columns, rows.slice(i, i + CHUNK)),
    );
  }
}
