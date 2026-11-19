import {
  consentsResource,
  otpCodesResource,
  paymentCustomersResource,
  permissionsResource,
  rentalEventsResource,
  savedPlacesResource,
  scooterCommandsResource,
  scooterStatusHistoryResource,
  sessionsResource,
  staffInvitationsResource,
  staffSessionsResource,
  zoneControlResource,
  zonePresenceResource,
  type ConsentListItem,
  type ListQuery,
  type ListResponse,
  type OtpCodeListItem,
  type PaymentCustomerListItem,
  type PermissionListItem,
  type RentalEventListItem,
  type ResourceDefinition,
  type SavedPlaceListItem,
  type ScooterCommandListItem,
  type ScooterStatusHistoryItem,
  type SessionListItem,
  type StaffInvitationListItem,
  type StaffSessionListItem,
  type TelemetryReadingsPage,
  type TelemetryReadingsQuery,
  type ZoneControlListItem,
  type ZonePresenceListItem,
} from '@hulajnogi/shared';
import { and, eq, gt, isNull, lt, or, sql, type SQL } from 'drizzle-orm';
import { runListQuery, type ListSource } from '../admin/list-query.js';
import type { DbExecutor } from '../client.js';
import {
  vConsentList,
  vOtpCodeList,
  vPaymentCustomerList,
  vPermissionList,
  vRentalEventList,
  vSavedPlaceList,
  vScooterCommandList,
  vScooterStatusHistory,
  vSessionList,
  vStaffInvitationList,
  vStaffSessionList,
  vZoneControlList,
  vZonePresenceList,
} from '../schema/schema.js';
import { parsePgArray } from './tickets.repository.js';

/**
 * Źródła nowych list panelu (iteracja 8, ADR 0074, ADR 0076) na widokach z migracji 0013. Repozytorium nie zna
 * uprawnień: maskowanie danych klienta bez `users.read` (zdarzenia przejazdów, klienci operatora płatności) robi API
 * tak jak na liście przejazdów, a ten sam `ListSource` obsługuje eksport listy (ADR 0073).
 */
type Fields<R extends ResourceDefinition> = keyof R['fields'] & string;

const columns = <F extends string>(view: Record<F, unknown>, fields: readonly F[]) =>
  Object.fromEntries(fields.map((f) => [f, view[f]])) as ListSource<F>['columns'];

const keys = <R extends ResourceDefinition>(def: R) => Object.keys(def.fields) as Fields<R>[];

export const consentListSource: ListSource<Fields<typeof consentsResource>> = {
  from: vConsentList,
  id: vConsentList.id,
  columns: columns(vConsentList, keys(consentsResource)),
};

export const sessionListSource: ListSource<Fields<typeof sessionsResource>> = {
  from: vSessionList,
  id: vSessionList.id,
  columns: columns(vSessionList, keys(sessionsResource)),
};

export const staffSessionListSource: ListSource<Fields<typeof staffSessionsResource>> = {
  from: vStaffSessionList,
  id: vStaffSessionList.id,
  columns: columns(vStaffSessionList, keys(staffSessionsResource)),
};

export const staffInvitationListSource: ListSource<Fields<typeof staffInvitationsResource>> = {
  from: vStaffInvitationList,
  id: vStaffInvitationList.id,
  columns: columns(vStaffInvitationList, keys(staffInvitationsResource)),
};

export const otpCodeListSource: ListSource<Fields<typeof otpCodesResource>> = {
  from: vOtpCodeList,
  id: vOtpCodeList.id,
  columns: columns(vOtpCodeList, keys(otpCodesResource)),
};

export const permissionListSource: ListSource<Fields<typeof permissionsResource>> = {
  from: vPermissionList,
  id: vPermissionList.code,
  columns: columns(vPermissionList, keys(permissionsResource)),
};

export const savedPlaceListSource: ListSource<Fields<typeof savedPlacesResource>> = {
  from: vSavedPlaceList,
  id: vSavedPlaceList.id,
  columns: columns(vSavedPlaceList, keys(savedPlacesResource)),
};

