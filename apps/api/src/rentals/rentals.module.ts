import { Module } from '@nestjs/common';
import { FleetModule } from '../fleet/fleet.module.js';
import { AdminRentalsController } from './admin-rentals.controller.js';
import { AdminRentalsService } from './admin-rentals.service.js';
import { CustomerAccountController, RentalsController } from './rentals.controller.js';
import { RentalsService } from './rentals.service.js';

/** Moduł Wypożyczenia: rezerwacja, przejazd, komendy przejazdu, przejazdy w panelu (ADR 0036). */
@Module({
  imports: [FleetModule],
  controllers: [RentalsController, CustomerAccountController, AdminRentalsController],
  providers: [RentalsService, AdminRentalsService],
  exports: [RentalsService],
})
export class RentalsModule {}
