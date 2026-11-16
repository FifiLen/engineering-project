import { Route, type Point } from './geo.js';

/**
 * Trasy rowerowe z OSRM (ADR 0017, profil bicycle z infra/osrm). Gdy OSRM nie odpowiada, hulajnoga
 * jedzie prosto do celu, żeby symulacja działała także bez przygotowanych danych mapy.
 */
export class RoutePlanner {
  private warned = false;

  constructor(
    private readonly baseUrl: string,
    private readonly fetchFn: typeof fetch = fetch,
  ) {}

  async route(from: Point, to: Point): Promise<Route> {
    try {
      const url = `${this.baseUrl}/route/v1/bike/${from.lon},${from.lat};${to.lon},${to.lat}?overview=full&geometries=geojson`;
      const res = await this.fetchFn(url, { signal: AbortSignal.timeout(3000) });
      const body = (await res.json()) as {
        code: string;
        routes?: Array<{ geometry: { coordinates: [number, number][] } }>;
      };
      const coords = body.routes?.[0]?.geometry.coordinates;
      if (body.code !== 'Ok' || !coords || coords.length < 2) throw new Error(`OSRM: ${body.code}`);
      return new Route([from, ...coords.map(([lon, lat]) => ({ lat, lon })), to]);
    } catch (error) {
      if (!this.warned)
        console.warn(`Brak trasy z OSRM (${(error as Error).message}); hulajnogi jadą w linii prostej.`);
      this.warned = true;
      return new Route([from, to]);
    }
  }
}
