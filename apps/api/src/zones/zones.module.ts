import { Module } from '@nestjs/common';
import { type Database, DrizzleZoneRepository } from '@hulajnogi/db';
import { DB } from '../database/database.module.js';
import { ZONE_REPOSITORY, ZonesService } from './zones.service.js';
import { ZonesController } from './zones.controller.js';

@Module({
  controllers: [ZonesController],
  providers: [
    // Port z packages/core, implementacja z packages/db (ADR 0025).
    { provide: ZONE_REPOSITORY, inject: [DB], useFactory: (db: Database) => new DrizzleZoneRepository(db) },
    ZonesService,
  ],
  exports: [ZonesService],
})
export class ZonesModule {}
