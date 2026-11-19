import { Module } from '@nestjs/common';
import { FilesModule } from '../files/files.module.js';
import { FleetModule } from '../fleet/fleet.module.js';
import { DashboardService } from './dashboard.service.js';
import { OperationsService } from './operations.service.js';
import {
  DashboardController,
  ScooterServiceController,
  ServiceTasksController,
  SparePartsController,
} from './service.controller.js';
import { ServiceTasksService } from './service-tasks.service.js';
import { SparePartsService } from './spare-parts.service.js';
import { AdminTicketsController, CustomerTicketsController } from './tickets.controller.js';
import { TicketsService } from './tickets.service.js';
import { TicketDataExport } from './ticket-data-export.js';

/**
 * Moduł Operacje (ADR 0055): zgłoszenia, zadania serwisowe, magazyn części, stan hulajnogi w serwisie i pulpit
 * „Wymaga uwagi”. Moduł Wypożyczenia zakłada przez niego zgłoszenia automatyczne przy zakończeniu przejazdu,
 * a Telemetria przy utracie i powrocie łączności.
 */
@Module({
  imports: [FleetModule, FilesModule],
  controllers: [
    CustomerTicketsController,
    AdminTicketsController,
    ServiceTasksController,
    ScooterServiceController,
    SparePartsController,
    DashboardController,
  ],
  providers: [
    OperationsService,
    TicketsService,
    ServiceTasksService,
    SparePartsService,
    DashboardService,
    TicketDataExport,
  ],
  exports: [OperationsService, TicketsService],
})
export class OperationsModule {}
