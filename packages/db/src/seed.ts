import type { Pool, PoolClient } from 'pg';
import { priceRental, rideReceiptItems, type RentalPrice } from '@hulajnogi/core';
import type { Place, PlacesFile } from './places.js';
import { seedContent, type SeedContentFiles } from './seed-content.js';

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

/**
 * Części zamienne z makiety magazynu (`27-panel-serwis/czesci-magazyn`). Ceny (grosze), stany i minima to wartości
 * deweloperskie (pytanie 11 w planie iteracji 6). Stan początkowy zakłada przyjęcie dostawy (`sp_part_receive`),
 * więc suma ruchów magazynowych zgadza się ze stanem.
 */
export const DEV_SPARE_PARTS = [
  { sku: 'BRK-PAD-R', name: 'Klocki hamulcowe tylne (para)', unitCost: 2400, stock: 12, minStock: 10 },
  { sku: 'BRK-CBL-R', name: 'Linka hamulca tylnego', unitCost: 1250, stock: 13, minStock: 5 },
  { sku: 'TIRE-10', name: 'Opona pełna 10"', unitCost: 8900, stock: 3, minStock: 6 },
  { sku: 'LGT-R', name: 'Lampa tylna LED', unitCost: 3200, stock: 1, minStock: 4 },
  { sku: 'BAT-36V', name: 'Akumulator 36 V 10 Ah', unitCost: 69_000, stock: 4, minStock: 3 },
  { sku: 'LGT-F', name: 'Lampa przednia LED', unitCost: 4500, stock: 7, minStock: 4 },
  { sku: 'GRIP-P', name: 'Manetki (para)', unitCost: 1800, stock: 9, minStock: 4 },
  { sku: 'QR-LBL', name: 'Naklejka z kodem QR', unitCost: 120, stock: 140, minStock: 50 },
] as const;

/**
 * Szablony powiadomień w języku polskim (ICU MessageFormat, ADR 0058). Kody i parametry wyznacza rejestr
 * w packages/shared; panel zmienia tylko treść. Istniejący szablon zostaje bez zmian (jego wersje zmienia się
 * w panelu), a wersję 1 zapisuje wyzwalacz `notification_templates_version`. Kwoty, numery przejazdów, hulajnóg
 * i zgłoszeń formatuje API przed renderowaniem. Kod SMS odpowiada tekstowi z `apps/api/src/auth` sprzed iteracji 6.
 */
