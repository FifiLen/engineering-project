import {
  priceRental,
  type DocumentSources,
  type ReceiptDocumentSource,
  type RentalDocumentSource,
  type RentalPlaceSource,
  type ScooterCardDocumentSource,
  type ServiceTaskDocumentSource,
  type TemplateDocumentType,
  type TicketDocumentSource,
  type TimelineEntrySource,
  type WalletAdjustmentDocumentSource,
} from '@hulajnogi/core';
import type { DrizzleDocumentRepository } from '@hulajnogi/db';
import { rentalLabel } from '../notifications/notification-params.js';
import {
  AUDIT_ACTION_LABELS,
  END_MODE_LABELS,
  label,
  LEDGER_REASON_LABELS,
  PAYMENT_SOURCE_LABELS,
  RECEIPT_ITEM_LABELS,
  REFUND_REASON_LABELS,
  RENTAL_EVENT_LABELS,
  rentalTransitionLabel,
  RENTAL_STATE_LABELS,
  SCOOTER_STATUS_LABELS,
  SCOOTER_STATUS_REASON_LABELS,
  SCOOTER_VARIANT_LABELS,
  TASK_PRIORITY_LABELS,
  TASK_STATUS_LABELS,
  TASK_TYPE_LABELS,
  TICKET_CATEGORY_LABELS,
  TICKET_SOURCE_LABELS,
  TICKET_STATUS_LABELS,
} from './document-labels.js';

/**
 * Wiersze widoków `v_doc_*` (migracja 0011) na źródła katalogu w core (`…DocumentSource`): numery obiektów
 * w zapisie dokumentu, teksty wyliczeń i adres początku i końca przejazdu z odwrotnego wyszukiwania Photon.
 */
type Row = Record<string, unknown>;

export interface SourceContext {
  /** Odwrotne wyszukiwanie z limitem 3 s; `null`: dokument podaje strefę i współrzędne. */
  reverse(point: { lat: number; lon: number }): Promise<string | null>;
  siteUrl: string;
}

const str = (value: unknown): string | null => (value === null || value === undefined ? null : String(value));
const num = (value: unknown): number | null => (value === null || value === undefined ? null : Number(value));
const date = (value: unknown): Date | null =>
  value === null || value === undefined ? null : new Date(value as string);
const list = (value: unknown): Row[] => (Array.isArray(value) ? (value as Row[]) : []);

/** Tablica wyliczeń z `pg` przychodzi jako `{A,B}`, bo sterownik nie zna typów tablic enumów. */
export function pgArray(value: unknown): string[] {
  if (Array.isArray(value)) return value.map(String);
  if (typeof value !== 'string' || value === '{}' || !value) return [];
  return value
    .replace(/^\{|\}$/g, '')
    .split(',')
    .map((v) => v.replace(/^"|"$/g, ''));
}

const categories = (value: unknown) =>
  pgArray(value)
    .map((c) => label(TICKET_CATEGORY_LABELS, c))
    .join(', ');
const taskNumber = (value: unknown) => `S-${String(value)}`;
const ticketNumber = (value: unknown) => `Z-${String(value)}`;

function receipt(row: Row): ReceiptDocumentSource {
  return {
    number: row.number as string,
    kind: row.kind as ReceiptDocumentSource['kind'],
    issuedAt: new Date(row.issued_at as string),
    paymentSourceLabel: label(PAYMENT_SOURCE_LABELS, row.payment_source),
    rentalNumber:
      row.rental_number === null || row.rental_number === undefined ? null : rentalLabel(Number(row.rental_number)),
    seller: { name: str(row.seller_name), address: str(row.seller_address), taxId: str(row.seller_tax_id) },
    buyer: { name: str(row.buyer_name), phone: str(row.buyer_phone) },
    corrected: row.corrects_number
      ? { number: row.corrects_number as string, issuedAt: new Date(row.corrects_issued_at as string) }
      : null,
    // Przyczyna korekty (powód zwrotu) nie jest częścią `v_doc_receipt`; pole zostaje puste.
    correctionReasonLabel: null,
    items: list(row.items).map((item) => ({
      label: label(RECEIPT_ITEM_LABELS, item.description),
      quantity: Number(item.quantity),
      unitPrice: Number(item.unitPrice),
      vatRate: item.vatRate === null || item.vatRate === undefined ? null : Number(item.vatRate),
      amount: Number(item.amount),
    })),
  };
}

function rentalEvent(entry: Row): string {
  const text =
    entry.type === 'STATE_CHANGED'
      ? rentalTransitionLabel(str(entry.fromState), String(entry.toState))
      : label(RENTAL_EVENT_LABELS, entry.type);
  return entry.zoneCode ? `${text} (${String(entry.zoneCode as string)})` : text;
}

