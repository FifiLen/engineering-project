import 'reflect-metadata';
import type * as shared from '@hulajnogi/shared';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { JOBS } from '../src/jobs/jobs.service.js';
import { asStaff, staffToken } from './helpers.js';
import { operationsContext, type OperationsContext } from './operations-helpers.js';

const adminUrl = process.env.DATABASE_URL;

describe.skipIf(!adminUrl)('API: Flota → Telemetria (ADR 0076)', () => {
  let ctx: OperationsContext;
  let scooterId: string;
  const base = Date.now() - 10 * 60_000;
  const at = (i: number) => new Date(base + i * 5_000);
  const range = { from: new Date(base - 60_000).toISOString(), to: new Date(base + 120_000).toISOString() };
  const url = (params: Record<string, string | number>) =>
    `/admin/telemetry?${new URLSearchParams(Object.entries(params).map(([k, v]): [string, string] => [k, String(v)]))}`;

  beforeAll(async () => {
    ctx = await operationsContext('telemetry_admin', 2);
    scooterId = await ctx.idOf(1);
    // 12 odczytów co 5 s; dwa z bufora po odzyskaniu łączności, jeden odblokowany z niską baterią.
    for (let i = 0; i < 12; i++) {
      await ctx.telemetry(1, { bat: i === 5 ? 9 : 80, locked: i !== 5, buffered: i === 3 || i === 4, at: at(i) });
    }
  });

  afterAll(async () => {
    await ctx?.close();
  });

  it('zapis locked i buffered z wiadomości MQTT (migracja 0013)', async () => {
    const rows = await ctx.pool.query<{ locked: boolean; buffered: boolean }>(
      `SELECT locked, buffered FROM telemetry WHERE scooter_id = $1 ORDER BY recorded_at`,
      [scooterId],
    );
    expect(rows.rows).toHaveLength(12);
    expect(rows.rows.filter((r) => r.buffered)).toHaveLength(2);
    expect(rows.rows.filter((r) => !r.locked)).toHaveLength(1);
  });

  it('strona od najnowszych z kursorem starszych i nowszych, bez liczby wszystkich, z przerwą między odczytami', async () => {
    const first = await ctx.staff.technician({ method: 'GET', url: url({ scooterId, ...range, pageSize: 10 }) });
    expect(first.statusCode).toBe(200);
    const page = first.json<shared.TelemetryReadingsPage>();
    expect(page).not.toHaveProperty('total');
    expect(page.items).toHaveLength(10);
    expect(page.items[0]!.recordedAt).toBe(at(11).toISOString());
    expect(page.items[0]).toMatchObject({
      batteryPct: 80,
      locked: true,
      buffered: false,
      gapSeconds: 5,
      lat: 50,
      lon: 18.5,
    });
    expect(page.newerCursor).toBeNull();
    expect(page.olderCursor).not.toBeNull();

    const older = (
      await ctx.staff.technician({
        method: 'GET',
        url: url({ scooterId, ...range, pageSize: 10, cursor: page.olderCursor! }),
      })
    ).json<shared.TelemetryReadingsPage>();
    expect(older.items.map((i) => i.recordedAt)).toEqual([at(1).toISOString(), at(0).toISOString()]);
    expect(older.olderCursor).toBeNull();
    expect(older.items.at(-1)!.gapSeconds).toBeNull();

    const newer = (
      await ctx.staff.technician({
        method: 'GET',
        url: url({ scooterId, ...range, pageSize: 10, cursor: older.newerCursor!, direction: 'newer' }),
      })
    ).json<shared.TelemetryReadingsPage>();
    expect(newer.items).toHaveLength(10);
    expect(newer.items[0]!.recordedAt).toBe(at(11).toISOString());

    const low = (
      await ctx.staff.technician({ method: 'GET', url: url({ scooterId, ...range, batteryBelow: 20 }) })
    ).json<shared.TelemetryReadingsPage>();
    expect(low.items).toEqual([expect.objectContaining({ batteryPct: 9, locked: false })]);
    const inRide = (
      await ctx.staff.technician({ method: 'GET', url: url({ scooterId, ...range, inRide: 'true' }) })
    ).json<shared.TelemetryReadingsPage>();
    expect(inRide.items).toEqual([]);
  });

  it('hulajnoga i zakres wymagane, najwyżej 24 h i w oknie retencji; bez telemetry.read 403', async () => {
    const day = 24 * 3_600_000;
    const now = Date.now();
    const cases: Array<Record<string, string>> = [
      { from: range.from, to: range.to },
      { scooterId, to: range.to },
      { scooterId, from: new Date(now - day - 1000).toISOString(), to: new Date(now).toISOString() },
      { scooterId, from: range.to, to: range.from },
      {
        scooterId,
        from: new Date(now - 100 * day).toISOString(),
        to: new Date(now - 100 * day + 3_600_000).toISOString(),
      },
    ];
    for (const params of cases) {
      const res = await ctx.staff.admin({ method: 'GET', url: url(params) });
      expect({ params, status: res.statusCode }).toEqual({ params, status: 400 });
      expect(res.json()).toMatchObject({ code: 'VALIDATION_ERROR' });
    }
    const editorId = (
      await ctx.pool.query<{ id: string }>(
        `INSERT INTO staff (email, name, password_hash) VALUES ('r@test.local', 'Redaktor', 'x') RETURNING id`,
      )
    ).rows[0]!.id;
    await ctx.pool.query(
      `INSERT INTO staff_roles (staff_id, role_id) SELECT $1, id FROM roles WHERE name = 'Redaktor'`,
      [editorId],
    );
    const editor = asStaff(ctx.app, staffToken(ctx.app, editorId));
    expect((await editor({ method: 'GET', url: url({ scooterId, ...range }) })).statusCode).toBe(403);
    expect(
      (
        await editor({
          method: 'POST',
          url: '/admin/telemetry/export',
          payload: { query: { scooterId, ...range }, format: 'csv', columns: [{ field: 'recordedAt', label: 'Czas' }] },
        })
      ).statusCode,
    ).toBe(403);
  });

  it('eksport zakresu: wszystkie odczyty od najnowszych, tak/nie w CSV, wpis list.exported z zakresem', async () => {
    const res = await ctx.staff.technician({
      method: 'POST',
      url: '/admin/telemetry/export',
      payload: {
        query: { scooterId, ...range, cursor: range.to, pageSize: '10' },
        format: 'csv',
        columns: [
          { field: 'recordedAt', label: 'Czas' },
          { field: 'batteryPct', label: 'Bateria' },
          { field: 'locked', label: 'Zablokowana' },
          { field: 'buffered', label: 'Z bufora' },
          { field: 'lat', label: 'Szerokość' },
        ],
      },
    });
    expect(res.statusCode).toBe(200);
    expect(res.headers['content-disposition']).toMatch(/filename="telemetry-.+\.csv"$/);
    const rows = res.body
      .slice(1, -2)
      .split('\r\n')
      .map((l) => l.split(';'));
    expect(rows[0]).toEqual(['Czas', 'Bateria', 'Zablokowana', 'Z bufora', 'Szerokość']);
    expect(rows).toHaveLength(13);
    expect(rows.filter((r) => r[3] === 'tak')).toHaveLength(2);
    expect(rows.find((r) => r[1] === '9')!.slice(2, 5)).toEqual(['nie', 'nie', '50']);
    const audit = await ctx.pool.query<{ data: Record<string, unknown> }>(
      `SELECT data FROM audit_log WHERE action = 'list.exported' AND staff_id = $1`,
      [ctx.staffIds.technician],
    );
    expect(audit.rows).toEqual([
      {
        data: {
          resource: 'telemetry',
          format: 'csv',
          scooterId,
          from: range.from,
          to: range.to,
          batteryBelow: null,
          inRide: false,
          columns: ['recordedAt', 'batteryPct', 'locked', 'buffered', 'lat'],
          rowCount: 12,
        },
      },
    ]);
    const unknown = await ctx.staff.technician({
      method: 'POST',
      url: '/admin/telemetry/export',
      payload: { query: { scooterId, ...range }, format: 'csv', columns: [{ field: 'position', label: 'x' }] },
    });
    expect(unknown.json()).toMatchObject({ code: 'VALIDATION_FAILED' });
  });

  it('retencja: zadanie telemetry.purge usuwa partycje starsze niż 90 dni (sp_purge_telemetry)', async () => {
    await ctx.pool.query(`CALL sp_ensure_telemetry_partitions('2026-01-01'::date, 1, NULL)`);
    const partitions = () =>
      ctx.pool
        .query<{ relname: string }>(`SELECT relname FROM pg_class WHERE relname = 'telemetry_20260101'`)
        .then((r) => r.rows.length);
    expect(await partitions()).toBe(1);
    await ctx.jobs().run(JOBS.telemetryPurge);
    expect(await partitions()).toBe(0);
    // Bieżące odczyty zostają.
    expect((await ctx.pool.query(`SELECT 1 FROM telemetry WHERE scooter_id = $1`, [scooterId])).rows.length).toBe(12);
  });
});
