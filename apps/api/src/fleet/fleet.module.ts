import {
  type Database,
  DrizzleCommandRepository,
  DrizzleScooterModelRepository,
  DrizzleScooterRepository,
} from '@hulajnogi/db';
import { Module } from '@nestjs/common';
import { DB } from '../database/database.module.js';
import { CommandsService } from './commands.service.js';
import { FleetMapController } from './fleet-map.controller.js';
import { FleetStatusService } from './fleet-status.service.js';
import { ScooterModelsController } from './scooter-models.controller.js';
import { ScooterModelsService } from './scooter-models.service.js';
import { ScootersController } from './scooters.controller.js';
import { ScootersService } from './scooters.service.js';

/** Moduł Flota: hulajnogi, modele, komendy i mapa floty. Repozytoria z packages/db (ADR 0025). */
@Module({
  controllers: [ScootersController, ScooterModelsController, FleetMapController],
  providers: [
    { provide: DrizzleScooterRepository, inject: [DB], useFactory: (db: Database) => new DrizzleScooterRepository(db) },
    {
      provide: DrizzleScooterModelRepository,
      inject: [DB],
      useFactory: (db: Database) => new DrizzleScooterModelRepository(db),
    },
    { provide: DrizzleCommandRepository, inject: [DB], useFactory: (db: Database) => new DrizzleCommandRepository(db) },
    FleetStatusService,
    ScootersService,
    ScooterModelsService,
    CommandsService,
  ],
  exports: [FleetStatusService, CommandsService],
})
export class FleetModule {}
