/** Punkt w WGS 84 (SRID 4326). */
export interface GeoPoint {
  lat: number;
  lon: number;
}

export const ZONE_TYPES = ['SERVICE_AREA', 'PARKING', 'SLOW', 'NO_RIDE'] as const;
export type ZoneType = (typeof ZONE_TYPES)[number];

export interface Zone {
  id: string;
  code: string;
  name: string;
  type: ZoneType;
  speedLimitKmh: number | null;
}

/** Port: aktywne strefy zawierające punkt, od najbardziej restrykcyjnej (implementacja w packages/db). */
export interface ZoneRepository {
  findAt(point: GeoPoint): Promise<Zone[]>;
}

export interface PositionRules {
  insideServiceArea: boolean;
  /** Jazda dozwolona: w obszarze działania i poza strefą zakazu. */
  canRide: boolean;
  /** Zakończenie przejazdu dozwolone: w strefie parkowania i poza strefą zakazu. */
  canPark: boolean;
  /** Najniższy limit ze stref wolnej jazdy; `null`, gdy żadna nie obowiązuje. */
  speedLimitKmh: number | null;
}

/** Reguły stref dla pozycji hulajnogi lub użytkownika. */
export function evaluatePosition(zones: readonly Zone[]): PositionRules {
  const has = (type: ZoneType) => zones.some((z) => z.type === type);
  const insideServiceArea = has('SERVICE_AREA');
  const noRide = has('NO_RIDE');
  const limits = zones.filter((z) => z.type === 'SLOW' && z.speedLimitKmh !== null).map((z) => z.speedLimitKmh!);
  return {
    insideServiceArea,
    canRide: insideServiceArea && !noRide,
    canPark: has('PARKING') && !noRide,
    speedLimitKmh: limits.length ? Math.min(...limits) : null,
  };
}
