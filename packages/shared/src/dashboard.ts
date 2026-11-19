/**
 * Pulpit „Wymaga uwagi” (D1 iteracji 6, makieta `27-panel-serwis/pulpit-uwaga`): liczby z `fn_dashboard_attention`
 * i najwyżej cztery pozycje na grupę. Grupa jest w odpowiedzi tylko z uprawnieniem listy docelowej (ADR 0055);
 * bez niego pole ma wartość `null`, a panel jej nie pokazuje.
 */
import { z } from 'zod';
import type { PaymentMethodKind, PaymentPurpose } from './payments.js';
import type { RentalState } from './rentals.js';
import type { ServiceTaskStatus } from './service.js';
import type { TicketCategory } from './tickets.js';

/** Liczba pozycji w grupie pulpitu (makieta). */
export const DASHBOARD_GROUP_ITEMS = 4;

/** Hulajnoga offline w przejeździe (`rentals.read`). */
export interface AttentionOfflineRental {
  rentalId: string;
  rentalNumber: number;
  rentalState: RentalState;
  scooterId: string;
  scooterNumber: number;
  userName: string | null;
  /** Ostatni sygnał hulajnogi (czas bez łączności liczy panel). */
  lastSeenAt: string | null;
  parkingZoneCode: string | null;
  parkingZoneName: string | null;
  /** Otwarte zgłoszenie automatyczne `OFFLINE` tej hulajnogi. */
  ticketId: string | null;
  ticketNumber: number | null;
  billingStopped: boolean;
}

/** Hulajnoga z baterią poniżej progu krytycznego (`scooters.read`). */
export interface AttentionCriticalBattery {
  scooterId: string;
  scooterNumber: number;
  status: string;
  batteryPct: number | null;
  parkingZoneCode: string | null;
  parkingZoneName: string | null;
  rentalId: string | null;
  rentalNumber: number | null;
  /** Otwarte zadanie wymiany baterii. */
  taskId: string | null;
  taskNumber: number | null;
  taskStatus: ServiceTaskStatus | null;
  taskAssigneeName: string | null;
  taskOverdue: boolean;
}

/** Nowe pilne zgłoszenie bez przypisania (`tickets.read`); nazwisko klienta tylko z `users.read`. */
export interface AttentionUrgentTicket {
  ticketId: string;
  ticketNumber: number;
  categories: TicketCategory[];
  scooterId: string;
  scooterNumber: number;
  reporterName: string | null;
  photos: number;
  createdAt: string;
}

/** Nieudana płatność z dzisiejszego dnia (`payments.read`). */
export interface AttentionFailedPayment {
  paymentId: string;
  purpose: PaymentPurpose;
  method: PaymentMethodKind;
  amount: number;
  userId: string;
  userName: string | null;
  rentalId: string | null;
  rentalNumber: number | null;
  failureCode: string | null;
  updatedAt: string;
}

export interface AttentionGroup<T> {
  count: number;
  items: T[];
}

export interface DashboardAttention {
  /** Próg krytycznej baterii użyty w grupie (packages/core, zgłoszenie `BATTERY_CRITICAL`). */
  criticalBatteryPct: number;
  offlineInRental: (AttentionGroup<AttentionOfflineRental> & { billingStopped: number }) | null;
  criticalBattery: AttentionGroup<AttentionCriticalBattery> | null;
  urgentTickets: AttentionGroup<AttentionUrgentTicket> | null;
  failedPayments: (AttentionGroup<AttentionFailedPayment> & { unpaidRentals: number }) | null;
  asOf: string;
}

// ---------------------------------------------------------------------------------------------------------
// Pulpit z kafelkami i wykresami (iteracja 8, pytanie 9, plansze `33-panel-pulpit`): `GET /admin/dashboard/summary`
// ---------------------------------------------------------------------------------------------------------

/**
 * Kafelki w stałej kolejności katalogu (kopia `DASHBOARD_TILE_KEYS` z packages/core): rola widzi pierwsze pięć
 * dozwolonych, a odpowiedź ma tylko te kafelki (bez uprawnienia kafelka nie ma w tablicy).
 */
export const DASHBOARD_TILE_KEYS = [
  'activeRides',
  'availableScooters',
  'lowBattery',
  'salesToday',
  'newTickets',
  'tasksInProgress',
  'partsBelowMinimum',
] as const;
export type DashboardTileKey = (typeof DASHBOARD_TILE_KEYS)[number];

export const dashboardTileSchema = z.discriminatedUnion('key', [
  /** Przejazdy w toku bez rezerwacji (`rentals.read`), przyrost: starty w ostatnich 60 min. */
  z.object({ key: z.literal('activeRides'), value: z.number().int(), startedLastHour: z.number().int() }),
  /** Status floty `AVAILABLE` (bez niskiej baterii) z udziałem we flocie bez `RETIRED` (`scooters.read`). */
  z.object({
    key: z.literal('availableScooters'),
    value: z.number().int(),
    fleetTotal: z.number().int(),
    share: z.number().nullable(),
  }),
  /** Poniżej progu cennika, w tym krytyczne poniżej 10% (`scooters.read`). */
  z.object({
    key: z.literal('lowBattery'),
    value: z.number().int(),
    critical: z.number().int(),
    thresholdPct: z.number().int(),
  }),
  /** Sprzedaż brutto z paragonów od północy (korekty odjęte, jak raport przychodów) w groszach (`payments.read`). */
  z.object({ key: z.literal('salesToday'), value: z.number().int(), receipts: z.number().int() }),
  /** Zgłoszenia `NEW`, w tym pilne bez wykonawcy (`tickets.read`). */
  z.object({ key: z.literal('newTickets'), value: z.number().int(), urgentUnassigned: z.number().int() }),
  /** Zadania `OPEN` i `IN_PROGRESS`, w tym przypisane do zalogowanego i po terminie (`service.read`). */
  z.object({
    key: z.literal('tasksInProgress'),
    value: z.number().int(),
    mine: z.number().int(),
    overdue: z.number().int(),
  }),
  /** Części poniżej minimum (reguła `<`), nazwy trzech pierwszych do opisu (`service.read`). */
  z.object({ key: z.literal('partsBelowMinimum'), value: z.number().int(), names: z.array(z.string()).max(3) }),
]);
export type DashboardTile = z.infer<typeof dashboardTileSchema>;

