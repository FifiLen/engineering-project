/**
 * Kontrakt zgłoszeń między aplikacją, panelem i API (iteracja 6, ADR 0055). Wartości wyliczeń są kopią
 * z packages/core; zgodność pilnuje test API.
 */
import { z } from 'zod';
import type { FileView } from './files.js';
import type { ServiceTaskSummary, ServiceTaskType } from './service.js';

export const TICKET_SOURCES = ['USER', 'AUTO', 'STAFF'] as const;
export type TicketSource = (typeof TICKET_SOURCES)[number];

export const TICKET_STATUSES = ['NEW', 'IN_PROGRESS', 'AT_SERVICE', 'RESOLVED'] as const;
export type TicketStatus = (typeof TICKET_STATUSES)[number];

/** Statusy ustawiane ręcznie przez operatora; `AT_SERVICE` ustawia zadanie serwisowe ze zgłoszenia. */
export const MANUAL_TICKET_STATUSES = ['NEW', 'IN_PROGRESS', 'RESOLVED'] as const satisfies readonly TicketStatus[];

export const TICKET_CATEGORIES = [
  'BRAKES',
  'LIGHTS',
  'WHEEL',
  'HANDLEBAR',
  'QR_CODE',
  'BATTERY',
  'CONNECTION',
  'OTHER',
  'BILLING',
  'OUT_OF_ZONE',
] as const;
export type TicketCategory = (typeof TICKET_CATEGORIES)[number];

/** Kategorie w aplikacji; `BILLING` („Rozliczenie”) tylko w zgłoszeniu z przejazdu. */
export const CUSTOMER_TICKET_CATEGORIES = [
  'BRAKES',
  'LIGHTS',
  'WHEEL',
  'HANDLEBAR',
  'QR_CODE',
  'BATTERY',
  'OTHER',
  'BILLING',
] as const satisfies readonly TicketCategory[];
export type CustomerTicketCategory = (typeof CUSTOMER_TICKET_CATEGORIES)[number];

/** Pilne kategorie (pytanie 4): aplikacja i panel oznaczają je od razu, regułę stosuje API. */
export const URGENT_TICKET_CATEGORIES = ['BRAKES', 'WHEEL', 'HANDLEBAR'] as const satisfies readonly TicketCategory[];
/** Kategorie, przy których opis jest wymagany. */
export const DESCRIPTION_REQUIRED_CATEGORIES = ['BILLING', 'OTHER'] as const satisfies readonly TicketCategory[];

export const AUTO_TICKET_KINDS = ['OFFLINE', 'BATTERY_CRITICAL', 'OUT_OF_ZONE'] as const;
export type AutoTicketKind = (typeof AUTO_TICKET_KINDS)[number];

export const TICKET_MAX_PHOTOS = 3;
export const TICKET_DESCRIPTION_MAX = 1000;
/** Licznik „Odpowiedź dla klienta” w panelu (makieta `zgloszenie-szczegoly`). */
export const TICKET_REPLY_MAX = 500;

/** Numer zgłoszenia dla klienta i panelu, np. `Z-1042` (zadania mają `S-…`). */
export const ticketLabel = (number: number): string => `Z-${number}`;

const description = z.string().trim().max(TICKET_DESCRIPTION_MAX).nullable().default(null);
const photoIds = z.array(z.uuid()).max(TICKET_MAX_PHOTOS).default([]);

/**
 * `POST /tickets`: zgłoszenie klienta z profilu, z podsumowania albo w trakcie przejazdu (`rentalId`, D5), z karty
 * hulajnogi; zdjęcia wysłane wcześniej przez `POST /files` z celem `TICKET_PHOTO`. Reguły kategorii i opisu
 * (`BILLING` z przejazdem, opis przy `BILLING` i `OTHER`) sprawdza core.
 */
export const customerTicketCreateSchema = z.object({
  scooterId: z.uuid(),
  rentalId: z.uuid().nullable().default(null),
  categories: z.array(z.enum(CUSTOMER_TICKET_CATEGORIES)).min(1).max(CUSTOMER_TICKET_CATEGORIES.length),
  description,
  photoIds,
});
export type CustomerTicketCreate = z.infer<typeof customerTicketCreateSchema>;

/** Zgłoszenie operatora z karty hulajnogi albo przejazdu (`source = STAFF`); kategorie systemowe dozwolone. */
export const staffTicketCreateSchema = z.object({
  scooterId: z.uuid(),
  rentalId: z.uuid().nullable().default(null),
  categories: z.array(z.enum(TICKET_CATEGORIES)).min(1).max(TICKET_CATEGORIES.length),
  description,
  photoIds,
  assigneeId: z.uuid().nullable().default(null),
});
export type StaffTicketCreate = z.infer<typeof staffTicketCreateSchema>;

