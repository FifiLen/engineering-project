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