export const DEV_NOTIFICATION_TEMPLATES = [
  {
    code: 'reservation_ending',
    channel: 'PUSH',
    title: 'Rezerwacja się kończy',
    body: 'Rezerwacja hulajnogi {scooterNumber} wygasa za {minutesLeft, plural, one {# minutę} few {# minuty} many {# minut} other {# minuty}}. Zeskanuj kod QR, żeby ruszyć.',
    description:
      'Wysyłany przed końcem bezpłatnej rezerwacji, gdy klient ma włączone „Koniec rezerwacji”. Parametry: scooterNumber, minutesLeft.',
  },
  {
    code: 'ride_ended',
    channel: 'PUSH',
    title: 'Przejazd zakończony',
    // Opłata za odholowanie osobno (ADR 0060); limit treści push to 240 znaków źródła.
    body: 'Przejazd {rideNumber} trwał {minutes, plural, one {# minutę} few {# minuty} other {# minut}}. Koszt: {amount}{hasTowingFee, select, true { (odholowanie {towingFee})} other {}}. {hasReceipt, select, true {Paragon w aplikacji.} other {}}',
    description:
      'Wysyłany po rozliczeniu przejazdu, gdy klient ma włączone „Paragony”. Parametry: rideNumber, minutes, amount, hasReceipt, towingFee, hasTowingFee.',
  },
  {
    code: 'payment_failed',
    channel: 'PUSH',
    title: 'Płatność nieudana',
    body: 'Nie udało się pobrać {amount} za przejazd {rideNumber}. Spłać zaległość w aplikacji, żeby wypożyczyć kolejną hulajnogę.',
    description: 'Wysyłany po odmowie obciążenia karty za przejazd (zaległość). Parametry: rideNumber, amount.',
  },
  {
    code: 'battery_low',
    channel: 'PUSH',
    title: 'Niska bateria',
    body: 'Bateria hulajnogi {scooterNumber}: {batteryPct}%. Zakończ przejazd w najbliższej strefie parkowania.',
    description:
      'Wysyłany w trakcie jazdy po spadku baterii poniżej progu z cennika. Parametry: scooterNumber, batteryPct.',
  },
  {
    code: 'ticket_received',
    channel: 'PUSH',
    title: 'Otrzymaliśmy zgłoszenie',
    body: 'Zgłoszenie {ticketNumber} dotyczące hulajnogi {scooterNumber} jest u nas. Damy znać, gdy coś się zmieni.',
    description: 'Wysyłany po przyjęciu zgłoszenia od klienta. Parametry: ticketNumber, scooterNumber.',
  },
  {
    code: 'ticket_status_changed',
    channel: 'PUSH',
    title: 'Twoje zgłoszenie',
    body: 'Zgłoszenie {ticketNumber}: {status, select, IN_PROGRESS {zajmujemy się nim} AT_SERVICE {hulajnoga jest w serwisie} RESOLVED {rozwiązane} other {nowy status}}. {reply}',
    description:
      'Wysyłany przy zmianie statusu zgłoszenia z odpowiedzią dla klienta. Parametry: ticketNumber, status, reply.',
  },
  {
    code: 'login_code',
    channel: 'SMS',
    title: null,
    body: '[nazwa]: {code} to Twój kod logowania. Nie podawaj go nikomu.',
    description: 'SMS z kodem logowania do aplikacji. Parametry: code.',
  },
  {
    code: 'data_export_ready',
    channel: 'PUSH',
    title: 'Twoje dane są gotowe',
    body: 'Plik z Twoimi danymi jest gotowy do pobrania do {expiresAt}. Znajdziesz go w ustawieniach aplikacji: Pobierz moje dane.',
    description:
      'Wysyłany po przygotowaniu eksportu danych klienta (ADR 0069), zawsze, bez preferencji. Parametry: expiresAt.',
  },
] as const;

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
  /** Przykładowe zgłoszenia i zadania serwisowe (iteracja 6), tylko w bazie bez zgłoszeń. */
  sampleOperations?: boolean;
  /**
   * Grafiki biblioteki i szablony startowe DOCX z magazynem plików (iteracja 7). Bez nich seed zakłada treści
   * (sekcje, FAQ, aktualności) bez grafik i bez szablonów wydruków, np. w testach API bez magazynu.
   */
  contentFiles?: SeedContentFiles;
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

    await seedSpareParts(client);
    await seedNotificationTemplates(client);
    if (options.sampleOperations) await seedSampleOperations(client, admin.email);
    await seedContent(client, options.contentFiles);

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

/** Części zamienne: nowa część dostaje stan przyjęciem dostawy; istniejąca zostaje bez zmian (magazyn prowadzi panel). */
async function seedSpareParts(client: PoolClient): Promise<void> {
  for (const part of DEV_SPARE_PARTS) {
    const row = await client.query<{ id: string }>(
      `INSERT INTO spare_parts (sku, name, unit_cost, stock_qty, min_stock_qty) VALUES ($1, $2, $3, 0, $4)
       ON CONFLICT (sku) DO NOTHING RETURNING id`,
      [part.sku, part.name, part.unitCost, part.minStock],
    );
    if (row.rows[0]) {
      await client.query(`CALL sp_part_receive($1, $2, NULL, NULL, NULL, NULL, NULL)`, [row.rows[0].id, part.stock]);
    }
  }
}

async function seedNotificationTemplates(client: PoolClient): Promise<void> {
  for (const template of DEV_NOTIFICATION_TEMPLATES) {
    await client.query(
      `INSERT INTO notification_templates (code, channel, title, body, description) VALUES ($1, $2, $3, $4, $5)
       ON CONFLICT (code, channel) DO NOTHING`,
      [template.code, template.channel, template.title, template.body, template.description],
    );
  }
}

/**
 * Przykładowy obieg serwisowy (scenariusz demo iteracji 6) na czterech wolnych hulajnogach o najwyższych numerach:
 * - pilne zgłoszenie „Hamulce” od klienta, nowe i nieprzypisane (hulajnoga w serwisie z przyczyną `URGENT_TICKET`);
 * - zgłoszenie „Światła” w serwisie z zadaniem naprawy i przeglądem bez zgłoszenia;
 * - zgłoszenie automatyczne krytycznej baterii z zadaniem wymiany baterii;
 * - rozwiązane zgłoszenie „Hamulce” z zakończoną naprawą i częściami z magazynu (stan maleje przez `sp_task_use_part`).
 * Przejścia przechodzą przez wyzwalacze i procedury z migracji 0008, a działania systemu mają wpisy `SYSTEM`
 * w dzienniku audytu. Idempotentne: baza, w której są już zgłoszenia, nie dostaje przykładów.
 */
