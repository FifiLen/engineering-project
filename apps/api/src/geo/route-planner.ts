import { distanceM, type GeoPoint } from '@hulajnogi/core';
import type { RouteView } from '@hulajnogi/shared';
import { Inject, Injectable, Logger } from '@nestjs/common';
import { CONFIG, type AppConfig } from '../config.js';

/** Limit czasu zapytania do OSRM (ADR 0048); po nim klient dostaje linię prostą. */
const OSRM_TIMEOUT_MS = 2000;

export type RouteProfile = RouteView['profile'];

interface OsrmResponse {
  code: string;
  routes?: Array<{ distance: number; duration: number; geometry: { coordinates: Array<[number, number]> } }>;
}

const round6 = (v: number) => Math.round(v * 1e6) / 1e6;

/**
 * Port tras dla klienta (ADR 0048): OSRM w Dockerze z profilem rowerowym i pieszym. Brak OSRM nigdy
 * nie blokuje jazdy: odpowiedzią jest linia prosta z odległością, bez czasu i z `approximate: true`.
 */
@Injectable()
export class RoutePlanner {
  private readonly logger = new Logger(RoutePlanner.name);

  constructor(@Inject(CONFIG) private readonly config: AppConfig) {}

  async route(profile: RouteProfile, from: GeoPoint, to: GeoPoint): Promise<RouteView> {
    const base = profile === 'foot' ? this.config.OSRM_FOOT_URL : this.config.OSRM_URL;
    const osrmProfile = profile === 'foot' ? 'foot' : 'bike';
    const url = `${base.replace(/\/$/, '')}/route/v1/${osrmProfile}/${from.lon},${from.lat};${to.lon},${to.lat}?overview=full&geometries=geojson&steps=false`;
    try {
      const response = await fetch(url, { signal: AbortSignal.timeout(OSRM_TIMEOUT_MS) });
      const body = (await response.json()) as OsrmResponse;
      const best = body.routes?.[0];
      if (body.code !== 'Ok' || !best) throw new Error(`OSRM: ${body.code}`);
      return {
        line: best.geometry.coordinates.map(([lon, lat]) => [round6(lon), round6(lat)] as [number, number]),
        distanceM: Math.round(best.distance),
        durationSec: Math.round(best.duration),
        approximate: false,
        profile,
      };
    } catch (error) {
      this.logger.warn(`Brak trasy z OSRM (${profile}): ${(error as Error).message}; linia prosta`);
      return straightLine(profile, from, to);
    }
  }
}

export function straightLine(profile: RouteProfile, from: GeoPoint, to: GeoPoint): RouteView {
  return {
    line: [
      [from.lon, from.lat],
      [to.lon, to.lat],
    ],
    distanceM: Math.round(distanceM(from, to)),
    durationSec: null,
    approximate: true,
    profile,
  };
}
