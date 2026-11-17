import type {
  CommandType,
  NearestParking,
  OpenRental,
  RentableScooter,
  RentalEventType,
  RentalState,
  RentalTariff,
  ScooterStatus,
  TimelineEvent,
  Zone,
  ZoneType,
} from '@hulajnogi/core';
import {
  rentalsResource,
  type ListQuery,
  type ListResponse,
  type NotificationPreferences,
  type RentalHistoryItem,
  type RentalListItem,
  type RentalSettlementView,
  type RentalStats,
  type RentalTimelineEntry,
  type ScooterVariant,
} from '@hulajnogi/shared';
import { inArray, sql } from 'drizzle-orm';
import { runListQuery, type ListSource } from '../admin/list-query.js';
import { DrizzlePaymentRepository } from './payments.repository.js';
import type { DbExecutor } from '../client.js';
import { rentals, vRentalDetails } from '../schema/schema.js';

type RentalField = keyof typeof rentalsResource.fields;

const listSource: ListSource<RentalField> = {
  from: vRentalDetails,
  id: vRentalDetails.id,
  columns: {
    id: vRentalDetails.id,
    number: vRentalDetails.number,
    state: vRentalDetails.state,
    hasProblem: vRentalDetails.hasProblem,
    userId: vRentalDetails.userId,
    userName: vRentalDetails.userName,
    userPhone: vRentalDetails.userPhone,
    scooterId: vRentalDetails.scooterId,
    scooterNumber: vRentalDetails.scooterNumber,
    createdAt: vRentalDetails.createdAt,
    startedAt: vRentalDetails.startedAt,
    endedAt: vRentalDetails.endedAt,
    elapsedSeconds: vRentalDetails.elapsedSeconds,
    distanceM: vRentalDetails.distanceM,
    totalAmount: vRentalDetails.totalAmount,
    tariffVersion: vRentalDetails.tariffVersion,
    endZoneCode: vRentalDetails.endZoneCode,
    pendingCommand: vRentalDetails.pendingCommand,
    settlement: vRentalDetails.settlement,
    paidAmount: vRentalDetails.paidAmount,
  },
};

const OPEN_STATES = sql.raw(`('RESERVED', 'UNLOCKING', 'ACTIVE', 'PAUSED', 'ENDING')`);

/** Przejazd z danymi do widoku klienta i panelu (bez osi czasu). */
export interface RentalRecord extends OpenRental {
  number: number;
  tariffId: string;
  paymentSource: 'WALLET' | 'CARD';
  paymentMethodId: string | null;
  reservedAt: Date | null;
  startedAt: Date | null;
  endedAt: Date | null;
  rideSeconds: number;
  pauseSeconds: number;
  distanceM: number;
  totalAmount: number | null;
  endZone: { code: string; name: string } | null;
  scooterNumber: number;
  scooterVariant: ScooterVariant;
  scooterBatteryPct: number | null;
  scooterOnline: boolean;
  scooterLat: number | null;
  scooterLon: number | null;
  createdAt: Date;
}

export interface RentalCommandRecord {
  id: string;
  scooterId: string;
  scooterNumber: number;
  rentalId: string | null;
  type: CommandType;
  status: 'SENT' | 'ACKED' | 'REJECTED' | 'TIMEOUT';
  sentAt: Date;
  expiresAt: Date | null;
  params?: { kmh?: number };
}

export interface NewRental {
  userId: string;
  scooterId: string;
  tariffId: string;
  state: RentalState;
  reservedAt: Date | null;
  reservationExpiresAt: Date | null;
  /** Źródło płatności wybrane przy pierwszym stanie przejazdu (ADR 0049); karta przy `CARD`. */
  paymentSource: 'WALLET' | 'CARD';
  paymentMethodId: string | null;
}

export interface CustomerScooterRow extends RentableScooter {
  variant: ScooterVariant;
  lat: number | null;
  lon: number | null;
  modelRangeKm: number | null;
}

