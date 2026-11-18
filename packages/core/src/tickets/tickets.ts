import { DomainError } from '../errors.js';

/**
 * Zgłoszenia usterek (ADR 0055): od klienta (`USER`), z systemu (`AUTO`) i od operatora (`STAFF`). Reguły
 * kategorii, pilności i statusów są tutaj; baza sprawdza pilność (`CHECK`) i jedno otwarte zgłoszenie
 * automatyczne danego rodzaju (indeks częściowy na `auto_kind`).
 */
export const TICKET_SOURCES = ['USER', 'AUTO', 'STAFF'] as const;
export type TicketSource = (typeof TICKET_SOURCES)[number];

export const TICKET_STATUSES = ['NEW', 'IN_PROGRESS', 'AT_SERVICE', 'RESOLVED'] as const;
export type TicketStatus = (typeof TICKET_STATUSES)[number];

/** Typ `ticket_category`; `BILLING` i `OUT_OF_ZONE` dochodzą w migracji 0008. */
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

/** Kategorie w aplikacji; `BILLING` („Rozliczenie”, pytanie 6) tylko w zgłoszeniu z przejazdu. */
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

/** Kategorie tylko dla zgłoszeń automatycznych i operatora. */
export const SYSTEM_TICKET_CATEGORIES = ['CONNECTION', 'OUT_OF_ZONE'] as const satisfies readonly TicketCategory[];

/** Usterki pilne (pytanie 4): wyłączają hulajnogę z ruchu od razu albo po przejeździe. */
export const URGENT_TICKET_CATEGORIES = ['BRAKES', 'WHEEL', 'HANDLEBAR'] as const satisfies readonly TicketCategory[];

/** Kategorie, przy których opis jest wymagany. */
export const DESCRIPTION_REQUIRED_CATEGORIES = ['BILLING', 'OTHER'] as const satisfies readonly TicketCategory[];

export const TICKET_MAX_PHOTOS = 3;

/** Rodzaj zgłoszenia automatycznego (`tickets.auto_kind`), osobna kolumna pod indeks częściowy. */
export const AUTO_TICKET_KINDS = ['OFFLINE', 'BATTERY_CRITICAL', 'OUT_OF_ZONE'] as const;
export type AutoTicketKind = (typeof AUTO_TICKET_KINDS)[number];

export const AUTO_TICKET_CATEGORY: Record<AutoTicketKind, TicketCategory> = {
  OFFLINE: 'CONNECTION',
  BATTERY_CRITICAL: 'BATTERY',
  OUT_OF_ZONE: 'OUT_OF_ZONE',
};

/** Hulajnoga offline dłużej niż 5 min daje zgłoszenie `OFFLINE` (zadanie `tickets.offline-check`, pytanie 3). */
export const OFFLINE_TICKET_AFTER_MS = 5 * 60_000;
/** Bateria poniżej tego progu przy `ENDED` daje zgłoszenie `BATTERY_CRITICAL` i zadanie `BATTERY_SWAP`. */
export const BATTERY_CRITICAL_TICKET_PCT = 10;

const includesAny = (categories: readonly TicketCategory[], set: readonly TicketCategory[]) =>
  categories.some((c) => set.includes(c));

export const isUrgent = (categories: readonly TicketCategory[]): boolean =>
  includesAny(categories, URGENT_TICKET_CATEGORIES);

export interface TicketInput {
  source: Exclude<TicketSource, 'AUTO'>;
  categories: readonly TicketCategory[];
  description: string | null;
  photoCount: number;
  /** Zgłoszenie z przejazdu (`rental_id`): w trakcie jazdy (D5) albo z podsumowania. */
  hasRental: boolean;
}

export interface ValidTicket {
  /** Kategorie bez powtórzeń, w kolejności typu w bazie. */
  categories: TicketCategory[];
  description: string | null;
  urgent: boolean;
}

/**
 * Walidacja zgłoszenia od klienta albo operatora: co najmniej jedna kategoria z listy źródła, `BILLING` tylko
 * z przejazdem, opis przy `BILLING` i `OTHER`, najwyżej `TICKET_MAX_PHOTOS` zdjęć.
 */