/**
 * Zmiana statusu i (albo) odpowiedź dla klienta (D7); nowa odpowiedź zastępuje poprzednią i idzie pushem.
 * `note` to wewnętrzna notatka rozwiązania (`resolution_note`), której klient nie widzi.
 */
export const ticketStatusChangeSchema = z
  .object({
    version: z.number().int().min(1),
    status: z.enum(MANUAL_TICKET_STATUSES).optional(),
    reply: z.string().trim().max(TICKET_REPLY_MAX).nullable().default(null),
    note: z.string().trim().max(TICKET_DESCRIPTION_MAX).nullable().default(null),
  })
  .refine((v) => v.status !== undefined || Boolean(v.reply), { path: ['status'] });
export type TicketStatusChange = z.infer<typeof ticketStatusChangeSchema>;

/** Przypisanie dyspozytora albo serwisanta; `null` zdejmuje przypisanie. */
export const ticketAssignSchema = z.object({
  version: z.number().int().min(1),
  assigneeId: z.uuid().nullable(),
});
export type TicketAssign = z.infer<typeof ticketAssignSchema>;

// --- Widoki klienta -------------------------------------------------------------------------------

/** Wpis historii statusów w aplikacji: bez nazwisk operatorów i notatek wewnętrznych. */
export interface CustomerTicketStatusEntry {
  status: TicketStatus;
  at: string;
}

export interface TicketReplyView {
  text: string;
  at: string;
  /** Odczyt przez klienta (`customer_reply_read_at`); `null`, gdy nieprzeczytana. */
  readAt: string | null;
}

/** Pozycja „Moje zgłoszenia”. */
export interface CustomerTicketListItem {
  id: string;
  number: number;
  status: TicketStatus;
  categories: TicketCategory[];
  scooterNumber: number;
  createdAt: string;
  updatedAt: string;
  hasUnreadReply: boolean;
}

/** Szczegóły zgłoszenia w aplikacji (`GET /me/tickets/{id}`). */
export interface CustomerTicketView extends CustomerTicketListItem {
  description: string | null;
  rental: { id: string; number: number; endedAt: string | null } | null;
  photos: FileView[];
  reply: TicketReplyView | null;
  /** Zwrot z reklamacji (ADR 0055): kwota w groszach i paragon korygujący, jeśli powstał. */
  refund: { amount: number; receiptId: string | null } | null;
  history: CustomerTicketStatusEntry[];
  resolvedAt: string | null;
}

// --- Widoki panelu --------------------------------------------------------------------------------

/** Aktor wpisu osi czasu (`audit_log.actor` i zgłoszenie od klienta). */
export const TIMELINE_ACTORS = ['STAFF', 'SYSTEM', 'CUSTOMER'] as const;
export type TimelineActor = (typeof TIMELINE_ACTORS)[number];

/** Wpis osi czasu zgłoszenia albo zadania z `v_ticket_timeline` (D6). */
export interface TicketTimelineEntry {
  at: string;
  actor: TimelineActor;
  staffId: string | null;
  staffName: string | null;
  /** Akcja dziennika audytu, np. `ticket.status_changed`, `service_task.created`, `refund.created`. */
  action: string;
  entityType: string;
  entityId: string | null;
  data: Record<string, unknown>;
}

/** Szczegóły zgłoszenia w panelu; bez `users.read` API podaje `reporter.name = null` (panel pokazuje „Klient”). */
export interface TicketAdminDetails {
  id: string;
  number: number;
  version: number;
  source: TicketSource;
  autoKind: AutoTicketKind | null;
  status: TicketStatus;
  urgent: boolean;
  categories: TicketCategory[];
  description: string | null;
  scooter: { id: string; number: number; status: string; online: boolean; batteryPct: number | null };
  rental: { id: string; number: number } | null;
  reporter: { id: string; name: string | null } | null;
  assignee: { id: string; name: string } | null;
  photos: FileView[];
  reply: TicketReplyView | null;
  resolutionNote: string | null;
  tasks: ServiceTaskSummary[];
  /** Rodzaj podpowiadany w oknie „Utwórz zadanie” (`null` przy samej reklamacji). */
  suggestedTaskType: ServiceTaskType | null;
  /** Rodzaje dostępne na hulajnodze (rodzaj już otwarty jest niedostępny). */
  availableTaskTypes: ServiceTaskType[];
  /** Kwota zwrotów powiązanych ze zgłoszeniem (reklamacja, grosze); `null` bez `payments.read`. */
  refundedAmount: number | null;
  timeline: TicketTimelineEntry[];
  createdAt: string;
  updatedAt: string;
  resolvedAt: string | null;
}