export interface NearbyRow {
  id: string;
  number: number;
  variant: ScooterVariant;
  batteryPct: number;
  distanceM: number;
  lat: number;
  lon: number;
  modelRangeKm: number | null;
}

type Row = Record<string, unknown>;
const date = (v: unknown) => (v === null || v === undefined ? null : new Date(v as string));
const num = (v: unknown) => (v === null || v === undefined ? null : Number(v));

const tariffSql = sql`SELECT id, version, unlock_fee, minute_rate, pause_minute_rate, free_reservation_minutes, min_battery_pct FROM tariffs`;
const toTariff = (r: Row): RentalTariff => ({
  id: r.id as string,
  version: r.version as number,
  unlockFee: Number(r.unlock_fee),
  minuteRate: Number(r.minute_rate),
  pauseMinuteRate: Number(r.pause_minute_rate),
  freeReservationMinutes: r.free_reservation_minutes as number,
  minBatteryPct: r.min_battery_pct as number,
});

// can_ride: strefa zakazu albo poza obszarem działania daje przyczynę OUT_OF_AREA (migracja 0006).
const scooterSql = sql`SELECT s.id, s.number, s.status, s.online, s.battery_pct, s.variant,
                              ST_Y(s.position) AS lat, ST_X(s.position) AS lon, m.range_km AS model_range_km,
                              CASE WHEN s.position IS NULL THEN NULL ELSE fn_scooter_can_ride(s.position) END AS can_ride
                       FROM scooters s JOIN scooter_models m ON m.id = s.model_id`;
const toScooter = (r: Row): CustomerScooterRow => ({
  id: r.id as string,
  number: r.number as number,
  status: r.status as ScooterStatus,
  online: r.online as boolean,
  batteryPct: r.battery_pct as number | null,
  canRide: (r.can_ride as boolean | null) ?? null,
  variant: r.variant as ScooterVariant,
  lat: num(r.lat),
  lon: num(r.lon),
  modelRangeKm: num(r.model_range_km),
});

const rentalSql = sql`
  SELECT r.id, r.number, r.user_id, r.scooter_id, r.tariff_id, r.state, r.payment_source, r.payment_method_id,
         r.reserved_at, r.reservation_expires_at,
         r.started_at, r.ended_at, r.ride_seconds, r.pause_seconds, r.distance_m, r.total_amount, r.created_at,
         ez.code AS end_zone_code, ez.name AS end_zone_name,
         s.number AS scooter_number, s.variant AS scooter_variant, s.battery_pct AS scooter_battery_pct,
         s.online AS scooter_online, ST_Y(s.position) AS scooter_lat, ST_X(s.position) AS scooter_lon,
         (SELECT c.type FROM scooter_commands c
          WHERE c.rental_id = r.id AND c.status = 'SENT' AND c.type IN ('LOCK', 'UNLOCK')) AS pending_command
  FROM rentals r
  JOIN scooters s ON s.id = r.scooter_id
  LEFT JOIN zones ez ON ez.id = r.end_zone_id`;
const toRental = (r: Row): RentalRecord => ({
  id: r.id as string,
  number: Number(r.number),
  userId: r.user_id as string,
  scooterId: r.scooter_id as string,
  tariffId: r.tariff_id as string,
  paymentSource: r.payment_source as RentalRecord['paymentSource'],
  paymentMethodId: (r.payment_method_id as string | null) ?? null,
  state: r.state as RentalState,
  reservedAt: date(r.reserved_at),
  reservationExpiresAt: date(r.reservation_expires_at),
  startedAt: date(r.started_at),
  endedAt: date(r.ended_at),
  rideSeconds: r.ride_seconds as number,
  pauseSeconds: r.pause_seconds as number,
  distanceM: r.distance_m as number,
  totalAmount: num(r.total_amount),
  createdAt: new Date(r.created_at as string),
  endZone: r.end_zone_code ? { code: r.end_zone_code as string, name: r.end_zone_name as string } : null,
  scooterNumber: r.scooter_number as number,
  scooterVariant: r.scooter_variant as ScooterVariant,
  scooterBatteryPct: r.scooter_battery_pct as number | null,
  scooterOnline: r.scooter_online as boolean,
  scooterLat: num(r.scooter_lat),
  scooterLon: num(r.scooter_lon),
  pendingCommand: (r.pending_command as CommandType | null) ?? null,
});

