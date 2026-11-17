import type {
  AppliedZoneControl,
  GeoPoint,
  Zone,
  ZonePresence,
  ZoneReading,
  ZoneRepository,
  ZoneType,
} from '@hulajnogi/core';
import {
  zonesResource,
  type ListQuery,
  type ListResponse,
  type ZoneImpactRental,
  type ZoneListItem,
  type ZonePolygon,
} from '@hulajnogi/shared';
import { sql } from 'drizzle-orm';
import { runListQuery, type ListSource } from '../admin/list-query.js';
import type { DbExecutor } from '../client.js';
import { vZoneList } from '../schema/schema.js';

interface ZoneRow extends Record<string, unknown> {
  id: string;
  code: string;
  name: string;
  type: ZoneType;
  speed_limit_kmh: number | null;
}

type Row = Record<string, unknown>;
const toZone = (r: ZoneRow): Zone => ({
  id: r.id,
  code: r.code,
  name: r.name,
  type: r.type,
  speedLimitKmh: r.speed_limit_kmh,
});

type ZoneField = keyof typeof zonesResource.fields;

const listSource: ListSource<ZoneField> = {
  from: vZoneList,
  id: vZoneList.id,
  columns: {
    id: vZoneList.id,
    code: vZoneList.code,
    name: vZoneList.name,
    type: vZoneList.type,
    active: vZoneList.active,
    visibleInApp: vZoneList.visibleInApp,
    speedLimitKmh: vZoneList.speedLimitKmh,
    capacity: vZoneList.capacity,
    areaM2: vZoneList.areaM2,
    points: vZoneList.points,
    scootersInside: vZoneList.scootersInside,
    ridesInside: vZoneList.ridesInside,
    used: vZoneList.used,
    version: vZoneList.version,
    updatedAt: vZoneList.updatedAt,
    updatedByName: vZoneList.updatedByName,
  },
};

/** Strefa do zapisu: geometria w GeoJSON (`Polygon`), w bazie `MultiPolygon` (ADR 0047). */
export interface ZoneDraft {
  code: string;
  name: string;
  type: ZoneType;
  speedLimitKmh: number | null;
  capacity: number | null;
  visibleInApp: boolean;
  polygon: ZonePolygon;
}

export interface ZoneState {
  id: string;
  code: string;
  type: ZoneType;
  active: boolean;
  version: number;
}

/** Przejazd ze śledzeniem stref i ostatnią pozycją hulajnogi (ponowna ocena po zmianie stref). */
export interface TrackedRental {
  rentalId: string;
  scooterId: string;
  position: GeoPoint | null;
}

const geomSql = (polygon: ZonePolygon) =>
  sql`ST_Multi(ST_SetSRID(ST_GeomFromGeoJSON(${JSON.stringify(polygon)}), 4326))`;

/**
 * Moduł Strefy: geometrie stref, zapytania przestrzenne przez funkcje bazy (ADR 0026), bieżące strefy
 * hulajnóg w przejeździe i stan sterowania hulajnogą (ADR 0043, ADR 0044). Reguły geometrii zależne od
 * innych stref sprawdza baza (wyzwalacz `zones_rules`, migracja 0006).
 */
export class DrizzleZoneRepository implements ZoneRepository {
  constructor(private readonly db: DbExecutor) {}

  private async rows<T extends Row = Row>(query: ReturnType<typeof sql>): Promise<T[]> {
    return (await this.db.execute<T>(query)).rows as T[];
  }

  async findAt({ lat, lon }: GeoPoint): Promise<Zone[]> {
    const rows = await this.rows<ZoneRow>(
      sql`SELECT id, code, name, type, speed_limit_kmh FROM fn_zones_at_point(${lon}, ${lat})`,
    );
    return rows.map(toZone);
  }

  /** Strefy w promieniu od punktu z flagą „punkt w strefie” (histereza wyjazdu, ADR 0043). */
  async near({ lat, lon }: GeoPoint, radiusM: number): Promise<ZoneReading['near']> {
    const rows = await this.rows<ZoneRow & { inside: boolean }>(
      sql`SELECT id, code, name, type, speed_limit_kmh, inside FROM fn_zones_near_point(${lon}, ${lat}, ${radiusM})`,
    );
    return rows.map((r) => ({ zone: toZone(r), inside: r.inside }));
  }

  // --- Panel: lista, szczegóły, zapis --------------------------------------------------------

  list(query: ListQuery): Promise<ListResponse<ZoneListItem>> {
    return runListQuery<ZoneField, ZoneListItem>(this.db, zonesResource, listSource, query);
  }

