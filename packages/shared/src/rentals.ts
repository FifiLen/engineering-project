/**
 * Kontrakt wypożyczenia między aplikacją a API (iteracja 3, ADR 0036, ADR 0042). Wartości wyliczeń są
 * kopią z packages/core; zgodność pilnuje test API.
 */
import { z } from 'zod';
import type { ScooterVariant } from './admin/fleet.js';
import type { ZoneType } from './admin/zones.js';
import type { RentalSettlementView, RideSettlement } from './payments.js';

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

export const UNAVAILABLE_REASONS = [
  'RESERVED',
  'IN_USE',
  'MAINTENANCE',
  'RETIRED',
  'OFFLINE',
  'OUT_OF_AREA',
  'LOW_BATTERY',
] as const;
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

/**
 * Rezerwacja i start (ADR 0049): źródło płatności wybrane przy pierwszym stanie przejazdu; bez niego
 * portfel, a start z rezerwacji zachowuje źródło rezerwacji. Karta przy `CARD`, bez niej domyślna.
 */
export const rentalRequestSchema = scooterRequestSchema.extend({
  paymentSource: z.enum(['WALLET', 'CARD']).optional(),
  paymentMethodId: z.uuid().nullable().optional(),
});
export type RentalRequest = z.infer<typeof rentalRequestSchema>;

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
  /** Strefy, w których jest hulajnoga (wykrywanie z telemetrii, ADR 0043); pusta lista przed pierwszym odczytem. */
  zones: RentalZone[];
  /**
   * Co strefy wymagają od hulajnogi (ADR 0044): zatrzymanie w strefie zakazu i poza obszarem działania,
   * limit w strefie wolnej jazdy. Aplikacja pokazuje z tego komunikat strefy na ekranie jazdy.
   */
  zoneControl: { stopped: boolean; speedLimitKmh: number | null };
  /** Rozliczenie po zakończeniu (ADR 0049); przed zakończeniem stan `NONE` ze źródłem wybranym przy starcie. */
  settlement: RentalSettlementView;
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
  settlement: RideSettlement;
  receiptId: string | null;
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

export interface RentalZone {
  code: string;
  name: string;
  type: ZoneType;
  speedLimitKmh: number | null;
}

// --- Trasy i wyszukiwanie (ADR 0045, ADR 0048) -------------------------------------------------

export const pointQuerySchema = nearbyQuerySchema;

/** Trasa z OSRM przez API; bez OSRM linia prosta z `approximate: true` i bez czasu. */
export interface RouteView {
  /** [lon, lat] */
  line: Array<[number, number]>;
  distanceM: number;
  durationSec: number | null;
  approximate: boolean;
  profile: 'bike' | 'foot';
}

/** Prowadzenie do najbliższej strefy parkowania: cel na granicy strefy najbliżej klienta. */
export interface NearestParkingRoute {
  zone: { id: string; code: string; name: string; anchor: [number, number] };
  target: [number, number];
  route: RouteView;
}

export const placeSearchQuerySchema = z.object({
  q: z.string().trim().min(3).max(100),
  lat: z.coerce.number().min(-90).max(90).optional(),
  lon: z.coerce.number().min(-180).max(180).optional(),
});
export type PlaceSearchQuery = z.infer<typeof placeSearchQuerySchema>;

export interface PlaceResult {
  id: string;
  name: string;
  /** Ulica, dzielnica, miasto. */
  description: string | null;
  lat: number;
  lon: number;
  /** Odległość od klienta w linii prostej, gdy podał pozycję. */
  distanceM: number | null;
}

export interface PlaceSearchResponse {
  places: PlaceResult[];
}

export const destinationQuerySchema = z.object({
  lat: z.coerce.number().min(-90).max(90),
  lon: z.coerce.number().min(-180).max(180),
  toLat: z.coerce.number().min(-90).max(90),
  toLon: z.coerce.number().min(-180).max(180),
});
export type DestinationQuery = z.infer<typeof destinationQuerySchema>;

/** Wybrany cel: szacunek dojazdu hulajnogą i strefa parkowania przy celu (decyzja D5). */
export interface DestinationView {
  route: RouteView;
  parking: { code: string; name: string; distanceM: number; anchor: [number, number] } | null;
  /** Limit wolnej jazdy w miejscu celu (notka „Przy celu obowiązuje wolna jazda”). */
  speedLimitKmh: number | null;
  insideServiceArea: boolean;
}
