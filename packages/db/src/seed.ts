import type { Pool, PoolClient } from 'pg';
import type { Place, PlacesFile } from './places.js';

/**
 * Wartości deweloperskie cennika. To NIE są decyzje biznesowe (w makietach nadal [CENA] itd.),
 * tylko liczby pozwalające uruchomić przepływy. Kwoty w groszach (ADR 0014).
 */
export const DEV_TARIFF = {
  version: 1,
  unlockFee: 300,
  minuteRate: 80,
  pauseMinuteRate: 30,
  outOfZoneFee: 2000,
  freeReservationMinutes: 10,
  minWalletBalance: 1000,
  minBatteryPct: 15,
  minUserAge: 18,
} as const;

export interface SeedStaff {
  email: string;
  name: string;
  /** Nazwa roli systemowej z migracji 0002 (Administrator, Dyspozytor, Serwisant). */
  role: string;
  passwordHash: string;
}

/** Dokument z wersjami (ADR 0027); dane startowe zakładają wersję 1 jako obowiązującą. */
export interface SeedDocument {
  slug: string;
  name: string;
  consentType: 'TERMS' | 'PRIVACY' | null;
  title: string;
  bodyMd: string;
}

export interface SeedOptions {
  places: PlacesFile;
  fleetSize: number;
  admin: { email: string; name: string; passwordHash: string };
  /** Dodatkowi operatorzy deweloperscy (demo ról i uprawnień). */
  staff?: readonly SeedStaff[];
  documents?: readonly SeedDocument[];
}

export interface SeedSummary {
  zones: number;
  scootersCreated: number;
  scootersTotal: number;
}

const VARIANTS = ['GRAFIT', 'GRAFIT', 'BETON', 'KOBALT'] as const;