async function place(
  lat: unknown,
  lon: unknown,
  zone: { code: unknown; name: unknown },
  ctx: SourceContext,
): Promise<RentalPlaceSource | null> {
  if (lat === null || lat === undefined) return null;
  const point = { lat: Number(lat), lon: Number(lon) };
  return {
    address: await ctx.reverse(point),
    zone: zone.code ? [zone.code, zone.name].filter(Boolean).join(' ') : null,
    ...point,
  };
}

async function rental(row: Row, ctx: SourceContext): Promise<RentalDocumentSource> {
  const price = priceRental(
    {
      unlockFee: Number(row.unlock_fee),
      minuteRate: Number(row.minute_rate),
      pauseMinuteRate: Number(row.pause_minute_rate),
    },
    {
      rideSeconds: Number(row.ride_seconds),
      pauseSeconds: Number(row.pause_seconds),
      startedAt: date(row.started_at),
    },
    { towingFee: num(row.towing_fee) },
  );
  const [start, end] = await Promise.all([
    place(row.start_lat, row.start_lon, { code: row.start_zone_code, name: row.start_zone_name }, ctx),
    place(row.end_lat, row.end_lon, { code: row.end_zone_code, name: row.end_zone_name }, ctx),
  ]);
  return {
    number: rentalLabel(Number(row.number)),
    stateLabel: label(RENTAL_STATE_LABELS, row.state),
    reservedAt: date(row.reserved_at),
    startedAt: date(row.started_at),
    endedAt: date(row.ended_at),
    rideMinutes: price.rideMinutes,
    pauseMinutes: price.pauseMinutes,
    distanceM: num(row.distance_m),
    endModeLabel: row.end_mode ? label(END_MODE_LABELS, row.end_mode) : null,
    tariffVersion: num(row.tariff_version),
    receiptNumber: str(row.receipt_number),
    scooter: { number: Number(row.scooter_number), modelName: row.model_name as string },
    customer: { name: str(row.user_name), phone: str(row.user_phone) },
    start,
    end,
    amounts: {
      unlockFee: price.unlockFee,
      ride: price.rideAmount,
      pause: price.pauseAmount,
      towingFee: price.towingFee,
      total: num(row.total_amount) ?? price.total,
    },
    timeline: list(row.timeline)
      .filter((entry) => entry.kind === 'EVENT')
      .map((entry): TimelineEntrySource => ({ at: new Date(entry.at as string), label: rentalEvent(entry) })),
  };
}

function auditTimeline(entries: Row[]): TimelineEntrySource[] {
  return entries.map((entry) => {
    const text = label(AUDIT_ACTION_LABELS, entry.action);
    const who = entry.staffName ? ` · ${String(entry.staffName as string)}` : '';
    return { at: new Date(entry.at as string), label: `${text}${who}` };
  });
}

function outcome(row: Row): string | null {
  if (row.status !== 'DONE') return null;
  const status = label(SCOOTER_STATUS_LABELS, row.scooter_status);
  const reason = row.scooter_status_reason ? label(SCOOTER_STATUS_REASON_LABELS, row.scooter_status_reason) : null;
  return reason ? `${status}: ${reason}` : status;
}

function serviceTask(
  row: Row,
  live: { batteryPct: number | null } | null,
  reporter: { name: string | null; phone: string | null } | null,
): ServiceTaskDocumentSource {
  const finished = row.status === 'DONE' || row.status === 'CANCELLED';
  return {
    number: taskNumber(row.number),
    typeLabel: label(TASK_TYPE_LABELS, row.type),
    statusLabel: label(TASK_STATUS_LABELS, row.status),
    priorityLabel: label(TASK_PRIORITY_LABELS, row.priority),
    createdAt: new Date(row.created_at as string),
    finishedAt: finished ? date(row.completed_at) : null,
    dueAt: date(row.due_at),
    assigneeName: str(row.assignee_name),
    note: str(row.result_note) ?? str(row.cancel_reason),
    outcome: outcome(row),
    scooter: {
      number: Number(row.scooter_number),
      modelName: row.model_name as string,
      odometerKm: row.odometer_m === null ? null : Math.floor(Number(row.odometer_m) / 1000),
      batteryPct: live?.batteryPct ?? null,
    },
    ticket: row.ticket_id
      ? { number: ticketNumber(row.ticket_number), categoriesLabel: categories(row.ticket_categories), reporter }
      : null,
    parts: list(row.parts).map((part) => ({
      name: part.name as string,
      sku: part.sku as string,
      quantity: Number(part.quantity),
      unitCost: Number(part.unitCost),
    })),
    timeline: auditTimeline(list(row.timeline)),
  };
}