const commandSql = sql`SELECT c.id, c.scooter_id, s.number AS scooter_number, c.rental_id, c.type, c.status, c.sent_at,
                              c.expires_at, c.payload
                       FROM scooter_commands c JOIN scooters s ON s.id = c.scooter_id`;
const toCommand = (r: Row): RentalCommandRecord => ({
  id: r.id as string,
  scooterId: r.scooter_id as string,
  scooterNumber: r.scooter_number as number,
  rentalId: (r.rental_id as string | null) ?? null,
  type: r.type as CommandType,
  status: r.status as RentalCommandRecord['status'],
  sentAt: new Date(r.sent_at as string),
  expiresAt: date(r.expires_at),
  ...(r.payload && Object.keys(r.payload as object).length > 0 ? { params: r.payload as { kmh?: number } } : {}),
});

/**
 * Moduł Wypożyczenia (ADR 0036). Repozytorium nie decyduje o przejściach: serwis w API blokuje wiersze
 * (`lock*`, zawsze najpierw hulajnoga, potem przejazd), wywołuje reguły z packages/core i zapisuje wynik
 * tymi metodami w jednej transakcji.
 */
export class DrizzleRentalRepository {
  constructor(private readonly db: DbExecutor) {}

  private async rows(query: ReturnType<typeof sql>): Promise<Row[]> {
    return (await this.db.execute<Row>(query)).rows;
  }

  private async one(query: ReturnType<typeof sql>): Promise<Row | null> {
    return (await this.rows(query))[0] ?? null;
  }

  /** Czas transakcji w bazie: ten sam, który dostają zdarzenia osi czasu (`DEFAULT now()`). */
  async now(): Promise<Date> {
    return new Date((await this.one(sql`SELECT now() AS now`))!.now as string);
  }

  // --- Cennik i hulajnogi -------------------------------------------------------------------

  /** Obowiązująca wersja cennika: najnowsza z `valid_from` w przeszłości. */
  async currentTariff(now: Date): Promise<RentalTariff | null> {
    const row = await this.one(sql`${tariffSql} WHERE valid_from <= ${now} ORDER BY version DESC LIMIT 1`);
    return row ? toTariff(row) : null;
  }

  async tariff(id: string): Promise<RentalTariff> {
    return toTariff((await this.one(sql`${tariffSql} WHERE id = ${id}`))!);
  }

  async scooter(id: string): Promise<CustomerScooterRow | null> {
    const row = await this.one(sql`${scooterSql} WHERE s.id = ${id}`);
    return row ? toScooter(row) : null;
  }

  async scooterByNumber(number: number): Promise<CustomerScooterRow | null> {
    const row = await this.one(sql`${scooterSql} WHERE s.number = ${number} AND s.status <> 'RETIRED'`);
    return row ? toScooter(row) : null;
  }

  /** Blokada wiersza hulajnogi: pierwsza blokada każdej operacji przejazdu. */
  async lockScooter(id: string): Promise<CustomerScooterRow | null> {
    const row = await this.one(sql`${scooterSql} WHERE s.id = ${id} FOR UPDATE OF s`);
    return row ? toScooter(row) : null;
  }

  async setScooterStatus(id: string, status: ScooterStatus): Promise<void> {
    await this.db.execute(
      sql`UPDATE scooters SET status = ${status}, updated_at = now(), version = version + 1 WHERE id = ${id} AND status <> ${status}`,
    );
  }

