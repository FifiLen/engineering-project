import { commandSchema, telemetrySchema, type Command } from '@hulajnogi/shared';
import { describe, expect, it } from 'vitest';
import { initialState, loadArea, randomDestination } from './area.js';
import { loadConfig } from './config.js';
import { DemoTraffic, restoreFleet } from './fleet.js';
import { distanceM, mulberry32, Route } from './geo.js';
import { RoutePlanner } from './osrm.js';
import { METERS_PER_BATTERY_PCT, VirtualScooter } from './virtual-scooter.js';

const area = loadArea(loadConfig({}).SIM_PLACES_FILE);
const now = new Date('2026-11-16T12:00:00Z');
const rynek = { lat: 50.095541, lon: 18.542034 };
const dworzec = { lat: 50.089104, lon: 18.547972 };
const command = (cmd: Command['cmd'], params?: Command['params']): Command =>
  commandSchema.parse({ commandId: crypto.randomUUID(), cmd, issuedAt: now.toISOString(), params });

describe('obszar i pozycje startowe', () => {
  it('czyta sprawdzone współrzędne Rybnika ze stref parkowania', () => {
    expect(area.hubs.map((h) => h.code)).toEqual(['P-01', 'P-02', 'P-03', 'P-04', 'P-05']);
    expect(area.center).toEqual(rynek);
  });

  it('pozycja startowa jak w danych startowych: 20–200 m od strefy parkowania', () => {
    for (let n = 1; n <= 40; n++) {
      const { position, batteryPct } = initialState(area, n);
      const hub = area.hubs[n % area.hubs.length]!;
      expect(distanceM(hub, position)).toBeGreaterThanOrEqual(19.9);
      expect(distanceM(hub, position)).toBeLessThanOrEqual(200.1);
      expect(batteryPct).toBeGreaterThanOrEqual(8);
    }
    // Co dziewiąta hulajnoga startuje z niską baterią, jak w seedzie.
    expect(initialState(area, 9).batteryPct).toBeLessThan(18);
  });

  it('cele przejazdów leżą w obszarze działania', () => {
    const random = mulberry32(1);
    for (let i = 0; i < 200; i++)
      expect(distanceM(area.center, randomDestination(area, random))).toBeLessThan(area.radiusM);
  });
});

describe('trasa', () => {
  it('interpoluje pozycję po długości łamanej', () => {
    const route = new Route([rynek, dworzec]);
    expect(route.lengthM).toBeCloseTo(distanceM(rynek, dworzec), 6);
    expect(route.at(0)).toEqual(rynek);
    expect(route.at(route.lengthM + 10)).toEqual(dworzec);
    expect(distanceM(route.at(route.lengthM / 2), rynek)).toBeCloseTo(route.lengthM / 2, 0);
  });

  it('bez OSRM jedzie w linii prostej', async () => {
    const planner = new RoutePlanner('http://localhost:1', () => Promise.reject(new Error('brak połączenia')));
    const route = await planner.route(rynek, dworzec);
    expect(route.points).toEqual([rynek, dworzec]);
  });

  it('trasa z OSRM zaczyna się i kończy w punktach przejazdu', async () => {
    const fakeFetch = (async () =>
      new Response(
        JSON.stringify({
          code: 'Ok',
          routes: [
            {
              geometry: {
                coordinates: [
                  [18.5421, 50.0955],
                  [18.5479, 50.0891],
                ],
              },
            },
          ],
        }),
      )) as typeof fetch;
    const route = await new RoutePlanner('http://osrm', fakeFetch).route(rynek, dworzec);
    expect(route.points[0]).toEqual(rynek);
    expect(route.points.at(-1)).toEqual(dworzec);
    expect(route.points).toHaveLength(4);
  });
});

