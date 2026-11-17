import { DomainError, evaluatePosition } from '@hulajnogi/core';
import { type Database, DrizzleZoneRepository } from '@hulajnogi/db';
import {
  destinationQuerySchema,
  placeSearchQuerySchema,
  type DestinationQuery,
  type DestinationView,
  type PlaceSearchQuery,
  type PlaceSearchResponse,
} from '@hulajnogi/shared';
import { Controller, Get, Inject, Injectable, Module, Query } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { CurrentCustomer, CustomerAuth, type CustomerPrincipal } from '../auth/decorators.js';
import { ZodPipe } from '../common/zod-query.js';
import { DB } from '../database/database.module.js';
import { PlaceSearch } from './place-search.js';
import { RoutePlanner } from './route-planner.js';

/** Limit zapytań klienta do usług map (wyszukiwanie i trasy razem, ADR 0045 i 0048). */
const GEO_REQUESTS_PER_MINUTE = 30;

@Injectable()
export class GeoRateLimiter {
  private readonly hits = new Map<string, number[]>();

  take(userId: string, now = Date.now()): void {
    const recent = (this.hits.get(userId) ?? []).filter((t) => now - t < 60_000);
    if (recent.length >= GEO_REQUESTS_PER_MINUTE) throw new DomainError('RATE_LIMITED', { retryAfterSec: 60 });
    recent.push(now);
    this.hits.set(userId, recent);
  }
}

/** Aplikacja: „Dokąd jedziesz?” (ADR 0045) i szacunek dojazdu do wybranego celu (decyzja D5). */
@ApiTags('aplikacja: mapa')
@CustomerAuth()
@Controller('places')
export class PlacesController {
  constructor(
    private readonly search: PlaceSearch,
    private readonly routes: RoutePlanner,
    private readonly limiter: GeoRateLimiter,
    @Inject(DB) private readonly db: Database,
  ) {}

  @Get('search')
  @ApiOperation({
    summary: 'Miejsca z obszaru działania z zapasem 1 km (5 wyników); 503 PLACES_UNAVAILABLE bez usługi',
  })
  async searchPlaces(
    @CurrentCustomer() customer: CustomerPrincipal,
    @Query(new ZodPipe(placeSearchQuerySchema)) query: PlaceSearchQuery,
  ): Promise<PlaceSearchResponse> {
    this.limiter.take(customer.userId);
    const near = query.lat !== undefined && query.lon !== undefined ? { lat: query.lat, lon: query.lon } : null;
    return { places: await this.search.search(query.q, near) };
  }

  @Get('destination')
  @ApiOperation({ summary: 'Wybrany cel: trasa rowerowa z OSRM, strefa parkowania przy celu i limit w miejscu celu' })
  async destination(
    @CurrentCustomer() customer: CustomerPrincipal,
    @Query(new ZodPipe(destinationQuerySchema)) query: DestinationQuery,
  ): Promise<DestinationView> {
    this.limiter.take(customer.userId);
    const target = { lat: query.toLat, lon: query.toLon };
    const zones = new DrizzleZoneRepository(this.db);
    const [route, parking, atTarget] = await Promise.all([
      this.routes.route('bike', { lat: query.lat, lon: query.lon }, target),
      zones.nearestParking(target),
      zones.findAt(target),
    ]);
    const rules = evaluatePosition(atTarget);
    return {
      route,
      parking: parking
        ? { code: parking.code, name: parking.name, distanceM: parking.distanceM, anchor: parking.anchor }
        : null,
      speedLimitKmh: rules.speedLimitKmh,
      insideServiceArea: rules.insideServiceArea,
    };
  }
}

/** Usługi map za API (ADR 0017): trasy z OSRM i wyszukiwanie miejsc. */
@Module({
  controllers: [PlacesController],
  providers: [RoutePlanner, PlaceSearch, GeoRateLimiter],
  exports: [RoutePlanner, PlaceSearch, GeoRateLimiter],
})
export class GeoModule {}
