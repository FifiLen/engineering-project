import { distanceM, DomainError, type GeoPoint } from '@hulajnogi/core';
import { type Database, DrizzleZoneRepository } from '@hulajnogi/db';
import type { PlaceResult } from '@hulajnogi/shared';
import { Inject, Injectable, Logger } from '@nestjs/common';
import { CONFIG, type AppConfig } from '../config.js';
import { DB } from '../database/database.module.js';

const PHOTON_TIMEOUT_MS = 3000;
const RESULT_LIMIT = 5;
/** Zapas wokół obszaru działania (pytanie 9 w planie iteracji 4). */
const AREA_MARGIN_M = 1000;
const CACHE_TTL_MS = 24 * 60 * 60 * 1000;
const CACHE_MAX = 500;
const USER_AGENT = 'hulajnogi-projekt-inzynierski/0.1';

interface PhotonFeature {
  geometry: { coordinates: [number, number] };
  properties: {
    osm_type?: string;
    osm_id?: number;
    name?: string;
    street?: string;
    housenumber?: string;
    district?: string;
    city?: string;
  };
}

/**
 * Wyszukiwanie miejsc przez Photon za API (ADR 0045): zawężenie do obszaru działania z zapasem 1 km,
 * nazwy lokalne (`lang=default`), pamięć podręczna na 24 h w procesie. Klient zna tylko API.
 */
@Injectable()
export class PlaceSearch {
  private readonly logger = new Logger(PlaceSearch.name);
  private readonly cache = new Map<string, { at: number; places: Omit<PlaceResult, 'distanceM'>[] }>();

  constructor(
    @Inject(CONFIG) private readonly config: AppConfig,
    @Inject(DB) private readonly db: Database,
  ) {}

  async search(query: string, near: GeoPoint | null): Promise<PlaceResult[]> {
    const key = query.trim().toLowerCase().replace(/\s+/g, ' ');
    const cached = this.cache.get(key);
    const places = cached && Date.now() - cached.at < CACHE_TTL_MS ? cached.places : await this.fetch(key, near);
    if (!cached || cached.places !== places) this.remember(key, places);
    return places.map((p) => ({ ...p, distanceM: near ? Math.round(distanceM(near, p)) : null }));
  }

  /** Adapter Photon; błąd usługi to `PLACES_UNAVAILABLE` (503), brak wyników to pusta lista. */
  protected async fetch(query: string, near: GeoPoint | null): Promise<Omit<PlaceResult, 'distanceM'>[]> {
    const bbox = await new DrizzleZoneRepository(this.db).serviceAreaBbox(AREA_MARGIN_M);
    const url = new URL('/api/', this.config.PHOTON_URL);
    url.searchParams.set('q', query);
    url.searchParams.set('limit', String(RESULT_LIMIT));
    url.searchParams.set('lang', 'default');
    if (bbox) url.searchParams.set('bbox', bbox.map((v) => v.toFixed(5)).join(','));
    if (near) {
      url.searchParams.set('lat', String(near.lat));
      url.searchParams.set('lon', String(near.lon));
    }
    try {
      const response = await fetch(url, {
        headers: { 'User-Agent': USER_AGENT },
        signal: AbortSignal.timeout(PHOTON_TIMEOUT_MS),
      });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const body = (await response.json()) as { features?: PhotonFeature[] };
      return (body.features ?? []).slice(0, RESULT_LIMIT).map(toPlace);
    } catch (error) {
      this.logger.warn(`Photon niedostępny: ${(error as Error).message}`);
      throw new DomainError('PLACES_UNAVAILABLE');
    }
  }

  /**
   * Odwrotne wyszukiwanie adresu (`/reverse`, ADR 0068): początek i koniec przejazdu na potwierdzeniu. Limit 3 s,
   * a błąd albo brak wyniku daje `null` (dokument podaje wtedy strefę i współrzędne), więc wydruk nie zależy
   * od dostępności Photon.
   */
  async reverse(point: GeoPoint): Promise<string | null> {
    const url = new URL('/reverse', this.config.PHOTON_URL);
    url.searchParams.set('lat', point.lat.toFixed(6));
    url.searchParams.set('lon', point.lon.toFixed(6));
    url.searchParams.set('lang', 'default');
    url.searchParams.set('limit', '1');
    try {
      const response = await fetch(url, {
        headers: { 'User-Agent': USER_AGENT },
        signal: AbortSignal.timeout(PHOTON_TIMEOUT_MS),
      });
      if (!response.ok) return null;
      const feature = ((await response.json()) as { features?: PhotonFeature[] }).features?.[0];
      if (!feature) return null;
      const p = feature.properties;
      const street = p.street ? [p.street, p.housenumber].filter(Boolean).join(' ') : (p.name ?? null);
      return [street, p.city].filter(Boolean).join(', ') || null;
    } catch {
      return null;
    }
  }

  private remember(key: string, places: Omit<PlaceResult, 'distanceM'>[]): void {
    if (this.cache.size >= CACHE_MAX) this.cache.delete(this.cache.keys().next().value!);
    this.cache.set(key, { at: Date.now(), places });
  }
}

function toPlace(feature: PhotonFeature): Omit<PlaceResult, 'distanceM'> {
  const p = feature.properties;
  const [lon, lat] = feature.geometry.coordinates;
  const street = p.street ? [p.street, p.housenumber].filter(Boolean).join(' ') : null;
  const name = p.name ?? street ?? p.district ?? p.city ?? '';
  const description = [street !== name ? street : null, p.district, p.city].filter(Boolean).join(', ') || null;
  return { id: `${p.osm_type ?? 'X'}${p.osm_id ?? `${lon},${lat}`}`, name, description, lat, lon };
}
