import { Controller, Get, Query } from '@nestjs/common';
import { ApiOkResponse, ApiQuery, ApiTags } from '@nestjs/swagger';
import { z } from 'zod';
import { ZodPipe } from '../common/zod-query.js';
import { ZonesService } from './zones.service.js';

const lookupQuery = z.object({
  lat: z.coerce.number().min(-90).max(90),
  lon: z.coerce.number().min(-180).max(180),
});

@ApiTags('strefy')
@Controller('zones')
export class ZonesController {
  constructor(private readonly zones: ZonesService) {}

  @Get('lookup')
  @ApiQuery({ name: 'lat', type: Number, example: 50.0957 })
  @ApiQuery({ name: 'lon', type: Number, example: 18.5419 })
  @ApiOkResponse({ description: 'Strefy zawierające punkt, od najbardziej restrykcyjnej' })
  async lookup(@Query(new ZodPipe(lookupQuery)) query: z.infer<typeof lookupQuery>) {
    const zones = await this.zones.findAt(query.lat, query.lon);
    return {
      point: query,
      insideServiceArea: zones.some((z) => z.type === 'SERVICE_AREA'),
      canPark: zones.some((z) => z.type === 'PARKING') && !zones.some((z) => z.type === 'NO_RIDE'),
      zones,
    };
  }
}
