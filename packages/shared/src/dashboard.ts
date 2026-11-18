/**
 * Pulpit „Wymaga uwagi” (D1 iteracji 6, makieta `27-panel-serwis/pulpit-uwaga`): liczby z `fn_dashboard_attention`
 * i najwyżej cztery pozycje na grupę. Grupa jest w odpowiedzi tylko z uprawnieniem listy docelowej (ADR 0055);
 * bez niego pole ma wartość `null`, a panel jej nie pokazuje.
 */
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