export function validateTicket(input: TicketInput): ValidTicket {
  const categories = TICKET_CATEGORIES.filter((c) => input.categories.includes(c));
  if (!categories.length) throw new DomainError('TICKET_CATEGORIES_REQUIRED');
  const allowed: readonly TicketCategory[] = input.source === 'USER' ? CUSTOMER_TICKET_CATEGORIES : TICKET_CATEGORIES;
  const forbidden = categories.find((c) => !allowed.includes(c));
  if (forbidden) throw new DomainError('TICKET_CATEGORY_NOT_ALLOWED', { category: forbidden });
  if (categories.includes('BILLING') && !input.hasRental) {
    throw new DomainError('TICKET_RENTAL_REQUIRED', { category: 'BILLING' });
  }
  const description = input.description?.trim() || null;
  if (!description && includesAny(categories, DESCRIPTION_REQUIRED_CATEGORIES)) {
    throw new DomainError('TICKET_DESCRIPTION_REQUIRED', {
      categories: categories.filter((c) => (DESCRIPTION_REQUIRED_CATEGORIES as readonly string[]).includes(c)),
    });
  }
  if (!Number.isInteger(input.photoCount) || input.photoCount < 0 || input.photoCount > TICKET_MAX_PHOTOS) {
    throw new DomainError('TICKET_TOO_MANY_PHOTOS', { max: TICKET_MAX_PHOTOS });
  }
  return { categories, description, urgent: isUrgent(categories) };
}

export interface AutoTicket {
  source: 'AUTO';
  autoKind: AutoTicketKind;
  categories: TicketCategory[];
  urgent: boolean;
  /** Zadanie zakładane od razu ze zgłoszeniem; `OFFLINE` czeka na dyspozytora. */
  taskType: 'BATTERY_SWAP' | 'RELOCATION' | null;
}

/** Zgłoszenie automatyczne danego rodzaju; duplikat odrzuca indeks, a zadanie w tle traktuje konflikt jako „już jest”. */
export function autoTicket(kind: AutoTicketKind): AutoTicket {
  const categories = [AUTO_TICKET_CATEGORY[kind]];
  const taskType = kind === 'BATTERY_CRITICAL' ? 'BATTERY_SWAP' : kind === 'OUT_OF_ZONE' ? 'RELOCATION' : null;
  return { source: 'AUTO', autoKind: kind, categories, urgent: isUrgent(categories), taskType };
}

/** `tickets.offline-check` po 5 min: hulajnoga nadal offline od utraty łączności. */
export function shouldOpenOfflineTicket(input: { online: boolean; offlineSince: Date | null; now: Date }): boolean {
  return (
    !input.online &&
    input.offlineSince !== null &&
    input.now.getTime() - input.offlineSince.getTime() >= OFFLINE_TICKET_AFTER_MS
  );
}

export const needsBatteryCriticalTicket = (batteryPct: number | null): boolean =>
  batteryPct !== null && batteryPct < BATTERY_CRITICAL_TICKET_PCT;

/** Po powrocie łączności zgłoszenie `OFFLINE` bez zadania w stanie `NEW` albo `IN_PROGRESS` zamyka się samo. */
export function canAutoCloseOfflineTicket(ticket: {
  autoKind: AutoTicketKind | null;
  status: TicketStatus;
  hasTasks: boolean;
}): boolean {
  return (
    ticket.autoKind === 'OFFLINE' && (ticket.status === 'NEW' || ticket.status === 'IN_PROGRESS') && !ticket.hasTasks
  );
}

/** Rodzaj zadania podpowiadany w oknie „Utwórz zadanie”; `null` dla samej reklamacji (`BILLING`). */
export function suggestTaskType(
  categories: readonly TicketCategory[],
): 'REPAIR' | 'BATTERY_SWAP' | 'RELOCATION' | null {
  const service = categories.filter((c) => c !== 'BILLING');
  if (!service.length) return null;
  if (service.every((c) => c === 'BATTERY')) return 'BATTERY_SWAP';
  if (service.every((c) => c === 'OUT_OF_ZONE')) return 'RELOCATION';
  return 'REPAIR';
}

/** Priorytet zadania ze zgłoszenia: pilne zgłoszenie daje wysoki. */
export const taskPriorityForTicket = (urgent: boolean): 'HIGH' | 'NORMAL' => (urgent ? 'HIGH' : 'NORMAL');

/** Statusy, które operator ustawia ręcznie; `AT_SERVICE` ustawia tylko system (zadanie ze zgłoszenia). */
export const MANUAL_TICKET_STATUSES = ['NEW', 'IN_PROGRESS', 'RESOLVED'] as const satisfies readonly TicketStatus[];

