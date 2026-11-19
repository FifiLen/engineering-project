import type { CurrentStateUpdate, TelemetryReading, TelemetryRepository, TelemetryTarget } from '@hulajnogi/core';
import { eq, inArray, sql } from 'drizzle-orm';
import type { Database, DbExecutor } from '../client.js';
import { scooters } from '../schema/schema.js';
import { telemetry } from '../schema/telemetry.js';

const targetColumns = {
  id: scooters.id,
  number: scooters.number,
  status: scooters.status,
  online: scooters.online,
  batteryPct: scooters.batteryPct,
  lastSeenAt: scooters.lastSeenAt,
  lat: sql<number | null>`ST_Y(${scooters.position})`,
  lon: sql<number | null>`ST_X(${scooters.position})`,
};

type TargetRow = { [K in keyof typeof targetColumns]: unknown };

const toTarget = (r: TargetRow): TelemetryTarget => ({
  id: r.id as string,
  number: r.number as number,
  status: r.status as TelemetryTarget['status'],
  online: r.online as boolean,
  batteryPct: r.batteryPct as number | null,
  lastSeenAt: r.lastSeenAt as Date | null,
  position: r.lat === null || r.lon === null ? null : { lat: Number(r.lat), lon: Number(r.lon) },
});

const point = (r: TelemetryReading) => sql`ST_SetSRID(ST_MakePoint(${r.position.lon}, ${r.position.lat}), 4326)`;

/** Moduł Telemetria: historia punktów (tabela partycjonowana) i stan bieżący hulajnóg. */
export class DrizzleTelemetryRepository implements TelemetryRepository {
  constructor(private readonly db: Database) {}

  async findTargets(numbers: readonly number[]): Promise<TelemetryTarget[]> {
    if (!numbers.length) return [];
    const rows = await this.db
      .select(targetColumns)
      .from(scooters)
      .where(inArray(scooters.number, [...numbers]));
    return rows.map(toTarget);
  }

  async save(
    history: ReadonlyArray<{ scooterId: string; reading: TelemetryReading }>,
    current: readonly CurrentStateUpdate[],
  ): Promise<void> {
    await this.db.transaction(async (tx) => {
      if (history.length) {
        await tx
          .insert(telemetry)
          .values(
            history.map(({ scooterId, reading }) => ({
              scooterId,
              recordedAt: reading.recordedAt,
              position: point(reading),
              batteryPct: reading.batteryPct,
              speedKmh: reading.speedKmh,
              // Pola kontraktu MQTT (Telemetry) do listy Flota → Telemetria (migracja 0013, ADR 0076).
              locked: reading.locked,
              buffered: reading.buffered,
              // Punkt należy do przejazdu w trakcie jazdy (dystans i trasa przejazdu, ADR 0042).
              rentalId: sql`(SELECT id FROM rentals WHERE scooter_id = ${scooterId} AND state IN ('ACTIVE', 'PAUSED', 'ENDING'))`,
            })),
          )
          // QoS 1 może dostarczyć wiadomość ponownie; klucz (hulajnoga, czas) czyni zapis idempotentnym.
          .onConflictDoNothing();
      }
      for (const update of current) await this.applyCurrent(tx, update);
    });
  }

  /** Warunek na czasie chroni przed cofnięciem stanu, gdy dwie partie zapisują się równolegle. */
  private async applyCurrent(tx: DbExecutor, { scooterId, reading, odometerIncrementM }: CurrentStateUpdate) {
    await tx
      .update(scooters)
      .set({
        position: point(reading),
        batteryPct: reading.batteryPct,
        lastSeenAt: reading.recordedAt,
        odometerM: sql`${scooters.odometerM} + ${odometerIncrementM}`,
      })
      .where(
        sql`${scooters.id} = ${scooterId} AND (${scooters.lastSeenAt} IS NULL OR ${scooters.lastSeenAt} < ${reading.recordedAt})`,
      );
  }

  /**
   * Łączność z `status` (retained, Last Will). `wasOnline` to stan sprzed zapisu: zgłoszenie `OFFLINE` planuje się
   * tylko przy zmianie online → offline, nie przy powtórzonym statusie po restarcie API (ADR 0055).
   */
  async setConnection(
    number: number,
    online: boolean,
    firmware: string | null,
  ): Promise<(TelemetryTarget & { wasOnline: boolean }) | null> {
    const [before] = await this.db
      .select({ online: scooters.online })
      .from(scooters)
      .where(eq(scooters.number, number));
    const [row] = await this.db
      .update(scooters)
      .set({ online, ...(firmware ? { firmware } : {}) })
      .where(eq(scooters.number, number))
      .returning(targetColumns);
    return row ? { ...toTarget(row), wasOnline: before?.online ?? false } : null;
  }

  /** Dzienne partycje telemetrii na najbliższe dni (`sp_ensure_telemetry_partitions`). */
  async ensurePartitions(from: Date, days: number): Promise<number> {
    const { rows } = await this.db.execute<{ created_count: number }>(
      sql`CALL sp_ensure_telemetry_partitions(${from.toISOString().slice(0, 10)}::date, ${days}, NULL)`,
    );
    return rows[0]!.created_count;
  }
}