export const scooterCommandListSource: ListSource<Fields<typeof scooterCommandsResource>> = {
  from: vScooterCommandList,
  id: vScooterCommandList.id,
  columns: columns(vScooterCommandList, keys(scooterCommandsResource)),
};

export const rentalEventListSource: ListSource<Fields<typeof rentalEventsResource>> = {
  from: vRentalEventList,
  id: vRentalEventList.id,
  columns: columns(vRentalEventList, keys(rentalEventsResource)),
};

// Obecność ma klucz (hulajnoga, strefa), a sterowanie strefami jeden wiersz na hulajnogę w przejeździe.
export const zonePresenceListSource: ListSource<Fields<typeof zonePresenceResource>> = {
  from: vZonePresenceList,
  id: vZonePresenceList.zoneId,
  columns: columns(vZonePresenceList, keys(zonePresenceResource)),
};

export const zoneControlListSource: ListSource<Fields<typeof zoneControlResource>> = {
  from: vZoneControlList,
  id: vZoneControlList.scooterId,
  columns: columns(vZoneControlList, keys(zoneControlResource)),
};

export const paymentCustomerListSource: ListSource<Fields<typeof paymentCustomersResource>> = {
  from: vPaymentCustomerList,
  id: vPaymentCustomerList.providerCustomerId,
  columns: columns(vPaymentCustomerList, keys(paymentCustomersResource)),
};

type HistoryField = Fields<typeof scooterStatusHistoryResource>;

/**
 * Historia stanów hulajnogi (ADR 0074): opcjonalnie tylko przedziały nachodzące na okres `[from, to)`, także otwarte
 * (filtr `validFrom`/`validTo` listy nie wyraża nakładania się z przedziałem otwartym).
 */
export function statusHistoryListSource(overlap?: { from: Date; to: Date }): ListSource<HistoryField> {
  const v = vScooterStatusHistory;
  return {
    from: v,
    id: v.id,
    columns: columns(v, keys(scooterStatusHistoryResource)),
    where: overlap ? and(lt(v.validFrom, overlap.to), or(isNull(v.validTo), gt(v.validTo, overlap.from))) : undefined,
  };
}

/** Tablice z widoków (`text[]`) przychodzą jako tablice; na wszelki wypadek też z literału `{a,b}`. */
const withArrays = <T>(result: ListResponse<T>, fields: ReadonlyArray<keyof T>): ListResponse<T> => ({
  ...result,
  items: result.items.map((item) => {
    const copy = { ...item };
    for (const field of fields) (copy as Record<keyof T, unknown>)[field] = parsePgArray(item[field]);
    return copy;
  }),
});

export class DrizzleAdminListsRepository {
  constructor(private readonly db: DbExecutor) {}

  /** Użytkownicy → Zgody (`users.read`). */
  consents(query: ListQuery, def: ResourceDefinition<Fields<typeof consentsResource>> = consentsResource) {
    return runListQuery<Fields<typeof consentsResource>, ConsentListItem>(this.db, def, consentListSource, query);
  }

  /** Użytkownicy → Sesje (`users.read`): wiersz na rodzinę tokenów. */
  sessions(query: ListQuery, def: ResourceDefinition<Fields<typeof sessionsResource>> = sessionsResource) {
    return runListQuery<Fields<typeof sessionsResource>, SessionListItem>(this.db, def, sessionListSource, query);
  }

  /** Operatorzy i role → Sesje (`staff.read`). */
  staffSessions(
    query: ListQuery,
    def: ResourceDefinition<Fields<typeof staffSessionsResource>> = staffSessionsResource,
  ) {
    return runListQuery<Fields<typeof staffSessionsResource>, StaffSessionListItem>(
      this.db,
      def,
      staffSessionListSource,
      query,
    );
  }

  /** Operatorzy i role → Zaproszenia (`staff.read`). */
  async staffInvitations(
    query: ListQuery,
    def: ResourceDefinition<Fields<typeof staffInvitationsResource>> = staffInvitationsResource,
  ) {
    const result = await runListQuery<Fields<typeof staffInvitationsResource>, StaffInvitationListItem>(
      this.db,
      def,
      staffInvitationListSource,
      query,
    );
    return withArrays(result, ['staffRoles']);
  }