  /** Wolne hulajnogi w promieniu (`fn_nearest_scooters`) z pozycją do mapy. */
  async nearby(lat: number, lon: number, radiusM: number, limit: number, minBattery: number): Promise<NearbyRow[]> {
    const rows = await this.rows(sql`
      SELECT n.id, n.number, s.variant, n.battery_pct, n.distance_m, ST_Y(s.position) AS lat, ST_X(s.position) AS lon, m.range_km AS model_range_km
      FROM fn_nearest_scooters(${lon}, ${lat}, ${radiusM}, ${limit}, ${minBattery}) n
      JOIN scooters s ON s.id = n.id JOIN scooter_models m ON m.id = s.model_id
      WHERE s.online
      ORDER BY n.distance_m, n.number`);
    return rows.map((r) => ({
      id: r.id as string,
      number: r.number as number,
      variant: r.variant as ScooterVariant,
      batteryPct: r.battery_pct as number,
      distanceM: Math.round(Number(r.distance_m)),
      lat: Number(r.lat),
      lon: Number(r.lon),
      modelRangeKm: num(r.model_range_km),
    }));
  }

  /** Najbliższa aktywna strefa parkowania do punktu (błąd `OUTSIDE_PARKING`). */
  async nearestParking(lat: number, lon: number): Promise<NearestParking | null> {
    const row = await this.one(sql`
      SELECT code, name, ST_Distance(geom::geography, p::geography) AS distance_m,
             ST_Y(ST_PointOnSurface(geom)) AS lat, ST_X(ST_PointOnSurface(geom)) AS lon
      FROM zones, ST_SetSRID(ST_MakePoint(${lon}, ${lat}), 4326) p
      WHERE active AND type = 'PARKING'
      ORDER BY ST_Distance(geom::geography, p::geography), code LIMIT 1`);
    return row
      ? {
          code: row.code as string,
          name: row.name as string,
          distanceM: Math.round(Number(row.distance_m)),
          lat: Number(row.lat),
          lon: Number(row.lon),
        }
      : null;
  }

  /** Strefa parkowania w punkcie (zapis `end_zone_id`). */
  async parkingZoneAt(lat: number, lon: number): Promise<string | null> {
    const row = await this.one(sql`SELECT id FROM fn_zones_at_point(${lon}, ${lat}) WHERE type = 'PARKING' LIMIT 1`);
    return (row?.id as string | undefined) ?? null;
  }

  // --- Przejazdy ---------------------------------------------------------------------------

  async find(id: string): Promise<RentalRecord | null> {
    const row = await this.one(sql`${rentalSql} WHERE r.id = ${id}`);
    return row ? toRental(row) : null;
  }

  async openForUser(userId: string): Promise<RentalRecord | null> {
    const row = await this.one(sql`${rentalSql} WHERE r.user_id = ${userId} AND r.state IN ${OPEN_STATES}`);
    return row ? toRental(row) : null;
  }

  async openForScooter(scooterId: string): Promise<RentalRecord | null> {
    const row = await this.one(sql`${rentalSql} WHERE r.scooter_id = ${scooterId} AND r.state IN ${OPEN_STATES}`);
    return row ? toRental(row) : null;
  }

  /** Blokada przejazdu po blokadzie hulajnogi; zwraca stan widoczny po zakończeniu równoległych transakcji. */
  async lock(id: string): Promise<RentalRecord | null> {
    await this.db.execute(sql`SELECT 1 FROM rentals WHERE id = ${id} FOR UPDATE`);
    return this.find(id);
  }

  async lockOpenForUser(userId: string): Promise<RentalRecord | null> {
    await this.db.execute(sql`SELECT 1 FROM rentals WHERE user_id = ${userId} AND state IN ${OPEN_STATES} FOR UPDATE`);
    return this.openForUser(userId);
  }

  async lockOpenForScooter(scooterId: string): Promise<RentalRecord | null> {
    await this.db.execute(
      sql`SELECT 1 FROM rentals WHERE scooter_id = ${scooterId} AND state IN ${OPEN_STATES} FOR UPDATE`,
    );
    return this.openForScooter(scooterId);
  }

