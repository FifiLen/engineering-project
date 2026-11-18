/**
 * Zasób panelu modułu Wypożyczenia: przejazdy tylko do odczytu i zdalne zakończenie (ADR 0031, ADR 0036).
 */
import { z } from 'zod';
import { RIDE_SETTLEMENTS, type RentalSettlementView, type RideSettlement } from '../payments.js';
import type { FileView } from '../files.js';
import type { EndMode, RentalPriceView, RentalState, TariffView } from '../rentals.js';
import { RENTAL_STATES } from '../rentals.js';
import type { CommandStatus } from './fleet.js';
import type { RefundListItem } from './payments.js';
import type { ResourceDefinition } from './list.js';

export const REMOTE_END_REASONS = ['SCOOTER_NOT_RESPONDING', 'CUSTOMER_REQUEST', 'TERMS_VIOLATION', 'OTHER'] as const;
export type RemoteEndReason = (typeof REMOTE_END_REASONS)[number];

/**
 * Zdalne zakończenie (D7). `collectTowingFee` (ADR 0060): „Pobierz opłatę za odholowanie” przy hulajnodze poza
 * strefą parkowania; w strefie API odrzuca zaznaczenie (`TOWING_FEE_NOT_APPLICABLE`).
 */
export const remoteEndSchema = z.object({
  reason: z.enum(REMOTE_END_REASONS),
  note: z.string().trim().max(500).nullable().default(null),
  collectTowingFee: z.boolean().default(false),
});
export type RemoteEnd = z.infer<typeof remoteEndSchema>;

export const rentalsResource = {
  name: 'rentals',
  fields: {
    id: { type: 'uuid', filters: ['eq'] },
    number: { type: 'integer', filters: ['eq'], sortable: true },
    state: { type: 'enum', values: RENTAL_STATES, filters: ['eq'], facet: true, sortable: true },
    hasProblem: { type: 'boolean', filters: ['eq'], facet: true },
    userId: { type: 'uuid', filters: ['eq'] },
    userName: { type: 'text', sortable: true },
    userPhone: { type: 'text', filters: ['contains'] },
    scooterId: { type: 'uuid', filters: ['eq'] },
    scooterNumber: { type: 'integer', filters: ['eq'], sortable: true },
    createdAt: { type: 'datetime', filters: ['gte', 'lte'], sortable: true },
    startedAt: { type: 'datetime', filters: ['gte', 'lte'], sortable: true },
    endedAt: { type: 'datetime', filters: ['gte', 'lte'], sortable: true },
    elapsedSeconds: { type: 'integer', sortable: true },
    distanceM: { type: 'integer', sortable: true },
    totalAmount: { type: 'integer', sortable: true },
    tariffVersion: { type: 'integer', filters: ['eq'] },
    endZoneCode: { type: 'text', filters: ['eq'] },
    pendingCommand: { type: 'text' },
    settlement: { type: 'enum', values: RIDE_SETTLEMENTS, filters: ['eq'], facet: true },
    paidAmount: { type: 'integer', sortable: true },
  },
  search: ['number', 'scooterNumber', 'userName', 'userPhone'],
  defaultSort: ['-createdAt'],
  deleteMode: 'none',
  permissions: { read: 'rentals.read', write: 'rentals.manage' },
} as const satisfies ResourceDefinition;

export interface RentalListItem {
  id: string;
  number: number;
  state: RentalState;
  hasProblem: boolean;
  userId: string;
  userName: string | null;
  userPhone: string | null;
  scooterId: string;
  scooterNumber: number;
  createdAt: string;
  startedAt: string | null;
  endedAt: string | null;
  elapsedSeconds: number;
  distanceM: number;
  totalAmount: number | null;
  tariffVersion: number;
  endZoneCode: string | null;
  pendingCommand: string | null;
  settlement: RideSettlement;
  paidAmount: number;
}

/** Wpis osi czasu: zdarzenie przejazdu albo komenda z jej wynikiem (`v_rental_timeline`). */
export interface RentalTimelineEntry {
  at: string;
  kind: 'EVENT' | 'COMMAND';
  type: string;
  fromState: RentalState | null;
  toState: RentalState | null;
  data: Record<string, unknown>;
  zoneCode: string | null;
  commandId: string | null;
  commandStatus: CommandStatus | null;
  ackedAt: string | null;
  ackReason: string | null;
}

export interface RentalAdminDetails extends Omit<RentalListItem, 'settlement'> {
  reservedAt: string | null;
  reservationExpiresAt: string | null;
  billedUntil: string | null;
  rideSeconds: number;
  pauseSeconds: number;
  price: RentalPriceView;
  tariff: TariffView;
  endZoneName: string | null;
  scooterOnline: boolean;
  scooterBatteryPct: number | null;
  scooterLat: number | null;
  scooterLon: number | null;
  userRidesCount: number;
  /** Trasa z telemetrii przejazdu: [lon, lat]. */
  route: Array<[number, number]>;
  timeline: RentalTimelineEntry[];
  settlement: RentalSettlementView;
  refunds: RefundListItem[];
  /** Kwota, którą można jeszcze zwrócić (zapłata minus zwroty udane i w toku); 0, gdy przejazd nie jest rozliczony. */
  refundable: number;
  // Iteracja 6 (ADR 0056, 0057, 0060). Pola opcjonalne do czasu, gdy API je wypełni.
  endMode?: EndMode | null;
  /** Opłata za odholowanie pobrana przy zdalnym zakończeniu; `null` bez opłaty. */
  towingFee?: number | null;
  /** Okno zdalnego zakończenia: opłata z wersji cennika przejazdu i czy ostatnia pozycja kwalifikuje się do niej. */
  towing?: { outOfZoneFee: number; outsideParking: boolean; positionAt: string | null } | null;
  parkingPhoto?: FileView | null;
  billingStoppedAt?: string | null;
  asOf: string;
}
