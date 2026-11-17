import type { Pool, PoolClient } from 'pg';
import { priceRental, rideReceiptItems, type RentalPrice } from '@hulajnogi/core';
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
  /** Stawka robocza do sprawdzenia przez autora (pytanie 8, ADR 0052). */
  vatRate: 23,
} as const;

/** Doładowanie przykładowego klienta przed pierwszym przejazdem (przejazdy z danych startowych są rozliczone z portfela). */
const SAMPLE_TOPUP = 10_000;

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
  /** Przykładowe zakończone przejazdy (lista w panelu, historia w aplikacji); 0 = bez przejazdów. */
  sampleRentals?: number;
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

const bufferSql = `ST_Multi(ST_Buffer(ST_SetSRID(ST_MakePoint($1, $2), 4326)::geography, $3::float8, 'quad_segs=4')::geometry)`;

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
    [
      lon,
      lat,
      place.radiusM,
      place.code,
      place.name,
      place.type,
      place.speedLimitKmh ?? null,
      place.type === 'PARKING' ? (place.capacity ?? null) : null,
    ],
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
         free_reservation_minutes, min_wallet_balance, min_battery_pct, min_user_age, vat_rate, valid_from)
       SELECT $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, now()
       WHERE NOT EXISTS (SELECT 1 FROM tariffs WHERE version = $1)`,
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
        DEV_TARIFF.vatRate,
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
    if (!center)
      throw new Error(`Brak miejsca ${places.serviceArea.centerPlace} wskazanego jako środek obszaru działania`);
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

    if (options.sampleRentals) await seedSampleRentals(client, parking, options.sampleRentals);

    await client.query('COMMIT');
    const zones = await pool.query<{ count: string }>('SELECT count(*) FROM zones');
    const total = await pool.query<{ count: string }>('SELECT count(*) FROM scooters');
    return {
      zones: Number(zones.rows[0]!.count),
      scootersCreated: created,
      scootersTotal: Number(total.rows[0]!.count),
    };
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}

/** Klienci deweloperscy z przykładowymi przejazdami (numery z zakresu testowego, bez zgód na dokumenty). */
const SAMPLE_CUSTOMERS = [
  { phone: '+48500000101', name: 'Anna Kowalczyk' },
  { phone: '+48500000102', name: 'Piotr Zieliński' },
  { phone: '+48500000103', name: 'Karolina Mazur' },
] as const;

/**
 * Zakończone przejazdy między strefami parkowania z pełną osią czasu i komendami. Liczniki i kwota
 * pochodzą z wyceny w packages/core (ADR 0042), więc zgadzają się z tym, co policzyłby proces wypożyczenia.
 * Każdy klient dostaje doładowanie, a przejazdy są rozliczone z portfela z paragonem (pytanie 12 w planie
 * iteracji 5). Idempotentne: klienci, którzy mają już przejazdy, nie dostają nowych.
 */
async function seedSampleRentals(client: PoolClient, parking: readonly Place[], count: number): Promise<void> {
  const tariff = await client.query<{
    id: string;
    unlock_fee: string;
    minute_rate: string;
    pause_minute_rate: string;
    vat_rate: string;
  }>('SELECT id, unlock_fee, minute_rate, pause_minute_rate, vat_rate FROM tariffs WHERE version = $1', [
    DEV_TARIFF.version,
  ]);
  const rate = tariff.rows[0]!;
  const customers: string[] = [];
  for (const customer of SAMPLE_CUSTOMERS) {
    const row = await client.query<{ id: string; rentals: number }>(
      `INSERT INTO users (phone, name) VALUES ($1, $2)
       ON CONFLICT (phone) DO UPDATE SET name = EXCLUDED.name
       RETURNING id, (SELECT count(*)::int FROM rentals WHERE user_id = users.id) AS rentals`,
      [customer.phone, customer.name],
    );
    if (row.rows[0]!.rentals === 0) customers.push(row.rows[0]!.id);
  }
  if (!customers.length || parking.length < 2) return;

  const rand = mulberry32(2026);
  const scooters = await client.query<{ id: string }>(
    `SELECT id FROM scooters WHERE status = 'AVAILABLE' ORDER BY number LIMIT 10`,
  );
  const settled: Array<{ id: string; userId: string; price: RentalPrice; endedAt: Date }> = [];
  for (let i = 0; i < count; i++) {
    const from = requireCoords(parking[i % parking.length]!);
    const to = requireCoords(parking[(i + 1 + Math.floor(rand() * (parking.length - 1))) % parking.length]!);
    const rideSeconds = 240 + Math.floor(rand() * 1200);
    const pauseSeconds = i % 3 === 0 ? 60 + Math.floor(rand() * 300) : 0;
    const startedAt = new Date(Date.now() - (i + 1) * 26 * 3600_000 - Math.floor(rand() * 3600_000));
    const endRequestedAt = new Date(startedAt.getTime() + (rideSeconds + pauseSeconds) * 1000);
    const price = priceRental(
      {
        unlockFee: Number(rate.unlock_fee),
        minuteRate: Number(rate.minute_rate),
        pauseMinuteRate: Number(rate.pause_minute_rate),
      },
      { rideSeconds, pauseSeconds, startedAt },
    );
    const at = (date: Date, plusMs = 0) => new Date(date.getTime() + plusMs);
    const rental = await client.query<{ id: string }>(
      `INSERT INTO rentals (user_id, scooter_id, tariff_id, state, started_at, ended_at, ride_seconds, pause_seconds,
                            total_amount, start_position, end_position, route, distance_m, end_zone_id, created_at, updated_at)
       SELECT $1, $2, $3, 'ENDED', $4, $5, $6, $7, $8, a, b, ST_MakeLine(a, b), round(ST_Distance(a::geography, b::geography)),
              (SELECT id FROM fn_zones_at_point($11, $12) WHERE type = 'PARKING' LIMIT 1), $13, $5
       FROM ST_SetSRID(ST_MakePoint($9, $10), 4326) a, ST_SetSRID(ST_MakePoint($11, $12), 4326) b
       RETURNING id`,
      [
        customers[i % customers.length],
        scooters.rows[i % scooters.rows.length]!.id,
        rate.id,
        startedAt,
        at(endRequestedAt, 1500),
        rideSeconds,
        pauseSeconds,
        price.total,
        from.lon,
        from.lat,
        to.lon,
        to.lat,
        at(startedAt, -3000),
      ],
    );
    const id = rental.rows[0]!.id;
    settled.push({ id, userId: customers[i % customers.length]!, price, endedAt: at(endRequestedAt, 1500) });
    const events: Array<[string, string | null, string | null, Date, object]> = [
      ['STATE_CHANGED', null, 'UNLOCKING', at(startedAt, -3000), { action: 'START' }],
      ['STATE_CHANGED', 'UNLOCKING', 'ACTIVE', startedAt, { action: 'CONFIRM_UNLOCK' }],
    ];
    if (pauseSeconds) {
      const pausedAt = at(startedAt, Math.floor(rideSeconds / 2) * 1000);
      events.push(['STATE_CHANGED', 'ACTIVE', 'PAUSED', pausedAt, { action: 'PAUSE' }]);
      events.push(['STATE_CHANGED', 'PAUSED', 'ACTIVE', at(pausedAt, pauseSeconds * 1000), { action: 'RESUME' }]);
    }
    events.push(['END_REQUESTED', null, null, endRequestedAt, { resumeState: 'ACTIVE' }]);
    events.push(['STATE_CHANGED', 'ACTIVE', 'ENDING', endRequestedAt, { action: 'REQUEST_END' }]);
    events.push(['STATE_CHANGED', 'ENDING', 'ENDED', at(endRequestedAt, 1500), { action: 'COMPLETE_END' }]);
    for (const [type, fromState, toState, createdAt, data] of events) {
      await client.query(
        `INSERT INTO rental_events (rental_id, type, from_state, to_state, data, created_at) VALUES ($1, $2, $3, $4, $5, $6)`,
        [id, type, fromState, toState, JSON.stringify(data), createdAt],
      );
    }
    for (const [type, sentAt] of [
      ['UNLOCK', at(startedAt, -3000)],
      ['LOCK', endRequestedAt],
    ] as const) {
      await client.query(
        `INSERT INTO scooter_commands (scooter_id, rental_id, type, status, sent_at, acked_at, expires_at)
         SELECT scooter_id, id, $2, 'ACKED', $3, $3::timestamptz + interval '400 milliseconds', $3::timestamptz + interval '10 seconds'
         FROM rentals WHERE id = $1`,
        [id, type, sentAt],
      );
    }
  }
  await settleSampleRentals(client, settled, {
    unlockFee: Number(rate.unlock_fee),
    minuteRate: Number(rate.minute_rate),
    pauseMinuteRate: Number(rate.pause_minute_rate),
    vatRate: Number(rate.vat_rate),
  });
}

/**
 * Doładowanie (płatność atrapy `SUCCEEDED` i wpis `TOPUP`) przed pierwszym przejazdem, potem obciążenia
 * `RIDE_CHARGE` w kolejności zakończenia i paragony. Wpisy z datą przejazdu, więc dopisujemy je wprost
 * (wyzwalacz księgi sprawdza saldo po operacji), a pamięć podręczną salda naprawia `sp_rebuild_wallet_balances`.
 */
async function settleSampleRentals(
  client: PoolClient,
  rentals: Array<{ id: string; userId: string; price: RentalPrice; endedAt: Date }>,
  tariff: { unlockFee: number; minuteRate: number; pauseMinuteRate: number; vatRate: number },
): Promise<void> {
  const sorted = [...rentals].sort((a, b) => a.endedAt.getTime() - b.endedAt.getTime());
  const balances = new Map<string, number>();
  for (const rental of sorted) {
    if (!balances.has(rental.userId)) {
      const topupAt = new Date(rental.endedAt.getTime() - 2 * 3600_000);
      const payment = await client.query<{ id: string }>(
        `INSERT INTO payments (user_id, purpose, method, amount, status, provider, provider_payment_id, idempotency_key, created_at, updated_at)
         VALUES ($1::uuid, 'TOPUP', 'CARD', $2, 'SUCCEEDED', 'fake', 'pi_seed_' || md5($1::text), 'seed-topup-' || $1::text, $3, $3)
         RETURNING id`,
        [rental.userId, SAMPLE_TOPUP, topupAt],
      );
      await client.query(
        `INSERT INTO wallet_ledger (user_id, type, amount, balance_after, payment_id, created_at) VALUES ($1, 'TOPUP', $2, $2, $3, $4)`,
        [rental.userId, SAMPLE_TOPUP, payment.rows[0]!.id, topupAt],
      );
      balances.set(rental.userId, SAMPLE_TOPUP);
    }
    const balance = balances.get(rental.userId)! - rental.price.total;
    balances.set(rental.userId, balance);
    await client.query(
      `INSERT INTO wallet_ledger (user_id, type, amount, balance_after, rental_id, created_at) VALUES ($1, 'RIDE_CHARGE', $2, $3, $4, $5)`,
      [rental.userId, -rental.price.total, balance, rental.id, rental.endedAt],
    );
    const receipt = await client.query<{ receipt_id: string }>(
      `CALL sp_issue_receipt($1, 'SALE', $2, NULL, NULL, NULL, 'WALLET', $3::jsonb, $4::jsonb, NULL, NULL)`,
      [
        rental.userId,
        rental.id,
        JSON.stringify({ name: '[dane sprzedawcy]', address: null, taxId: null }),
        JSON.stringify(rideReceiptItems(rental.price, tariff, tariff.vatRate)),
      ],
    );
    await client.query(`UPDATE receipts SET issued_at = $2 WHERE id = $1`, [
      receipt.rows[0]!.receipt_id,
      rental.endedAt,
    ]);
  }
  await client.query(`CALL sp_rebuild_wallet_balances(NULL)`);
}