const isoDateTime = z.string();

export const dashboardSummarySchema = z.object({
  asOf: isoDateTime,
  tiles: z.array(dashboardTileSchema).max(5),
  /** „Przejazdy dziś według godzin” (`rentals.read`); `null` bez uprawnienia. */
  ridesByHour: z
    .object({
      /** Doba polska `RRRR-MM-DD`. */
      day: z.string(),
      currentHour: z.number().int().nullable(),
      ridesSoFar: z.number().int(),
      avgSoFar: z.number(),
      hours: z.array(
        z.object({
          hour: z.number().int(),
          rides: z.number().int(),
          /** Średnia z czterech poprzednich tych samych dni tygodnia. */
          avgPrevious: z.number(),
          state: z.enum(['past', 'current', 'future']),
        }),
      ),
    })
    .nullable(),
  /** „Stan floty” (`scooters.read`): pasek bez wyłączonych z ruchu. */
  fleetState: z
    .object({
      total: z.number().int(),
      retired: z.number().int(),
      segments: z.array(
        z.object({
          key: z.enum(['AVAILABLE', 'IN_USE_OR_RESERVED', 'LOW_BATTERY', 'MAINTENANCE', 'OFFLINE']),
          count: z.number().int(),
          share: z.number().nullable(),
        }),
      ),
    })
    .nullable(),
  /** „Twoje zadania” Serwisanta (`service.read`, rola bez `rentals.read`): do 5 przypisanych według terminu. */
  myTasks: z
    .object({
      assigned: z.number().int(),
      overdue: z.number().int(),
      unassigned: z.number().int(),
      inProgressTotal: z.number().int(),
      items: z
        .array(
          z.object({
            taskId: z.string(),
            number: z.number().int(),
            type: z.enum(['REPAIR', 'BATTERY_SWAP', 'INSPECTION', 'RELOCATION']),
            status: z.enum(['OPEN', 'IN_PROGRESS']),
            scooterId: z.string(),
            scooterNumber: z.number().int(),
            dueAt: isoDateTime.nullable(),
            overdue: z.boolean(),
          }),
        )
        .max(5),
    })
    .nullable(),
  /** Kafelki i grupa „Treści” Redaktora (`content.read`, rola bez kafelków operacyjnych; dług z iteracji 7). */
  content: z
    .object({
      tiles: z.object({
        publishedNews: z.object({
          value: z.number().int(),
          scheduled: z.number().int(),
          expiringSoon: z.number().int(),
        }),
        faq: z.object({ value: z.number().int(), categories: z.number().int(), unpublished: z.number().int() }),
        sectionBlocks: z.object({
          value: z.number().int(),
          web: z.number().int(),
          mobile: z.number().int(),
          drafts: z.number().int(),
        }),
        media: z.object({ value: z.number().int(), unused: z.number().int() }),
      }),
      /** Cztery podgrupy, każda z liczbą i najwyżej czterema pozycjami. */
      scheduledNews: z.object({
        count: z.number().int(),
        items: z.array(
          z.object({ id: z.string(), title: z.string(), publishFrom: isoDateTime, authorName: z.string().nullable() }),
        ),
      }),
      expiringNews: z.object({
        count: z.number().int(),
        items: z.array(
          z.object({ id: z.string(), title: z.string(), publishTo: isoDateTime, authorName: z.string().nullable() }),
        ),
      }),
      drafts: z.object({
        count: z.number().int(),
        items: z.array(
          z.object({
            kind: z.enum(['NEWS', 'CONTENT_BLOCK', 'LEGAL_DOCUMENT']),
            id: z.string(),
            title: z.string(),
            client: z.enum(['WEB', 'MOBILE', 'ADMIN']).nullable(),
            updatedAt: isoDateTime,
            authorName: z.string().nullable(),
          }),
        ),
      }),
      unusedMedia: z.object({
        count: z.number().int(),
        items: z.array(
          z.object({
            id: z.string(),
            originalName: z.string().nullable(),
            width: z.number().int().nullable(),
            height: z.number().int().nullable(),
            sizeBytes: z.number().int(),
            createdAt: isoDateTime,
          }),
        ),
      }),
      lastPublishedAt: isoDateTime.nullable(),
    })
    .nullable(),
});
export type DashboardSummary = z.infer<typeof dashboardSummarySchema>;

/** Odświeżanie pulpitu (pytanie 9): co 60 s i po zdarzeniach `fleet`, zgłoszeń i płatności (zbiorczo po 1 s). */
export const DASHBOARD_REFRESH_MS = 60_000;
