import { Module } from '@nestjs/common';
import { FilesModule } from '../files/files.module.js';
import { FleetModule } from '../fleet/fleet.module.js';
import { GeoModule } from '../geo/geo.module.js';
import { OperationsModule } from '../operations/operations.module.js';
import { PaymentsModule } from '../payments/payments.module.js';
import { AdminRentalsController } from './admin-rentals.controller.js';
import { AdminRentalsService } from './admin-rentals.service.js';
import { CustomerAccountController, RentalsController } from './rentals.controller.js';
import { RentalsService } from './rentals.service.js';

/** Moduł Wypożyczenia: rezerwacja, przejazd, komendy przejazdu, rozliczenie przy zakończeniu, przejazdy w panelu (ADR 0036, ADR 0049). */
@Module({
  imports: [FleetModule, GeoModule, PaymentsModule, FilesModule, OperationsModule],
  controllers: [RentalsController, CustomerAccountController, AdminRentalsController],
  providers: [RentalsService, AdminRentalsService],
  exports: [RentalsService],
})
export class RentalsModule {}