async function seedSampleOperations(client: PoolClient, adminEmail: string): Promise<void> {
  if ((await client.query('SELECT 1 FROM tickets LIMIT 1')).rowCount) return;
  const free = await client.query<{ id: string }>(
    `SELECT id FROM scooters WHERE status = 'AVAILABLE' ORDER BY number DESC LIMIT 4`,
  );
  if (free.rows.length < 4) return;
  const [urgentScooter, lightsScooter, batteryScooter, repairedScooter] = free.rows.map((r) => r.id);

  const customers: string[] = [];
  for (const customer of SAMPLE_CUSTOMERS) {
    const row = await client.query<{ id: string }>(
      `INSERT INTO users (phone, name) VALUES ($1, $2) ON CONFLICT (phone) DO UPDATE SET name = EXCLUDED.name RETURNING id`,
      [customer.phone, customer.name],
    );
    customers.push(row.rows[0]!.id);
  }
  const staffWithRole = async (role: string) =>
    (
      await client.query<{ id: string }>(
        `SELECT s.id FROM staff s JOIN staff_roles sr ON sr.staff_id = s.id JOIN roles r ON r.id = sr.role_id
         WHERE r.name = $1 AND s.active ORDER BY s.created_at LIMIT 1`,
        [role],
      )
    ).rows[0]?.id;
  const adminId = (await client.query<{ id: string }>('SELECT id FROM staff WHERE email = $1', [adminEmail])).rows[0]!
    .id;
  const technician = (await staffWithRole('Serwisant')) ?? adminId;
  const dispatcher = (await staffWithRole('Dyspozytor')) ?? adminId;
  const lastRide = async (userId: string) =>
    (
      await client.query<{ id: string }>(
        `SELECT id FROM rentals WHERE user_id = $1 AND state = 'ENDED' ORDER BY ended_at DESC LIMIT 1`,
        [userId],
      )
    ).rows[0]?.id ?? null;
  const partId = async (sku: string) =>
    (await client.query<{ id: string }>('SELECT id FROM spare_parts WHERE sku = $1', [sku])).rows[0]!.id;
  const systemAudit = (action: string, entityType: string, entityId: string, data: object) =>
    client.query(
      `INSERT INTO audit_log (actor, staff_id, action, entity_type, entity_id, data) VALUES ('SYSTEM', NULL, $1, $2, $3, $4)`,
      [action, entityType, entityId, JSON.stringify(data)],
    );
  const toService = async (scooterId: string, reason: 'URGENT_TICKET' | 'SERVICE_TASK', ticketId: string) => {
    await client.query(
      `UPDATE scooters SET status = 'MAINTENANCE', status_reason = $2, updated_at = now(), version = version + 1 WHERE id = $1`,
      [scooterId, reason],
    );
    await systemAudit('scooter.sent_to_service', 'scooter', scooterId, {
      changes: { status: ['AVAILABLE', 'MAINTENANCE'] },
      reason,
      ticketId,
    });
  };
  const insertTicket = async (sql: string, params: unknown[]) =>
    (await client.query<{ id: string }>(sql, params)).rows[0]!.id;

  // Pilne zgłoszenie od klienta po przejeździe, czeka na dyspozytora.
  const urgent = await insertTicket(
    `INSERT INTO tickets (scooter_id, rental_id, reported_by, source, categories, description, urgent, created_at, updated_at)
     VALUES ($1, $2, $3, 'USER', '{BRAKES}', $4, true, now() - interval '12 minutes', now() - interval '12 minutes')
     RETURNING id`,
    [
      urgentScooter,
      await lastRide(customers[0]!),
      customers[0],
      'Tylny hamulec prawie nie działa, hulajnoga zatrzymuje się dopiero po kilku metrach.',
    ],
  );
  await toService(urgentScooter!, 'URGENT_TICKET', urgent);

  // Zgłoszenie w serwisie: naprawa przypisana serwisantowi, odpowiedź dla klienta i przegląd bez zgłoszenia.
  const lights = await insertTicket(
    `INSERT INTO tickets (scooter_id, rental_id, reported_by, source, categories, description, urgent, status, assignee_id,
                          customer_reply, customer_reply_at, created_at, updated_at)
     VALUES ($1, $2, $3, 'USER', '{LIGHTS}', $4, false, 'AT_SERVICE', $5, $6, now() - interval '20 hours',
             now() - interval '1 day', now() - interval '20 hours')
     RETURNING id`,
    [
      lightsScooter,
      await lastRide(customers[1]!),
      customers[1],
      'Nie świeci tylna lampa.',
      dispatcher,
      'Sprawdzamy hulajnogę, odezwiemy się wkrótce.',
    ],
  );
  await client.query(
    `INSERT INTO service_tasks (scooter_id, ticket_id, type, priority, description, assignee_id, created_by, due_at, created_at, updated_at)
     VALUES ($1, $2, 'REPAIR', 'NORMAL', $3, $4, $5, now() + interval '1 day', now() - interval '20 hours', now() - interval '20 hours'),
            ($1, NULL, 'INSPECTION', 'LOW', $6, $4, $5, now() + interval '2 days', now() - interval '20 hours', now() - interval '20 hours')`,
    [lightsScooter, lights, 'Sprawdzić przewód i lampę LGT-R.', technician, dispatcher, 'Przegląd okresowy.'],
  );
  await toService(lightsScooter!, 'SERVICE_TASK', lights);

  // Zgłoszenie automatyczne: krytyczna bateria po przejeździe, od razu zadanie wymiany baterii (pytanie 3).
  await client.query(`UPDATE scooters SET battery_pct = LEAST(COALESCE(battery_pct, 7), 7) WHERE id = $1`, [
    batteryScooter,
  ]);
  const battery = await insertTicket(
    `INSERT INTO tickets (scooter_id, source, auto_kind, categories, status, created_at, updated_at)
     VALUES ($1, 'AUTO', 'BATTERY_CRITICAL', '{BATTERY}', 'AT_SERVICE', now() - interval '5 hours', now() - interval '5 hours')
     RETURNING id`,
    [batteryScooter],
  );
  await systemAudit('ticket.created', 'ticket', battery, { autoKind: 'BATTERY_CRITICAL', batteryPct: 7 });
  const swap = await insertTicket(
    `INSERT INTO service_tasks (scooter_id, ticket_id, type, priority, due_at, created_at, updated_at)
     VALUES ($1, $2, 'BATTERY_SWAP', 'HIGH', now() + interval '3 hours', now() - interval '5 hours', now() - interval '5 hours')
     RETURNING id`,
    [batteryScooter, battery],
  );
  await systemAudit('service_task.created', 'service_task', swap, { type: 'BATTERY_SWAP', ticketId: battery });
  await toService(batteryScooter!, 'SERVICE_TASK', battery);

  // Rozwiązane zgłoszenie: naprawa z częściami z magazynu, hulajnoga wróciła do floty.
  const repaired = await insertTicket(
    `INSERT INTO tickets (scooter_id, rental_id, reported_by, source, categories, description, urgent, assignee_id,
                          created_at, updated_at)
     VALUES ($1, $2, $3, 'USER', '{BRAKES}', $4, true, $5, now() - interval '3 hours', now() - interval '3 hours')
     RETURNING id`,
    [repairedScooter, await lastRide(customers[2]!), customers[2], 'Hamulec piszczy i słabo hamuje.', dispatcher],
  );
  const repair = await insertTicket(
    `INSERT INTO service_tasks (scooter_id, ticket_id, type, priority, description, assignee_id, created_by, created_at, updated_at)
     VALUES ($1, $2, 'REPAIR', 'HIGH', $3, $4, $5, now() - interval '170 minutes', now() - interval '170 minutes')
     RETURNING id`,
    [repairedScooter, repaired, 'Sprawdzić klocki i linkę hamulca tylnego.', technician, dispatcher],
  );
  await client.query(
    `UPDATE tickets SET status = 'AT_SERVICE', updated_at = now(), version = version + 1 WHERE id = $1`,
    [repaired],
  );
  await client.query(
    `UPDATE service_tasks SET status = 'IN_PROGRESS', started_at = now() - interval '2 hours', updated_at = now(),
            version = version + 1 WHERE id = $1`,
    [repair],
  );
  for (const sku of ['BRK-PAD-R', 'BRK-CBL-R']) {
    await client.query(`CALL sp_task_use_part($1, $2, 1, $3, NULL, NULL)`, [repair, await partId(sku), technician]);
  }
  await client.query(
    `UPDATE service_tasks SET status = 'DONE', result_note = $2, updated_at = now(), version = version + 1 WHERE id = $1`,
    [repair, 'Wymieniono klocki i linkę hamulca tylnego, wyregulowano hamulec.'],
  );
  await client.query(
    `UPDATE tickets SET status = 'RESOLVED', resolution_note = $2, customer_reply = $3, customer_reply_at = now(),
            updated_at = now(), version = version + 1
     WHERE id = $1`,
    [repaired, 'Naprawa hamulca w zadaniu serwisowym.', 'Naprawiliśmy hamulec. Dziękujemy za zgłoszenie.'],
  );
}
