/** Geometria symulatora (urządzenie nie korzysta z logiki backendu). */
export interface Point {
  lat: number;
  lon: number;
}

const EARTH_RADIUS_M = 6_371_008.8;
const rad = (deg: number) => (deg * Math.PI) / 180;
const deg = (r: number) => (r * 180) / Math.PI;

export function distanceM(a: Point, b: Point): number {
  const dLat = rad(b.lat - a.lat);
  const dLon = rad(b.lon - a.lon);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.sin(dLon / 2) ** 2;
  return 2 * EARTH_RADIUS_M * Math.asin(Math.min(1, Math.sqrt(h)));
}

/** Punkt w odległości `meters` od `from` w kierunku `azimuth` (radiany, 0 = północ). */
export function project(from: Point, meters: number, azimuth: number): Point {
  const d = meters / EARTH_RADIUS_M;
  const lat1 = rad(from.lat);
  const lon1 = rad(from.lon);
  const lat2 = Math.asin(Math.sin(lat1) * Math.cos(d) + Math.cos(lat1) * Math.sin(d) * Math.cos(azimuth));
  const lon2 =
    lon1 + Math.atan2(Math.sin(azimuth) * Math.sin(d) * Math.cos(lat1), Math.cos(d) - Math.sin(lat1) * Math.sin(lat2));
  return { lat: deg(lat2), lon: deg(lon2) };
}

/** Trasa jako łamana z narastającą odległością od początku. */
export class Route {
  readonly lengthM: number;
  private readonly cumulative: number[];

  constructor(readonly points: readonly Point[]) {
    if (points.length < 2) throw new Error('Trasa wymaga co najmniej dwóch punktów');
    this.cumulative = [0];
    for (let i = 1; i < points.length; i++)
      this.cumulative.push(this.cumulative[i - 1]! + distanceM(points[i - 1]!, points[i]!));
    this.lengthM = this.cumulative.at(-1)!;
  }

  /** Pozycja po przejechaniu `meters` od początku (na końcu trasy zostaje w ostatnim punkcie). */
  at(meters: number): Point {
    if (meters <= 0) return this.points[0]!;
    if (meters >= this.lengthM) return this.points.at(-1)!;
    let i = 1;
    while (this.cumulative[i]! < meters) i++;
    const a = this.points[i - 1]!;
    const b = this.points[i]!;
    const segment = this.cumulative[i]! - this.cumulative[i - 1]!;
    const t = segment === 0 ? 0 : (meters - this.cumulative[i - 1]!) / segment;
    return { lat: a.lat + (b.lat - a.lat) * t, lon: a.lon + (b.lon - a.lon) * t };
  }
}

/** Deterministyczny generator liczb pseudolosowych (ten sam co w danych startowych bazy). */
export function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