  async listItem(id: string): Promise<ZoneListItem | null> {
    const result = await this.list({
      filters: [{ field: 'id', op: 'eq', values: [id] }],
      sort: [],
      page: 1,
      pageSize: 1,
      facets: [],
    });
    return result.items[0] ?? null;
  }

  async state(id: string, forUpdate = false): Promise<ZoneState | null> {
    const lock = forUpdate ? sql` FOR UPDATE` : sql``;
    const [row] = await this.rows(sql`SELECT id, code, type, active, version FROM zones WHERE id = ${id}${lock}`);
    return row
      ? {
          id: row.id as string,
          code: row.code as string,
          type: row.type as ZoneType,
          active: row.active as boolean,
          version: row.version as number,
        }
      : null;
  }

  /** Geometria strefy w GeoJSON z 6 miejscami po przecinku (około 0,1 m). */
  async geometry(id: string): Promise<{ type: 'MultiPolygon'; coordinates: number[][][][] } | null> {
    const [row] = await this.rows(sql`SELECT ST_AsGeoJSON(geom, 6) AS g FROM zones WHERE id = ${id}`);
    return row ? (JSON.parse(row.g as string) as { type: 'MultiPolygon'; coordinates: number[][][][] }) : null;
  }

  async insert(draft: ZoneDraft, staffId: string): Promise<string> {
    const [row] = await this.rows(sql`
      INSERT INTO zones (code, name, type, geom, speed_limit_kmh, capacity, visible_in_app, updated_by)
      VALUES (${draft.code}, ${draft.name}, ${draft.type}, ${geomSql(draft.polygon)}, ${draft.speedLimitKmh},
              ${draft.capacity}, ${draft.visibleInApp}, ${staffId})
      RETURNING id`);
    return row!.id as string;
  }

  /** Zapis z blokadą optymistyczną: `false`, gdy ktoś zmienił strefę w międzyczasie. */
  async update(id: string, version: number, draft: ZoneDraft, staffId: string): Promise<boolean> {
    const rows = await this.rows(sql`
      UPDATE zones SET code = ${draft.code}, name = ${draft.name}, type = ${draft.type}, geom = ${geomSql(draft.polygon)},
             speed_limit_kmh = ${draft.speedLimitKmh}, capacity = ${draft.capacity}, visible_in_app = ${draft.visibleInApp},
             updated_by = ${staffId}, updated_at = now(), version = version + 1
      WHERE id = ${id} AND version = ${version}
      RETURNING id`);
    return rows.length === 1;
  }

  async setActive(id: string, version: number, active: boolean, staffId: string): Promise<boolean> {
    const rows = await this.rows(sql`
      UPDATE zones SET active = ${active}, updated_by = ${staffId}, updated_at = now(), version = version + 1
      WHERE id = ${id} AND version = ${version}
      RETURNING id`);
    return rows.length === 1;
  }

  /** Usunięcie nieużytej strefy (`sp_delete_zone`; użyta kończy się błędem `ZONE_IN_USE`). */
  async delete(id: string): Promise<void> {
    await this.db.execute(sql`CALL sp_delete_zone(${id})`);
  }

  /** Przejazdy w trakcie w strefie albo w proponowanej geometrii (`fn_zone_change_impact`). */
  async impact(zoneId: string | null, polygon: ZonePolygon | null): Promise<ZoneImpactRental[]> {
    const geom = polygon ? geomSql(polygon) : sql`NULL::geometry`;
    const rows = await this.rows(sql`SELECT * FROM fn_zone_change_impact(${zoneId}::uuid, ${geom})`);
    return rows.map((r) => ({
      rentalId: r.rental_id as string,
      rentalNumber: Number(r.rental_number),
      scooterId: r.scooter_id as string,
      scooterNumber: r.scooter_number as number,
      userName: (r.user_name as string | null) ?? null,
      enteredAt: r.entered_at ? new Date(r.entered_at as string).toISOString() : null,
      speedKmh: r.speed_kmh === null ? null : Number(r.speed_kmh),
    }));
  }

  async endedRentals(id: string): Promise<number> {
    const [row] = await this.rows(sql`SELECT count(*)::int AS n FROM rentals WHERE end_zone_id = ${id}`);
    return row!.n as number;
  }

  /** Ostatnia zmiana stref (nagłówek `ETag` odpowiedzi `GET /zones`). */
  async revision(): Promise<string> {
    const [row] = await this.rows(
      sql`SELECT count(*)::int AS n, COALESCE(max(version), 0)::int AS v, max(updated_at) AS at FROM zones`,
    );
    return `${row!.n}-${row!.v}-${row!.at ? new Date(row!.at as string).getTime() : 0}`;
  }

