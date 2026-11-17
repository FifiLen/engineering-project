/**
 * Strefy w części wirtualnego klienta (ADR 0046): to, co klient widzi w aplikacji, czyli publiczne
 * `GET /zones` z API. Część hulajnogi (`virtual-scooter.ts`) stref nie zna i reaguje tylko na komendy MQTT.
 * Plik miejsc z danych startowych jest zapasem, gdy API nie działa.
 */
import { readFileSync } from 'node:fs';
import { ZONE_TYPES, type ZoneType } from '@hulajnogi/shared';
import { z } from 'zod';
import { project, type Point } from './geo.js';

/** Odpytywanie `GET /zones` z `If-None-Match` (ADR 0046). */
export const ZONES_REFRESH_MS = 60_000;
const ZONES_TIMEOUT_MS = 3000;
/** Wierzchołki okręgu strefy zapasowej z pliku miejsc. */
const CIRCLE_VERTICES = 32;

/** Wielokąt jako pierścienie [lon, lat]: pierwszy zewnętrzny, kolejne to otwory (GeoJSON). */
type Polygon = Array<Array<[number, number]>>;

export interface Zone {
  code: string;
  name: string;
  type: ZoneType;
  speedLimitKmh: number | null;
  /** Punkt wewnątrz strefy (`ST_PointOnSurface` w API): cel jazdy do strefy. */
  anchor: Point;
  polygons: Polygon[];
}

/** Strefy dla wirtualnego klienta: bieżący zbiór i odświeżenie przed planowaniem trasy. */
export interface ZoneProvider {
  readonly zones: readonly Zone[];
  refresh(): Promise<void>;
}

const position = z
  .array(z.number())
  .min(2)
  .transform((p): [number, number] => [p[0]!, p[1]!]);
const polygon = z.array(z.array(position).min(4)).min(1);
const featureCollectionSchema = z.object({
  type: z.literal('FeatureCollection'),
  features: z.array(
    z.object({
      geometry: z.discriminatedUnion('type', [
        z.object({ type: z.literal('MultiPolygon'), coordinates: z.array(polygon) }),
        z.object({ type: z.literal('Polygon'), coordinates: polygon }),
      ]),
      properties: z.object({
        code: z.string(),
        name: z.string(),
        type: z.string(),
        speedLimitKmh: z.number().nullable().optional(),
        anchor: z.tuple([z.number(), z.number()]),
      }),
    }),
  ),
});

const isZoneType = (type: string): type is ZoneType => (ZONE_TYPES as readonly string[]).includes(type);

/** Odpowiedź `GET /zones` (GeoJSON FeatureCollection); strefy nieznanego rodzaju są pomijane. */
export function parseZones(body: unknown): Zone[] {
  return featureCollectionSchema.parse(body).features.flatMap(({ geometry, properties: p }) => {
    if (!isZoneType(p.type)) return [];
    return [
      {
        code: p.code,
        name: p.name,
        type: p.type,
        speedLimitKmh: p.speedLimitKmh ?? null,
        anchor: { lon: p.anchor[0], lat: p.anchor[1] },
        polygons: geometry.type === 'MultiPolygon' ? geometry.coordinates : [geometry.coordinates],
      },
    ];
  });
}

interface PlacesFile {
  serviceArea: { code: string; name: string; centerPlace: string; radiusM: number };
  places: Array<{
    code: string;
    name: string;
    type: string;
    radiusM: number;
    speedLimitKmh?: number;
    lat?: number;
    lon?: number;
  }>;
}

function circle(center: Point, radiusM: number): Polygon {
  const ring = Array.from({ length: CIRCLE_VERTICES }, (_, i): [number, number] => {
    const p = project(center, radiusM, (i / CIRCLE_VERTICES) * 2 * Math.PI);
    return [p.lon, p.lat];
  });
  return [[...ring, ring[0]!]];
}

/**
 * Strefy zapasowe z pliku miejsc (te same okręgi co w danych startowych bazy): obszar działania wokół
 * `centerPlace` i miejsca ze sprawdzonymi współrzędnymi. Nie zawierają zmian z panelu.
 */
export function loadPlaceZones(path: string): Zone[] {
  const file = JSON.parse(readFileSync(path, 'utf8')) as PlacesFile;
  const located = file.places.filter((p) => p.lat !== undefined && p.lon !== undefined && isZoneType(p.type));
  const zone = (code: string, name: string, type: ZoneType, center: Point, radiusM: number, kmh?: number): Zone => ({
    code,
    name,
    type,
    speedLimitKmh: kmh ?? null,
    anchor: center,
    polygons: [circle(center, radiusM)],
  });
  const zones = located.map((p) =>
    zone(p.code, p.name, p.type as ZoneType, { lat: p.lat!, lon: p.lon! }, p.radiusM, p.speedLimitKmh),
  );
  const center = located.find((p) => p.code === file.serviceArea.centerPlace);
  if (center) {
    const { code, name, radiusM } = file.serviceArea;
    zones.unshift(zone(code, name, 'SERVICE_AREA', { lat: center.lat!, lon: center.lon! }, radiusM));
  }
  return zones;
}

