import * as shared from '@hulajnogi/shared';
import type { NestFastifyApplication } from '@nestjs/platform-fastify';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { createApp } from '../src/bootstrap.js';
import { loadConfig } from '../src/config.js';
import { MqttService } from '../src/mqtt/mqtt.service.js';
import { FleetGateway } from '../src/realtime/fleet.gateway.js';
import { asStaff, staffToken } from './helpers.js';
import { operationsContext, type OperationsContext } from './operations-helpers.js';

describe('konfiguracja sterowania symulatorem (ADR 0059)', () => {
  it('domyślnie tylko w trybie deweloperskim; zmienna nadpisuje', () => {
    expect(loadConfig({ NODE_ENV: 'development' }).SIMULATOR_CONTROL_ENABLED).toBe(true);
    expect(loadConfig({ NODE_ENV: 'test' }).SIMULATOR_CONTROL_ENABLED).toBe(false);
    expect(loadConfig({ NODE_ENV: 'development', SIMULATOR_CONTROL_ENABLED: 'false' }).SIMULATOR_CONTROL_ENABLED).toBe(
      false,
    );
    expect(loadConfig({ NODE_ENV: 'test', SIMULATOR_CONTROL_ENABLED: 'true' }).SIMULATOR_CONTROL_ENABLED).toBe(true);
    expect(loadConfig({ NODE_ENV: 'development', SIMULATOR_CONTROL_ENABLED: '' }).SIMULATOR_CONTROL_ENABLED).toBe(true);
  });
});

/**
 * Symulator sterowany z panelu (ADR 0059): polecenie z `simulator.manage` w dzienniku audytu i na MQTT
 * `simulator/control` (testy API działają bez brokera: publikacje zapisuje `MqttService.published`, a wiadomości
 * brokera podaje test przez `MqttService.dispatch`), stan i wyniki do pokoju `simulator`, 404 przy wyłączeniu.
 */