  async insert(rental: NewRental): Promise<string> {
    const row = await this.one(sql`
      INSERT INTO rentals (user_id, scooter_id, tariff_id, state, reserved_at, reservation_expires_at, payment_source, payment_method_id)
      VALUES (${rental.userId}, ${rental.scooterId}, ${rental.tariffId}, ${rental.state}, ${rental.reservedAt},
              ${rental.reservationExpiresAt}, ${rental.paymentSource}, ${rental.paymentMethodId})
      RETURNING id`);
    return row!.id as string;
  }

  /** Start z rezerwacji może zmienić źródło płatności (ADR 0049). */
  async setPaymentSource(id: string, source: 'WALLET' | 'CARD', paymentMethodId: string | null): Promise<void> {
    await this.db.execute(sql`
      UPDATE rentals SET payment_source = ${source}, payment_method_id = ${paymentMethodId}, updated_at = now() WHERE id = ${id}`);
  }

  async setState(id: string, state: RentalState, extra: { startedAt?: Date } = {}): Promise<void> {
    await this.db.execute(sql`
      UPDATE rentals SET state = ${state}, updated_at = now(),
             started_at = COALESCE(started_at, ${extra.startedAt ?? null}::timestamptz)
      WHERE id = ${id}`);
  }

  /**
   * Zakończenie: liczniki i kwota z core, dystans i trasa z telemetrii przejazdu, pozycja końcowa
   * i strefa z bieżącej pozycji hulajnogi (ADR 0042).
   */
  async finish(
    id: string,
    values: { endedAt: Date; rideSeconds: number; pauseSeconds: number; totalAmount: number; endZoneId: string | null },
  ): Promise<void> {
    await this.db.execute(sql`
      UPDATE rentals r SET state = 'ENDED', ended_at = ${values.endedAt}, updated_at = now(),
             ride_seconds = ${values.rideSeconds}, pause_seconds = ${values.pauseSeconds},
             total_amount = ${values.totalAmount}, end_zone_id = ${values.endZoneId},
             distance_m = fn_rental_distance_m(r.id), route = fn_rental_route(r.id),
             end_position = (SELECT position FROM scooters WHERE id = r.scooter_id)
      WHERE id = ${id}`);
  }

  async addEvent(
    rentalId: string,
    type: RentalEventType,
    change: {
      from?: RentalState | null;
      to?: RentalState | null;
      data?: Record<string, unknown>;
      zoneId?: string | null;
    } = {},
  ): Promise<void> {
    await this.db.execute(sql`
      INSERT INTO rental_events (rental_id, type, from_state, to_state, data, zone_id)
      VALUES (${rentalId}, ${type}::text::rental_event_type, ${change.from ?? null}, ${change.to ?? null},
              ${JSON.stringify(change.data ?? {})}::jsonb, ${change.zoneId ?? null})`);
  }

  /** Zdarzenia potrzebne do liczników (ADR 0042). */
  async timelineEvents(rentalId: string): Promise<TimelineEvent[]> {
    const rows = await this.rows(
      sql`SELECT type::text AS type, to_state, created_at FROM rental_events WHERE rental_id = ${rentalId} ORDER BY created_at, id`,
    );
    return rows.map((r) => ({
      type: r.type as RentalEventType,
      toState: (r.to_state as RentalState | null) ?? null,
      at: new Date(r.created_at as string),
    }));
  }

  /** Ostatnie zdarzenie bez zmiany stanu po ostatniej zmianie stanu (komunikat w aplikacji). */
  async lastNotice(rentalId: string): Promise<{ type: RentalEventType; data: Record<string, unknown> } | null> {
    const row = await this.one(sql`
      SELECT type::text AS type, data FROM rental_events
      WHERE rental_id = ${rentalId} AND type::text IN ('PAUSE_FAILED', 'RESUME_FAILED', 'LOCK_FAILED', 'ENDED_REMOTELY')
        AND created_at >= COALESCE((SELECT max(created_at) FROM rental_events
                                    WHERE rental_id = ${rentalId} AND type = 'STATE_CHANGED'), '-infinity')
      ORDER BY id DESC LIMIT 1`);
    return row ? { type: row.type as RentalEventType, data: row.data as Record<string, unknown> } : null;
  }