function scooterCard(row: Row, live: { batteryPct: number | null; lastSeenAt: Date | null } | null, siteUrl: string) {
  const number = Number(row.number);
  return {
    number,
    serialNumber: row.serial_number as string,
    statusLabel: label(SCOOTER_STATUS_LABELS, row.status),
    variantLabel: label(SCOOTER_VARIANT_LABELS, row.variant),
    model: { code: row.model_code as string, name: row.model_name as string },
    firmware: str(row.firmware),
    odometerM: Number(row.odometer_m ?? 0),
    batteryPct: live?.batteryPct ?? null,
    lastSeenAt: live?.lastSeenAt ?? null,
    createdAt: new Date(row.created_at as string),
    pageUrl: `${siteUrl.replace(/\/$/, '')}/h/${String(number).padStart(4, '0')}`,
    tasks: list(row.service_tasks).map((task) => ({
      number: taskNumber(task.number),
      typeLabel: label(TASK_TYPE_LABELS, task.type),
      statusLabel: label(TASK_STATUS_LABELS, task.status),
      createdAt: new Date(task.createdAt as string),
      finishedAt: date(task.completedAt),
    })),
    tickets: list(row.tickets).map((ticket) => ({
      number: ticketNumber(ticket.number),
      categoriesLabel: categories(ticket.categories),
      statusLabel: label(TICKET_STATUS_LABELS, ticket.status),
      createdAt: new Date(ticket.createdAt as string),
    })),
  } satisfies ScooterCardDocumentSource;
}

function ticket(row: Row, modelName: string): TicketDocumentSource {
  return {
    number: ticketNumber(row.number),
    sourceLabel: label(TICKET_SOURCE_LABELS, row.source),
    statusLabel: label(TICKET_STATUS_LABELS, row.status),
    categoriesLabel: categories(row.categories),
    urgent: Boolean(row.urgent),
    createdAt: new Date(row.created_at as string),
    resolvedAt: date(row.resolved_at),
    description: str(row.description),
    reply: str(row.customer_reply),
    scooter: { number: Number(row.scooter_number), modelName },
    rentalNumber:
      row.rental_number === null || row.rental_number === undefined ? null : rentalLabel(Number(row.rental_number)),
    reporter: row.reported_by ? { name: str(row.reporter_name), phone: str(row.reporter_phone) } : null,
    photos: list(row.photo_list).map((photo) => new Date(photo.uploadedAt as string)),
    timeline: auditTimeline(list(row.timeline)),
  };
}

function walletAdjustment(row: Row): WalletAdjustmentDocumentSource {
  return {
    reference: `K-${String(row.entry_id).padStart(6, '0')}`,
    createdAt: new Date(row.created_at as string),
    amount: Number(row.amount),
    balanceAfter: Number(row.balance_after),
    reasonLabel: row.reason ? label(LEDGER_REASON_LABELS, row.reason) : label(REFUND_REASON_LABELS, row.refund_reason),
    note: str(row.note),
    authorName: str(row.staff_name),
    customer: { name: str(row.user_name), phone: str(row.user_phone) },
  };
}

/** Źródło danych wydruku rodzaju z widoku `v_doc_*`; `null`: obiektu nie ma. */
export async function loadDocumentSource<K extends TemplateDocumentType>(
  repo: DrizzleDocumentRepository,
  type: K,
  entityId: string,
  ctx: SourceContext,
): Promise<DocumentSources[K] | null> {
  const row = await repo.source(type, entityId);
  if (!row) return null;
  switch (type) {
    case 'RECEIPT':
      return receipt(row) as DocumentSources[K];
    case 'RENTAL_CONFIRMATION':
      return (await rental(row, ctx)) as DocumentSources[K];
    case 'SERVICE_PROTOCOL': {
      const live = await repo.scooterLiveState(row.scooter_id as string);
      const ticketRow = row.ticket_id ? await repo.source('INCIDENT_REPORT', row.ticket_id as string) : null;
      const reporter = ticketRow?.reported_by
        ? { name: str(ticketRow.reporter_name), phone: str(ticketRow.reporter_phone) }
        : null;
      return serviceTask(row, live, reporter) as DocumentSources[K];
    }
    case 'SCOOTER_CARD': {
      const live = await repo.scooterLiveState(row.scooter_id as string);
      return scooterCard(row, live, ctx.siteUrl) as DocumentSources[K];
    }
    case 'INCIDENT_REPORT': {
      const scooter = await repo.source('SCOOTER_CARD', row.scooter_id as string);
      return ticket(row, str(scooter?.model_name) ?? '') as DocumentSources[K];
    }
    case 'WALLET_ADJUSTMENT':
      return walletAdjustment(row) as DocumentSources[K];
  }
  return null;
}