describe.skipIf(!process.env.DATABASE_URL)('API: symulator z panelu', () => {
  let ctx: OperationsContext;
  let app: NestFastifyApplication;
  const published = () =>
    app
      .get(MqttService)
      .published.filter((p) => p.topic === shared.simulatorTopics.control)
      .map((p) => p.payload as shared.SimulatorControl);
  const broker = (topic: string, payload: unknown) =>
    app.get(MqttService).dispatch(topic, Buffer.from(JSON.stringify(payload)));
  const status = async () =>
    (await ctx.staff.admin({ method: 'GET', url: '/admin/simulator/status' })).json<shared.SimulatorOverview>();

  beforeAll(async () => {
    ctx = await operationsContext('simulator_api', 4, { SIMULATOR_CONTROL_ENABLED: 'true' });
    app = ctx.app;
  });

  afterAll(async () => {
    await ctx?.close();
  });

  it('tylko simulator.manage (Administrator); Dyspozytor i Serwisant dostają 403', async () => {
    const payload = { scooter: 1, action: 'disconnect', params: {} };
    for (const who of ['dispatcher', 'technician'] as const) {
      expect((await ctx.staff[who]({ method: 'POST', url: '/admin/simulator/commands', payload })).statusCode).toBe(
        403,
      );
      expect((await ctx.staff[who]({ method: 'GET', url: '/admin/simulator/status' })).statusCode).toBe(403);
    }
    expect(published()).toEqual([]);
  });

  it('polecenie: wpis simulator.command w dzienniku i publikacja zgodna z kontraktem symulatora 1.0.0', async () => {
    const before = Date.now();
    const res = await ctx.staff.admin({
      method: 'POST',
      url: '/admin/simulator/commands',
      payload: { scooter: 2, action: 'drain', params: { targetPct: 5, durationS: 30 } },
    });
    expect(res.statusCode).toBe(202);
    const accepted = res.json<shared.SimulatorCommandAccepted>();
    const message = published().at(-1)!;
    expect(shared.simulatorControlSchema.parse(message)).toEqual({
      commandId: accepted.commandId,
      action: 'drain',
      scooter: 2,
      params: { targetPct: 5, durationS: 30 },
      issuedBy: ctx.staffIds.admin,
      expiresAt: accepted.expiresAt,
    });
    const ttl = Date.parse(accepted.expiresAt) - before;
    expect(ttl).toBeGreaterThan(shared.SIMULATOR_COMMAND_TTL_MS - 5000);
    expect(ttl).toBeLessThanOrEqual(shared.SIMULATOR_COMMAND_TTL_MS + 1000);
    expect(await ctx.auditOf(await ctx.idOf(2), 'simulator.command')).toEqual([
      expect.objectContaining({
        actor: 'STAFF',
        staff_id: ctx.staffIds.admin,
        data: expect.objectContaining({ commandId: accepted.commandId, action: 'drain', scooter: 2 }),
      }),
    ]);

    // Domyślne parametry rozładowania z kontraktu (5% w 30 s) i jazda do punktu.
    await ctx.staff.admin({
      method: 'POST',
      url: '/admin/simulator/commands',
      payload: { scooter: 3, action: 'drain' },
    });
    expect(published().at(-1)).toMatchObject({ action: 'drain', params: { targetPct: 5, durationS: 30 } });
    await ctx.staff.admin({
      method: 'POST',
      url: '/admin/simulator/commands',
      payload: { scooter: 1, action: 'goto', params: { point: { lat: 50.0, lon: 18.5 } } },
    });
    expect(published().at(-1)).toMatchObject({ action: 'goto', params: { point: { lat: 50.0, lon: 18.5 } } });
  });

  it('walidacja: parametry spoza kontraktu 400, nieznana hulajnoga 404', async () => {
    const post = (payload: object) => ctx.staff.admin({ method: 'POST', url: '/admin/simulator/commands', payload });
    const count = published().length;
    expect((await post({ scooter: 1, action: 'drain', params: { targetPct: 101 } })).statusCode).toBe(400);
    expect((await post({ scooter: 1, action: 'goto', params: {} })).statusCode).toBe(400);
    expect((await post({ scooter: 1, action: 'explode', params: {} })).statusCode).toBe(400);
    const unknown = await post({ scooter: 9999, action: 'silence', params: {} });
    expect(unknown.statusCode).toBe(404);
    expect(unknown.json()).toMatchObject({ code: 'NOT_FOUND', details: { entity: 'scooter', number: 9999 } });
    expect(published()).toHaveLength(count);
  });

  it('stan i wyniki z MQTT trafiają do pokoju simulator; „nie odpowiada” po 30 s bez stanu', async () => {
    const gateway = app.get(FleetGateway);
    const statusEvents = vi.spyOn(gateway, 'simulatorStatus');
    const resultEvents = vi.spyOn(gateway, 'simulatorResult');

    const empty = await status();
    expect(empty).toMatchObject({ enabled: true, status: null, receivedAt: null, stale: true });
    const drain = empty.commands.find((c) => c.action === 'drain' && c.scooter === 2)!;
    expect(empty.commands.map((c) => c.action)).toEqual(['goto', 'drain', 'drain']);
    expect(drain).toMatchObject({ scooter: 2, staffName: 'Admin Testowy', result: null });

    const now = new Date().toISOString();
    broker(shared.simulatorTopics.status, {
      online: true,
      since: now,
      fleetSize: 4,
      connected: 4,
      riding: 0,
      messagesPerSecond: 1,
      ridesPerHour: 0,
      updatedAt: now,
      scenarios: [{ scooter: 2, kind: 'drain', startedAt: now, progress: { batteryPct: 60, targetPct: 5 } }],
    });
    broker(shared.simulatorTopics.result, { commandId: drain.commandId, ok: false, reason: 'SCENARIO_ACTIVE' });
    // Wiadomość niezgodna z kontraktem jest pomijana.
    broker(shared.simulatorTopics.status, { online: 'maybe' });

    expect(statusEvents).toHaveBeenCalledTimes(1);
    expect(statusEvents.mock.calls[0]![0]).toMatchObject({ enabled: true, stale: false, status: { fleetSize: 4 } });
    expect(resultEvents).toHaveBeenCalledWith({ commandId: drain.commandId, ok: false, reason: 'SCENARIO_ACTIVE' });
    const live = await status();
    expect(live).toMatchObject({
      stale: false,
      status: { online: true, scenarios: [{ scooter: 2, kind: 'drain' }] },
      receivedAt: expect.any(String),
    });
    expect(live.commands.find((c) => c.commandId === drain.commandId)!.result).toMatchObject({
      ok: false,
      reason: 'SCENARIO_ACTIVE',
    });

    // Stan retained sprzed minuty (np. po restarcie API): „Symulator nie odpowiada”.
    const old = new Date(Date.now() - 60_000).toISOString();
    broker(shared.simulatorTopics.status, { ...live.status!, updatedAt: old });
    expect((await status()).stale).toBe(true);
    // Last Will: symulator offline.
    broker(shared.simulatorTopics.status, { online: false });
    expect((await status()).status).toEqual({ online: false });
  });

  it('dołączenie do pokoju simulator wymaga simulator.manage', async () => {
    const gateway = app.get(FleetGateway);
    const socket = (staffId: string) => ({ data: { staffId }, join: vi.fn(() => Promise.resolve()) });
    const admin = socket(ctx.staffIds.admin);
    expect(await gateway.subscribeSimulator(admin as never)).toEqual({ ok: true });
    expect(admin.join).toHaveBeenCalledWith(shared.SIMULATOR_ROOM);
    const dispatcher = socket(ctx.staffIds.dispatcher);
    expect(await gateway.subscribeSimulator(dispatcher as never)).toEqual({ ok: false, code: 'FORBIDDEN' });
    expect(dispatcher.join).not.toHaveBeenCalled();
  });

  it('przy SIMULATOR_CONTROL_ENABLED=false punkty zwracają 404, a pokój jest niedostępny', async () => {
    const disabled = await createApp(
      loadConfig({
        NODE_ENV: 'test',
        DATABASE_URL: ctx.databaseUrl,
        MQTT_ENABLED: 'false',
        JOBS_ENABLED: 'false',
        FILE_STORAGE: 'memory',
      }),
      { logger: false },
    );
    await disabled.init();
    try {
      const admin = asStaff(disabled, staffToken(disabled, ctx.staffIds.admin));
      const get = await admin({ method: 'GET', url: '/admin/simulator/status' });
      expect(get.statusCode).toBe(404);
      const post = await admin({
        method: 'POST',
        url: '/admin/simulator/commands',
        payload: { scooter: 1, action: 'disconnect', params: {} },
      });
      expect(post.statusCode).toBe(404);
      expect(disabled.get(MqttService).published).toEqual([]);
      const socket = { data: { staffId: ctx.staffIds.admin }, join: vi.fn() };
      expect(await disabled.get(FleetGateway).subscribeSimulator(socket as never)).toEqual({
        ok: false,
        code: 'FORBIDDEN',
      });
    } finally {
      await disabled.close();
    }
  });
});
