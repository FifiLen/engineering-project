import {
  detectZoneChanges,
  ZONE_EXIT_DISTANCE_M,
  type GeoPoint,
  type ZonePresence,
  type ZoneTransition,
} from '@hulajnogi/core';
import { type Database, DrizzleZoneRepository } from '@hulajnogi/db';
import { Inject, Injectable, Logger } from '@nestjs/common';
import { DB } from '../database/database.module.js';
import { RentalsService } from '../rentals/rentals.service.js';

/** Odczyt hulajnogi przekazany przez Telemetrię po zapisie partii (ADR 0043). */
export interface TrackedReading {
  scooterId: string;
  position: GeoPoint;
  recordedAt: Date;
  buffered: boolean;
}

/**
 * Moduł Strefy: bieżące strefy hulajnóg w przejeździe (ADR 0043). Przejścia liczy core z histerezą,
 * a zdarzenia na osi czasu i komendy dla hulajnogi zapisuje moduł Wypożyczenie (ADR 0044).
 */
@Injectable()
export class ZoneTracker {
  private readonly logger = new Logger(ZoneTracker.name);

  constructor(
    @Inject(DB) private readonly db: Database,
    private readonly rentals: RentalsService,
  ) {}

  /** Odczyty z jednej partii telemetrii, posortowane według czasu odczytu. */
  async track(readings: readonly TrackedReading[]): Promise<void> {
    if (!readings.length) return;
    const riding = await this.rentals.ridingByScooter([...new Set(readings.map((r) => r.scooterId))]);
    const byScooter = new Map<string, TrackedReading[]>();
    for (const reading of readings) {
      if (!riding.has(reading.scooterId)) continue;
      byScooter.set(reading.scooterId, [...(byScooter.get(reading.scooterId) ?? []), reading]);
    }
    for (const [scooterId, list] of byScooter) {
      try {
        await this.trackScooter(scooterId, riding.get(scooterId)!, list);
      } catch (error) {
        this.logger.error(`Strefy hulajnogi ${scooterId}: ${(error as Error).message}`);
      }
    }
  }

  /**
   * Zmiana stref w panelu działa w trwających przejazdach od razu (pytanie 7): ostatnia pozycja hulajnogi
   * przechodzi przez tę samą ocenę co odczyt telemetrii.
   */
  async reevaluate(): Promise<void> {
    const tracked = await new DrizzleZoneRepository(this.db).trackedRentals();
    const now = new Date();
    for (const { rentalId, scooterId, position } of tracked) {
      if (!position) continue;
      try {
        await this.trackScooter(scooterId, rentalId, [{ scooterId, position, recordedAt: now, buffered: false }]);
      } catch (error) {
        this.logger.error(`Ponowna ocena stref hulajnogi ${scooterId}: ${(error as Error).message}`);
      }
    }
  }

  private async trackScooter(scooterId: string, rentalId: string, readings: readonly TrackedReading[]): Promise<void> {
    const transitions = await this.db.transaction(async (tx) => {
      const zones = new DrizzleZoneRepository(tx);
      let control = await zones.control(scooterId);
      if (control && control.rentalId !== rentalId) {
        // Pozostałość po przejeździe, którego koniec nie wyczyścił stanu.
        await zones.stopTracking(control.rentalId);
        control = null;
      }
      if (!control) await zones.startTracking(scooterId, rentalId);
      let presence: ZonePresence[] | null = control ? await zones.presence(scooterId) : null;
      const found: ZoneTransition[] = [];
      for (const reading of readings) {
        const changes = detectZoneChanges(presence, {
          at: reading.recordedAt,
          near: await zones.near(reading.position, ZONE_EXIT_DISTANCE_M),
        });
        presence = changes.presence;
        found.push(...changes.transitions);
      }
      await zones.savePresence(scooterId, rentalId, presence ?? []);
      return found;
    });
    // Punkty z bufora dają zdarzenia, ale komendę wyznacza dopiero odczyt bieżący (ADR 0043).
    await this.rentals.onZoneChanges({
      rentalId,
      scooterId,
      transitions,
      applyControl: readings.some((r) => !r.buffered),
    });
  }
}
