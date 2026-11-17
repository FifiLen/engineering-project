import { activeZonesGeoJson, type Database, DrizzleZoneRepository } from '@hulajnogi/db';
import { pointQuerySchema, type NearbyQuery, type NearestParkingRoute } from '@hulajnogi/shared';
import { Controller, Get, Headers, Inject, Query, Res } from '@nestjs/common';
import { ApiOkResponse, ApiOperation, ApiQuery, ApiTags } from '@nestjs/swagger';
import type { FastifyReply } from 'fastify';
import { z } from 'zod';
import { CurrentCustomer, CustomerAuth, Public, type CustomerPrincipal } from '../auth/decorators.js';
import { ZodPipe } from '../common/zod-query.js';
import { DB } from '../database/database.module.js';
import { GeoRateLimiter } from '../geo/geo.module.js';
import { RoutePlanner } from '../geo/route-planner.js';
import { ZonesService } from './zones.service.js';

const lookupQuery = z.object({
  lat: z.coerce.number().min(-90).max(90),
  lon: z.coerce.number().min(-180).max(180),
});

@ApiTags('strefy')
@Public()
@Controller('zones')
export class ZonesController {
  constructor(
    private readonly zones: ZonesService,
    @Inject(DB) private readonly db: Database,
  ) {}

  /**
   * Aktywne strefy dla aplikacji, panelu i symulatora (ADR 0046). `ETag` z wersji stref pozwala
   * odpytywać co minutę bez przesyłania geometrii, gdy nic się nie zmieniło.
   */
  @Get()
  @ApiOkResponse({ description: 'Aktywne strefy jako GeoJSON (FeatureCollection, WGS 84) z punktem `anchor`' })
  async geoJson(
    @Headers('if-none-match') ifNoneMatch: string | undefined,
    @Res({ passthrough: true }) reply: FastifyReply,
  ) {
    const etag = `"zones-${await new DrizzleZoneRepository(this.db).revision()}"`;
    void reply.header('ETag', etag).header('Cache-Control', 'no-cache');
    if (ifNoneMatch === etag) {
      void reply.status(304);
      return undefined;
    }
    return activeZonesGeoJson(this.db);
  }

  @Get('lookup')
  @ApiQuery({ name: 'lat', type: Number, example: 50.0957 })
  @ApiQuery({ name: 'lon', type: Number, example: 18.5419 })
  @ApiOkResponse({ description: 'Strefy zawierające punkt, od najbardziej restrykcyjnej' })
  async lookup(@Query(new ZodPipe(lookupQuery)) query: z.infer<typeof lookupQuery>) {
    const { zones, rules } = await this.zones.lookup(query);
    return {
      point: query,
      insideServiceArea: rules.insideServiceArea,
      canPark: rules.canPark,
      zones: zones.map(({ code, name, type, speedLimitKmh }) => ({ code, name, type, speedLimitKmh })),
    };
  }
}

/** Prowadzenie do najbliższej strefy parkowania w trakcie jazdy (ADR 0048, makieta `przejazd-prowadz-do-strefy`). */
@ApiTags('aplikacja: mapa')
@CustomerAuth()
@Controller('zones')
export class CustomerZonesController {
  constructor(
    @Inject(DB) private readonly db: Database,
    private readonly routes: RoutePlanner,
    private readonly limiter: GeoRateLimiter,
  ) {}

  @Get('nearest-parking')
  @ApiOperation({ summary: 'Najbliższa strefa parkowania z trasą rowerową do jej granicy (bez OSRM: linia prosta)' })
  async nearestParking(
    @CurrentCustomer() customer: CustomerPrincipal,
    @Query(new ZodPipe(pointQuerySchema)) query: NearbyQuery,
  ): Promise<NearestParkingRoute | null> {
    this.limiter.take(customer.userId);
    const parking = await new DrizzleZoneRepository(this.db).nearestParking(query);
    if (!parking) return null;
    const [lon, lat] = parking.target;
    return {
      zone: { id: parking.id, code: parking.code, name: parking.name, anchor: parking.anchor },
      target: parking.target,
      route: await this.routes.route('bike', query, { lat, lon }),
    };
  }
}
