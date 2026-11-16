import type { GeoPoint, Zone, ZoneRepository, ZoneType } from '@hulajnogi/core';
import { sql } from 'drizzle-orm';
import type { DbExecutor } from '../client.js';

interface ZoneRow extends Record<string, unknown> {
  id: string;
  code: string;
  name: string;
  type: ZoneType;
  speed_limit_kmh: number | null;
}

/** Moduł Strefy: zapytania przestrzenne przez funkcję bazy `fn_zones_at_point` (ADR 0026). */
export class DrizzleZoneRepository implements ZoneRepository {
  constructor(private readonly db: DbExecutor) {}

  async findAt({ lat, lon }: GeoPoint): Promise<Zone[]> {
    const { rows } = await this.db.execute<ZoneRow>(
      sql`SELECT id, code, name, type, speed_limit_kmh FROM fn_zones_at_point(${lon}, ${lat})`,
    );
    return rows.map((r) => ({ id: r.id, code: r.code, name: r.name, type: r.type, speedLimitKmh: r.speed_limit_kmh }));
  }
}

export interface ZoneFeature {
  type: 'Feature';
  id: string;
  geometry: { type: 'MultiPolygon'; coordinates: number[][][][] };
  properties: { code: string; name: string; type: ZoneType; speedLimitKmh: number | null };
}

/** Aktywne strefy jako GeoJSON do warstwy stref na mapie (panel, od iteracji 3 aplikacja). */
export async function activeZonesGeoJson(
  db: DbExecutor,
): Promise<{ type: 'FeatureCollection'; features: ZoneFeature[] }> {
  const { rows } = await db.execute<ZoneRow & { geometry: string }>(
    sql`SELECT id, code, name, type, speed_limit_kmh, ST_AsGeoJSON(geom, 6) AS geometry
        FROM zones WHERE active ORDER BY CASE type WHEN 'SERVICE_AREA' THEN 0 ELSE 1 END, code`,
  );
  return {
    type: 'FeatureCollection',
    features: rows.map((r) => ({
      type: 'Feature',
      id: r.id,
      geometry: JSON.parse(r.geometry) as ZoneFeature['geometry'],
      properties: { code: r.code, name: r.name, type: r.type, speedLimitKmh: r.speed_limit_kmh },
    })),
  };
}
