import { distanceM, type GeoPoint } from '@hulajnogi/core';
import type { Random } from './random.js';

/**
 * Geometria generatora w pamięci: strefy jako wielokąty z bazy (GeoJSON), test punktu w wielokącie i odległość od
 * brzegu w lokalnym układzie metrycznym. Na obszarze miasta (kilka km) przybliżenie płaskie ma błąd poniżej metra.
 */

const M_PER_DEG_LAT = 111_320;

export interface Polygon {
  /** Pierścienie [lon, lat]; pierwszy zewnętrzny, kolejne to otwory. */
  rings: Array<Array<[number, number]>>;
  bbox: { minLon: number; minLat: number; maxLon: number; maxLat: number };
}

/** Wielokąty z `ST_AsGeoJSON(geom)` typu MultiPolygon albo Polygon. */
export function parsePolygons(geojson: string): Polygon[] {
  const g = JSON.parse(geojson) as { type: string; coordinates: unknown };
  const polygons = (g.type === 'MultiPolygon' ? g.coordinates : [g.coordinates]) as Array<
    Array<Array<[number, number]>>
  >;
  return polygons.map((rings) => {
    const all = rings.flat();
    return {
      rings,
      bbox: {
        minLon: Math.min(...all.map((p) => p[0])),
        minLat: Math.min(...all.map((p) => p[1])),
        maxLon: Math.max(...all.map((p) => p[0])),
        maxLat: Math.max(...all.map((p) => p[1])),
      },
    };
  });
}