/** Punkt w pierścieniu: zwykły ray casting na [lon, lat] (strefy miejskie są małe, krzywizna nie ma znaczenia). */
function inRing(point: Point, ring: ReadonlyArray<[number, number]>): boolean {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [xi, yi] = ring[i]!;
    const [xj, yj] = ring[j]!;
    if (yi > point.lat !== yj > point.lat && point.lon < ((xj - xi) * (point.lat - yi)) / (yj - yi) + xi) {
      inside = !inside;
    }
  }
  return inside;
}

export function zoneContains(zone: Zone, point: Point): boolean {
  return zone.polygons.some(
    ([outer, ...holes]) => outer !== undefined && inRing(point, outer) && !holes.some((h) => inRing(point, h)),
  );
}

/**
 * Czy wolno tu jechać: wewnątrz obszaru działania i poza strefą zakazu. Ta sama reguła co
 * `desiredZoneControl` w backendzie, ale liczona na strefach widocznych dla klienta.
 */
export function canRideAt(zones: readonly Zone[], point: Point): boolean {
  const inArea = zones.some((z) => z.type === 'SERVICE_AREA' && zoneContains(z, point));
  return inArea && !zones.some((z) => z.type === 'NO_RIDE' && zoneContains(z, point));
}

/** Strefa o kodzie z `control goto` (bez rozróżniania wielkości liter). */
export function findZone(zones: readonly Zone[], code: string): Zone | undefined {
  const wanted = code.toUpperCase();
  return zones.find((z) => z.code.toUpperCase() === wanted);
}

/**
 * Cel jazdy po odblokowaniu (ADR 0046): `anchor` losowej strefy parkowania innej niż ta, w której hulajnoga
 * stoi, żeby jazda była widoczna na mapie, a próba zakończenia w drodze trafiała poza strefę.
 */
export function rideDestination(zones: readonly Zone[], from: Point, random: () => number): Zone | null {
  const parking = zones.filter((z) => z.type === 'PARKING');
  const elsewhere = parking.filter((z) => !zoneContains(z, from));
  const candidates = elsewhere.length ? elsewhere : parking;
  return candidates[Math.floor(random() * candidates.length)] ?? null;
}

/** Strefy bez odpytywania API (testy). */
export const staticZones = (zones: readonly Zone[]): ZoneProvider => ({ zones, refresh: async () => undefined });

export interface ZoneSourceOptions {
  apiUrl: string;
  /** Strefy z pliku miejsc do pierwszej udanej odpowiedzi API. */
  fallback: readonly Zone[];
  fetchFn?: typeof fetch;
  log?: (message: string) => void;
  warn?: (message: string) => void;
}

/**
 * Strefy z `GET /zones` (ADR 0046): przy starcie, przed planowaniem każdej trasy i co minutę, z `ETag`
 * i `If-None-Match`, więc niezmienione strefy kosztują odpowiedź 304 bez treści. Gdy API nie odpowiada,
 * zostają ostatnie znane strefy (na starcie plik miejsc) z jednym ostrzeżeniem w logu.
 */
export class ZoneSource implements ZoneProvider {
  private current: readonly Zone[];
  private etag: string | null = null;
  private inFlight: Promise<void> | null = null;
  private failing = false;
  private readonly fetchFn: typeof fetch;
  private readonly log: (message: string) => void;
  private readonly warn: (message: string) => void;

  constructor(private readonly options: ZoneSourceOptions) {
    this.current = options.fallback;
    this.fetchFn = options.fetchFn ?? fetch;
    this.log = options.log ?? console.log;
    this.warn = options.warn ?? console.warn;
  }

  get zones(): readonly Zone[] {
    return this.current;
  }

  /** Strefy pochodzą z API (a nie z pliku miejsc). */
  get fromApi(): boolean {
    return this.etag !== null;
  }

  /** Jedno zapytanie naraz; równoległe wywołania czekają na to samo. Nigdy nie kończy się błędem. */
  refresh(): Promise<void> {
    this.inFlight ??= this.fetchZones().finally(() => (this.inFlight = null));
    return this.inFlight;
  }

  /** Odpytywanie co `intervalMs`; zwraca funkcję zatrzymującą. */
  watch(intervalMs = ZONES_REFRESH_MS): () => void {
    const timer = setInterval(() => void this.refresh(), intervalMs);
    return () => clearInterval(timer);
  }

  private async fetchZones(): Promise<void> {
    try {
      const res = await this.fetchFn(`${this.options.apiUrl.replace(/\/$/, '')}/zones`, {
        headers: this.etag ? { 'If-None-Match': this.etag } : {},
        signal: AbortSignal.timeout(ZONES_TIMEOUT_MS),
      });
      if (res.status === 304 && this.etag) {
        this.failing = false;
        return;
      }
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      this.current = parseZones(await res.json());
      // Bez nagłówka ETag zapamiętujemy znacznik zastępczy, żeby `fromApi` mówiło prawdę; 304 i tak nie przyjdzie.
      this.etag = res.headers.get('etag') ?? '';
      this.failing = false;
      this.log(`Strefy z API (${this.current.length}): ${this.current.map((z) => z.code).join(', ')}.`);
    } catch (error) {
      if (!this.failing) {
        const kept = this.fromApi ? 'zostają ostatnie strefy z API' : 'symulator korzysta z pliku miejsc';
        this.warn(`Brak stref z API ${this.options.apiUrl} (${(error as Error).message}); ${kept}.`);
      }
      this.failing = true;
    }
  }
}
