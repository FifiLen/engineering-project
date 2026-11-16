import { Inject, Injectable } from '@nestjs/common';
import { evaluatePosition, type GeoPoint, type PositionRules, type Zone, type ZoneRepository } from '@hulajnogi/core';

export const ZONE_REPOSITORY = Symbol('ZONE_REPOSITORY');

export interface PositionLookup {
  zones: Zone[];
  rules: PositionRules;
}

/** Serwis aplikacyjny: dane z repozytorium, reguły z packages/core. */
@Injectable()
export class ZonesService {
  constructor(@Inject(ZONE_REPOSITORY) private readonly zones: ZoneRepository) {}

  async lookup(point: GeoPoint): Promise<PositionLookup> {
    const zones = await this.zones.findAt(point);
    return { zones, rules: evaluatePosition(zones) };
  }
}