function insideRing(ring: ReadonlyArray<[number, number]>, lon: number, lat: number): boolean {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [xi, yi] = ring[i]!;
    const [xj, yj] = ring[j]!;
    if (yi > lat !== yj > lat && lon < ((xj - xi) * (lat - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}

export function insidePolygons(polygons: readonly Polygon[], p: GeoPoint): boolean {
  return polygons.some(
    (poly) =>
      p.lon >= poly.bbox.minLon &&
      p.lon <= poly.bbox.maxLon &&
      p.lat >= poly.bbox.minLat &&
      p.lat <= poly.bbox.maxLat &&
      insideRing(poly.rings[0]!, p.lon, p.lat) &&
      !poly.rings.slice(1).some((hole) => insideRing(hole, p.lon, p.lat)),
  );
}

const cross = (ax: number, ay: number, bx: number, by: number, cx: number, cy: number) =>
  (bx - ax) * (cy - ay) - (by - ay) * (cx - ax);

/** Odcinki AB i CD mają punkt wspólny (także styczny koniec); płaskie przybliżenie lon/lat jak w `insidePolygons`. */
function segmentsIntersect(a: [number, number], b: [number, number], c: [number, number], d: [number, number]) {
  const d1 = cross(c[0], c[1], d[0], d[1], a[0], a[1]);
  const d2 = cross(c[0], c[1], d[0], d[1], b[0], b[1]);
  const d3 = cross(a[0], a[1], b[0], b[1], c[0], c[1]);
  const d4 = cross(a[0], a[1], b[0], b[1], d[0], d[1]);
  if (((d1 > 0 && d2 < 0) || (d1 < 0 && d2 > 0)) && ((d3 > 0 && d4 < 0) || (d3 < 0 && d4 > 0))) return true;
  const on = (p: [number, number], q: [number, number], r: [number, number], v: number) =>
    v === 0 &&
    Math.min(p[0], q[0]) <= r[0] &&
    r[0] <= Math.max(p[0], q[0]) &&
    Math.min(p[1], q[1]) <= r[1] &&
    r[1] <= Math.max(p[1], q[1]);
  return on(c, d, a, d1) || on(c, d, b, d2) || on(a, b, c, d3) || on(a, b, d, d4);
}

/**
 * Odcinek PQ ma część wspólną z wielokątami: koniec wewnątrz albo przecięcie brzegu (pierścienia zewnętrznego lub
 * otworu). Generator odrzuca tak trasy przez strefę zakazu poza zamierzonymi przejazdami (ADR 0075).
 */
export function segmentTouchesPolygons(polygons: readonly Polygon[], p: GeoPoint, q: GeoPoint): boolean {
  if (insidePolygons(polygons, p) || insidePolygons(polygons, q)) return true;
  const a: [number, number] = [p.lon, p.lat];
  const b: [number, number] = [q.lon, q.lat];
  for (const poly of polygons) {
    const { bbox } = poly;
    if (Math.max(a[0], b[0]) < bbox.minLon || Math.min(a[0], b[0]) > bbox.maxLon) continue;
    if (Math.max(a[1], b[1]) < bbox.minLat || Math.min(a[1], b[1]) > bbox.maxLat) continue;
    for (const ring of poly.rings) {
      for (let i = 0; i + 1 < ring.length; i++) if (segmentsIntersect(a, b, ring[i]!, ring[i + 1]!)) return true;
    }
  }
  return false;
}

/** Odległość punktu od brzegu wielokątów w metrach (0 dla punktu na brzegu). */
export function distanceToBoundaryM(polygons: readonly Polygon[], p: GeoPoint): number {
  const mLon = M_PER_DEG_LAT * Math.cos((p.lat * Math.PI) / 180);
  let best = Infinity;
  for (const poly of polygons) {
    for (const ring of poly.rings) {
      for (let i = 0; i + 1 < ring.length; i++) {
        const ax = (ring[i]![0] - p.lon) * mLon;
        const ay = (ring[i]![1] - p.lat) * M_PER_DEG_LAT;
        const bx = (ring[i + 1]![0] - p.lon) * mLon;
        const by = (ring[i + 1]![1] - p.lat) * M_PER_DEG_LAT;
        const dx = bx - ax;
        const dy = by - ay;
        const len = dx * dx + dy * dy;
        const t = len === 0 ? 0 : Math.max(0, Math.min(1, -(ax * dx + ay * dy) / len));
        best = Math.min(best, Math.hypot(ax + t * dx, ay + t * dy));
      }
    }
  }
  return best;
}

/** Punkt przesunięty o `east`, `north` metrów. */
export function offset(p: GeoPoint, east: number, north: number): GeoPoint {
  return {
    lat: p.lat + north / M_PER_DEG_LAT,
    lon: p.lon + east / (M_PER_DEG_LAT * Math.cos((p.lat * Math.PI) / 180)),
  };
}

/** Losowy punkt w kole o promieniu `radiusM` (równomiernie po powierzchni). */
export function randomAround(random: Random, center: GeoPoint, radiusM: number): GeoPoint {
  const r = radiusM * Math.sqrt(random.next());
  const a = random.next() * 2 * Math.PI;
  return offset(center, r * Math.cos(a), r * Math.sin(a));
}

export const pathLengthM = (points: readonly GeoPoint[]): number =>
  points.slice(1).reduce((sum, p, i) => sum + distanceM(points[i]!, p), 0);

/** Punkt na łamanej w odległości `at` metrów od początku. */
export function pointAlong(points: readonly GeoPoint[], at: number): GeoPoint {
  let left = at;
  for (let i = 1; i < points.length; i++) {
    const a = points[i - 1]!;
    const b = points[i]!;
    const d = distanceM(a, b);
    if (left <= d || i === points.length - 1) {
      const t = d === 0 ? 0 : Math.max(0, Math.min(1, left / d));
      return { lat: a.lat + (b.lat - a.lat) * t, lon: a.lon + (b.lon - a.lon) * t };
    }
    left -= d;
  }
  return points[points.length - 1]!;
}

const coord = (n: number) => n.toFixed(7);
export const pointWkt = (p: GeoPoint): string => `POINT(${coord(p.lon)} ${coord(p.lat)})`;
export const lineWkt = (points: readonly GeoPoint[]): string =>
  `LINESTRING(${points.map((p) => `${coord(p.lon)} ${coord(p.lat)}`).join(', ')})`;
