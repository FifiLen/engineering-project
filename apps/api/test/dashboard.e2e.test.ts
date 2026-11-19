import { dashboardSummarySchema, type DashboardSummary } from '@hulajnogi/shared';
import type { NestFastifyApplication } from '@nestjs/platform-fastify';
import type { InjectOptions } from 'fastify';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { asStaff, staffToken } from './helpers.js';
import { operationsContext, type OperationsContext } from './operations-helpers.js';

const hasDb = Boolean(process.env.DATABASE_URL);
type Inject = (options: InjectOptions) => ReturnType<NestFastifyApplication['inject']>;

describe.skipIf(!hasDb)('pulpit z kafelkami i wykresami (pytanie 9, plansze 33-panel-pulpit)', () => {
  let ctx: OperationsContext;
  let editor: Inject;

  const summary = async (who: Inject): Promise<DashboardSummary> => {
    const res = await who({ method: 'GET', url: '/admin/dashboard/summary' });
    expect(res.statusCode, res.body).toBe(200);
    return dashboardSummarySchema.parse(res.json());
  };

  beforeAll(async () => {
    ctx = await operationsContext('dashboard_api', 6);
    const editorId = (
      await ctx.pool.query<{ id: string }>(
        `INSERT INTO staff (email, name, password_hash) VALUES ('r@test.local', 'Redaktor Testowy', 'x') RETURNING id`,
      )
    ).rows[0]!.id;
    await ctx.pool.query(
      `INSERT INTO staff_roles (staff_id, role_id) SELECT $1, id FROM roles WHERE name = 'Redaktor'`,
      [editorId],
    );
    editor = asStaff(ctx.app, staffToken(ctx.app, editorId));

    // Przejazd zakończony (paragon dziś) i drugi w toku; hulajnoga 3 z niską baterią, 4 z krytyczną, 6 bez łączności.
    const anna = await ctx.register('+48500900100', 'Anna Pulpitowa');
    const jan = await ctx.register('+48500900200', 'Jan Pulpitowy');
    await ctx.ride(anna.token, 1);
    await ctx.endRide(anna.token, 1);
    await ctx.ride(jan.token, 5);
    await ctx.pool.query(`UPDATE scooters SET battery_pct = 12 WHERE number = 3`);
    await ctx.pool.query(`UPDATE scooters SET battery_pct = 5 WHERE number = 4`);
    await ctx.pool.query(`UPDATE scooters SET online = false WHERE number = 6`);

    // Zadanie serwisowe przypisane Serwisantowi z terminem w przeszłości.
    const task = await ctx.staff.dispatcher({
      method: 'POST',
      url: '/admin/service-tasks',
      payload: {
        scooterId: await ctx.idOf(2),
        type: 'INSPECTION',
        priority: 'NORMAL',
        assigneeId: ctx.staffIds.technician,
        description: 'Przegląd',
        dueAt: new Date(Date.now() - 3_600_000).toISOString(),
      },
    });
    expect(task.statusCode, task.body).toBe(201);
  });

  afterAll(async () => {
    await ctx?.close();
  });

  it('Administrator: pierwsze pięć kafelków, przejazdy według godzin i stan floty; bez „Twoich zadań” i „Treści”', async () => {
    const body = await summary(ctx.staff.admin);
    expect(body.tiles.map((t) => t.key)).toEqual([
      'activeRides',
      'availableScooters',
      'lowBattery',
      'salesToday',
      'newTickets',
    ]);
    const tile = <K extends DashboardSummary['tiles'][number]['key']>(key: K) =>
      body.tiles.find((t) => t.key === key) as Extract<DashboardSummary['tiles'][number], { key: K }>;
    expect(tile('activeRides')).toMatchObject({ value: 1, startedLastHour: 2 });
    expect(tile('lowBattery')).toMatchObject({ value: 2, critical: 1, thresholdPct: 15 });
    expect(tile('availableScooters').fleetTotal).toBe(6);
    const sales = (
      await ctx.pool.query<{ total: string; n: string }>(
        `SELECT sum(total_amount) AS total, count(*) AS n FROM receipts WHERE kind = 'SALE'`,
      )
    ).rows[0]!;
    expect(tile('salesToday')).toMatchObject({ value: Number(sales.total), receipts: Number(sales.n) });

    expect(body.ridesByHour!.hours).toHaveLength(24);
    expect(body.ridesByHour!.ridesSoFar).toBe(2);
    expect(body.ridesByHour!.hours.filter((h) => h.state === 'current')).toHaveLength(1);
    expect(body.fleetState!.total).toBe(6);
    expect(body.fleetState!.segments.find((s) => s.key === 'OFFLINE')!.count).toBe(1);
    expect(body.fleetState!.segments.find((s) => s.key === 'IN_USE_OR_RESERVED')!.count).toBe(1);
    expect(body.myTasks).toBeNull();
    expect(body.content).toBeNull();
  });

  it('Serwisant: kafelki floty, zgłoszeń, zadań i części, stan floty i „Twoje zadania”; bez przejazdów i sprzedaży', async () => {
    const body = await summary(ctx.staff.technician);
    expect(body.tiles.map((t) => t.key)).toEqual([
      'availableScooters',
      'lowBattery',
      'newTickets',
      'tasksInProgress',
      'partsBelowMinimum',
    ]);
    expect(body.tiles.find((t) => t.key === 'tasksInProgress')).toMatchObject({ value: 1, mine: 1, overdue: 1 });
    expect(body.ridesByHour).toBeNull();
    expect(body.fleetState).not.toBeNull();
    expect(body.myTasks).toMatchObject({ assigned: 1, overdue: 1, unassigned: 0, inProgressTotal: 1 });
    expect(body.myTasks!.items[0]).toMatchObject({
      type: 'INSPECTION',
      status: 'OPEN',
      scooterNumber: 2,
      overdue: true,
    });
    expect(body.content).toBeNull();
  });

  it('Redaktor: bez kafelków operacyjnych, z grupą „Treści”; pola bez uprawnienia to null', async () => {
    const body = await summary(editor);
    expect(body.tiles).toEqual([]);
    expect(body.ridesByHour).toBeNull();
    expect(body.fleetState).toBeNull();
    expect(body.myTasks).toBeNull();
    expect(body.content).not.toBeNull();
    const media = (await ctx.pool.query<{ n: string }>(`SELECT count(*) AS n FROM media_assets`)).rows[0]!;
    expect(body.content!.tiles.media.value).toBe(Number(media.n));
    for (const group of ['scheduledNews', 'expiringNews', 'drafts', 'unusedMedia'] as const) {
      expect(body.content![group].items.length).toBeLessThanOrEqual(4);
      expect(body.content![group].count).toBeGreaterThanOrEqual(body.content![group].items.length);
    }
    // „Wymaga uwagi” zostaje osobnym punktem.
    expect((await editor({ method: 'GET', url: '/admin/dashboard/attention' })).statusCode).toBe(200);
  });
});
