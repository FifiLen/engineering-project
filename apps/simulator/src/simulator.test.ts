import { commandSchema, telemetrySchema, type Command } from '@hulajnogi/shared';
import { describe, expect, it } from 'vitest';
import { initialState, loadArea, randomDestination, rideDestinationHub } from './area.js';
import { loadConfig } from './config.js';
import { applyControl, parseControl } from './control.js';
import { CommandRides, DemoTraffic, restoreFleet } from './fleet.js';
import { distanceM, mulberry32, Route, type Point } from './geo.js';
import { RoutePlanner } from './osrm.js';
import { METERS_PER_BATTERY_PCT, VirtualScooter } from './virtual-scooter.js';

const area = loadArea(loadConfig({}).SIM_PLACES_FILE);
const now = new Date('2026-11-16T12:00:00Z');
const rynek = { lat: 50.095541, lon: 18.542034 };
const dworzec = { lat: 50.089104, lon: 18.547972 };
const command = (cmd: Command['cmd'], params?: Command['params'], expiresAt?: Date): Command =>
  commandSchema.parse({
    commandId: crypto.randomUUID(),
    cmd,
    issuedAt: now.toISOString(),
    expiresAt: expiresAt?.toISOString(),
    params,
  });
/** Planista bez OSRM: trasa w linii prostej, z zapisem celów. */
const straightPlanner = () => {
  const targets: Point[] = [];
  const planner = {
    route: async (from: Point, to: Point) => {
      targets.push(to);
      return new Route([from, to]);
    },
  } as unknown as RoutePlanner;
  return { planner, targets };
};
const rideUntilStopped = (scooter: VirtualScooter) => {
  for (let i = 0; i < 3600 && scooter.riding; i++) scooter.tick(1);
};

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

  it('przejazd pokazowy: jedzie po trasie, zużywa baterię, na końcu staje i blokuje się', () => {
    const scooter = new VirtualScooter(1, { position: rynek, batteryPct: 80 });
    const route = new Route([rynek, dworzec]);
    scooter.startDemoRide(route);
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
    scooter.startDemoRide(new Route([rynek, dworzec]));
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

  it('komenda po expiresAt nie jest wykonywana i dostaje EXPIRED (ADR 0038)', () => {
    const scooter = new VirtualScooter(1, { position: rynek, batteryPct: 50 });
    const late = command('unlock', undefined, new Date(now.getTime() + 10_000));
    // Komenda dostarczona przez broker po powrocie online, minutę po wysłaniu.
    expect(scooter.handle(late, new Date(now.getTime() + 60_000))).toMatchObject({ ok: false, reason: 'EXPIRED' });
    expect(scooter.locked).toBe(true);
    expect(scooter.awaitingRoute).toBe(false);
    // W terminie komenda działa; bez expiresAt nie wygasa (kontrakt 1.0.0).
    const onTime = command('unlock', undefined, new Date(now.getTime() + 10_000));
    expect(scooter.handle(onTime, new Date(now.getTime() + 9_000)).ok).toBe(true);
    expect(scooter.handle(command('lock'), new Date(now.getTime() + 3_600_000)).ok).toBe(true);
  });

  it('blokada w trakcie jazdy zatrzymuje hulajnogę', () => {
    const scooter = new VirtualScooter(1, { position: rynek, batteryPct: 50 });
    scooter.startDemoRide(new Route([rynek, dworzec]));
    scooter.tick(5);
    expect(scooter.handle(command('lock'), now).ok).toBe(true);
    expect(scooter.riding).toBe(false);
    scooter.tick(5);
    expect(scooter.speedKmh).toBe(0);
  });
});