/** Deterministyczny generator liczb pseudolosowych, żeby dane startowe były powtarzalne. */
function mulberry32(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const bufferSql = `ST_Multi(ST_Buffer(ST_SetSRID(ST_MakePoint($1, $2), 4326)::geography, $3::float8, 'quad_segs=16')::geometry)`;

function requireCoords(place: Place): { lat: number; lon: number } {
  if (place.lat === undefined || place.lon === undefined) {
    throw new Error(`Miejsce ${place.code} (${place.name}) nie ma współrzędnych. Uruchom: pnpm db:places`);
  }
  return { lat: place.lat, lon: place.lon };
}

async function upsertZone(client: PoolClient, place: Place) {
  const { lat, lon } = requireCoords(place);
  await client.query(
    `INSERT INTO zones (code, name, type, geom, speed_limit_kmh, capacity)
     VALUES ($4, $5, $6, ${bufferSql}, $7, $8)
     ON CONFLICT (code) DO UPDATE SET
       name = EXCLUDED.name, type = EXCLUDED.type, geom = EXCLUDED.geom,
       speed_limit_kmh = EXCLUDED.speed_limit_kmh, capacity = EXCLUDED.capacity, updated_at = now()`,
    [lon, lat, place.radiusM, place.code, place.name, place.type, place.speedLimitKmh ?? null, place.type === 'PARKING' ? (place.capacity ?? null) : null],
  );
}

/** Zakłada lub aktualizuje dane startowe. Można uruchamiać wielokrotnie. */
export async function seedDatabase(pool: Pool, options: SeedOptions): Promise<SeedSummary> {
  const { places, fleetSize, admin } = options;
  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    await client.query(
      `INSERT INTO tariffs (version, unlock_fee, minute_rate, pause_minute_rate, out_of_zone_fee,
         free_reservation_minutes, min_wallet_balance, min_battery_pct, min_user_age, valid_from)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, now())
       ON CONFLICT (version) DO NOTHING`,
      [
        DEV_TARIFF.version,
        DEV_TARIFF.unlockFee,
        DEV_TARIFF.minuteRate,
        DEV_TARIFF.pauseMinuteRate,
        DEV_TARIFF.outOfZoneFee,
        DEV_TARIFF.freeReservationMinutes,
        DEV_TARIFF.minWalletBalance,
        DEV_TARIFF.minBatteryPct,
        DEV_TARIFF.minUserAge,
      ],
    );

    await client.query(
      `INSERT INTO staff (email, name, password_hash) VALUES ($1, $2, $3)
       ON CONFLICT (email) DO NOTHING`,
      [admin.email, admin.name, admin.passwordHash],
    );
    // Rola systemowa Administrator powstaje w migracji 0002 (ADR 0028).
    await client.query(
      `INSERT INTO staff_roles (staff_id, role_id)
       SELECT s.id, r.id FROM staff s, roles r WHERE s.email = $1 AND r.name = 'Administrator' AND r.is_system
       ON CONFLICT DO NOTHING`,
      [admin.email],
    );

    for (const member of options.staff ?? []) {
      await client.query(
        `INSERT INTO staff (email, name, password_hash) VALUES ($1, $2, $3) ON CONFLICT (email) DO NOTHING`,
        [member.email, member.name, member.passwordHash],
      );
      await client.query(
        `INSERT INTO staff_roles (staff_id, role_id)
         SELECT s.id, r.id FROM staff s, roles r WHERE s.email = $1 AND r.name = $2
         ON CONFLICT DO NOTHING`,
        [member.email, member.role],
      );
    }

    // Dokument, który już istnieje, zostaje bez zmian: jego wersje zmienia się w panelu.
    for (const doc of options.documents ?? []) {
      const page = await client.query<{ id: string }>(
        `INSERT INTO content_pages (slug, name, consent_type) VALUES ($1, $2, $3)
         ON CONFLICT (slug) DO NOTHING RETURNING id`,
        [doc.slug, doc.name, doc.consentType],
      );
      if (page.rows[0]) {
        await client.query(
          `INSERT INTO content_page_versions (page_id, version_no, title, body_md, status, published_at)
           VALUES ($1, 1, $2, $3, 'PUBLISHED', now())`,
          [page.rows[0].id, doc.title, doc.bodyMd],
        );
      }
    }

    const center = places.places.find((p) => p.code === places.serviceArea.centerPlace);
    if (!center) throw new Error(`Brak miejsca ${places.serviceArea.centerPlace} wskazanego jako środek obszaru działania`);
    const c = requireCoords(center);
    await upsertZone(client, {
      code: places.serviceArea.code,
      name: places.serviceArea.name,
      query: '',
      type: 'SERVICE_AREA' as Place['type'],
      radiusM: places.serviceArea.radiusM,
      lat: c.lat,
      lon: c.lon,
    });
    for (const place of places.places) await upsertZone(client, place);

    const parking = places.places.filter((p) => p.type === 'PARKING');
    const existing = await client.query<{ number: number }>('SELECT number FROM scooters');
    const taken = new Set(existing.rows.map((r) => r.number));
    let created = 0;
    for (let n = 1; n <= fleetSize; n++) {
      if (taken.has(n)) continue;
      const rand = mulberry32(n * 7919);
      const hub = parking[n % parking.length]!;
      const { lat, lon } = requireCoords(hub);
      const distance = 20 + rand() * 180;
      const azimuth = rand() * 2 * Math.PI;
      const battery = n % 9 === 0 ? 8 + Math.floor(rand() * 10) : 35 + Math.floor(rand() * 65);
      await client.query(
        `INSERT INTO scooters (number, serial_number, variant, model_id, status, online, battery_pct, position, firmware)
         VALUES ($1, $2, $3, (SELECT id FROM scooter_models WHERE code = 'BASE'), 'AVAILABLE', false, $4,
                 ST_Project(ST_SetSRID(ST_MakePoint($5, $6), 4326)::geography, $7::float8, $8::float8)::geometry, 'v2.4.1')`,
        [n, `SC-26-${String(n).padStart(4, '0')}`, VARIANTS[n % VARIANTS.length], battery, lon, lat, distance, azimuth],
      );
      created++;
    }

    await client.query('COMMIT');
    const zones = await pool.query<{ count: string }>('SELECT count(*) FROM zones');
    const total = await pool.query<{ count: string }>('SELECT count(*) FROM scooters');
    return { zones: Number(zones.rows[0]!.count), scootersCreated: created, scootersTotal: Number(total.rows[0]!.count) };
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}