  /** Użytkownicy → Kody SMS (`users.read`), bez skrótu kodu i z numerem zamaskowanym. */
  otpCodes(query: ListQuery, def: ResourceDefinition<Fields<typeof otpCodesResource>> = otpCodesResource) {
    return runListQuery<Fields<typeof otpCodesResource>, OtpCodeListItem>(this.db, def, otpCodeListSource, query);
  }

  /** Liczba kodów do usunięcia przez „Usuń wygasłe” (okno potwierdzenia; ten sam warunek co procedura). */
  async purgeableOtpCodes(): Promise<number> {
    const { rows } = await this.db.execute<{ n: number }>(
      sql`SELECT count(*)::int AS n FROM v_otp_code_list WHERE purgeable`,
    );
    return rows[0]?.n ?? 0;
  }

  /** Operatorzy i role → Uprawnienia (`roles.manage`). */
  async permissions(
    query: ListQuery,
    def: ResourceDefinition<Fields<typeof permissionsResource>> = permissionsResource,
  ) {
    const result = await runListQuery<Fields<typeof permissionsResource>, PermissionListItem>(
      this.db,
      def,
      permissionListSource,
      query,
    );
    return withArrays(result, ['roleNames']);
  }

  /**
   * Opis uprawnienia z wersją rekordu (`false` przy konflikcie wersji); `permission.updated` w dzienniku audytu zapisuje
   * API w tej samej transakcji.
   */
  async updatePermissionDescription(code: string, version: number, description: string, staffId: string) {
    const { rowCount } = await this.db.execute(sql`
      UPDATE permissions SET description = ${description}, updated_by = ${staffId}, updated_at = now(), version = version + 1
      WHERE code = ${code} AND version = ${version}`);
    return (rowCount ?? 0) > 0;
  }

  /** Karta klienta → Zapisane miejsca (`users.read`; filtr `userId` z adresu). */
  savedPlaces(query: ListQuery, def: ResourceDefinition<Fields<typeof savedPlacesResource>> = savedPlacesResource) {
    return runListQuery<Fields<typeof savedPlacesResource>, SavedPlaceListItem>(
      this.db,
      def,
      savedPlaceListSource,
      query,
    );
  }

  /** Flota → Komendy (`scooters.read`). */
  scooterCommands(
    query: ListQuery,
    def: ResourceDefinition<Fields<typeof scooterCommandsResource>> = scooterCommandsResource,
  ) {
    return runListQuery<Fields<typeof scooterCommandsResource>, ScooterCommandListItem>(
      this.db,
      def,
      scooterCommandListSource,
      query,
    );
  }

  /** Karta hulajnogi → Historia stanów (`scooters.read`), opcjonalnie przedziały nachodzące na okres. */
  statusHistory(
    query: ListQuery,
    options: { overlap?: { from: Date; to: Date }; def?: ResourceDefinition<HistoryField> } = {},
  ) {
    return runListQuery<HistoryField, ScooterStatusHistoryItem>(
      this.db,
      options.def ?? scooterStatusHistoryResource,
      statusHistoryListSource(options.overlap),
      query,
    );
  }

  /** Przedziały hulajnogi nachodzące na okres (oś czasu i udziały na karcie; wskaźniki liczy core). */
  async statusIntervals(scooterId: string, period: { from: Date; to: Date }) {
    const v = vScooterStatusHistory;
    return this.db
      .select({ status: v.status, online: v.online, validFrom: v.validFrom, validTo: v.validTo })
      .from(v)
      .where(
        and(eq(v.scooterId, scooterId), lt(v.validFrom, period.to), or(isNull(v.validTo), gt(v.validTo, period.from))),
      )
      .orderBy(v.validFrom);
  }

  /** Przejazdy → Zdarzenia (`rentals.read`). */
  rentalEvents(query: ListQuery, def: ResourceDefinition<Fields<typeof rentalEventsResource>> = rentalEventsResource) {
    return runListQuery<Fields<typeof rentalEventsResource>, RentalEventListItem>(
      this.db,
      def,
      rentalEventListSource,
      query,
    );
  }