describe('jazda po odblokowaniu komendą (ADR 0039)', () => {
  const start = (): VirtualScooter => {
    const scooter = new VirtualScooter(1, { position: rynek, batteryPct: 80 });
    expect(scooter.handle(command('unlock'), now).ok).toBe(true);
    return scooter;
  };

  it('cel to środek innej strefy parkowania niż ta, w której hulajnoga stoi', () => {
    const random = mulberry32(3);
    const here = area.hubs[0]!;
    for (let i = 0; i < 50; i++) {
      const hub = rideDestinationHub(area, here, random);
      expect(hub.code).not.toBe(here.code);
      expect(area.hubs).toContain(hub);
    }
  });

  it('jedzie trasą do strefy parkowania i staje tam odblokowana, bez samoczynnej blokady', async () => {
    const scooter = start();
    expect(scooter.awaitingRoute).toBe(true);
    const { planner, targets } = straightPlanner();
    const rides = new CommandRides([scooter], { area, planner, random: mulberry32(5) });
    expect(await rides.tick()).toBe(1);
    expect(scooter.awaitingRoute).toBe(false);
    const hub = targets[0]!;
    expect(area.hubs.some((h) => h.lat === hub.lat && h.lon === hub.lon)).toBe(true);
    scooter.tick(1);
    expect(scooter.riding).toBe(true);
    expect(scooter.speedKmh).toBeGreaterThan(14);
    rideUntilStopped(scooter);
    expect(scooter.position).toEqual(hub);
    // Na końcu trasy czeka na blokadę: stoi, jest odblokowana i nie planuje nowej trasy.
    for (let i = 0; i < 60; i++) scooter.tick(1);
    expect(scooter.telemetry(now)).toMatchObject({ v: 0, locked: false });
    expect(await rides.tick()).toBe(0);
    expect(scooter.handle(command('lock'), now).ok).toBe(true);
    expect(scooter.idle).toBe(true);
  });

  it('blokada w drodze zatrzymuje jazdę, a wznowienie jedzie dalej tą samą trasą', async () => {
    const scooter = start();
    const { planner, targets } = straightPlanner();
    const rides = new CommandRides([scooter], { area, planner });
    await rides.tick();
    for (let i = 0; i < 20; i++) scooter.tick(1);
    expect(scooter.handle(command('lock'), now).ok).toBe(true);
    const paused = scooter.position;
    for (let i = 0; i < 20; i++) scooter.tick(1);
    expect(scooter.position).toEqual(paused);
    expect(scooter.telemetry(now)).toMatchObject({ v: 0, locked: true });
    // Wstrzymana jazda nie jest wolną hulajnogą dla przejazdów pokazowych.
    expect(scooter.idle).toBe(false);

    expect(scooter.handle(command('unlock'), now).ok).toBe(true);
    expect(await rides.tick()).toBe(0);
    scooter.tick(1);
    expect(distanceM(paused, scooter.position)).toBeGreaterThan(3);
    rideUntilStopped(scooter);
    expect(targets).toHaveLength(1);
    expect(scooter.position).toEqual(targets[0]);
    expect(scooter.locked).toBe(false);
  });

  it('blokada przed wyznaczeniem trasy wstrzymuje jazdę, trasa czeka na wznowienie', async () => {
    const scooter = start();
    const { planner } = straightPlanner();
    const rides = new CommandRides([scooter], { area, planner });
    const planning = rides.tick();
    scooter.handle(command('lock'), now);
    await planning;
    scooter.tick(5);
    expect(scooter.position).toEqual(rynek);
    scooter.handle(command('unlock'), now);
    scooter.tick(5);
    expect(scooter.riding).toBe(true);
  });

  it('po zakończeniu jazdy w strefie kolejne odblokowanie wyznacza nową trasę', async () => {
    const scooter = start();
    const { planner, targets } = straightPlanner();
    const rides = new CommandRides([scooter], { area, planner, random: mulberry32(11) });
    await rides.tick();
    scooter.tick(1);
    rideUntilStopped(scooter);
    scooter.handle(command('lock'), now);
    scooter.handle(command('unlock'), now);
    expect(scooter.awaitingRoute).toBe(true);
    expect(await rides.tick()).toBe(1);
    expect(targets[1]).not.toEqual(targets[0]);
  });
});

describe('plik sterujący awariami', () => {
  it('czyta numery hulajnóg, także z zerami wiodącymi', () => {
    expect(parseControl('{ "offline": [142, "0007", 142], "silent": [27] }')).toEqual({
      offline: [7, 142],
      silent: [27],
    });
  });

  it('błędna treść albo brak list oznacza brak awarii', () => {
    expect(parseControl('')).toEqual({ offline: [], silent: [] });
    expect(parseControl('{ "offline": "142" ')).toEqual({ offline: [], silent: [] });
    expect(parseControl('null')).toEqual({ offline: [], silent: [] });
    expect(parseControl('{ "offline": [-1, 1.5, "x"], "silent": {} }')).toEqual({ offline: [], silent: [] });
  });

  it('polecenie control dopisuje numery, a online usuwa je z obu list', () => {
    let state = applyControl({ offline: [], silent: [] }, 'offline', [142]);
    state = applyControl(state, 'silent', [27, 142]);
    expect(state).toEqual({ offline: [142], silent: [27, 142] });
    expect(applyControl(state, 'online', [142])).toEqual({ offline: [], silent: [27] });
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
      new VirtualScooter(4, { position: rynek, batteryPct: 90 }),
    ];
    // Hulajnoga 4 ma wstrzymaną jazdę klienta: jest zablokowana, ale nie jest wolna.
    fleet[3]!.handle(command('unlock'), now);
    fleet[3]!.handle(command('lock'), now);
    const traffic = new DemoTraffic(fleet, { area, planner, ridesPerHour: 3600, random: mulberry32(7) });
    expect(await traffic.tick(1)).toBe(1);
    expect(fleet.map((s) => s.riding)).toEqual([false, true, false, false]);
  });

  it('bez przejazdów na godzinę flota stoi', async () => {
    const fleet = [new VirtualScooter(1, { position: rynek, batteryPct: 90 })];
    const traffic = new DemoTraffic(fleet, { area, planner, ridesPerHour: 0 });
    expect(await traffic.tick(3600)).toBe(0);
  });
});
