import { type Database, DrizzleTelemetryRepository } from '@hulajnogi/db';
import { Module } from '@nestjs/common';
import { DB } from '../database/database.module.js';
import { FleetModule } from '../fleet/fleet.module.js';
import { RentalsModule } from '../rentals/rentals.module.js';
import { ZonesModule } from '../zones/zones.module.js';
import { TelemetryService } from './telemetry.service.js';

/** Moduł Telemetria: odbiór MQTT, zapis punktów i stanu bieżącego, zdarzenia dla panelu. */
@Module({
  imports: [FleetModule, RentalsModule, ZonesModule],
  providers: [
    {
      provide: DrizzleTelemetryRepository,
      inject: [DB],
      useFactory: (db: Database) => new DrizzleTelemetryRepository(db),
    },
    TelemetryService,
  ],
  exports: [TelemetryService],
})
export class TelemetryModule {}
