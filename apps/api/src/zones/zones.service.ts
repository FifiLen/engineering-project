import { Inject, Injectable } from '@nestjs/common';
import type { Pool } from 'pg';
import { DB_POOL } from '../database/database.module.js';

export interface ZoneAtPoint {
  code: string;
  name: string;
  type: 'SERVICE_AREA' | 'PARKING' | 'SLOW' | 'NO_RIDE';
  speedLimitKmh: number | null;
}

@Injectable()
export class ZonesService {
  constructor(@Inject(DB_POOL) private readonly pool: Pool) {}

  /** Aktywne strefy zawierające punkt; zapytanie korzysta z indeksu GiST (ADR 0010). */
  async findAt(lat: number, lon: number): Promise<ZoneAtPoint[]> {
    const { rows } = await this.pool.query<ZoneAtPoint>(
      `SELECT code, name, type, speed_limit_kmh AS "speedLimitKmh"
         FROM zones
        WHERE active AND ST_Contains(geom, ST_SetSRID(ST_MakePoint($1, $2), 4326))
        ORDER BY CASE type WHEN 'NO_RIDE' THEN 0 WHEN 'SLOW' THEN 1 WHEN 'PARKING' THEN 2 ELSE 3 END, code`,
      [lon, lat],
    );
    return rows;
  }
}