  /** Stan sprzed żądania zakończenia zapisany w zdarzeniu `END_REQUESTED`. */
  async endResumeState(rentalId: string): Promise<'ACTIVE' | 'PAUSED'> {
    const row = await this.one(sql`
      SELECT data->>'resumeState' AS state FROM rental_events
      WHERE rental_id = ${rentalId} AND type::text = 'END_REQUESTED' ORDER BY id DESC LIMIT 1`);
    return row?.state === 'PAUSED' ? 'PAUSED' : 'ACTIVE';
  }

  /** Rezerwacje po terminie, których zadanie wygaśnięcia się zgubiło (zadanie zabezpieczające, ADR 0037). */
  /** Hulajnogi w przejeździe po odblokowaniu, przed zakończeniem: śledzenie stref (ADR 0043). */
  async ridingByScooter(scooterIds: string[]): Promise<Map<string, string>> {
    if (!scooterIds.length) return new Map();
    const rows = await this.rows(sql`
      SELECT id, scooter_id FROM rentals
      WHERE ${inArray(rentals.scooterId, scooterIds)} AND state IN ('ACTIVE', 'PAUSED', 'ENDING')`);
    return new Map(rows.map((r) => [r.scooter_id as string, r.id as string]));
  }

  /**
   * Strefy, w których jest hulajnoga przejazdu (stan z wykrywania stref, migracja 0006); `null`, dopóki
   * śledzenie się nie zaczęło (pusta lista po starcie śledzenia znaczy „poza obszarem działania”).
   */
  async currentZones(rentalId: string): Promise<Zone[] | null> {
    const [started] = await this.rows(sql`SELECT 1 FROM scooter_zone_control WHERE rental_id = ${rentalId}`);
    if (!started) return null;
    const rows = await this.rows(sql`
      SELECT z.id, z.code, z.name, z.type, z.speed_limit_kmh
      FROM scooter_zone_presence p JOIN zones z ON z.id = p.zone_id
      WHERE p.rental_id = ${rentalId}
      ORDER BY CASE z.type WHEN 'NO_RIDE' THEN 0 WHEN 'SLOW' THEN 1 WHEN 'PARKING' THEN 2 ELSE 3 END, z.code`);
    return rows.map((r) => ({
      id: r.id as string,
      code: r.code as string,
      name: r.name as string,
      type: r.type as ZoneType,
      speedLimitKmh: (r.speed_limit_kmh as number | null) ?? null,
    }));
  }

  async dueReservations(now: Date, limit = 100): Promise<string[]> {
    const rows = await this.rows(sql`
      SELECT id FROM rentals WHERE state = 'RESERVED' AND reservation_expires_at <= ${now}
      ORDER BY reservation_expires_at LIMIT ${limit}`);
    return rows.map((r) => r.id as string);
  }

  // --- Komendy przejazdu --------------------------------------------------------------------

  /** Czas wysłania i termin z zegara bazy, tak jak czas zdarzeń na osi czasu (ADR 0038). */
  async createCommand(input: {
    scooterId: string;
    rentalId: string | null;
    type: CommandType;
    ttlMs: number;
    /** Parametry komendy MQTT (limit prędkości strefy; `speed_limit` bez `kmh` zdejmuje limit). */
    params?: { kmh?: number };
  }): Promise<RentalCommandRecord> {
    const row = await this.one(sql`
      INSERT INTO scooter_commands (scooter_id, rental_id, type, payload, expires_at)
      VALUES (${input.scooterId}, ${input.rentalId}, ${input.type}, ${JSON.stringify(input.params ?? {})}::jsonb,
              now() + make_interval(secs => ${input.ttlMs / 1000}))
      RETURNING id`);
    return (await this.command(row!.id as string))!;
  }

  async command(id: string): Promise<RentalCommandRecord | null> {
    const row = await this.one(sql`${commandSql} WHERE c.id = ${id}`);
    return row ? toCommand(row) : null;
  }

