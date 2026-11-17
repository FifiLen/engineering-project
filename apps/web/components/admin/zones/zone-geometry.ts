/**
 * Geometria w edytorze stref (ADR 0047): wielokąt z jednym pierścieniem [lon, lat], współrzędne z sześcioma
 * miejscami po przecinku. Walidacja na kliencie tylko podpowiada; ostatecznie rozstrzygają core i baza.
 */
import type { ZonePolygon } from '@hulajnogi/shared';
import type { MultiPolygon, Polygon, Position } from 'geojson';

export type Ring = Array<[number, number]>;

/** Najmniejsza powierzchnia strefy; kopia `MIN_ZONE_AREA_M2` z packages/core (podpowiedź przed zapisem). */
export const MIN_ZONE_AREA_M2 = 100;

const round6 = (n: number) => Math.round(n * 1e6) / 1e6;

/** Pierścień zamknięty, z zaokrąglonymi współrzędnymi i bez powtórzonych sąsiednich punktów. */
export function normalizeRing(coordinates: ReadonlyArray<Position>): Ring {
  const ring: Ring = [];
  for (const [lon, lat] of coordinates) {
    const point: [number, number] = [round6(lon!), round6(lat!)];
    const last = ring.at(-1);
    if (!last || last[0] !== point[0] || last[1] !== point[1]) ring.push(point);
  }
  if (ring.length > 0) {
    const [first, last] = [ring[0]!, ring.at(-1)!];
    if (first[0] !== last[0] || first[1] !== last[1]) ring.push([first[0], first[1]]);
  }
  return ring;
}

export function toZonePolygon(geometry: Polygon | ZonePolygon): ZonePolygon {
  return { type: 'Polygon', coordinates: [normalizeRing(geometry.coordinates[0] ?? [])] };
}

export const ringOf = (polygon: ZonePolygon): Ring => polygon.coordinates[0] ?? [];

/** Liczba punktów granicy (pierścień zamknięty ma pierwszy punkt powtórzony na końcu). */
export const pointCount = (polygon: ZonePolygon | null) => (polygon ? Math.max(0, ringOf(polygon).length - 1) : 0);

export const samePolygon = (a: ZonePolygon | null, b: ZonePolygon | null) => JSON.stringify(a) === JSON.stringify(b);

const EARTH_RADIUS_M = 6_371_008.8;
const rad = (deg: number) => (deg * Math.PI) / 180;

/** Powierzchnia pierścienia na sferze; ten sam wzór co `ringAreaM2` w packages/core. */
export function ringAreaM2(ring: ReadonlyArray<Position>): number {
  let sum = 0;
  for (let i = 0; i < ring.length - 1; i++) {
    const [lon1, lat1] = ring[i]!;
    const [lon2, lat2] = ring[i + 1]!;
    sum += rad(lon2! - lon1!) * (2 + Math.sin(rad(lat1!)) + Math.sin(rad(lat2!)));
  }
  return Math.abs((sum * EARTH_RADIUS_M * EARTH_RADIUS_M) / 2);
}

const haFormat = new Intl.NumberFormat('pl', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const haFormatLarge = new Intl.NumberFormat('pl', { maximumFractionDigits: 0 });
/** „0,42”, „7,07”, „3848”: duże obszary bez części ułamkowej, jak w makietach. */
export const formatHa = (m2: number) => (m2 >= 1_000_000 ? haFormatLarge : haFormat).format(m2 / 10_000);

type Point = readonly [number, number];

function orientation(a: Point, b: Point, c: Point): number {
  const value = (b[1] - a[1]) * (c[0] - b[0]) - (b[0] - a[0]) * (c[1] - b[1]);
  return value === 0 ? 0 : value > 0 ? 1 : 2;
}

function segmentsCross(p1: Point, q1: Point, p2: Point, q2: Point): boolean {
  const o1 = orientation(p1, q1, p2);
  const o2 = orientation(p1, q1, q2);
  const o3 = orientation(p2, q2, p1);
  const o4 = orientation(p2, q2, q1);
  return o1 !== o2 && o3 !== o4 && o1 !== 0 && o2 !== 0 && o3 !== 0 && o4 !== 0;
}

/** Punkt w pierścieniu (promień w kierunku wschodnim); punkt na krawędzi może wyjść w obie strony. */
export function pointInRing(point: Point, ring: ReadonlyArray<Position>): boolean {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [xi, yi] = ring[i] as [number, number];
    const [xj, yj] = ring[j] as [number, number];
    if (yi > point[1] !== yj > point[1] && point[0] < ((xj - xi) * (point[1] - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}

export const outerRings = (geometry: MultiPolygon | Polygon): Array<ReadonlyArray<Position>> =>
  geometry.type === 'Polygon' ? [geometry.coordinates[0] ?? []] : geometry.coordinates.map((p) => p[0] ?? []);

export function pointInGeometry(point: Point, geometry: MultiPolygon | Polygon): boolean {
  return outerRings(geometry).some((ring) => pointInRing(point, ring));
}

/** Czy wielokąty mają część wspólną (przecięcie krawędzi albo jeden wewnątrz drugiego); styk się nie liczy. */
export function ringsOverlap(a: ReadonlyArray<Position>, b: ReadonlyArray<Position>): boolean {
  const pa = a.map((p): Point => [p[0]!, p[1]!]);
  const pb = b.map((p): Point => [p[0]!, p[1]!]);
  for (let i = 0; i < pa.length - 1; i++) {
    for (let j = 0; j < pb.length - 1; j++) {
      if (segmentsCross(pa[i]!, pa[i + 1]!, pb[j]!, pb[j + 1]!)) return true;
    }
  }
  const shared = (p: Point, ring: Point[]) => ring.some((q) => q[0] === p[0] && q[1] === p[1]);
  return (
    (pa.length > 0 && pointInRing(pa[0]!, b) && !shared(pa[0]!, pb)) ||
    (pb.length > 0 && pointInRing(pb[0]!, a) && !shared(pb[0]!, pa))
  );
}

/** Usunięcie punktu `index` (bez powtórzonego punktu zamykającego); `null`, gdy zostałyby mniej niż 3 punkty. */
export function removeVertex(polygon: ZonePolygon, index: number): ZonePolygon | null {
  const open = ringOf(polygon).slice(0, -1);
  if (open.length <= 3) return null;
  open.splice(index, 1);
  return { type: 'Polygon', coordinates: [normalizeRing(open)] };
}

export function boundsOfPositions(points: ReadonlyArray<Position>): [[number, number], [number, number]] {
  const lons = points.map((p) => p[0]!);
  const lats = points.map((p) => p[1]!);
  return [
    [Math.min(...lons), Math.min(...lats)],
    [Math.max(...lons), Math.max(...lats)],
  ];
}
