import { Module } from '@nestjs/common';
import { type Database, DrizzleZoneRepository } from '@hulajnogi/db';
import { DB } from '../database/database.module.js';
import { GeoModule } from '../geo/geo.module.js';
import { RentalsModule } from '../rentals/rentals.module.js';
import { AdminZonesController } from './admin-zones.controller.js';
import { AdminZonesService } from './admin-zones.service.js';
import { ZoneTracker } from './zone-tracker.service.js';
import { ZONE_REPOSITORY, ZonesService } from './zones.service.js';
import { CustomerZonesController, ZonesController } from './zones.controller.js';

/** Moduł Strefy: geometrie, edytor w panelu, bieżące strefy hulajnóg w przejeździe (ADR 0043, 0047). */
@Module({
  imports: [GeoModule, RentalsModule],
  controllers: [ZonesController, CustomerZonesController, AdminZonesController],
  providers: [
    // Port z packages/core, implementacja z packages/db (ADR 0025).
    { provide: ZONE_REPOSITORY, inject: [DB], useFactory: (db: Database) => new DrizzleZoneRepository(db) },
    ZonesService,
    ZoneTracker,
    AdminZonesService,
  ],
  exports: [ZonesService, ZoneTracker],
})
export class ZonesModule {}