describe('wirtualna hulajnoga', () => {
  it('telemetria jest zgodna z kontraktem MQTT', () => {
    const scooter = new VirtualScooter(142, { position: rynek, batteryPct: 71.6 });
    expect(telemetrySchema.parse(scooter.telemetry(now))).toEqual({
      ts: now.toISOString(),
      lat: rynek.lat,
      lon: rynek.lon,
      bat: 71,
      v: 0,
      locked: true,
      buffered: false,
    });
  });

  it('jedzie po trasie, zużywa baterię, na końcu staje i blokuje się', () => {
    const scooter = new VirtualScooter(1, { position: rynek, batteryPct: 80 });
    const route = new Route([rynek, dworzec]);
    scooter.startRide(route);
    expect(scooter.locked).toBe(false);
    scooter.tick(10);
    expect(scooter.speedKmh).toBeGreaterThan(14);
    expect(distanceM(rynek, scooter.position)).toBeGreaterThan(30);
    for (let i = 0; i < 600 && scooter.riding; i++) scooter.tick(1);
    expect(scooter.riding).toBe(false);
    expect(scooter.locked).toBe(true);
    expect(scooter.position).toEqual(dworzec);
    expect(scooter.snapshot().batteryPct).toBeCloseTo(80 - route.lengthM / METERS_PER_BATTERY_PCT, 1);
    expect(scooter.snapshot().odometerM).toBeCloseTo(route.lengthM, 0);
  });

  it('przestrzega limitu prędkości z komendy', () => {
    const scooter = new VirtualScooter(1, { position: rynek, batteryPct: 80 });
    expect(scooter.handle(command('speed_limit', { kmh: 10 }), now).ok).toBe(true);
    scooter.startRide(new Route([rynek, dworzec]));
    scooter.tick(1);
    expect(scooter.speedKmh).toBeLessThanOrEqual(10);
  });

  it('odblokowanie: odmowa przy rozładowanej baterii i gdy już odblokowana', () => {
    const empty = new VirtualScooter(1, { position: rynek, batteryPct: 3 });
    expect(empty.handle(command('unlock'), now)).toMatchObject({ ok: false, reason: 'LOW_BATTERY' });
    const scooter = new VirtualScooter(2, { position: rynek, batteryPct: 50 });
    expect(scooter.handle(command('unlock'), now)).toMatchObject({ ok: true });
    expect(scooter.handle(command('unlock'), now)).toMatchObject({ ok: false, reason: 'ALREADY_IN_STATE' });
  });

  it('powtórzona komenda o tym samym commandId nie jest wykonywana ponownie', () => {
    const scooter = new VirtualScooter(1, { position: rynek, batteryPct: 50 });
    const unlock = command('unlock');
    const first = scooter.handle(unlock, now);
    scooter.handle(command('lock'), now);
    const repeated = scooter.handle(unlock, new Date(now.getTime() + 5000));
    expect(repeated).toEqual(first);
    expect(scooter.locked).toBe(true);
  });

  it('blokada w trakcie jazdy zatrzymuje hulajnogę', () => {
    const scooter = new VirtualScooter(1, { position: rynek, batteryPct: 50 });
    scooter.startRide(new Route([rynek, dworzec]));
    scooter.tick(5);
    expect(scooter.handle(command('lock'), now).ok).toBe(true);
    expect(scooter.riding).toBe(false);
    scooter.tick(5);
    expect(scooter.speedKmh).toBe(0);
  });
});

describe('przejazdy pokazowe', () => {
  const planner = new RoutePlanner('http://localhost:1', () => Promise.reject(new Error('offline')));

  it('przywraca stan zapisanych hulajnóg, pozostałe startują z danych startowych', () => {
    const fleet = restoreFleet(3, area, [
      { number: 2, position: dworzec, batteryPct: 33, locked: true, odometerM: 1200 },
    ]);
    expect(fleet.map((s) => s.number)).toEqual([1, 2, 3]);
    expect(fleet[1]!.position).toEqual(dworzec);
    expect(fleet[1]!.batteryPct).toBe(33);
    expect(fleet[0]!.position).toEqual(initialState(area, 1).position);
  });

  it('uruchamia przejazdy tylko na wolnych hulajnogach z wystarczającą baterią', async () => {
    const fleet = [
      new VirtualScooter(1, { position: rynek, batteryPct: 10 }),
      new VirtualScooter(2, { position: rynek, batteryPct: 90 }),
      new VirtualScooter(3, { position: rynek, batteryPct: 90, locked: false }),
    ];
    const traffic = new DemoTraffic(fleet, { area, planner, ridesPerHour: 3600, random: mulberry32(7) });
    expect(await traffic.tick(1)).toBe(1);
    expect(fleet.map((s) => s.riding)).toEqual([false, true, false]);
  });

  it('bez przejazdów na godzinę flota stoi', async () => {
    const fleet = [new VirtualScooter(1, { position: rynek, batteryPct: 90 })];
    const traffic = new DemoTraffic(fleet, { area, planner, ridesPerHour: 0 });
    expect(await traffic.tick(3600)).toBe(0);
  });
});