  async lockCommand(id: string): Promise<RentalCommandRecord | null> {
    const row = await this.one(sql`${commandSql} WHERE c.id = ${id} FOR UPDATE OF c`);
    return row ? toCommand(row) : null;
  }

  /** Wynik komendy; zmienia tylko komendę w statusie SENT (spóźnione potwierdzenie nic nie zmienia). */
  async completeCommand(
    id: string,
    status: 'ACKED' | 'REJECTED' | 'TIMEOUT',
    at: Date | null,
    reason: string | null,
  ): Promise<boolean> {
    const { rowCount } = await this.db.execute(sql`
      UPDATE scooter_commands SET status = ${status}, acked_at = ${at}, ack_reason = ${reason}
      WHERE id = ${id} AND status = 'SENT'`);
    return (rowCount ?? 0) > 0;
  }

  /** Komendy SENT po limicie (zadanie zabezpieczające `commands.timeout-sweep`). */
  async overdueCommands(sentBefore: Date, limit = 100): Promise<string[]> {
    const rows = await this.rows(sql`
      SELECT id FROM scooter_commands WHERE status = 'SENT' AND sent_at < ${sentBefore} ORDER BY sent_at LIMIT ${limit}`);
    return rows.map((r) => r.id as string);
  }

  // --- Panel --------------------------------------------------------------------------------

  list(query: ListQuery): Promise<ListResponse<RentalListItem>> {
    return runListQuery<RentalField, RentalListItem>(this.db, rentalsResource, listSource, query);
  }

  async listItem(id: string): Promise<RentalListItem | null> {
    const result = await this.list({
      filters: [{ field: 'id', op: 'eq', values: [id] }],
      sort: [],
      page: 1,
      pageSize: 1,
      facets: [],
    });
    return result.items[0] ?? null;
  }

  async timeline(rentalId: string): Promise<RentalTimelineEntry[]> {
    const rows = await this.rows(sql`
      SELECT at, kind, type, from_state, to_state, data, zone_code, command_id, command_status, acked_at, ack_reason
      FROM v_rental_timeline WHERE rental_id = ${rentalId} ORDER BY at, kind DESC, event_id`);
    return rows.map((r) => ({
      at: new Date(r.at as string).toISOString(),
      kind: r.kind as RentalTimelineEntry['kind'],
      type: r.type as string,
      fromState: (r.from_state as RentalState | null) ?? null,
      toState: (r.to_state as RentalState | null) ?? null,
      data: (r.data as Record<string, unknown>) ?? {},
      zoneCode: (r.zone_code as string | null) ?? null,
      commandId: (r.command_id as string | null) ?? null,
      commandStatus: (r.command_status as RentalTimelineEntry['commandStatus']) ?? null,
      ackedAt: r.acked_at ? new Date(r.acked_at as string).toISOString() : null,
      ackReason: (r.ack_reason as string | null) ?? null,
    }));
  }

  /** Trasa: zapisana przy zakończeniu albo bieżąca z telemetrii przejazdu. */
  async route(rentalId: string): Promise<Array<[number, number]>> {
    const row = await this.one(sql`
      SELECT ST_AsGeoJSON(COALESCE(r.route, fn_rental_route(r.id)), 6) AS geojson FROM rentals r WHERE r.id = ${rentalId}`);
    if (!row?.geojson) return [];
    return (JSON.parse(row.geojson as string) as { coordinates: Array<[number, number]> }).coordinates;
  }

  /** Prędkość z ostatniego punktu telemetrii przejazdu. */
  async lastSpeed(rentalId: string): Promise<number | null> {
    const row = await this.one(
      sql`SELECT speed_kmh FROM telemetry WHERE rental_id = ${rentalId} ORDER BY recorded_at DESC LIMIT 1`,
    );
    return row ? Number(row.speed_kmh) : null;
  }

  async liveDistance(rentalId: string): Promise<number> {
    const row = await this.one(sql`SELECT fn_rental_distance_m(${rentalId}) AS d`);
    return Number(row?.d ?? 0);
  }