export interface TicketState {
  status: TicketStatus;
  source: TicketSource;
  customerReply: string | null;
}

export interface TicketUpdateDecision {
  status: TicketStatus;
  statusChanged: boolean;
  /** Nowa odpowiedź dla klienta (`customer_reply`, `customer_reply_at`); `null`, gdy się nie zmienia. */
  reply: string | null;
  /** Push `ticket_status_changed` do klienta: zmiana statusu albo nowa odpowiedź w zgłoszeniu klienta. */
  notifyCustomer: boolean;
}

/**
 * Zmiana statusu albo odpowiedzi przez operatora (ADR 0055, D7):
 * - `RESOLVED` jest stanem końcowym (`TICKET_RESOLVED`); nowy problem to nowe zgłoszenie;
 * - `AT_SERVICE` ustawia tylko system, a z `AT_SERVICE` operator nie cofnie zgłoszenia, dopóki są otwarte zadania;
 * - `RESOLVED` wymaga braku otwartych zadań, a w zgłoszeniu klienta odpowiedzi (nowej albo zapisanej wcześniej);
 * - odpowiedź jest tylko w zgłoszeniu klienta i zastępuje poprzednią (poprzednie zostają w dzienniku audytu).
 */
export function decideTicketUpdate(input: {
  ticket: TicketState;
  status?: TicketStatus;
  reply?: string | null;
  openTasks: number;
}): TicketUpdateDecision {
  const { ticket, openTasks } = input;
  const to = input.status ?? ticket.status;
  const reply = input.reply?.trim() || null;
  if (ticket.status === 'RESOLVED') throw new DomainError('TICKET_RESOLVED');
  if (reply && ticket.source !== 'USER') throw new DomainError('TICKET_REPLY_NOT_ALLOWED', { source: ticket.source });
  const statusChanged = to !== ticket.status;
  if (!statusChanged && !reply) {
    throw new DomainError('INVALID_TICKET_TRANSITION', { from: ticket.status, to });
  }
  if (statusChanged) {
    if (!(MANUAL_TICKET_STATUSES as readonly TicketStatus[]).includes(to)) {
      throw new DomainError('INVALID_TICKET_TRANSITION', { from: ticket.status, to });
    }
    if (ticket.status === 'AT_SERVICE' && to !== 'RESOLVED' && openTasks > 0) {
      throw new DomainError('TICKET_HAS_OPEN_TASKS', { openTasks });
    }
    if (to === 'RESOLVED') {
      if (openTasks > 0) throw new DomainError('TICKET_HAS_OPEN_TASKS', { openTasks });
      if (ticket.source === 'USER' && !reply && !ticket.customerReply?.trim()) {
        throw new DomainError('TICKET_REPLY_REQUIRED');
      }
    }
  }
  return { status: to, statusChanged, reply, notifyCustomer: ticket.source === 'USER' };
}

/** Przypisanie dyspozytora albo serwisanta; zamkniętego zgłoszenia nie przypisuje się. */
export function ensureCanAssignTicket(status: TicketStatus): void {
  if (status === 'RESOLVED') throw new DomainError('TICKET_RESOLVED');
}

/** Pierwsze otwarte zadanie ze zgłoszenia ustawia `AT_SERVICE`; z rozwiązanego zgłoszenia zadania nie ma. */
export function ticketStatusOnTaskOpened(status: TicketStatus): 'AT_SERVICE' {
  if (status === 'RESOLVED') throw new DomainError('TICKET_RESOLVED');
  return 'AT_SERVICE';
}

/**
 * Status zgłoszenia po zamknięciu zadania; `null`, gdy się nie zmienia. Po ostatnim zadaniu zgłoszenie dostaje
 * `RESOLVED`, jeśli któreś zadanie zakończono (`DONE`), a gdy wszystkie anulowano, wraca do dyspozytora
 * (`IN_PROGRESS`).
 */
export function ticketStatusOnTaskClosed(input: {
  status: TicketStatus;
  openTasks: number;
  doneTasks: number;
}): TicketStatus | null {
  if (input.status !== 'AT_SERVICE' || input.openTasks > 0) return null;
  return input.doneTasks > 0 ? 'RESOLVED' : 'IN_PROGRESS';
}
