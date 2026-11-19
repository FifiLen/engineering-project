import {
  elapsedPeriodSeconds,
  notFound,
  scooterTimeCategory,
  scooterUsageIndicators,
  TELEMETRY_EXPORT_LIMIT,
  timeTotalsFromIntervals,
} from '@hulajnogi/core';
import { type Database, type DbExecutor, DrizzleAdminListsRepository, DrizzleScooterRepository } from '@hulajnogi/db';
import {
  telemetryReadingsResource,
  type ListExportRequest,
  type ListQuery,
  type ScooterStatusTime,
  type ScooterStatusTimeQuery,
  type TelemetryReadingsQuery,
  type TelemetryReadingView,
} from '@hulajnogi/shared';
import { Inject, Injectable } from '@nestjs/common';
import type { FastifyReply } from 'fastify';
import { ListExportService } from '../common/list-export/list-export.service.js';
import { DB } from '../database/database.module.js';

/** Partia odczytu telemetrii w eksporcie (strony z kursorem w transakcji eksportu). */
const TELEMETRY_EXPORT_BATCH = 1000;

/**
 * Listy techniczne Floty (ADR 0074, ADR 0076): komendy, historia stanów z udziałami czasu za okres i telemetria
 * z kursorem. Tylko odczyt; komendy wysyła karta hulajnogi (`scooters.command`), historię i telemetrię zapisuje system.
 */
@Injectable()
export class FleetListsService {
  constructor(
    @Inject(DB) private readonly db: Database,
    private readonly exporter: ListExportService,
  ) {}

  private repo(db: DbExecutor = this.db) {
    return new DrizzleAdminListsRepository(db);
  }

  commands(query: ListQuery, db?: DbExecutor) {
    return this.repo(db).scooterCommands(query);
  }

  statusHistory(query: ListQuery, overlap?: { from: Date; to: Date }, db?: DbExecutor) {
    return this.repo(db).statusHistory(query, { overlap });
  }

  /**
   * Udziały czasu hulajnogi za okres (karta hulajnogi → Historia stanów): przedziały przycięte do okresu, sekundy
   * w kategoriach i wskaźniki z core (ta sama definicja co pulpit i raport „Wykorzystanie floty”, ADR 0074).
   */
  async statusTime(scooterId: string, query: ScooterStatusTimeQuery): Promise<ScooterStatusTime> {
    if (!(await new DrizzleScooterRepository(this.db).findState(scooterId))) throw notFound('scooter', scooterId);
    const period = { from: new Date(query.from), to: new Date(query.to) };
    const now = new Date();
    // Kolumny widoku są w typach Drizzle opcjonalne; przedział historii ma zawsze stan, łączność i początek.
    const intervals = (await this.repo().statusIntervals(scooterId, period)).map((i) => ({
      status: i.status!,
      online: i.online!,
      validFrom: i.validFrom!,
      validTo: i.validTo,
    }));
    const totals = timeTotalsFromIntervals(intervals, period, now);
    const periodSeconds = elapsedPeriodSeconds(period, now);
    const end = Math.min(period.to.getTime(), now.getTime());
    const clipped = intervals
      .map((i) => ({
        status: i.status,
        online: i.online,
        category: scooterTimeCategory(i.status, i.online),
        from: new Date(Math.max(i.validFrom.getTime(), period.from.getTime())),
        to: new Date(Math.min((i.validTo ?? now).getTime(), end)),
        open: i.validTo === null,
      }))
      .filter((i) => i.to > i.from);
    return {
      scooterId,
      from: period.from.toISOString(),
      to: period.to.toISOString(),
      now: now.toISOString(),
      periodSeconds,
      historySince: intervals[0]?.validFrom.toISOString() ?? null,
      intervals: clipped.map((i) => ({ ...i, from: i.from.toISOString(), to: i.to.toISOString() })),
      totals,
      ...scooterUsageIndicators(totals, periodSeconds),
    };
  }

  telemetry(query: TelemetryReadingsQuery) {
    return this.repo().telemetryReadings(query);
  }

  /**
   * Eksport zakresu telemetrii (ADR 0073, ADR 0076): ten sam mechanizm co listy, limit `TELEMETRY_EXPORT_LIMIT`
   * (24 h odczytów co 5 s), strony kursorem od najnowszych jak na liście, wpis `list.exported` z zakresem.
   */
  export(reply: FastifyReply, staffId: string, query: TelemetryReadingsQuery, request: ListExportRequest) {
    const { scooterId, from, to, batteryBelow, inRide } = query;
    return this.exporter.run<TelemetryReadingView>(reply, {
      staffId,
      resource: telemetryReadingsResource.name,
      def: telemetryReadingsResource,
      request,
      query: { scooterId, from, to, batteryBelow: batteryBelow ?? null, inRide: inRide ?? false },
      limit: TELEMETRY_EXPORT_LIMIT,
      count: (db) => this.repo(db).telemetryCount(query),
      pages: async function* (tx) {
        const repo = new DrizzleAdminListsRepository(tx);
        let cursor: string | undefined;
        for (;;) {
          const page = await repo.telemetryReadings({
            ...query,
            direction: 'older',
            cursor,
            pageSize: TELEMETRY_EXPORT_BATCH,
          });
          if (page.items.length) yield page.items;
          if (!page.olderCursor) return;
          cursor = page.olderCursor;
        }
      },
    });
  }
}
