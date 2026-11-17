import type { TariffField, TariffInput } from '@hulajnogi/core';
import {
  tariffsResource,
  type ListQuery,
  type ListResponse,
  type TariffDetailsView,
  type TariffVersionItem,
} from '@hulajnogi/shared';
import { sql } from 'drizzle-orm';
import { runListQuery, type ListSource } from '../admin/list-query.js';
import type { DbExecutor } from '../client.js';
import { vTariffVersions } from '../schema/schema.js';

type TariffResourceField = keyof typeof tariffsResource.fields;

const listSource: ListSource<TariffResourceField> = {
  from: vTariffVersions,
  id: vTariffVersions.id,
  columns: {
    id: vTariffVersions.id,
    version: vTariffVersions.version,
    state: vTariffVersions.state,
    validFrom: vTariffVersions.validFrom,
    validTo: vTariffVersions.validTo,
    unlockFee: vTariffVersions.unlockFee,
    minuteRate: vTariffVersions.minuteRate,
    pauseMinuteRate: vTariffVersions.pauseMinuteRate,
    outOfZoneFee: vTariffVersions.outOfZoneFee,
    freeReservationMinutes: vTariffVersions.freeReservationMinutes,
    minWalletBalance: vTariffVersions.minWalletBalance,
    minBatteryPct: vTariffVersions.minBatteryPct,
    minUserAge: vTariffVersions.minUserAge,
    vatRate: vTariffVersions.vatRate,
    createdByName: vTariffVersions.createdByName,
    createdAt: vTariffVersions.createdAt,
    rentalsCount: vTariffVersions.rentalsCount,
  },
};

type Row = Record<string, unknown>;

const toDetails = (r: Row): TariffDetailsView => ({
  id: r.id as string,
  version: r.version as number,
  unlockFee: Number(r.unlock_fee),
  minuteRate: Number(r.minute_rate),
  pauseMinuteRate: Number(r.pause_minute_rate),
  freeReservationMinutes: r.free_reservation_minutes as number,
  outOfZoneFee: Number(r.out_of_zone_fee),
  minWalletBalance: Number(r.min_wallet_balance),
  minBatteryPct: r.min_battery_pct as number,
  minUserAge: r.min_user_age as number,
  vatRate: Number(r.vat_rate),
  validFrom: new Date(r.valid_from as string).toISOString(),
});

export type TariffValues = Record<TariffField, number>;

/**
 * Wersje cennika (ADR 0015, ADR 0053). Obowiązująca wersja to najnowsza z `valid_from` w przeszłości;
 * wersji nie edytuje się, zaplanowaną usuwa `sp_delete_scheduled_tariff`.
 */
export class DrizzleTariffRepository {
  constructor(private readonly db: DbExecutor) {}

  private async one(query: ReturnType<typeof sql>): Promise<Row | null> {
    return (await this.db.execute<Row>(query)).rows[0] ?? null;
  }

  list(query: ListQuery): Promise<ListResponse<TariffVersionItem>> {
    return runListQuery<TariffResourceField, TariffVersionItem>(this.db, tariffsResource, listSource, query);
  }

  async item(id: string): Promise<TariffVersionItem | null> {
    const result = await this.list({
      filters: [{ field: 'id', op: 'eq', values: [id] }],
      sort: [],
      page: 1,
      pageSize: 1,
      facets: [],
    });
    return result.items[0] ?? null;
  }

  /** Czas transakcji w bazie: ten sam zegar, z którego widok liczy stan wersji („od teraz”). */
  async now(): Promise<Date> {
    return new Date((await this.one(sql`SELECT now() AS now`))!.now as string);
  }

  async current(): Promise<TariffDetailsView | null> {
    const row = await this.one(sql`SELECT * FROM tariffs WHERE valid_from <= now() ORDER BY version DESC LIMIT 1`);
    return row ? toDetails(row) : null;
  }

  async details(id: string): Promise<TariffDetailsView | null> {
    const row = await this.one(sql`SELECT * FROM tariffs WHERE id = ${id}`);
    return row ? toDetails(row) : null;
  }

  async scheduled(): Promise<{ id: string; version: number } | null> {
    const row = await this.one(sql`SELECT id, version FROM tariffs WHERE valid_from > now() ORDER BY version LIMIT 1`);
    return row ? { id: row.id as string, version: row.version as number } : null;
  }

  /** Blokada tabeli na czas zapisu nowej wersji: numer i reguła jednej zaplanowanej bez wyścigu. */
  async lockForNewVersion(): Promise<void> {
    await this.db.execute(sql`LOCK TABLE tariffs IN SHARE ROW EXCLUSIVE MODE`);
  }

  async insert(input: Omit<TariffInput, 'validFrom'> & { validFrom: Date }, staffId: string): Promise<string> {
    const row = await this.one(sql`
      INSERT INTO tariffs (version, unlock_fee, minute_rate, pause_minute_rate, out_of_zone_fee, free_reservation_minutes,
                           min_wallet_balance, min_battery_pct, min_user_age, vat_rate, valid_from, created_by)
      SELECT COALESCE(max(version), 0) + 1, ${input.unlockFee}, ${input.minuteRate}, ${input.pauseMinuteRate},
             ${input.outOfZoneFee}, ${input.freeReservationMinutes}, ${input.minWalletBalance}, ${input.minBatteryPct},
             ${input.minUserAge}, ${input.vatRate}, ${input.validFrom}, ${staffId}
      FROM tariffs
      RETURNING id`);
    return row!.id as string;
  }

  async remove(id: string): Promise<void> {
    await this.db.execute(sql`CALL sp_delete_scheduled_tariff(${id})`);
  }
}

/** Wartości wersji do porównania w dzienniku audytu. */
export const tariffValues = (t: TariffDetailsView): TariffValues => ({
  unlockFee: t.unlockFee,
  minuteRate: t.minuteRate,
  pauseMinuteRate: t.pauseMinuteRate,
  outOfZoneFee: t.outOfZoneFee,
  freeReservationMinutes: t.freeReservationMinutes,
  minWalletBalance: t.minWalletBalance,
  minBatteryPct: t.minBatteryPct,
  minUserAge: t.minUserAge,
  vatRate: t.vatRate,
});
