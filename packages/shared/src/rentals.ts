/**
 * Kontrakt wypożyczenia między aplikacją a API (iteracja 3, ADR 0036, ADR 0042). Wartości wyliczeń są
 * kopią z packages/core; zgodność pilnuje test API.
 */
import { z } from 'zod';
import type { ScooterVariant } from './admin/fleet.js';

export const RENTAL_STATES = [
  'RESERVED',
  'UNLOCKING',
  'ACTIVE',
  'PAUSED',
  'ENDING',
  'ENDED',
  'EXPIRED',
  'UNLOCK_FAILED',
  'UNPAID',
] as const;
export type RentalState = (typeof RENTAL_STATES)[number];

export const OPEN_RENTAL_STATES = [
  'RESERVED',
  'UNLOCKING',
  'ACTIVE',
  'PAUSED',
  'ENDING',
] as const satisfies readonly RentalState[];

export const UNAVAILABLE_REASONS = ['RESERVED', 'IN_USE', 'MAINTENANCE', 'RETIRED', 'OFFLINE', 'LOW_BATTERY'] as const;
export type UnavailableReason = (typeof UNAVAILABLE_REASONS)[number];

/** Zdarzenia, które aplikacja pokazuje jako komunikat (nieudana pauza, wznowienie, blokada, odblokowanie). */
export const RENTAL_NOTICES = ['PAUSE_FAILED', 'RESUME_FAILED', 'LOCK_FAILED', 'ENDED_REMOTELY'] as const;
export type RentalNotice = (typeof RENTAL_NOTICES)[number];

export const nearbyQuerySchema = z.object({
  lat: z.coerce.number().min(-90).max(90),
  lon: z.coerce.number().min(-180).max(180),
});
export type NearbyQuery = z.infer<typeof nearbyQuerySchema>;

/** Stawki z wersji cennika (grosze); te same, które zapamiętuje przejazd przy starcie. */
export interface TariffView {
  version: number;
  unlockFee: number;
  minuteRate: number;
  pauseMinuteRate: number;
  freeReservationMinutes: number;
}

export interface NearbyScooter {
  id: string;
  number: number;
  variant: ScooterVariant;
  lat: number;
  lon: number;
  batteryPct: number;
  rangeKm: number | null;
  distanceM: number;
}

export interface NearbyResponse {
  scooters: NearbyScooter[];
  tariff: TariffView;
  radiusM: number;
}

/** Hulajnoga po numerze (skan albo wpisany numer, ADR 0041) z dostępnością dla klienta. */
export interface CustomerScooterView {
  id: string;
  number: number;
  variant: ScooterVariant;
  batteryPct: number | null;
  rangeKm: number | null;
  lat: number | null;
  lon: number | null;
  available: boolean;
  unavailableReason: UnavailableReason | null;
  /** Hulajnoga jest zarezerwowana przez tego klienta. */
  reservedByMe: boolean;
  tariff: TariffView;
}

export const scooterRequestSchema = z.object({ scooterId: z.uuid() });
export type ScooterRequest = z.infer<typeof scooterRequestSchema>;

/** Kwoty przejazdu w groszach (ADR 0042). */
export interface RentalPriceView {
  unlockFee: number;
  rideMinutes: number;
  rideAmount: number;
  pauseMinutes: number;
  pauseAmount: number;
  total: number;
}

/**
 * Przejazd klienta. Liczniki są policzone na chwilę `asOf`; aplikacja dolicza upływ czasu lokalnie
 * (jazda w `ACTIVE`, pauza w `PAUSED`), dopóki `billedUntil` jest puste.
 */
export interface RentalView {
  id: string;
  number: number;
  state: RentalState;
  scooter: {
    id: string;
    number: number;
    variant: ScooterVariant;
    batteryPct: number | null;
    lat: number | null;
    lon: number | null;
  };
  tariff: TariffView;
  reservedAt: string | null;
  reservationExpiresAt: string | null;
  startedAt: string | null;
  endedAt: string | null;
  billedUntil: string | null;
  rideSeconds: number;
  pauseSeconds: number;
  distanceM: number;
  /** Prędkość z ostatniego punktu telemetrii przejazdu; `null` przed pierwszym punktem. */
  speedKmh: number | null;
  /** Trasa z telemetrii przejazdu: [lon, lat]. */
  route: Array<[number, number]>;
  price: RentalPriceView;
  /** Komenda, na którą przejazd czeka (pauza, wznowienie, zakończenie). */
  pendingCommand: 'LOCK' | 'UNLOCK' | null;
  /** Ostatni komunikat dla klienta, jeśli nastąpił po ostatniej zmianie stanu. */
  notice: RentalNotice | null;
  endZone: { code: string; name: string } | null;
  /** Obciążenie portfela przychodzi w iteracji 5 (D1). */
  settlement: 'PENDING';
  asOf: string;
}

export interface RentalHistoryItem {
  id: string;
  number: number;
  scooterNumber: number;
  startedAt: string | null;
  endedAt: string | null;
  rideSeconds: number;
  pauseSeconds: number;
  distanceM: number;
  totalAmount: number | null;
  endZoneName: string | null;
}

export interface RentalStats {
  ridesCount: number;
  distanceM: number;
  travelSeconds: number;
}

export interface ProfileSummary {
  stats: RentalStats;
  /** Saldo portfela w groszach (suma księgi). */
  balance: number;
  notifications: NotificationPreferences;
}

export const notificationPreferencesSchema = z.object({
  reservationEnd: z.boolean(),
  receipts: z.boolean(),
});
export type NotificationPreferences = z.infer<typeof notificationPreferencesSchema>;

/** Zawartość kodu QR: `${PUBLIC_SITE_URL}/h/0142` albo sam numer (ADR 0041). */
export function parseScooterCode(input: string): number | null {
  const text = input.trim();
  const match = /^(?:https?:\/\/[^/\s]+\/h\/)?#?(\d{1,4})\/?$/i.exec(text);
  if (!match) return null;
  const number = Number(match[1]);
  return number >= 1 ? number : null;
}

export const scooterCodeUrl = (siteUrl: string, number: number): string =>
  `${siteUrl.replace(/\/$/, '')}/h/${number.toString().padStart(4, '0')}`;