  // --- Klient: najbliższa strefa parkowania, obszar działania -------------------------------------

  async nearestParking({ lat, lon }: GeoPoint): Promise<{
    id: string;
    code: string;
    name: string;
    distanceM: number;
    target: [number, number];
    anchor: [number, number];
  } | null> {
    const [row] = await this.rows(sql`SELECT * FROM fn_nearest_parking(${lon}, ${lat})`);
    return row
      ? {
          id: row.id as string,
          code: row.code as string,
          name: row.name as string,
          distanceM: Math.round(Number(row.distance_m)),
          target: [Number(row.target_lon), Number(row.target_lat)],
          anchor: [Number(row.anchor_lon), Number(row.anchor_lat)],
        }
      : null;
  }

  /** Prostokąt obszaru działania z zapasem (zawężenie wyszukiwania, ADR 0045): [minLon, minLat, maxLon, maxLat]. */
  async serviceAreaBbox(marginM: number): Promise<[number, number, number, number] | null> {
    const [row] = await this.rows(sql`
      SELECT ST_XMin(b) AS x1, ST_YMin(b) AS y1, ST_XMax(b) AS x2, ST_YMax(b) AS y2
      FROM (SELECT ST_Envelope(ST_Buffer(geom::geography, ${marginM})::geometry) AS b
            FROM zones WHERE active AND type = 'SERVICE_AREA') a`);
    return row ? [Number(row.x1), Number(row.y1), Number(row.x2), Number(row.y2)] : null;
  }

  // --- Bieżące strefy i sterowanie hulajnogi w przejeździe (ADR 0043, ADR 0044) -----------------

  /** Stan sterowania z blokadą wiersza; `null`, gdy śledzenie stref przejazdu się jeszcze nie zaczęło. */
  async control(scooterId: string): Promise<(AppliedZoneControl & { rentalId: string }) | null> {
    const [row] = await this.rows(sql`
      SELECT rental_id, speed_limit_kmh, limit_synced, stopped, stop_synced
      FROM scooter_zone_control WHERE scooter_id = ${scooterId} FOR UPDATE`);
    return row
      ? {
          rentalId: row.rental_id as string,
          speedLimitKmh: (row.speed_limit_kmh as number | null) ?? null,
          limitSynced: row.limit_synced as boolean,
          stopped: row.stopped as boolean,
          stopSynced: row.stop_synced as boolean,
        }
      : null;
  }

  /** Początek śledzenia stref przejazdu: hulajnoga bez limitu i z napędem. */
  async startTracking(scooterId: string, rentalId: string): Promise<void> {
    await this.db.execute(sql`
      INSERT INTO scooter_zone_control (scooter_id, rental_id) VALUES (${scooterId}, ${rentalId})
      ON CONFLICT (scooter_id) DO NOTHING`);
  }

  async presence(scooterId: string): Promise<ZonePresence[]> {
    const rows = await this.rows<ZoneRow & { entered_at: string; outside_count: number }>(sql`
      SELECT z.id, z.code, z.name, z.type, z.speed_limit_kmh, p.entered_at, p.outside_count
      FROM scooter_zone_presence p JOIN zones z ON z.id = p.zone_id
      WHERE p.scooter_id = ${scooterId} ORDER BY z.code`);
    return rows.map((r) => ({ zone: toZone(r), enteredAt: new Date(r.entered_at), outsideCount: r.outside_count }));
  }

  async savePresence(scooterId: string, rentalId: string, presence: readonly ZonePresence[]): Promise<void> {
    await this.db.execute(sql`DELETE FROM scooter_zone_presence WHERE scooter_id = ${scooterId}`);
    for (const p of presence) {
      await this.db.execute(sql`
        INSERT INTO scooter_zone_presence (scooter_id, zone_id, rental_id, entered_at, outside_count)
        VALUES (${scooterId}, ${p.zone.id}, ${rentalId}, ${p.enteredAt}, ${p.outsideCount})`);
    }
  }