  /** Strefy → Obecność w strefach (`zones.read`). */
  zonePresence(query: ListQuery, def: ResourceDefinition<Fields<typeof zonePresenceResource>> = zonePresenceResource) {
    return runListQuery<Fields<typeof zonePresenceResource>, ZonePresenceListItem>(
      this.db,
      def,
      zonePresenceListSource,
      query,
    );
  }

  /** Strefy → Komendy stref (`zones.read`). */
  zoneControl(query: ListQuery, def: ResourceDefinition<Fields<typeof zoneControlResource>> = zoneControlResource) {
    return runListQuery<Fields<typeof zoneControlResource>, ZoneControlListItem>(
      this.db,
      def,
      zoneControlListSource,
      query,
    );
  }

  /** Płatności → Klienci operatora (`payments.read`). */
  paymentCustomers(
    query: ListQuery,
    def: ResourceDefinition<Fields<typeof paymentCustomersResource>> = paymentCustomersResource,
  ) {
    return runListQuery<Fields<typeof paymentCustomersResource>, PaymentCustomerListItem>(
      this.db,
      def,
      paymentCustomerListSource,
      query,
    );
  }

  /**
   * Flota → Telemetria (`fn_telemetry_readings`, ADR 0076): strona odczytów od najnowszych z kursorem po czasie (bez
   * liczby wszystkich). `older` czyta przed kursorem, `newer` po nim (od najstarszych, odwrócone do kolejności listy).
   * Kursor ma mikrosekundy z bazy, żeby strony się nie nakładały.
   */
  async telemetryReadings(query: TelemetryReadingsQuery): Promise<TelemetryReadingsPage> {
    const newer = query.direction === 'newer' && query.cursor !== undefined;
    const from = newer ? sql`${query.cursor}::timestamptz + interval '1 microsecond'` : sql`${query.from}::timestamptz`;
    const to = !newer && query.cursor ? sql`${query.cursor}::timestamptz` : sql`${query.to}::timestamptz`;
    const limit = query.pageSize + 1;
    const { rows } = await this.db.execute<Record<string, unknown>>(sql`
      SELECT t.*, to_char(t.recorded_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"') AS cursor
      FROM fn_telemetry_readings(${query.scooterId}::uuid, ${from}, ${to}, ${!newer}, ${limit},
                                 ${query.batteryBelow ?? null}::smallint, ${query.inRide ?? false}) t`);
    const more = rows.length > query.pageSize;
    const page = (more ? rows.slice(0, query.pageSize) : rows).map((r) => ({
      cursor: r.cursor as string,
      item: {
        recordedAt: new Date(r.recorded_at as string).toISOString(),
        lon: Number(r.lon),
        lat: Number(r.lat),
        batteryPct: (r.battery_pct as number | null) ?? null,
        speedKmh: r.speed_kmh === null || r.speed_kmh === undefined ? null : Number(r.speed_kmh),
        rentalId: (r.rental_id as string | null) ?? null,
        rentalNumber: r.rental_number === null || r.rental_number === undefined ? null : Number(r.rental_number),
        locked: (r.locked as boolean | null) ?? null,
        buffered: (r.buffered as boolean | null) ?? null,
        gapSeconds: r.gap_seconds === null || r.gap_seconds === undefined ? null : Number(r.gap_seconds),
      },
    }));
    const ordered = newer ? [...page].reverse() : page;
    const newest = ordered[0]?.cursor ?? null;
    const oldest = ordered[ordered.length - 1]?.cursor ?? null;
    return {
      items: ordered.map((p) => p.item),
      olderCursor: newer ? oldest : more ? oldest : null,
      newerCursor: newer ? (more ? newest : null) : query.cursor ? newest : null,
    };
  }
}

/** Warunek dodatkowy listy (np. `userId` karty klienta) bez zmiany definicji zasobu. */
export const withWhere = <F extends string>(source: ListSource<F>, where: SQL): ListSource<F> => ({
  ...source,
  where: source.where ? and(source.where, where) : where,
});
