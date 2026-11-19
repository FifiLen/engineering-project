/**
 * Testy integracyjne migracji 0013 (iteracja 8: raporty i domknięcie panelu, ADR 0071, 0074, 0076) na prawdziwym
 * PostgreSQL: historia stanów hulajnogi z wyzwalaczami i przyczyną w widoku, funkcje raportowe na małych znanych
 * danych (kwoty w groszach, doby Europe/Warsaw z dobą zmiany czasu 25 października 2026), uruchomienia raportów,
 * dezaktywacja szablonu wydruku i widoki nowych list. Każde uruchomienie tworzy tymczasową bazę i usuwa ją na końcu.
 */
import { randomUUID } from 'node:crypto';
import { OTP_POLICY, PERMISSIONS } from '@hulajnogi/core';
import { Pool } from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { runMigrations } from './migrator.js';
import type { PlacesFile } from './places.js';
import { rethrowDatabaseRule } from './repositories/errors.js';
import { seedDatabase } from './seed.js';

const adminUrl = process.env.DATABASE_URL;
const dbName = `hulajnogi_reports_${randomUUID().slice(0, 8)}`;

// Syntetyczne współrzędne testowe (nie są to prawdziwe miejsca w Rybniku).
const places: PlacesFile = {
  city: 'Test',
  note: '',
  serviceArea: { code: 'AREA-TEST', name: 'Obszar testowy', centerPlace: 'P-01', radiusM: 3000 },
  places: [
    { code: 'P-01', name: 'Centrum', query: '', type: 'PARKING', radiusM: 50, capacity: 20, lat: 50.0, lon: 18.5 },
    { code: 'P-02', name: 'Północ', query: '', type: 'PARKING', radiusM: 50, capacity: 20, lat: 50.01, lon: 18.5 },
    {
      code: 'S-01',
      name: 'Wolna strefa',
      query: '',
      type: 'SLOW',
      radiusM: 200,
      speedLimitKmh: 10,
      lat: 50.005,
      lon: 18.5,
    },
  ],
};

/** Doba 25 października 2026 w Europe/Warsaw (zmiana czasu: 25 godzin) i doba 26 października. */
const OCT25 = '2026-10-24T22:00:00Z';
const OCT26 = '2026-10-25T23:00:00Z';
const OCT27 = '2026-10-26T23:00:00Z';

/** Kod błędu domeny po `rethrowDatabaseRule` (jak w API) albo `null`, gdy zapytanie się udało. */
async function domainCode(query: Promise<unknown>) {
  try {
    await query;
  } catch (error) {
    try {
      rethrowDatabaseRule(error);
    } catch (mapped) {
      return { code: (mapped as { code?: string }).code, details: (mapped as { details?: unknown }).details };
    }
  }
  return null;
}