  /** Wysłana komenda staje się stanem zastosowanym; potwierdzenie albo błąd zmienia tylko `*_synced`. */
  async applyControl(
    scooterId: string,
    change: { stopped?: boolean; stopCommandId?: string; speedLimitKmh?: number | null; limitCommandId?: string },
  ): Promise<void> {
    if (change.stopCommandId !== undefined) {
      await this.db.execute(sql`
        UPDATE scooter_zone_control SET stopped = ${change.stopped!}, stop_synced = true,
               stop_command_id = ${change.stopCommandId}, updated_at = now()
        WHERE scooter_id = ${scooterId}`);
    }
    if (change.limitCommandId !== undefined) {
      await this.db.execute(sql`
        UPDATE scooter_zone_control SET speed_limit_kmh = ${change.speedLimitKmh ?? null}, limit_synced = true,
               limit_command_id = ${change.limitCommandId}, updated_at = now()
        WHERE scooter_id = ${scooterId}`);
    }
  }

  /** Odrzucona albo niepotwierdzona komenda strefy: następny odczyt ją ponowi (ADR 0044). */
  async markControlFailed(commandId: string): Promise<void> {
    await this.db.execute(sql`
      UPDATE scooter_zone_control
      SET limit_synced = CASE WHEN limit_command_id = ${commandId} THEN false ELSE limit_synced END,
          stop_synced = CASE WHEN stop_command_id = ${commandId} THEN false ELSE stop_synced END,
          updated_at = now()
      WHERE limit_command_id = ${commandId} OR stop_command_id = ${commandId}`);
  }

  /** `lock` kasuje limit i zatrzymanie w hulajnodze (kontrakt MQTT 1.2.0), więc pauza zeruje stan zastosowany. */
  async resetControl(scooterId: string): Promise<void> {
    await this.db.execute(sql`
      UPDATE scooter_zone_control SET speed_limit_kmh = NULL, limit_synced = true, stopped = false, stop_synced = true,
             updated_at = now()
      WHERE scooter_id = ${scooterId}`);
  }

  /** Koniec przejazdu: hulajnoga przestaje być śledzona. */
  async stopTracking(rentalId: string): Promise<void> {
    await this.db.execute(sql`DELETE FROM scooter_zone_presence WHERE rental_id = ${rentalId}`);
    await this.db.execute(sql`DELETE FROM scooter_zone_control WHERE rental_id = ${rentalId}`);
  }

  /** Przejazdy ze śledzeniem stref z ostatnią pozycją hulajnogi (ponowna ocena po zmianie stref). */
  async trackedRentals(): Promise<TrackedRental[]> {
    const rows = await this.rows(sql`
      SELECT c.rental_id, c.scooter_id, ST_Y(s.position) AS lat, ST_X(s.position) AS lon
      FROM scooter_zone_control c JOIN scooters s ON s.id = c.scooter_id`);
    return rows.map((r) => ({
      rentalId: r.rental_id as string,
      scooterId: r.scooter_id as string,
      position: r.lat === null ? null : { lat: Number(r.lat), lon: Number(r.lon) },
    }));
  }
}

export interface ZoneFeature {
  type: 'Feature';
  id: string;
  geometry: { type: 'MultiPolygon'; coordinates: number[][][][] };
  properties: {
    code: string;
    name: string;
    type: ZoneType;
    speedLimitKmh: number | null;
    capacity: number | null;
    visibleInApp: boolean;
    /** Punkt wewnątrz strefy (`ST_PointOnSurface`): etykieta na mapie, cel symulatora (ADR 0046). */
    anchor: [number, number];
  };
}

/** Aktywne strefy jako GeoJSON do warstwy stref na mapie (panel, aplikacja, symulator). */
export async function activeZonesGeoJson(
  db: DbExecutor,
): Promise<{ type: 'FeatureCollection'; features: ZoneFeature[] }> {
  const { rows } = await db.execute<
    ZoneRow & { geometry: string; capacity: number | null; visible_in_app: boolean; ax: number; ay: number }
  >(
    sql`SELECT id, code, name, type, speed_limit_kmh, capacity, visible_in_app, ST_AsGeoJSON(geom, 6) AS geometry,
               ST_X(ST_PointOnSurface(geom)) AS ax, ST_Y(ST_PointOnSurface(geom)) AS ay
        FROM zones WHERE active ORDER BY CASE type WHEN 'SERVICE_AREA' THEN 0 ELSE 1 END, code`,
  );
  return {
    type: 'FeatureCollection',
    features: rows.map((r) => ({
      type: 'Feature',
      id: r.id,
      geometry: JSON.parse(r.geometry) as ZoneFeature['geometry'],
      properties: {
        code: r.code,
        name: r.name,
        type: r.type,
        speedLimitKmh: r.speed_limit_kmh,
        capacity: r.capacity,
        visibleInApp: r.visible_in_app,
        anchor: [Number(r.ax), Number(r.ay)],
      },
    })),
  };
}
