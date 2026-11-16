import { DrizzleScooterRepository } from '@hulajnogi/db';
import { Controller, Get } from '@nestjs/common';
import { ApiOkResponse, ApiTags } from '@nestjs/swagger';

@ApiTags('panel: flota')
@Controller('admin/fleet')
export class FleetMapController {
  constructor(private readonly scooters: DrizzleScooterRepository) {}

  @Get('map')
  @ApiOkResponse({ description: 'Pozycje i statusy floty; dalsze zmiany przychodzą zdarzeniem fleet.updates' })
  map() {
    return this.scooters.mapSnapshot();
  }
}