describe.skipIf(!adminUrl)('raporty i domknięcie panelu w bazie (0013)', () => {
  let admin: Pool;
  let pool: Pool;

  const rows = async <T = Record<string, unknown>>(text: string, params: unknown[] = []) =>
    (await pool.query(text, params)).rows as T[];
  const one = async <T = Record<string, unknown>>(text: string, params: unknown[] = []) =>
    (await rows<T>(text, params))[0]!;
  const id = async (text: string, params: unknown[] = []) => (await one<{ id: string }>(text, params)).id;

  const zone = (code: string) => id(`SELECT id FROM zones WHERE code = $1`, [code]);
  const staffId = () => id(`SELECT id FROM staff WHERE email = 'a@test.local'`);
  let scooterNo = 700;
  /** Nowa hulajnoga modelu BASE; wyzwalacz otwiera jej przedział historii w chwili wstawienia. */
  const scooter = (values: { online?: boolean; status?: string } = {}) =>
    id(
      `INSERT INTO scooters (number, serial_number, variant, model_id, status, online, battery_pct, position)
       VALUES ($1::int, 'REP-' || $1::text, 'GRAFIT', (SELECT id FROM scooter_models WHERE code = 'BASE'),
               $2::scooter_status, $3, 80, ST_SetSRID(ST_MakePoint(18.5, 50.0), 4326))
       RETURNING id`,
      [++scooterNo, values.status ?? 'AVAILABLE', values.online ?? true],
    );
  let phoneNo = 900;
  const user = (values: { createdAt?: string; name?: string } = {}) =>
    id(`INSERT INTO users (phone, name, created_at) VALUES ($1, $2, COALESCE($3::timestamptz, now())) RETURNING id`, [
      `+48500000${++phoneNo}`,
      values.name ?? 'Klient testowy',
      values.createdAt ?? null,
    ]);
  /** Przejazd zakończony (albo w innym stanie) z jawnymi czasami. */
  const rental = (
    userId: string,
    scooterId: string,
    values: {
      state?: string;
      startedAt: string;
      endedAt?: string | null;
      endZone?: string | null;
      rideSeconds?: number;
      distanceM?: number;
      endMode?: string | null;
      towingFee?: number | null;
      totalAmount?: number | null;
    },
  ) =>
    id(
      `INSERT INTO rentals (user_id, scooter_id, tariff_id, state, reserved_at, started_at, ended_at, end_zone_id,
                            ride_seconds, distance_m, end_mode, towing_fee, total_amount, created_at)
       VALUES ($1, $2, (SELECT id FROM tariffs WHERE version = 1), $3::rental_state, $4::timestamptz, $4::timestamptz,
               $5::timestamptz, $6, $7, $8, $9::rental_end_mode, $10, $11, $4::timestamptz)
       RETURNING id`,
      [
        userId,
        scooterId,
        values.state ?? 'ENDED',
        values.startedAt,
        values.endedAt === undefined ? null : values.endedAt,
        values.endZone ?? null,
        values.rideSeconds ?? 0,
        values.distanceM ?? 0,
        values.endMode ?? (values.state && values.state !== 'ENDED' ? null : 'CUSTOMER'),
        values.towingFee ?? null,
        values.totalAmount ?? null,
      ],
    );
  /** Paragon z pozycjami wstawiony z jawnym czasem wystawienia (procedura stempluje `now()`, ADR 0075). */
  const receipt = async (
    userId: string,
    values: {
      rentalId: string | null;
      issuedAt: string;
      items: { vatRate: number | null; amount: number }[];
      correctsId?: string;
      refundId?: string;
    },
  ) => {
    const total = values.items.reduce((sum, i) => sum + i.amount, 0);
    const receiptId = await id(
      `INSERT INTO receipts (user_id, rental_id, total_amount, issued_at, kind, corrects_receipt_id, refund_id, payment_source)
       VALUES ($1, $2, $3, $4, $5::receipt_kind, $6, $7, 'WALLET') RETURNING id`,
      [
        userId,
        values.rentalId,
        total,
        values.issuedAt,
        values.correctsId ? 'CORRECTION' : 'SALE',
        values.correctsId ?? null,
        values.refundId ?? null,
      ],
    );
    for (const [index, item] of values.items.entries()) {
      await pool.query(
        `INSERT INTO receipt_items (receipt_id, line_no, description, quantity, unit_price, vat_rate, amount)
         VALUES ($1, $2, 'Pozycja', 1, $3, $4, $3)`,
        [receiptId, index + 1, item.amount, item.vatRate],
      );
    }
    return receiptId;
  };
  /** Przedział historii stanów z jawnymi czasami (tak wstawia go generator danych, ADR 0075). */
  const interval = (scooterId: string, status: string, online: boolean, from: string, to: string) =>
    pool.query(
      `INSERT INTO scooter_status_history (scooter_id, status, online, valid_from, valid_to)
       VALUES ($1, $2::scooter_status, $3, $4, $5)`,
      [scooterId, status, online, from, to],
    );

  beforeAll(async () => {
    admin = new Pool({ connectionString: adminUrl });
    await admin.query(`CREATE DATABASE ${dbName}`);
    const url = new URL(adminUrl!);
    url.pathname = `/${dbName}`;
    pool = new Pool({ connectionString: url.toString() });
    pool.on('error', () => undefined);
    await runMigrations(pool);
    await seedDatabase(pool, {
      places,
      fleetSize: 4,
      admin: { email: 'a@test.local', name: 'Piotr Mazur', passwordHash: 'x' },
    });
  });

  afterAll(async () => {
    await pool?.end();
    await admin?.query(`DROP DATABASE IF EXISTS ${dbName} WITH (FORCE)`);
    await admin?.end();
  });

  // ------------------------------------------------------------------------------------------
  // Historia stanów hulajnogi (ADR 0074)
  // ------------------------------------------------------------------------------------------

  it('historia stanów: przedział otwarty dla każdej hulajnogi, zmiana stanu zamyka go, powtórzona łączność nie', async () => {
    const open = await one<{ scooters: number; open: number }>(
      `SELECT (SELECT count(*)::int FROM scooters) AS scooters,
              (SELECT count(*)::int FROM scooter_status_history WHERE valid_to IS NULL) AS open`,
    );
    expect(open.open).toBe(open.scooters);

    const s = await scooter();
    const history = () =>
      rows<{ status: string; online: boolean; closed: boolean; contiguous: boolean }>(
        `SELECT status::text, online, valid_to IS NOT NULL AS closed,
                valid_to IS NULL OR valid_to = lead(valid_from) OVER (ORDER BY id) AS contiguous
         FROM scooter_status_history WHERE scooter_id = $1 ORDER BY id`,
        [s],
      );
    expect(await history()).toEqual([{ status: 'AVAILABLE', online: true, closed: false, contiguous: true }]);

    // `setConnection` zapisuje też powtórzony stan łączności: bez nowego przedziału.
    await pool.query(`UPDATE scooters SET online = true, last_seen_at = now() WHERE id = $1`, [s]);
    await pool.query(`UPDATE scooters SET battery_pct = 40 WHERE id = $1`, [s]);
    expect(await history()).toHaveLength(1);

    await pool.query(`UPDATE scooters SET status = 'RESERVED' WHERE id = $1`, [s]);
    await pool.query(`UPDATE scooters SET online = false WHERE id = $1`, [s]);
    expect(await history()).toEqual([
      { status: 'AVAILABLE', online: true, closed: true, contiguous: true },
      { status: 'RESERVED', online: true, closed: true, contiguous: true },
      { status: 'RESERVED', online: false, closed: false, contiguous: true },
    ]);

    // Dwie zmiany w jednej transakcji: przedział zerowej długości zostaje w tabeli, widok go pomija.
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      await client.query(`UPDATE scooters SET status = 'IN_USE' WHERE id = $1`, [s]);
      await client.query(`UPDATE scooters SET online = true WHERE id = $1`, [s]);
      await client.query('COMMIT');
    } finally {
      client.release();
    }
    expect(await history()).toHaveLength(5);
    const view = await rows<{ status: string; online: boolean; category: string }>(
      `SELECT status::text, online, category FROM v_scooter_status_history WHERE scooter_id = $1 ORDER BY valid_from, id`,
      [s],
    );
    expect(view).toEqual([
      { status: 'AVAILABLE', online: true, category: 'AVAILABLE' },
      { status: 'RESERVED', online: true, category: 'RESERVED' },
      { status: 'RESERVED', online: false, category: 'OFFLINE' },
      { status: 'IN_USE', online: true, category: 'IN_RIDE' },
    ]);
  });

  it('historia stanów zapisuje stan po wyzwalaczu serwisu (MAINTENANCE zamiast AVAILABLE) i jest tylko do dopisywania', async () => {
    const s = await scooter({ status: 'IN_USE' });
    await pool.query(
      `INSERT INTO tickets (scooter_id, source, categories, urgent) VALUES ($1, 'STAFF', '{BRAKES}', true)`,
      [s],
    );
    await pool.query(`UPDATE scooters SET status = 'AVAILABLE' WHERE id = $1`, [s]);
    const last = await one<{ status: string; reason: string; category: string; ticket: boolean }>(
      `SELECT status::text, reason, category, reason_ticket_number IS NOT NULL AS ticket
       FROM v_scooter_status_history WHERE scooter_id = $1 AND is_open`,
      [s],
    );
    expect(last).toEqual({ status: 'MAINTENANCE', reason: 'TICKET', category: 'SERVICE', ticket: true });

    const closed = await id(`SELECT id FROM scooter_status_history WHERE scooter_id = $1 AND valid_to IS NOT NULL`, [
      s,
    ]);
    const openId = await id(`SELECT id FROM scooter_status_history WHERE scooter_id = $1 AND valid_to IS NULL`, [s]);
    const appendOnly = { code: 'STATUS_HISTORY_APPEND_ONLY', details: undefined };
    expect(
      await domainCode(pool.query(`UPDATE scooter_status_history SET valid_to = now() WHERE id = $1`, [closed])),
    ).toEqual(appendOnly);
    expect(
      await domainCode(pool.query(`UPDATE scooter_status_history SET status = 'AVAILABLE' WHERE id = $1`, [openId])),
    ).toEqual(appendOnly);
    expect(await domainCode(pool.query(`DELETE FROM scooter_status_history WHERE id = $1`, [closed]))).toEqual(
      appendOnly,
    );
    // Przedziały jednej hulajnogi się nie nakładają (przedział otwarty trwa do nieskończoności).
    await expect(interval(s, 'AVAILABLE', true, '2030-01-01T00:00:00Z', '2030-01-02T00:00:00Z')).rejects.toThrow(
      /scooter_status_history_no_overlap/,
    );
    await expect(interval(s, 'AVAILABLE', true, '2026-01-02T00:00:00Z', '2026-01-01T00:00:00Z')).rejects.toThrow(
      /scooter_status_history_range/,
    );
    // Hulajnogę bez przejazdów można usunąć razem z historią (kaskada).
    const spare = await scooter();
    await pool.query(`DELETE FROM scooters WHERE id = $1`, [spare]);
    expect(
      (await one<{ n: number }>(`SELECT count(*)::int AS n FROM scooter_status_history WHERE scooter_id = $1`, [spare]))
        .n,
    ).toBe(0);
  });

  it('v_scooter_status_history dopasowuje przyczynę: przejazd, zadanie, zgłoszenie OFFLINE, operator, brak telemetrii', async () => {
    const s = await scooter();
    const u = await user();
    const staff = await staffId();
    await interval(s, 'IN_USE', true, '2026-10-01T08:00:00Z', '2026-10-01T09:00:00Z');
    await interval(s, 'MAINTENANCE', true, '2026-10-01T09:00:00Z', '2026-10-01T12:00:00Z');
    await interval(s, 'AVAILABLE', false, '2026-10-01T12:00:00Z', '2026-10-01T13:00:00Z');
    await interval(s, 'AVAILABLE', true, '2026-10-01T13:00:00Z', '2026-10-01T14:00:00Z');
    await interval(s, 'AVAILABLE', false, '2026-10-01T14:00:00Z', '2026-10-01T15:00:00Z');
    await interval(s, 'RESERVED', true, '2026-10-01T15:00:00Z', '2026-10-01T15:05:00Z');
    await interval(s, 'AVAILABLE', true, '2026-10-01T15:05:00Z', '2026-10-01T16:00:00Z');
    const ride = await rental(u, s, { startedAt: '2026-10-01T08:00:00Z', endedAt: '2026-10-01T09:00:00Z' });
    await pool.query(
      `INSERT INTO rentals (user_id, scooter_id, tariff_id, state, reserved_at, reservation_expires_at, created_at)
       VALUES ($1, $2, (SELECT id FROM tariffs WHERE version = 1), 'EXPIRED', '2026-10-01T15:00:00Z',
               '2026-10-01T15:05:00Z', '2026-10-01T15:00:00Z')`,
      [u, s],
    );
    const task = await id(
      `INSERT INTO service_tasks (scooter_id, type, created_at, assignee_id) VALUES ($1, 'REPAIR', '2026-10-01T09:00:00Z', $2)
       RETURNING id`,
      [s, staff],
    );
    await pool.query(
      `INSERT INTO tickets (scooter_id, source, categories, auto_kind, status, created_at, resolved_at)
       VALUES ($1, 'AUTO', '{CONNECTION}', 'OFFLINE', 'RESOLVED', '2026-10-01T12:05:00Z', '2026-10-01T12:55:00Z')`,
      [s],
    );
    await pool.query(
      `INSERT INTO audit_log (staff_id, action, entity_type, entity_id, created_at)
       VALUES ($1, 'scooter.returned_to_fleet', 'scooter', $2, '2026-10-01T13:00:01Z')`,
      [staff, s],
    );
    const view = await rows(
      `SELECT category, reason, reason_rental_id, reason_task_id, reason_task_assignee_name, reason_ticket_auto_kind::text,
              reason_staff_name, duration_seconds::int
       FROM v_scooter_status_history WHERE scooter_id = $1 AND NOT is_open ORDER BY valid_from`,
      [s],
    );
    const base = {
      reason_rental_id: null,
      reason_task_id: null,
      reason_task_assignee_name: null,
      reason_ticket_auto_kind: null,
      reason_staff_name: null,
    };
    expect(view).toEqual([
      { ...base, category: 'IN_RIDE', reason: 'RENTAL', reason_rental_id: ride, duration_seconds: 3600 },
      {
        ...base,
        category: 'SERVICE',
        reason: 'SERVICE_TASK',
        reason_task_id: task,
        reason_task_assignee_name: 'Piotr Mazur',
        duration_seconds: 10800,
      },
      {
        ...base,
        category: 'OFFLINE',
        reason: 'AUTO_OFFLINE',
        reason_ticket_auto_kind: 'OFFLINE',
        duration_seconds: 3600,
      },
      { ...base, category: 'AVAILABLE', reason: 'STAFF', reason_staff_name: 'Piotr Mazur', duration_seconds: 3600 },
      { ...base, category: 'OFFLINE', reason: 'NO_TELEMETRY', duration_seconds: 3600 },
      {
        ...base,
        category: 'RESERVED',
        reason: 'RESERVATION',
        reason_rental_id: expect.any(String),
        duration_seconds: 300,
      },
      { ...base, category: 'AVAILABLE', reason: 'SYSTEM', duration_seconds: 3300 },
    ]);
  });

  // ------------------------------------------------------------------------------------------
  // Przedziały szeregu i najwcześniejsze dane
  // ------------------------------------------------------------------------------------------

  it('fn_report_buckets: doby, tygodnie i miesiące w Europe/Warsaw, doba zmiany czasu ma 25 godzin', async () => {
    const days = await rows<{ bucket: string; hours: number }>(
      `SELECT bucket::text, extract(epoch FROM bucket_to - bucket_from)::int / 3600 AS hours
       FROM fn_report_buckets($1, $2, 'day')`,
      [OCT25, OCT27],
    );
    expect(days).toEqual([
      { bucket: '2026-10-25', hours: 25 },
      { bucket: '2026-10-26', hours: 24 },
    ]);
    const weeks = await rows<{ bucket: string; from: string }>(
      `SELECT bucket::text, to_char(bucket_from AT TIME ZONE 'Europe/Warsaw', 'YYYY-MM-DD HH24:MI') AS from
       FROM fn_report_buckets('2026-09-30T22:00:00Z', '2026-10-31T23:00:00Z', 'week')`,
    );
    expect(weeks.map((w) => w.bucket)).toEqual(['2026-09-28', '2026-10-05', '2026-10-12', '2026-10-19', '2026-10-26']);
    expect(weeks[0]!.from).toBe('2026-10-01 00:00'); // pierwszy tydzień przycięty do okresu
    const months = await rows<{ bucket: string; hours: number }>(
      `SELECT bucket::text, extract(epoch FROM bucket_to - bucket_from)::int / 3600 AS hours
       FROM fn_report_buckets('2026-09-30T22:00:00Z', '2026-11-30T23:00:00Z', 'month')`,
    );
    expect(months).toEqual([
      { bucket: '2026-10-01', hours: 745 },
      { bucket: '2026-11-01', hours: 720 },
    ]);
    expect(await domainCode(pool.query(`SELECT * FROM fn_report_buckets($1, $2, 'year')`, [OCT25, OCT27]))).toEqual({
      code: 'REPORT_INVALID_GRANULARITY',
      details: { granularity: 'year' },
    });
  });

  // ------------------------------------------------------------------------------------------
  // Przychody
  // ------------------------------------------------------------------------------------------

  it('przychody: sprzedaż według stawki VAT z pozycją poza VAT, korekty ujemne z datą korekty, szereg, strefy, wpływy', async () => {
    const u = await user();
    const [s1, s2] = [await scooter(), await scooter()];
    const p01 = await zone('P-01');
    const earlier = { startedAt: '2026-10-20T10:00:00Z', endedAt: '2026-10-20T10:20:00Z' };
    const a = await rental(u, s1, { ...earlier, endZone: p01 });
    const b = await rental(u, s2, { ...earlier, endZone: p01 });
    const c = await rental(u, s1, { ...earlier, endZone: null });
    const d = await rental(u, s2, { ...earlier, endZone: p01 });
    // A: 25.10 23:30 (CET), z opłatą za odholowanie poza VAT.
    const saleA = await receipt(u, {
      rentalId: a,
      issuedAt: '2026-10-25T22:30:00Z',
      items: [
        { vatRate: 23, amount: 1230 },
        { vatRate: null, amount: 5000 },
      ],
    });
    // B: 26.10 00:30 czasu polskiego, czyli już druga doba.
    await receipt(u, { rentalId: b, issuedAt: '2026-10-25T23:30:00Z', items: [{ vatRate: 23, amount: 615 }] });
    // C: 25.10 00:30 (CEST), czyli pierwsza doba, choć to jeszcze 24.10 w UTC.
    await receipt(u, { rentalId: c, issuedAt: '2026-10-24T22:30:00Z', items: [{ vatRate: 23, amount: 246 }] });
    // D: 24.10 23:30 czasu polskiego, przed okresem.
    await receipt(u, { rentalId: d, issuedAt: '2026-10-24T21:30:00Z', items: [{ vatRate: 23, amount: 999 }] });
    const refund = await id(
      `INSERT INTO refunds (user_id, rental_id, source, amount, reason, status, created_at)
       VALUES ($1, $2, 'WALLET', 123, 'SCOOTER_FAILURE', 'SUCCEEDED', '2026-10-26T10:00:00Z') RETURNING id`,
      [u, a],
    );
    await pool.query(
      `INSERT INTO refunds (user_id, rental_id, source, amount, reason, status, created_at)
       VALUES ($1, $2, 'WALLET', 50, 'CUSTOMER_COMPLAINT', 'PENDING', '2026-10-26T11:00:00Z')`,
      [u, b],
    );
    const correction = await receipt(u, {
      rentalId: a,
      issuedAt: '2026-10-26T10:00:00Z',
      items: [{ vatRate: 23, amount: -123 }],
      correctsId: saleA,
      refundId: refund,
    });

    const byVat = await rows(
      `SELECT vat_rate::text, kind::text, receipts, gross::int, vat::int, net::int FROM fn_report_revenue_sales_by_vat($1, $2)`,
      [OCT25, OCT27],
    );
    expect(byVat).toEqual([
      { vat_rate: '23.00', kind: 'SALE', receipts: 3, gross: 2091, vat: 391, net: 1700 },
      { vat_rate: '23.00', kind: 'CORRECTION', receipts: 1, gross: -123, vat: -23, net: -100 },
      { vat_rate: null, kind: 'SALE', receipts: 1, gross: 5000, vat: 0, net: 5000 },
    ]);

    const series = await rows(
      `SELECT bucket::text, sales_gross::int, corrections_gross::int, gross::int, vat::int, net::int,
              outside_vat_gross::int, sale_receipts, correction_receipts, rides
       FROM fn_report_revenue_sales_series($1, $2, 'day')`,
      [OCT25, OCT27],
    );
    expect(series).toEqual([
      {
        bucket: '2026-10-25',
        sales_gross: 6476,
        corrections_gross: 0,
        gross: 6476,
        vat: 276,
        net: 6200,
        outside_vat_gross: 5000,
        sale_receipts: 2,
        correction_receipts: 0,
        rides: 2,
      },
      {
        bucket: '2026-10-26',
        sales_gross: 615,
        corrections_gross: -123,
        gross: 492,
        vat: 92,
        net: 400,
        outside_vat_gross: 0,
        sale_receipts: 1,
        correction_receipts: 1,
        rides: 1,
      },
    ]);

    const byZone = await rows(
      `SELECT zone_code, rides, sales_gross::int, corrections_gross::int, gross::int, outside_vat_gross::int
       FROM fn_report_revenue_sales_by_zone($1, $2)`,
      [OCT25, OCT27],
    );
    expect(byZone).toEqual([
      { zone_code: 'P-01', rides: 2, sales_gross: 6845, corrections_gross: -123, gross: 6722, outside_vat_gross: 5000 },
      { zone_code: null, rides: 1, sales_gross: 246, corrections_gross: 0, gross: 246, outside_vat_gross: 0 },
    ]);

    const pay = (values: {
      purpose: string;
      method: string;
      amount: number;
      status: string;
      at: string;
      rental?: string;
    }) =>
      pool.query(
        `INSERT INTO payments (user_id, purpose, rental_id, method, amount, status, idempotency_key, created_at)
         VALUES ($1, $2::payment_purpose, $3, $4::payment_method_kind, $5, $6::payment_status, gen_random_uuid()::text, $7)`,
        [u, values.purpose, values.rental ?? null, values.method, values.amount, values.status, values.at],
      );
    await pay({ purpose: 'TOPUP', method: 'BLIK', amount: 5000, status: 'SUCCEEDED', at: '2026-10-25T10:00:00Z' });
    await pay({ purpose: 'TOPUP', method: 'CARD', amount: 2000, status: 'REFUNDED', at: '2026-10-26T10:00:00Z' });
    await pay({
      purpose: 'RIDE',
      method: 'CARD',
      amount: 615,
      status: 'SUCCEEDED',
      at: '2026-10-26T10:00:00Z',
      rental: b,
    });
    await pay({ purpose: 'TOPUP', method: 'CARD', amount: 900, status: 'FAILED', at: '2026-10-26T10:00:00Z' });
    await pay({ purpose: 'TOPUP', method: 'CARD', amount: 700, status: 'SUCCEEDED', at: '2026-10-24T21:00:00Z' });
    expect(
      await rows(
        `SELECT purpose::text, method::text, payments, amount::int, refunded_payments FROM fn_report_revenue_payments($1, $2)`,
        [OCT25, OCT27],
      ),
    ).toEqual([
      { purpose: 'TOPUP', method: 'CARD', payments: 1, amount: 2000, refunded_payments: 1 },
      { purpose: 'TOPUP', method: 'BLIK', payments: 1, amount: 5000, refunded_payments: 0 },
      { purpose: 'RIDE', method: 'CARD', payments: 1, amount: 615, refunded_payments: 0 },
    ]);
    expect(
      await rows(`SELECT source::text, reason::text, refunds, amount::int FROM fn_report_revenue_refunds($1, $2)`, [
        OCT25,
        OCT27,
      ]),
    ).toEqual([{ source: 'WALLET', reason: 'SCOOTER_FAILURE', refunds: 1, amount: 123 }]);

    // Przyczyna korekty w danych wydruku paragonu (dług z iteracji 7).
    expect(
      await one(`SELECT correction_reason::text, is_correction FROM v_doc_receipt WHERE receipt_id = $1`, [correction]),
    ).toEqual({ correction_reason: 'SCOOTER_FAILURE', is_correction: true });
  });

  // ------------------------------------------------------------------------------------------
  // Wykorzystanie floty
  // ------------------------------------------------------------------------------------------

  it('wykorzystanie floty: czasy kategorii z historii przyciętej do okresu, przejazdy sprzed historii z rentals', async () => {
    const u = await user();
    const f = await scooter();
    const g = await scooter();
    // F: doba 25.10 (25 h = 90 000 s); pierwszy przedział zaczyna się przed okresem, ostatni kończy po nim.
    await interval(f, 'AVAILABLE', true, '2026-10-24T20:00:00Z', '2026-10-25T02:00:00Z'); // 4 h w okresie
    await interval(f, 'RESERVED', true, '2026-10-25T02:00:00Z', '2026-10-25T03:00:00Z'); // 1 h
    await interval(f, 'IN_USE', false, '2026-10-25T03:00:00Z', '2026-10-25T05:00:00Z'); // 2 h (bez łączności nadal jazda)
    await interval(f, 'MAINTENANCE', true, '2026-10-25T05:00:00Z', '2026-10-25T10:00:00Z'); // 5 h
    await interval(f, 'AVAILABLE', false, '2026-10-25T10:00:00Z', '2026-10-25T12:00:00Z'); // 2 h bez łączności
    await interval(f, 'AVAILABLE', true, '2026-10-25T12:00:00Z', '2026-10-26T05:00:00Z'); // 11 h w okresie
    const ride = await rental(u, f, {
      startedAt: '2026-10-25T03:00:00Z',
      endedAt: '2026-10-25T05:00:00Z',
      rideSeconds: 7000,
      distanceM: 5000,
    });
    await receipt(u, { rentalId: ride, issuedAt: '2026-10-25T05:00:00Z', items: [{ vatRate: 23, amount: 1500 }] });
    // G: historia od 12:00 UTC, przejazd 08:00–13:00 częściowo sprzed historii (4 h).
    await interval(g, 'AVAILABLE', true, '2026-10-25T12:00:00Z', '2026-10-26T05:00:00Z');
    await rental(u, g, { startedAt: '2026-10-25T08:00:00Z', endedAt: '2026-10-25T13:00:00Z', rideSeconds: 18000 });

    const usage = await rows(
      `SELECT scooter_id, period_seconds::int, tracked_seconds::int, in_ride_seconds::int, reserved_seconds::int,
              available_seconds::int, service_seconds::int, offline_seconds::int, retired_seconds::int,
              untracked_ride_seconds::int, rides, ride_seconds::int, distance_m::int, revenue_gross::int
       FROM fn_report_fleet_usage_by_scooter($1, $2) WHERE scooter_id = ANY($3) ORDER BY scooter_number`,
      [OCT25, OCT26, [f, g]],
    );
    expect(usage).toEqual([
      {
        scooter_id: f,
        period_seconds: 90000,
        tracked_seconds: 90000,
        in_ride_seconds: 7200,
        reserved_seconds: 3600,
        available_seconds: 54000,
        service_seconds: 18000,
        offline_seconds: 7200,
        retired_seconds: 0,
        untracked_ride_seconds: 0,
        rides: 1,
        ride_seconds: 7000,
        distance_m: 5000,
        revenue_gross: 1500,
      },
      {
        scooter_id: g,
        period_seconds: 90000,
        tracked_seconds: 39600,
        in_ride_seconds: 0,
        reserved_seconds: 0,
        available_seconds: 39600,
        service_seconds: 0,
        offline_seconds: 0,
        retired_seconds: 0,
        untracked_ride_seconds: 14400,
        rides: 1,
        ride_seconds: 18000,
        distance_m: 0,
        revenue_gross: 0,
      },
    ]);
    // Hulajnogi utworzone po okresie bez historii przed nim nie wchodzą do raportu: F, G i hulajnoga z historią od 1.10
    // (test przyczyn) bez czasu w tej dobie.
    const model = await one(
      `SELECT scooters, tracked_seconds::int, in_ride_seconds::int, untracked_ride_seconds::int, rides
       FROM fn_report_fleet_usage_by_model($1, $2)`,
      [OCT25, OCT26],
    );
    expect(model).toEqual({
      scooters: 3,
      tracked_seconds: 129600,
      in_ride_seconds: 7200,
      untracked_ride_seconds: 14400,
      rides: 2,
    });

    const series = await rows(
      `SELECT bucket::text, period_seconds::int, scooters, in_ride_seconds::int, available_seconds::int, rides
       FROM fn_report_fleet_usage_series($1, $2, 'day', NULL, $3)`,
      [OCT25, OCT27, f],
    );
    expect(series).toEqual([
      {
        bucket: '2026-10-25',
        period_seconds: 90000,
        scooters: 1,
        in_ride_seconds: 7200,
        available_seconds: 54000,
        rides: 1,
      },
      {
        bucket: '2026-10-26',
        period_seconds: 86400,
        scooters: 1,
        in_ride_seconds: 0,
        available_seconds: 21600,
        rides: 0,
      },
    ]);
  });

  // ------------------------------------------------------------------------------------------
  // Przejazdy według stref i godzin
  // ------------------------------------------------------------------------------------------

  it('przejazdy według stref i godzin: mapa ciepła z godziną zmiany czasu w jednej komórce, strefy końca, wjazdy, zakończenia', async () => {
    const u = await user();
    const s = await scooter();
    const [p02, s01] = [await zone('P-02'), await zone('S-01')];
    // Obie 2:30 doby zmiany czasu (CEST i CET) to niedziela, godzina 2.
    const r1 = await rental(u, s, {
      startedAt: '2026-10-25T00:30:00Z',
      endedAt: '2026-10-25T00:40:00Z',
      endZone: p02,
      rideSeconds: 600,
      distanceM: 2000,
    });
    const r2 = await rental(u, s, {
      startedAt: '2026-10-25T01:30:00Z',
      endedAt: '2026-10-25T01:50:00Z',
      endZone: p02,
      rideSeconds: 1200,
      distanceM: 4000,
      endMode: 'REMOTE',
      towingFee: 5000,
    });
    // Poniedziałek 26.10, 7:15 czasu polskiego.
    await rental(u, s, {
      startedAt: '2026-10-26T06:15:00Z',
      endedAt: '2026-10-26T06:45:00Z',
      endZone: p02,
      rideSeconds: 1800,
      distanceM: 3000,
    });
    // 27.10 0:30 czasu polskiego: po okresie.
    await rental(u, s, { startedAt: '2026-10-26T23:30:00Z', endedAt: '2026-10-26T23:40:00Z', endZone: p02 });
    // Poniedziałek tydzień wcześniej, 7:30 (do średniej na pulpicie).
    await rental(u, s, { startedAt: '2026-10-19T05:30:00Z', endedAt: '2026-10-19T05:40:00Z', endZone: null });

    const heat = await rows<{ isodow: number; hour: number; rides: number; day_occurrences: number }>(
      `SELECT isodow, hour, rides, day_occurrences FROM fn_report_rides_heatmap($1, $2, $3)`,
      [OCT25, OCT27, p02],
    );
    expect(heat).toHaveLength(168);
    expect(heat.filter((c) => c.rides > 0)).toEqual([
      { isodow: 1, hour: 7, rides: 1, day_occurrences: 1 },
      { isodow: 7, hour: 2, rides: 2, day_occurrences: 1 },
    ]);
    expect(new Set(heat.filter((c) => c.isodow >= 2 && c.isodow <= 6).map((c) => c.day_occurrences))).toEqual(
      new Set([0]),
    );

    expect(
      await rows(
        `SELECT zone_code, rides, ended_rides, avg_ride_seconds::text, total_ride_seconds::int, avg_distance_m::text,
                total_distance_m::int
         FROM fn_report_rides_by_end_zone($1, $2, $3)`,
        [OCT25, OCT27, p02],
      ),
    ).toEqual([
      {
        zone_code: 'P-02',
        rides: 3,
        ended_rides: 3,
        avg_ride_seconds: '1200.0',
        total_ride_seconds: 3600,
        avg_distance_m: '3000.0',
        total_distance_m: 9000,
      },
    ]);

    const event = (rentalId: string, type: string, at: string) =>
      pool.query(
        `INSERT INTO rental_events (rental_id, type, zone_id, created_at) VALUES ($1, $2::rental_event_type, $3, $4)`,
        [rentalId, type, s01, at],
      );
    await event(r1, 'ZONE_ENTERED', '2026-10-25T00:35:00Z');
    await event(r1, 'ZONE_EXITED', '2026-10-25T00:38:00Z');
    await event(r2, 'ZONE_ENTERED', '2026-10-25T01:35:00Z'); // bez wyjazdu: do końca przejazdu (15 min)
    expect(
      await rows(
        `SELECT zone_code, zone_type::text, entries, rides, total_seconds_in_zone::int, avg_seconds_in_zone::text
         FROM fn_report_rides_zone_entries($1, $2, $3)`,
        [OCT25, OCT27, p02],
      ),
    ).toEqual([
      {
        zone_code: 'S-01',
        zone_type: 'SLOW',
        entries: 2,
        rides: 2,
        total_seconds_in_zone: 1080,
        avg_seconds_in_zone: '540.0',
      },
    ]);
    expect(
      await rows(`SELECT end_mode::text, rides, towed, outside_parking FROM fn_report_rides_end_modes($1, $2, $3)`, [
        OCT25,
        OCT27,
        p02,
      ]),
    ).toEqual([
      { end_mode: 'CUSTOMER', rides: 2, towed: 0, outside_parking: 0 },
      { end_mode: 'REMOTE', rides: 1, towed: 1, outside_parking: 0 },
    ]);

    // Pulpit: przejazdy z poniedziałku 26.10 według godzin i średnia z czterech poprzednich poniedziałków.
    const hours = await rows<{ hour: number; rides: number; avg_previous: string }>(
      `SELECT hour, rides, avg_previous::text FROM fn_dashboard_rides_by_hour('2026-10-26')`,
    );
    expect(hours).toHaveLength(24);
    expect(hours.filter((h) => h.rides > 0 || Number(h.avg_previous) > 0)).toEqual([
      { hour: 7, rides: 1, avg_previous: '0.25' },
    ]);
  });

  // ------------------------------------------------------------------------------------------
  // Awaryjność
  // ------------------------------------------------------------------------------------------

  it('awaryjność: zgłoszenia według kategorii i źródła (zamknięte OFFLINE też), zadania, czas naprawy, MTBF, części', async () => {
    const reporter = await user();
    const staff = await staffId();
    const s = await scooter();
    await interval(s, 'IN_USE', true, '2026-10-25T03:00:00Z', '2026-10-25T05:00:00Z');
    await interval(s, 'MAINTENANCE', true, '2026-10-25T05:00:00Z', '2026-10-25T10:00:00Z');
    const ticket = (values: {
      source: string;
      categories: string;
      auto?: string;
      status?: string;
      at: string;
      resolved?: string;
    }) =>
      pool.query(
        `INSERT INTO tickets (scooter_id, reported_by, source, categories, urgent, auto_kind, status, created_at, resolved_at)
         VALUES ($1, CASE WHEN $2 = 'USER' THEN $3::uuid END, $2::ticket_source, $4::ticket_category[],
                 $4::ticket_category[] && '{BRAKES,WHEEL,HANDLEBAR}', $5::ticket_auto_kind, $6::ticket_status, $7, $8)`,
        [
          s,
          values.source,
          reporter,
          values.categories,
          values.auto ?? null,
          values.status ?? 'NEW',
          values.at,
          values.resolved ?? null,
        ],
      );
    await ticket({
      source: 'USER',
      categories: '{BRAKES}',
      status: 'RESOLVED',
      at: '2026-10-25T05:00:00Z',
      resolved: '2026-10-25T10:00:00Z',
    });
    await ticket({
      source: 'AUTO',
      categories: '{CONNECTION}',
      auto: 'OFFLINE',
      status: 'RESOLVED',
      at: '2026-10-25T10:05:00Z',
      resolved: '2026-10-25T11:55:00Z',
    });
    await ticket({ source: 'AUTO', categories: '{BATTERY}', auto: 'BATTERY_CRITICAL', at: '2026-10-25T12:00:00Z' });
    await ticket({ source: 'STAFF', categories: '{OUT_OF_ZONE}', at: '2026-10-25T13:00:00Z' });

    const part = await id(
      `INSERT INTO spare_parts (sku, name, unit_cost, stock_qty, min_stock_qty) VALUES ('REP-BRAKE', 'Klocki', 1500, 10, 2)
       RETURNING id`,
    );
    const task = await id(
      `INSERT INTO service_tasks (scooter_id, type, created_at) VALUES ($1, 'REPAIR', '2026-10-25T05:10:00Z') RETURNING id`,
      [s],
    );
    await pool.query(
      `UPDATE service_tasks SET status = 'IN_PROGRESS', assignee_id = $2, started_at = '2026-10-25T06:00:00Z' WHERE id = $1`,
      [task, staff],
    );
    await pool.query(
      `INSERT INTO service_task_parts (task_id, part_id, quantity, unit_cost) VALUES ($1, $2, 2, 1500)`,
      [task, part],
    );
    await pool.query(
      `UPDATE service_tasks SET status = 'DONE', result_note = 'Wymiana klocków', completed_at = '2026-10-25T09:00:00Z'
       WHERE id = $1`,
      [task],
    );

    expect(
      await one(
        `SELECT tickets, user_tickets, auto_tickets, staff_tickets, offline_tickets, urgent_tickets, failures, tasks_created,
                tasks_done, avg_repair_seconds::text, parts_cost::int, service_seconds::int, in_ride_seconds::int,
                mtbf_hours::text
         FROM fn_report_reliability_by_scooter($1, $2, NULL, $3)`,
        [OCT25, OCT26, s],
      ),
    ).toEqual({
      tickets: 4,
      user_tickets: 1,
      auto_tickets: 2,
      staff_tickets: 1,
      offline_tickets: 1,
      urgent_tickets: 1,
      failures: 2,
      tasks_created: 1,
      tasks_done: 1,
      avg_repair_seconds: '10800.0',
      parts_cost: 3000,
      service_seconds: 18000,
      in_ride_seconds: 7200,
      mtbf_hours: '1.00',
    });
    expect(
      await rows(
        `SELECT category::text, source::text, tickets, urgent, resolved, open, avg_resolution_seconds::text
         FROM fn_report_reliability_tickets($1, $2, NULL, $3)`,
        [OCT25, OCT26, s],
      ),
    ).toEqual([
      {
        category: 'BRAKES',
        source: 'USER',
        tickets: 1,
        urgent: 1,
        resolved: 1,
        open: 0,
        avg_resolution_seconds: '18000.0',
      },
      {
        category: 'BATTERY',
        source: 'AUTO',
        tickets: 1,
        urgent: 0,
        resolved: 0,
        open: 1,
        avg_resolution_seconds: null,
      },
      {
        category: 'CONNECTION',
        source: 'AUTO',
        tickets: 1,
        urgent: 0,
        resolved: 1,
        open: 0,
        avg_resolution_seconds: '6600.0',
      },
      {
        category: 'OUT_OF_ZONE',
        source: 'STAFF',
        tickets: 1,
        urgent: 0,
        resolved: 0,
        open: 1,
        avg_resolution_seconds: null,
      },
    ]);
    expect(
      await rows(
        `SELECT task_type::text, created, done, cancelled, open, avg_wait_seconds::text, avg_repair_seconds::text, parts_cost::int
         FROM fn_report_reliability_tasks($1, $2, NULL, $3)`,
        [OCT25, OCT26, s],
      ),
    ).toEqual([
      {
        task_type: 'REPAIR',
        created: 1,
        done: 1,
        cancelled: 0,
        open: 0,
        avg_wait_seconds: '3000.0',
        avg_repair_seconds: '10800.0',
        parts_cost: 3000,
      },
      {
        task_type: 'BATTERY_SWAP',
        created: 0,
        done: 0,
        cancelled: 0,
        open: 0,
        avg_wait_seconds: null,
        avg_repair_seconds: null,
        parts_cost: 0,
      },
      {
        task_type: 'INSPECTION',
        created: 0,
        done: 0,
        cancelled: 0,
        open: 0,
        avg_wait_seconds: null,
        avg_repair_seconds: null,
        parts_cost: 0,
      },
      {
        task_type: 'RELOCATION',
        created: 0,
        done: 0,
        cancelled: 0,
        open: 0,
        avg_wait_seconds: null,
        avg_repair_seconds: null,
        parts_cost: 0,
      },
    ]);
    expect(
      await rows(
        `SELECT sku, quantity, cost::int, tasks, below_minimum FROM fn_report_reliability_parts($1, $2, NULL, $3)`,
        [OCT25, OCT26, s],
      ),
    ).toEqual([{ sku: 'REP-BRAKE', quantity: 2, cost: 3000, tasks: 1, below_minimum: false }]);
    const model = await one<{ failures: number; mtbf_hours: string | null }>(
      `SELECT failures, mtbf_hours::text FROM fn_report_reliability_by_model($1, $2)`,
      [OCT25, OCT26],
    );
    expect(model.failures).toBeGreaterThanOrEqual(2);

    // Części poniżej minimum: reguła `<` jak w core i `v_spare_part_list` (stan równy minimum nie jest brakiem).
    await pool.query(
      `INSERT INTO spare_parts (sku, name, unit_cost, stock_qty, min_stock_qty) VALUES
         ('REP-EQUAL', 'Na minimum', 100, 3, 3), ('REP-LOW', 'Poniżej', 250, 1, 4)`,
    );
    const low = await rows<{ sku: string; shortage: number; restock_cost: string }>(
      `SELECT sku, shortage, restock_cost FROM fn_report_reliability_low_stock() WHERE sku LIKE 'REP-%'`,
    );
    expect(low).toEqual([{ sku: 'REP-LOW', shortage: 3, restock_cost: '750' }]);
    const view = await rows<{ sku: string }>(`SELECT sku FROM v_low_stock_parts WHERE sku LIKE 'REP-%'`);
    expect(view.map((v) => v.sku)).toEqual(['REP-LOW']);
  });

  // ------------------------------------------------------------------------------------------
  // Użytkownicy (sierpień 2026)
  // ------------------------------------------------------------------------------------------

  it('użytkownicy: rejestracje, aktywni, nowi i powracający, blokady, usunięcia, zgody marketingowe, kohorty', async () => {
    const AUG = '2026-07-31T22:00:00Z';
    const SEP = '2026-08-31T22:00:00Z';
    const OCT = '2026-09-30T22:00:00Z';
    const s = await scooter();
    const u1 = await user({ createdAt: '2026-07-15T10:00:00Z' });
    const u2 = await user({ createdAt: '2026-08-05T10:00:00Z' });
    const u3 = await user({ createdAt: '2026-08-20T10:00:00Z' });
    // 1.08 0:30 czasu polskiego: w sierpniu; 1.09 0:30: we wrześniu.
    const u4 = await user({ createdAt: '2026-07-31T22:30:00Z' });
    await user({ createdAt: '2026-08-31T22:30:00Z' });
    const ride = (u: string, at: string) => rental(u, s, { startedAt: at, endedAt: at });
    await ride(u1, '2026-07-20T10:00:00Z');
    await ride(u1, '2026-08-10T10:00:00Z');
    await ride(u2, '2026-08-06T10:00:00Z');
    await ride(u2, '2026-09-02T10:00:00Z');
    await pool.query(
      `UPDATE users SET status = 'BLOCKED', blocked_at = '2026-08-22T10:00:00Z', blocked_reason = 'TERMS_VIOLATION'
       WHERE id = $1`,
      [u3],
    );
    await pool.query(
      `UPDATE users SET status = 'DELETED', phone = NULL, deleted_at = '2026-08-15T10:00:00Z' WHERE id = $1`,
      [u4],
    );
    await pool.query(
      `INSERT INTO consents (user_id, type, document_version, accepted_at, revoked_at) VALUES
         ($1, 'MARKETING', '1', '2026-07-15T10:00:00Z', NULL),
         ($2, 'MARKETING', '1', '2026-08-20T10:00:00Z', '2026-08-25T10:00:00Z')`,
      [u1, u3],
    );

    expect(await one(`SELECT * FROM fn_report_users_summary($1, $2)`, [AUG, SEP])).toEqual({
      registrations: 3,
      active_users: 2,
      new_users: 1,
      returning_users: 1,
      blocked_users: 1,
      deleted_users: 1,
      marketing_granted: 1,
      marketing_revoked: 1,
      marketing_active_at_end: 1,
      customers_at_end: 3,
    });
    const series = await rows(
      `SELECT bucket::text, registrations, active_users, new_users, returning_users FROM fn_report_users_series($1, $2, 'month')`,
      [AUG, OCT],
    );
    expect(series).toEqual([
      { bucket: '2026-08-01', registrations: 3, active_users: 2, new_users: 1, returning_users: 1 },
      { bucket: '2026-09-01', registrations: 1, active_users: 1, new_users: 0, returning_users: 1 },
    ]);
    expect(
      await rows(
        `SELECT cohort_month::text, cohort_size, month_offset, active_users FROM fn_report_users_cohorts($1, $2)`,
        [AUG, OCT],
      ),
    ).toEqual([
      { cohort_month: '2026-08-01', cohort_size: 3, month_offset: 0, active_users: 1 },
      { cohort_month: '2026-08-01', cohort_size: 3, month_offset: 1, active_users: 1 },
      { cohort_month: '2026-09-01', cohort_size: 1, month_offset: 0, active_users: 0 },
    ]);
  });

  // ------------------------------------------------------------------------------------------
  // Portfel (czerwiec 2026)
  // ------------------------------------------------------------------------------------------

  it('portfel: saldo na granicach okresu z balance_after, obroty według typu, korekty, przedziały sald, zaległości', async () => {
    const JUN = '2026-05-31T22:00:00Z';
    const JUL = '2026-06-30T22:00:00Z';
    const w1 = await user({ createdAt: '2026-05-01T10:00:00Z' });
    const w2 = await user({ createdAt: '2026-05-02T10:00:00Z' });
    const entry = (u: string, type: string, amount: number, after: number, at: string, reason: string | null = null) =>
      pool.query(
        `INSERT INTO wallet_ledger (user_id, type, amount, balance_after, reason, created_at)
         VALUES ($1, $2::ledger_entry_type, $3, $4, $5::ledger_reason, $6)`,
        [u, type, amount, after, reason, at],
      );
    await entry(w1, 'TOPUP', 5000, 5000, '2026-05-31T21:00:00Z'); // 31.05 23:00: przed okresem
    await entry(w1, 'RIDE_CHARGE', -1200, 3800, '2026-06-10T10:00:00Z');
    await entry(w1, 'ADJUSTMENT', 300, 4100, '2026-06-12T10:00:00Z', 'GOODWILL');
    await entry(w1, 'ADJUSTMENT', -100, 4000, '2026-06-13T10:00:00Z', 'SYSTEM_ERROR');
    await entry(w2, 'TOPUP', 20000, 20000, '2026-06-30T21:30:00Z'); // 30.06 23:30: jeszcze w okresie
    await entry(w2, 'RIDE_CHARGE', -50, 19950, '2026-06-30T22:30:00Z'); // 1.07 0:30: po okresie

    expect(await one(`SELECT * FROM fn_report_wallet_summary($1, $2)`, [JUN, JUL])).toEqual({
      opening_balance: '5000',
      closing_balance: '24000',
      opening_nonzero_wallets: 1,
      closing_nonzero_wallets: 2,
      entries: 4,
      credits: '20300',
      debits: '-1300',
    });
    expect(
      await rows(
        `SELECT entry_type::text, entries, credits::int, debits::int, net::int FROM fn_report_wallet_turnover($1, $2)`,
        [JUN, JUL],
      ),
    ).toEqual([
      { entry_type: 'TOPUP', entries: 1, credits: 20000, debits: 0, net: 20000 },
      { entry_type: 'RIDE_CHARGE', entries: 1, credits: 0, debits: -1200, net: -1200 },
      { entry_type: 'ADJUSTMENT', entries: 2, credits: 300, debits: -100, net: 200 },
    ]);
    expect(
      await rows(`SELECT reason::text, entries, net::int FROM fn_report_wallet_adjustments($1, $2)`, [JUN, JUL]),
    ).toEqual([
      { reason: 'SYSTEM_ERROR', entries: 1, net: -100 },
      { reason: 'GOODWILL', entries: 1, net: 300 },
    ]);
    const ranges = await rows<{ range_no: number; wallets: number; total_amount: string }>(
      `SELECT range_no, wallets, total_amount FROM fn_report_wallet_balance_ranges($1, $2)`,
      [JUN, JUL],
    );
    expect(ranges.map((r) => [r.range_no, r.wallets, Number(r.total_amount)])).toEqual([
      [1, 0, 0],
      [2, 0, 0],
      [3, 0, 0],
      [4, 1, 4000],
      [5, 0, 0],
      [6, 1, 20000],
      [7, 0, 0],
    ]);

    const s = await scooter();
    const unpaid = await rental(w1, s, {
      state: 'UNPAID',
      startedAt: '2026-06-15T10:00:00Z',
      endedAt: '2026-06-15T10:30:00Z',
      endMode: 'CUSTOMER',
      totalAmount: 990,
    });
    const repaid = await rental(w2, s, {
      startedAt: '2026-06-16T10:00:00Z',
      endedAt: '2026-06-16T10:30:00Z',
      totalAmount: 700,
    });
    const pay = (rentalId: string, user: string, status: string, amount: number, at: string) =>
      pool.query(
        `INSERT INTO payments (user_id, purpose, rental_id, method, amount, status, idempotency_key, created_at)
         VALUES ($1, 'RIDE', $2, 'CARD', $3, $4::payment_status, gen_random_uuid()::text, $5)`,
        [user, rentalId, amount, status, at],
      );
    await pay(unpaid, w1, 'FAILED', 990, '2026-06-15T10:31:00Z');
    await pay(repaid, w2, 'FAILED', 700, '2026-06-16T10:31:00Z');
    await pay(repaid, w2, 'SUCCEEDED', 700, '2026-06-17T10:00:00Z');
    expect(await one(`SELECT * FROM fn_report_wallet_arrears($1, $2)`, [JUN, JUL])).toEqual({
      unpaid_rentals: 1,
      unpaid_users: 1,
      unpaid_amount: '990',
      period_unpaid_rentals: 1,
      period_unpaid_amount: '990',
      period_repaid_rentals: 1,
      period_repaid_amount: '700',
    });
  });

  it('fn_report_earliest_data zwraca najwcześniejszą datę źródła raportu, a nieznany raport to NOT_FOUND', async () => {
    const at = async (code: string) =>
      (await one<{ at: Date | null }>(`SELECT fn_report_earliest_data($1) AS at`, [code])).at?.toISOString() ?? null;
    expect(await at('wallet')).toBe('2026-05-31T21:00:00.000Z');
    expect(await at('users')).toBe('2026-05-01T10:00:00.000Z');
    expect(await at('rides_by_zone')).toBe('2026-06-15T10:00:00.000Z');
    expect(await at('fleet_usage')).toBe('2026-06-15T10:00:00.000Z');
    expect(await domainCode(pool.query(`SELECT fn_report_earliest_data('sales')`))).toEqual({
      code: 'NOT_FOUND',
      details: { entity: 'report' },
    });
  });

  // ------------------------------------------------------------------------------------------
  // Uruchomienia i definicje raportów
  // ------------------------------------------------------------------------------------------

  it('report_runs: chwila danych, kod błędu, plik usunięty po retencji, bez CSV; widoki historii i definicji', async () => {
    const staff = await staffId();
    await pool.query(
      `INSERT INTO report_definitions (code, name, description, permission_code, formats)
       VALUES ('revenue', 'Przychody', 'Sprzedaż i wpływy', 'reports.revenue', '{PDF,XLSX}')`,
    );
    const run = (format = 'PDF') =>
      id(
        `INSERT INTO report_runs (report_code, format, params, requested_by)
         VALUES ('revenue', $1::report_format, '{"from":"2026-10-01","to":"2026-10-31","preset":"previous_month"}', $2)
         RETURNING id`,
        [format, staff],
      );
    await expect(run('CSV')).rejects.toThrow(/report_runs_format_check/);
    const first = await run();
    await expect(
      pool.query(`UPDATE report_runs SET status = 'FAILED', finished_at = now(), error = 'x' WHERE id = $1`, [first]),
    ).rejects.toThrow(/report_runs_failed_code/);
    await pool.query(
      `UPDATE report_runs SET status = 'FAILED', finished_at = now(), error_code = 'REPORT_RENDER_TIMEOUT' WHERE id = $1`,
      [first],
    );
    const retry = await id(
      `INSERT INTO report_runs (report_code, format, params, requested_by, retry_of)
       SELECT report_code, format, params, requested_by, id FROM report_runs WHERE id = $1 RETURNING id`,
      [first],
    );
    const file = await id(
      `INSERT INTO files (storage_key, purpose, content_type, size_bytes)
       VALUES ('report/' || gen_random_uuid(), 'REPORT_EXPORT', 'application/pdf', 2048) RETURNING id`,
    );
    await expect(
      pool.query(`UPDATE report_runs SET status = 'SUCCEEDED', file_id = $2, finished_at = now() WHERE id = $1`, [
        retry,
        file,
      ]),
    ).rejects.toThrow(/report_runs_data_as_of/);
    await pool.query(
      `UPDATE report_runs SET status = 'SUCCEEDED', file_id = $2, started_at = now() - interval '2 seconds', finished_at = now(),
              data_as_of = now() - interval '2 seconds', row_count = 31, page_count = 3, file_deleted_at = now()
       WHERE id = $1`,
      [retry, file],
    );
    const list = await rows(
      `SELECT short_id = left(id::text, 8) AS short, report_name, state, requested_by_name, requested_by_roles,
              file_size_bytes, row_count, page_count, error_code, retry_of, duration_ms
       FROM v_report_run_list ORDER BY created_at, id`,
    );
    expect(list).toEqual([
      {
        short: true,
        report_name: 'Przychody',
        state: 'FAILED',
        requested_by_name: 'Piotr Mazur',
        requested_by_roles: ['Administrator'],
        file_size_bytes: null,
        row_count: null,
        page_count: null,
        error_code: 'REPORT_RENDER_TIMEOUT',
        retry_of: null,
        duration_ms: null,
      },
      {
        short: true,
        report_name: 'Przychody',
        state: 'FILE_DELETED',
        requested_by_name: 'Piotr Mazur',
        requested_by_roles: ['Administrator'],
        file_size_bytes: 2048,
        row_count: 31,
        page_count: 3,
        error_code: null,
        retry_of: first,
        duration_ms: 2000,
      },
    ]);
    expect(
      await one(
        `SELECT runs, last_run_id, last_run_state, permission_roles FROM v_report_definitions WHERE code = 'revenue'`,
      ),
    ).toEqual({ runs: 2, last_run_id: retry, last_run_state: 'FILE_DELETED', permission_roles: ['Administrator'] });
    expect(
      await domainCode(pool.query(`UPDATE report_definitions SET name = repeat('x', 81) WHERE code = 'revenue'`)),
    ).toEqual({ code: 'VALIDATION_FAILED', details: undefined });
  });

  // ------------------------------------------------------------------------------------------
  // Uprawnienia, szablony wydruków i widoki nowych list (ADR 0076)
  // ------------------------------------------------------------------------------------------

  it('uprawnienia: reports.manage tylko w roli Administrator, lista z rolami, opis do 160 znaków z wersją', async () => {
    expect(PERMISSIONS).toContain('reports.manage');
    const permissions = await rows<{
      code: string;
      roles_count: number;
      role_names: string[];
      in_administrator: boolean;
    }>(
      `SELECT code, roles_count, role_names, in_administrator FROM v_permission_list WHERE code LIKE 'reports.%' ORDER BY code`,
    );
    expect(permissions.find((p) => p.code === 'reports.manage')).toEqual({
      code: 'reports.manage',
      roles_count: 1,
      role_names: ['Administrator'],
      in_administrator: true,
    });
    expect(permissions.find((p) => p.code === 'reports.fleet_usage')?.role_names).toEqual([
      'Administrator',
      'Dyspozytor',
    ]);
    expect((await one<{ n: number }>(`SELECT count(*)::int AS n FROM v_permission_list`)).n).toBe(PERMISSIONS.length);
    expect(
      await domainCode(
        pool.query(`UPDATE permissions SET description = repeat('x', 161) WHERE code = 'reports.manage'`),
      ),
    ).toEqual({ code: 'VALIDATION_FAILED', details: undefined });
    expect(await one(`SELECT version, updated_by FROM permissions WHERE code = 'reports.manage'`)).toEqual({
      version: 1,
      updated_by: null,
    });
  });

  it('szablon wydruku: dezaktywacja z TEMPLATE_IS_DEFAULT dla domyślnego z aktywną wersją, ponowna aktywacja, pola i wydruki z 30 dni', async () => {
    const staff = await staffId();
    const template = (name: string) =>
      id(`INSERT INTO document_templates (document_type, name) VALUES ('RENTAL_CONFIRMATION', $1) RETURNING id`, [
        name,
      ]);
    const version = async (templateId: string) => {
      const file = await id(
        `INSERT INTO files (storage_key, purpose, content_type) VALUES ('document-template/test/' || gen_random_uuid(),
           'DOCUMENT_TEMPLATE', 'x') RETURNING id`,
      );
      const versionId = await id(
        `INSERT INTO document_template_versions (template_id, version_no, file_id, fields, size_bytes, uncompressed_bytes)
         VALUES ($1, 1, $2, '{rental.number,rental.startedAt,user.name}', 1, 1) RETURNING id`,
        [templateId, file],
      );
      await pool.query(`CALL sp_document_template_activate($1, $2)`, [versionId, staff]);
      return versionId;
    };
    const main = await template('Potwierdzenie testowe');
    const mainVersion = await version(main);
    await pool.query(`CALL sp_document_template_set_default($1)`, [main]);
    const other = await template('Potwierdzenie zapasowe');
    await version(other);
    const empty = await template('Bez wersji');

    const deactivate = (templateId: string) =>
      one<{ changed: boolean }>(`CALL sp_document_template_deactivate($1, $2, NULL)`, [templateId, staff]);
    expect(await domainCode(deactivate(main))).toEqual({ code: 'TEMPLATE_IS_DEFAULT', details: undefined });
    expect(await deactivate(other)).toEqual({ changed: true });
    expect(await deactivate(other)).toEqual({ changed: false });
    expect(await deactivate(empty)).toEqual({ changed: true });
    expect(await domainCode(one(`CALL sp_document_template_deactivate(gen_random_uuid(), NULL, NULL)`))).toEqual({
      code: 'NOT_FOUND',
      details: { entity: 'document_template' },
    });

    await pool.query(
      `INSERT INTO generated_documents (document_type, template_version_id, entity_ref, entity_label, format, status,
                                        requested_by_staff, created_at)
       VALUES ('RENTAL_CONFIRMATION', $1, 'R-1', 'R-1', 'PDF', 'QUEUED', $2, now() - interval '1 day'),
              ('RENTAL_CONFIRMATION', $1, 'R-2', 'R-2', 'PDF', 'QUEUED', $2, now() - interval '40 days')`,
      [mainVersion, staff],
    );
    const view = await rows(
      `SELECT name, active, is_default, deactivated_at IS NOT NULL AS deactivated, active_fields, generated_30d
       FROM v_document_templates WHERE document_type = 'RENTAL_CONFIRMATION' AND id = ANY($1) ORDER BY name`,
      [[main, other, empty]],
    );
    expect(view).toEqual([
      { name: 'Bez wersji', active: false, is_default: false, deactivated: true, active_fields: 0, generated_30d: 0 },
      {
        name: 'Potwierdzenie testowe',
        active: true,
        is_default: true,
        deactivated: false,
        active_fields: 3,
        generated_30d: 1,
      },
      {
        name: 'Potwierdzenie zapasowe',
        active: false,
        is_default: false,
        deactivated: true,
        active_fields: 3,
        generated_30d: 0,
      },
    ]);

    expect(await one(`CALL sp_document_template_reactivate($1, $2, NULL)`, [other, staff])).toEqual({ changed: true });
    expect(await one(`CALL sp_document_template_reactivate($1, $2, NULL)`, [other, staff])).toEqual({ changed: false });
    expect(
      await one(`SELECT active, is_default, deactivated_at FROM document_templates WHERE id = $1`, [other]),
    ).toEqual({ active: true, is_default: false, deactivated_at: null });
  });

  it('v_otp_code_list maskuje numer do trzech cyfr, nie ma skrótu kodu, liczy stan i warunek usuwania', async () => {
    const customer = await user({ name: 'Ewa Kod' });
    const phone = (await one<{ phone: string }>(`SELECT phone FROM users WHERE id = $1`, [customer])).phone;
    const code = (values: {
      phone: string;
      attempts?: number;
      consumed?: boolean;
      expires: string;
      purpose?: string;
    }) =>
      id(
        `INSERT INTO otp_codes (phone, code_hash, attempts, expires_at, consumed_at, purpose)
         VALUES ($1, 'hash', $2, now() + $3::interval, CASE WHEN $4 THEN now() END, $5::otp_purpose) RETURNING id`,
        [values.phone, values.attempts ?? 0, values.expires, values.consumed ?? false, values.purpose ?? 'LOGIN'],
      );
    const active = await code({ phone, expires: '5 minutes' });
    const blocked = await code({ phone, attempts: OTP_POLICY.maxAttempts, expires: '5 minutes' });
    const used = await code({ phone, consumed: true, expires: '5 minutes' });
    const old = await code({ phone: '+420123456789', expires: '-2 days', purpose: 'REGISTER' });
    const list = await rows(
      `SELECT id, phone_masked, phone_last3, user_name, purpose::text, state, purgeable
       FROM v_otp_code_list WHERE id = ANY($1)`,
      [[active, blocked, used, old]],
    );
    const masked = `+48 ••• ••• ${phone.slice(-3)}`;
    expect(new Map(list.map((r) => [r.id, r]))).toEqual(
      new Map([
        [
          active,
          {
            id: active,
            phone_masked: masked,
            phone_last3: phone.slice(-3),
            user_name: 'Ewa Kod',
            purpose: 'LOGIN',
            state: 'ACTIVE',
            purgeable: false,
          },
        ],
        [
          blocked,
          {
            id: blocked,
            phone_masked: masked,
            phone_last3: phone.slice(-3),
            user_name: 'Ewa Kod',
            purpose: 'LOGIN',
            state: 'BLOCKED',
            purgeable: false,
          },
        ],
        [
          used,
          {
            id: used,
            phone_masked: masked,
            phone_last3: phone.slice(-3),
            user_name: 'Ewa Kod',
            purpose: 'LOGIN',
            state: 'CONSUMED',
            purgeable: false,
          },
        ],
        [
          old,
          {
            id: old,
            phone_masked: '••• 789',
            phone_last3: '789',
            user_name: null,
            purpose: 'REGISTER',
            state: 'EXPIRED',
            purgeable: true,
          },
        ],
      ]),
    );
    const columns = await rows<{ column_name: string }>(
      `SELECT column_name FROM information_schema.columns WHERE table_name = 'v_otp_code_list'`,
    );
    expect(columns.map((c) => c.column_name)).not.toContain('phone');
    expect(columns.map((c) => c.column_name)).not.toContain('code_hash');
  });

  it('v_session_list i v_staff_session_list: jeden wiersz na rodzinę tokenów bez skrótu tokenu, stan bieżącego wiersza', async () => {
    const customer = await user();
    const session = (values: { family: string; revoked?: boolean; expires?: string; created: string }) =>
      id(
        `INSERT INTO sessions (user_id, family_id, refresh_token_hash, device_name, platform, app_version, expires_at,
                               revoked_at, created_at)
         VALUES ($1, $2, gen_random_uuid()::text, 'iPhone', 'IOS', '1.4.0', now() + $3::interval,
                 CASE WHEN $4 THEN now() END, now() + $5::interval) RETURNING id`,
        [customer, values.family, values.expires ?? '30 days', values.revoked ?? false, values.created],
      );
    const rotating = randomUUID();
    const first = await session({ family: rotating, revoked: true, created: '-3 hours' });
    const second = await session({ family: rotating, revoked: true, created: '-2 hours' });
    const third = await session({ family: rotating, created: '-1 hour' });
    await pool.query(`UPDATE sessions SET replaced_by = $2 WHERE id = $1`, [first, second]);
    await pool.query(`UPDATE sessions SET replaced_by = $2 WHERE id = $1`, [second, third]);
    const loggedOut = randomUUID();
    await session({ family: loggedOut, revoked: true, created: '-5 hours' });
    const expired = randomUUID();
    await session({ family: expired, expires: '-1 hour', created: '-40 days' });

    const list = await rows(
      `SELECT id, short_id, current_session_id, platform::text, app_version, rotations, state
       FROM v_session_list WHERE user_id = $1 ORDER BY created_at`,
      [customer],
    );
    expect(list).toEqual([
      {
        id: expired,
        short_id: expect.any(String),
        current_session_id: expect.any(String),
        platform: 'IOS',
        app_version: '1.4.0',
        rotations: 0,
        state: 'EXPIRED',
      },
      {
        id: loggedOut,
        short_id: expect.any(String),
        current_session_id: expect.any(String),
        platform: 'IOS',
        app_version: '1.4.0',
        rotations: 0,
        state: 'REVOKED',
      },
      {
        id: rotating,
        short_id: first.slice(0, 8),
        current_session_id: third,
        platform: 'IOS',
        app_version: '1.4.0',
        rotations: 2,
        state: 'ACTIVE',
      },
    ]);
    const columns = await rows<{ column_name: string }>(
      `SELECT column_name FROM information_schema.columns WHERE table_name IN ('v_session_list', 'v_staff_session_list')`,
    );
    expect(columns.map((c) => c.column_name)).not.toContain('refresh_token_hash');

    const staff = await staffId();
    const family = randomUUID();
    await pool.query(
      `INSERT INTO staff_sessions (staff_id, family_id, refresh_token_hash, user_agent, expires_at, remembered)
       VALUES ($1, $2, gen_random_uuid()::text, 'Firefox', now() + interval '7 days', true)`,
      [staff, family],
    );
    expect(await one(`SELECT staff_name, remembered, state FROM v_staff_session_list WHERE id = $1`, [family])).toEqual(
      {
        staff_name: 'Piotr Mazur',
        remembered: true,
        state: 'ACTIVE',
      },
    );
  });

  it('zaproszenia: ponowne wysłanie to stan REPLACED, ręczne unieważnienie REVOKED', async () => {
    const operator = await id(
      `INSERT INTO staff (email, name) VALUES ('nowy@test.local', 'Nowy Operator') RETURNING id`,
    );
    const invite = (expires = '72 hours') =>
      id(
        `INSERT INTO staff_invitations (staff_id, token_hash, expires_at) VALUES ($1, gen_random_uuid()::text, now() + $2::interval)
         RETURNING id`,
        [operator, expires],
      );
    const first = await invite();
    await pool.query(`UPDATE staff_invitations SET revoked_at = now() WHERE id = $1`, [first]);
    const second = await invite();
    await pool.query(`UPDATE staff_invitations SET replaced_by = $2 WHERE id = $1`, [first, second]);
    await expect(pool.query(`UPDATE staff_invitations SET replaced_by = $1 WHERE id = $1`, [second])).rejects.toThrow(
      /staff_invitations_replaced/,
    );
    await pool.query(`UPDATE staff_invitations SET revoked_at = now() WHERE id = $1`, [second]);
    const third = await invite();
    const list = await rows(
      `SELECT id, state, is_resend FROM v_staff_invitation_list WHERE staff_id = $1 ORDER BY created_at, id`,
      [operator],
    );
    expect(new Map(list.map((r) => [r.id, [r.state, r.is_resend]]))).toEqual(
      new Map([
        [first, ['REPLACED', false]],
        [second, ['REVOKED', true]],
        [third, ['PENDING', true]],
      ]),
    );
  });

  it('komendy: źródło uzupełnia wyzwalacz (operator, strefa, przejazd, system), strefa tylko przy komendzie strefy', async () => {
    const s = await scooter();
    const staff = await staffId();
    const u = await user();
    const ride = await rental(u, s, { startedAt: '2026-11-01T10:00:00Z', endedAt: '2026-11-01T10:30:00Z' });
    const slow = await zone('S-01');
    const command = (values: { type: string; staff?: string; rental?: string; source?: string; zone?: string }) =>
      id(
        `INSERT INTO scooter_commands (scooter_id, type, issued_by_staff, rental_id, source, zone_id)
         VALUES ($1, $2::command_type, $3, $4, $5::command_source, $6) RETURNING id`,
        [s, values.type, values.staff ?? null, values.rental ?? null, values.source ?? null, values.zone ?? null],
      );
    const byStaff = await command({ type: 'RING', staff });
    const byZone = await command({ type: 'SPEED_LIMIT', rental: ride, zone: slow, source: 'ZONE' });
    const derivedZone = await command({ type: 'STOP_GRADUALLY', rental: ride });
    const byRental = await command({ type: 'LOCK', rental: ride });
    const bySystem = await command({ type: 'LOCK' });
    await pool.query(
      `UPDATE scooter_commands SET status = 'ACKED', acked_at = sent_at + interval '1.5 seconds' WHERE id = $1`,
      [byStaff],
    );
    const list = await rows(
      `SELECT id, source::text, zone_code, staff_name, rental_number IS NOT NULL AS has_rental, response_ms
       FROM v_scooter_command_list WHERE scooter_id = $1`,
      [s],
    );
    expect(
      new Map(list.map((r) => [r.id, [r.source, r.zone_code, r.staff_name, r.has_rental, r.response_ms]])),
    ).toEqual(
      new Map([
        [byStaff, ['STAFF', null, 'Piotr Mazur', false, 1500]],
        [byZone, ['ZONE', 'S-01', null, true, null]],
        [derivedZone, ['ZONE', null, null, true, null]],
        [byRental, ['RENTAL', null, null, true, null]],
        [bySystem, ['SYSTEM', null, null, false, null]],
      ]),
    );
    await expect(command({ type: 'RING', source: 'STAFF' })).rejects.toThrow(/scooter_commands_staff_source/);
    await expect(command({ type: 'LOCK', zone: slow })).rejects.toThrow(/scooter_commands_zone_source/);
  });

  it('zgody: lista ze stanem i źródłem, operator wycofuje tylko zgodę marketingową', async () => {
    const customer = await user();
    const staff = await staffId();
    const consent = (type: string, version: string, at: string) =>
      id(
        `INSERT INTO consents (user_id, type, document_version, accepted_at, source)
         VALUES ($1, $2::consent_type, $3, $4, 'REGISTRATION') RETURNING id`,
        [customer, type, version, at],
      );
    const terms1 = await consent('TERMS', '1', '2026-11-01T10:00:00Z');
    const terms2 = await consent('TERMS', '2', '2026-11-02T10:00:00Z');
    const age = await consent('AGE', '1', '2026-11-01T10:00:00Z');
    const marketing = await consent('MARKETING', '1', '2026-11-01T10:00:00Z');
    expect(
      await domainCode(
        pool.query(`UPDATE consents SET revoked_at = now(), revoked_by_staff = $2 WHERE id = $1`, [terms2, staff]),
      ),
    ).toEqual({ code: 'CONSENT_NOT_REVOCABLE', details: undefined });
    await pool.query(`UPDATE consents SET revoked_at = now(), revoked_by_staff = $2 WHERE id = $1`, [marketing, staff]);
    const list = await rows(
      `SELECT id, state, source::text, revoked_by_name, is_latest FROM v_consent_list WHERE user_id = $1`,
      [customer],
    );
    expect(new Map(list.map((r) => [r.id, [r.state, r.source, r.revoked_by_name, r.is_latest]]))).toEqual(
      new Map([
        [terms1, ['SUPERSEDED', 'REGISTRATION', null, false]],
        [terms2, ['CURRENT', 'REGISTRATION', null, true]],
        [age, ['CONFIRMED', 'REGISTRATION', null, true]],
        [marketing, ['REVOKED', 'REGISTRATION', 'Piotr Mazur', true]],
      ]),
    );
  });

  it('fn_telemetry_readings: strona od najnowszych albo najstarszych z odstępem od poprzedniego odczytu i polami locked, buffered', async () => {
    const s = await scooter();
    const reading = (at: string, battery: number) =>
      pool.query(
        `INSERT INTO telemetry (scooter_id, recorded_at, position, battery_pct, speed_kmh, locked, buffered)
         VALUES ($1, $2, ST_SetSRID(ST_MakePoint(18.5, 50.0), 4326), $3, 0, true, false)`,
        [s, at, battery],
      );
    await reading('2026-11-10T10:00:00Z', 50);
    await reading('2026-11-10T10:00:05Z', 40);
    await reading('2026-11-10T10:00:12Z', 25);
    const page = (newest: boolean, limit: number, below: number | null = null) =>
      rows(
        `SELECT recorded_at, battery_pct, locked, buffered, gap_seconds::float AS gap
         FROM fn_telemetry_readings($1, '2026-11-10T09:00:00Z', '2026-11-10T11:00:00Z', $2, $3, $4::smallint)`,
        [s, newest, limit, below],
      );
    expect(await page(true, 2)).toEqual([
      { recorded_at: new Date('2026-11-10T10:00:12Z'), battery_pct: 25, locked: true, buffered: false, gap: 7 },
      { recorded_at: new Date('2026-11-10T10:00:05Z'), battery_pct: 40, locked: true, buffered: false, gap: 5 },
    ]);
    expect(await page(false, 1)).toEqual([
      { recorded_at: new Date('2026-11-10T10:00:00Z'), battery_pct: 50, locked: true, buffered: false, gap: null },
    ]);
    // Filtr baterii nie zmienia odstępu: liczy się od poprzedniego odczytu bez filtra.
    expect((await page(true, 5, 30)).map((r) => [r.battery_pct, r.gap])).toEqual([[25, 7]]);
  });
});