  // --- Klient: historia, statystyki, preferencje, konto ---------------------------------------

  async history(userId: string, limit: number): Promise<RentalHistoryItem[]> {
    const rows = await this.rows(sql`
      SELECT h.id, h.number, h.scooter_number, h.started_at, h.ended_at, h.ride_seconds, h.pause_seconds, h.distance_m,
             h.total_amount, h.end_zone_name, fn_rental_settlement(h.id) AS settlement,
             (SELECT rc.id FROM receipts rc WHERE rc.rental_id = h.id AND rc.kind = 'SALE') AS receipt_id
      FROM v_user_rental_history h WHERE h.user_id = ${userId} ORDER BY h.ended_at DESC NULLS LAST LIMIT ${limit}`);
    return rows.map((r) => ({
      id: r.id as string,
      number: Number(r.number),
      scooterNumber: r.scooter_number as number,
      startedAt: date(r.started_at)?.toISOString() ?? null,
      endedAt: date(r.ended_at)?.toISOString() ?? null,
      rideSeconds: r.ride_seconds as number,
      pauseSeconds: r.pause_seconds as number,
      distanceM: r.distance_m as number,
      totalAmount: num(r.total_amount),
      endZoneName: (r.end_zone_name as string | null) ?? null,
      settlement: r.settlement as RentalHistoryItem['settlement'],
      receiptId: (r.receipt_id as string | null) ?? null,
    }));
  }

  async stats(userId: string): Promise<RentalStats> {
    const row = await this.one(
      sql`SELECT rides_count, distance_m, travel_seconds FROM v_user_ride_stats WHERE user_id = ${userId}`,
    );
    return {
      ridesCount: Number(row?.rides_count ?? 0),
      distanceM: Number(row?.distance_m ?? 0),
      travelSeconds: Number(row?.travel_seconds ?? 0),
    };
  }

  async unpaidCount(userId: string): Promise<number> {
    const row = await this.one(
      sql`SELECT count(*)::int AS n FROM rentals WHERE user_id = ${userId} AND state = 'UNPAID'`,
    );
    return row!.n as number;
  }

  /** Płatności i zwroty klienta w toku (blokują usunięcie konta, pytanie 9). */
  async pendingMoney(userId: string): Promise<number> {
    const row = await this.one(sql`
      SELECT (SELECT count(*) FROM payments WHERE user_id = ${userId} AND status = 'PENDING')
           + (SELECT count(*) FROM refunds WHERE user_id = ${userId} AND status = 'PENDING') AS n`);
    return Number(row!.n);
  }

  /** Rozliczenie przejazdu z widoku modułu Płatności (ADR 0049). */
  settlement(rentalId: string): Promise<RentalSettlementView> {
    return new DrizzlePaymentRepository(this.db).settlement(rentalId);
  }

  async balance(userId: string): Promise<number> {
    const row = await this.one(sql`SELECT fn_wallet_balance(${userId}) AS balance`);
    return Number(row?.balance ?? 0);
  }

  async notificationPreferences(userId: string): Promise<NotificationPreferences> {
    const row = await this.one(sql`SELECT notify_reservation_end, notify_receipts FROM users WHERE id = ${userId}`);
    return {
      reservationEnd: (row?.notify_reservation_end as boolean) ?? true,
      receipts: (row?.notify_receipts as boolean) ?? true,
    };
  }

  async setNotificationPreferences(userId: string, prefs: NotificationPreferences): Promise<void> {
    await this.db.execute(sql`
      UPDATE users SET notify_reservation_end = ${prefs.reservationEnd}, notify_receipts = ${prefs.receipts}, updated_at = now()
      WHERE id = ${userId}`);
  }

  /** Usunięcie konta (`sp_anonymize_user`): dane osobowe znikają, przejazdy zostają. */
  async anonymizeUser(userId: string): Promise<void> {
    await this.db.execute(sql`CALL sp_anonymize_user(${userId})`);
  }
}
