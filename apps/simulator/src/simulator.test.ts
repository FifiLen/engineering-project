import { mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  commandSchema,
  simulatorResultSchema,
  simulatorStatusSchema,
  telemetrySchema,
  type Command,
} from '@hulajnogi/shared';
import { describe, expect, it } from 'vitest';
import { initialState, loadArea, randomDestination } from './area.js';
import { loadConfig } from './config.js';
import {
  applyControl,
  applyGoto,
  controlCommands,
  emptyControl,
  parseControl,
  parseTarget,
  readControl,
  takeGoto,
  writeControl,
} from './control.js';
import { CommandRides, DemoTraffic, restoreFleet } from './fleet.js';
import { distanceM, mulberry32, Route, type Point } from './geo.js';
import { RoutePlanner } from './osrm.js';
import { ControlChannel, simulatorStatus, STATUS_ACTIVE_MS, STATUS_INTERVAL_MS, statusDue } from './remote.js';
import { Scenarios } from './scenarios.js';
import { METERS_PER_BATTERY_PCT, STOP_DURATION_S, VirtualScooter } from './virtual-scooter.js';
import {
  canRideAt,
  loadPlaceZones,
  parseZones,
  rideDestination,
  staticZones,
  zoneContains,
  ZoneSource,
} from './zones.js';

const area = loadArea(loadConfig({}).SIM_PLACES_FILE);
const placeZones = loadPlaceZones(loadConfig({}).SIM_PLACES_FILE);
const fileZones = staticZones(placeZones);
const quiet = () => undefined;
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
/** Atrapa połączenia hulajnogi dla scenariuszy (bez brokera). */
const fakeLink = (number: number) => {
  const link = {
    number,
    unacked: 0,
    buffered: 0,
    offline: false,
    silent: false,
    setOffline: (offline: boolean) => void (link.offline = offline),
    setSilent: (silent: boolean) => void (link.silent = silent),
  };
  return link;
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

const start = (position: Point = rynek): VirtualScooter => {
  const scooter = new VirtualScooter(1, { position, batteryPct: 80 });
  expect(scooter.handle(command('unlock'), now).ok).toBe(true);
  return scooter;
};

describe('jazda po odblokowaniu komendą (ADR 0039)', () => {
  it('cel to anchor innej strefy parkowania niż ta, w której hulajnoga stoi', () => {
    const random = mulberry32(3);
    for (let i = 0; i < 50; i++) {
      const zone = rideDestination(placeZones, rynek, random)!;
      expect(zone.type).toBe('PARKING');
      expect(zone.code).not.toBe('P-01');
    }
  });

  it('jedzie trasą do strefy parkowania i staje tam odblokowana, bez samoczynnej blokady', async () => {
    const scooter = start();
    expect(scooter.awaitingRoute).toBe(true);
    const { planner, targets } = straightPlanner();
    const rides = new CommandRides([scooter], { zones: fileZones, planner, random: mulberry32(5), log: quiet });
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
    const rides = new CommandRides([scooter], { zones: fileZones, planner, log: quiet });
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
    const rides = new CommandRides([scooter], { zones: fileZones, planner, log: quiet });
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
    const rides = new CommandRides([scooter], { zones: fileZones, planner, random: mulberry32(11), log: quiet });
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
      goto: {},
    });
  });

  it('błędna treść albo brak list oznacza brak awarii', () => {
    const empty = { offline: [], silent: [], goto: {} };
    expect(parseControl('')).toEqual(empty);
    expect(parseControl('{ "offline": "142" ')).toEqual(empty);
    expect(parseControl('null')).toEqual(empty);
    expect(parseControl('{ "offline": [-1, 1.5, "x"], "silent": {}, "goto": [1] }')).toEqual(empty);
    expect(parseControl('{ "goto": { "x": "S-01", "7": "zła strefa", "8": "95,10" } }')).toEqual(empty);
  });

  it('polecenie control dopisuje numery, a online usuwa je z obu list', () => {
    let state = applyControl({ offline: [], silent: [], goto: { 5: 'S-01' } }, 'offline', [142]);
    state = applyControl(state, 'silent', [27, 142]);
    expect(state).toEqual({ offline: [142], silent: [27, 142], goto: { 5: 'S-01' } });
    expect(applyControl(state, 'online', [142])).toEqual({ offline: [], silent: [27], goto: { 5: 'S-01' } });
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

/** Kwadrat wokół punktu jako pierścień GeoJSON [lon, lat]. */
const square = (center: Point, halfM: number): number[][] => {
  const dLat = halfM / 111_320;
  const dLon = halfM / (111_320 * Math.cos((center.lat * Math.PI) / 180));
  const { lat, lon } = center;
  return [
    [lon - dLon, lat - dLat],
    [lon + dLon, lat - dLat],
    [lon + dLon, lat + dLat],
    [lon - dLon, lat + dLat],
    [lon - dLon, lat - dLat],
  ];
};
/** Strefa w kształcie odpowiedzi `GET /zones` (ADR 0046). */
const feature = (code: string, type: string, center: Point, halfM: number, properties: object = {}) => ({
  type: 'Feature',
  id: code,
  geometry: { type: 'MultiPolygon', coordinates: [[square(center, halfM)]] },
  properties: {
    code,
    name: `Strefa ${code}`,
    type,
    speedLimitKmh: null,
    capacity: null,
    visibleInApp: true,
    anchor: [center.lon, center.lat],
    ...properties,
  },
});
/** Strefa zakazu ok. 330 m na północ od Rynku i punkt za nią (dane testowe, nie miejsca w Rybniku). */
const noRideCenter = { lat: 50.0985, lon: 18.542034 };
const beyondNoRide = { lat: 50.101, lon: 18.542034 };
const apiBody = {
  type: 'FeatureCollection',
  features: [
    feature('AREA-TEST', 'SERVICE_AREA', rynek, 3000),
    feature('P-10', 'PARKING', dworzec, 40, { capacity: 10 }),
    feature('P-11', 'PARKING', rynek, 40),
    feature('S-10', 'SLOW', rynek, 150, { speedLimitKmh: 10 }),
    feature('Z-10', 'NO_RIDE', noRideCenter, 100),
  ],
};
const apiZones = parseZones(apiBody);
const noRide = apiZones.find((z) => z.code === 'Z-10')!;
/** Atrapa `fetch` dla `GET /zones` z ETag i odpowiedzią 304. */
const fakeApi = (etag = '"zones-8-1"') => {
  const requests: Array<{ url: string; ifNoneMatch: string | null }> = [];
  const fetchFn = (async (url: string | URL | Request, init?: RequestInit) => {
    const ifNoneMatch = new Headers(init?.headers).get('if-none-match');
    requests.push({ url: String(url), ifNoneMatch });
    if (ifNoneMatch === etag) return new Response(null, { status: 304, headers: { ETag: etag } });
    return new Response(JSON.stringify(apiBody), { headers: { ETag: etag, 'Content-Type': 'application/json' } });
  }) as typeof fetch;
  return { fetchFn, requests };
};
const parkingAnchors = (zones: typeof apiZones) => zones.filter((z) => z.type === 'PARKING').map((z) => z.anchor);

describe('komendy stref (kontrakt MQTT 1.2.0, ADR 0044, ADR 0046)', () => {
  const riding = () => {
    const scooter = start();
    scooter.assignRoute(new Route([rynek, dworzec]));
    return scooter;
  };

  it('speed_limit bez kmh zdejmuje limit', () => {
    const scooter = riding();
    expect(scooter.handle(command('speed_limit', { kmh: 10 }), now).ok).toBe(true);
    scooter.tick(1);
    expect(scooter.speedKmh).toBeLessThanOrEqual(10);
    expect(scooter.handle(command('speed_limit'), now).ok).toBe(true);
    expect(scooter.speedLimitKmh).toBeNull();
    scooter.tick(1);
    expect(scooter.speedKmh).toBeGreaterThan(14);
  });

  it('stop_gradually: prędkość spada do zera w około 3 s, a bez napędu hulajnoga nie jedzie sama', () => {
    const scooter = riding();
    scooter.tick(5);
    const cruising = scooter.speedKmh;
    expect(cruising).toBeGreaterThan(14);
    expect(scooter.handle(command('stop_gradually'), now).ok).toBe(true);
    const speeds: number[] = [];
    for (let i = 0; i < STOP_DURATION_S; i++) {
      scooter.tick(1);
      speeds.push(scooter.speedKmh);
    }
    expect(speeds[0]).toBeGreaterThan(0);
    expect(speeds[0]).toBeLessThan(cruising);
    expect(speeds[1]).toBeLessThan(speeds[0]!);
    expect(speeds.at(-1)).toBe(0);
    const halted = scooter.position;
    for (let i = 0; i < 30; i++) scooter.tick(1);
    expect(scooter.position).toEqual(halted);
    expect(scooter.telemetry(now)).toMatchObject({ v: 0, locked: false });
    expect(scooter.riding).toBe(false);
    expect(scooter.driveStopped).toBe(true);
    // Powtórzona komenda (ponowienie backendu) jest potwierdzana jako sukces.
    expect(scooter.handle(command('stop_gradually'), now).ok).toBe(true);
  });

  it('release_stop przywraca napęd bez zmiany limitu, a bez zatrzymania odpowiada ALREADY_IN_STATE', () => {
    const scooter = riding();
    expect(scooter.handle(command('release_stop'), now)).toMatchObject({ ok: false, reason: 'ALREADY_IN_STATE' });
    scooter.handle(command('speed_limit', { kmh: 10 }), now);
    scooter.handle(command('stop_gradually'), now);
    for (let i = 0; i < 5; i++) scooter.tick(1);
    expect(scooter.speedKmh).toBe(0);
    expect(scooter.handle(command('release_stop'), now)).toMatchObject({ ok: true });
    expect(scooter.driveStopped).toBe(false);
    expect(scooter.speedLimitKmh).toBe(10);
    scooter.tick(1);
    expect(scooter.riding).toBe(true);
    expect(scooter.speedKmh).toBeGreaterThan(0);
    expect(scooter.speedKmh).toBeLessThanOrEqual(10);
  });

  it('lock kasuje limit i zatrzymanie, także gdy hulajnoga jest już zablokowana', () => {
    const scooter = riding();
    scooter.handle(command('speed_limit', { kmh: 10 }), now);
    scooter.handle(command('stop_gradually'), now);
    for (let i = 0; i < 5; i++) scooter.tick(1);
    expect(scooter.handle(command('lock'), now).ok).toBe(true);
    expect(scooter.speedLimitKmh).toBeNull();
    expect(scooter.driveStopped).toBe(false);
    // Wznowienie jedzie dalej bez ograniczeń, dopóki backend nie wyśle nowych komend.
    expect(scooter.handle(command('unlock'), now).ok).toBe(true);
    scooter.tick(1);
    expect(scooter.speedKmh).toBeGreaterThan(14);

    scooter.handle(command('lock'), now);
    scooter.handle(command('speed_limit', { kmh: 8 }), now);
    expect(scooter.handle(command('lock'), now)).toMatchObject({ ok: false, reason: 'ALREADY_IN_STATE' });
    expect(scooter.speedLimitKmh).toBeNull();
  });
});

describe('strefy z API (ADR 0046)', () => {
  it('punkt w wielokącie i reguła jazdy jak w backendzie: obszar działania bez strefy zakazu', () => {
    expect(apiZones.map((z) => z.code)).toEqual(['AREA-TEST', 'P-10', 'P-11', 'S-10', 'Z-10']);
    expect(zoneContains(noRide, noRideCenter)).toBe(true);
    expect(zoneContains(noRide, rynek)).toBe(false);
    expect(canRideAt(apiZones, rynek)).toBe(true);
    expect(canRideAt(apiZones, noRideCenter)).toBe(false);
    expect(canRideAt(apiZones, { lat: 50.2, lon: 18.542 })).toBe(false);
    // Otwór w wielokącie (pierścień wewnętrzny GeoJSON) nie należy do strefy; nieznany rodzaj jest pomijany.
    const donut = parseZones({
      type: 'FeatureCollection',
      features: [
        {
          ...feature('A', 'SERVICE_AREA', rynek, 500),
          geometry: { type: 'Polygon', coordinates: [square(rynek, 500), square(rynek, 100)] },
        },
        feature('X', 'FUTURE_TYPE', rynek, 500),
      ],
    });
    expect(donut).toHaveLength(1);
    expect(canRideAt(donut, rynek)).toBe(false);
    expect(canRideAt(donut, { lat: rynek.lat + 0.0027, lon: rynek.lon })).toBe(true);
  });

  it('strefy zapasowe z pliku miejsc: obszar Rybnika, parkowanie, wolna jazda i zakaz', () => {
    expect(placeZones.map((z) => z.code)).toEqual([
      'AREA-RYBNIK',
      'P-01',
      'P-02',
      'P-03',
      'P-04',
      'P-05',
      'S-01',
      'Z-01',
    ]);
    const z01 = placeZones.find((z) => z.code === 'Z-01')!;
    expect(z01.type).toBe('NO_RIDE');
    expect(canRideAt(placeZones, rynek)).toBe(true);
    expect(canRideAt(placeZones, z01.anchor)).toBe(false);
    expect(placeZones.find((z) => z.code === 'S-01')!.speedLimitKmh).toBe(10);
  });

  it('pobiera GET /zones, potem pyta z If-None-Match i po 304 zostawia strefy bez zmian', async () => {
    const api = fakeApi();
    const source = new ZoneSource({ apiUrl: 'http://api/', fallback: placeZones, fetchFn: api.fetchFn, log: quiet });
    expect(source.fromApi).toBe(false);
    expect(source.zones).toBe(placeZones);
    await source.refresh();
    expect(source.fromApi).toBe(true);
    expect(source.zones).toEqual(apiZones);
    const first = source.zones;
    await source.refresh();
    expect(api.requests).toEqual([
      { url: 'http://api/zones', ifNoneMatch: null },
      { url: 'http://api/zones', ifNoneMatch: '"zones-8-1"' },
    ]);
    expect(source.zones).toBe(first);
    // Równoległe odświeżenia (planowanie kilku tras naraz) to jedno zapytanie.
    await Promise.all([source.refresh(), source.refresh()]);
    expect(api.requests).toHaveLength(3);
  });

  it('bez API zostaje plik miejsc z jednym ostrzeżeniem, a trasy dalej się planują', async () => {
    const warnings: string[] = [];
    const source = new ZoneSource({
      apiUrl: 'http://localhost:1',
      fallback: placeZones,
      fetchFn: () => Promise.reject(new Error('ECONNREFUSED')),
      log: quiet,
      warn: (message) => warnings.push(message),
    });
    await source.refresh();
    await source.refresh();
    expect(source.zones).toBe(placeZones);
    expect(source.fromApi).toBe(false);
    expect(warnings).toEqual([expect.stringMatching(/ECONNREFUSED.*pliku miejsc/)]);
    const scooter = start();
    const { planner, targets } = straightPlanner();
    expect(await new CommandRides([scooter], { zones: source, planner, log: quiet }).tick()).toBe(1);
    expect(parkingAnchors(placeZones)).toContainEqual(targets[0]);
  });

  it('cel jazdy to anchor strefy parkowania z API, odświeżonej przed planowaniem trasy', async () => {
    const api = fakeApi();
    const source = new ZoneSource({ apiUrl: 'http://api', fallback: placeZones, fetchFn: api.fetchFn, log: quiet });
    const scooter = start();
    const { planner, targets } = straightPlanner();
    const rides = new CommandRides([scooter], { zones: source, planner, random: mulberry32(2), log: quiet });
    expect(await rides.tick()).toBe(1);
    expect(api.requests).toHaveLength(1);
    // P-11 obejmuje Rynek, na którym hulajnoga stoi, więc jedzie do P-10 (strefa z API, nie z pliku).
    expect(targets).toEqual([dworzec]);
  });
});

describe('wirtualny klient po zatrzymaniu (ADR 0046)', () => {
  /** Hulajnoga jedzie z Rynku prosto na północ przez strefę zakazu Z-10. */
  const throughNoRide = async () => {
    const scooter = start();
    const { planner, targets } = straightPlanner();
    const logs: string[] = [];
    const rides = new CommandRides([scooter], {
      zones: staticZones(apiZones),
      planner,
      random: mulberry32(4),
      log: (message) => logs.push(message),
    });
    rides.steer(scooter, { point: beyondNoRide, label: 'punktu 50.101,18.542034' });
    await rides.tick();
    expect(targets).toEqual([beyondNoRide]);
    for (let i = 0; i < 600 && !zoneContains(noRide, scooter.position); i++) {
      scooter.tick(1);
      await rides.tick();
    }
    expect(zoneContains(noRide, scooter.position)).toBe(true);
    // Backend wykrywa wjazd do strefy zakazu i wyłącza napęd.
    expect(scooter.handle(command('stop_gradually'), now).ok).toBe(true);
    for (let i = 0; i < STOP_DURATION_S; i++) {
      scooter.tick(1);
      await rides.tick();
    }
    expect(scooter.speedKmh).toBe(0);
    await rides.tick();
    return { scooter, rides, targets, logs };
  };

  it('prowadzi hulajnogę pieszo wstecz po trasie poza strefę zakazu i tam czeka na release_stop', async () => {
    const { scooter, rides, targets, logs } = await throughNoRide();
    expect(rides.escortOf(scooter)).toBe('walking');
    const battery = scooter.snapshot().batteryPct;
    scooter.tick(1);
    const walking = scooter.telemetry(now);
    expect(walking.locked).toBe(false);
    expect(walking.v).toBeGreaterThan(3.5);
    expect(walking.v).toBeLessThan(4.5);
    for (let i = 0; i < 600 && rides.escortOf(scooter) === 'walking'; i++) {
      scooter.tick(1);
      await rides.tick();
    }
    expect(rides.escortOf(scooter)).toBe('waiting');
    expect(canRideAt(apiZones, scooter.position)).toBe(true);
    // Tuż za południową granicą strefy (100 m od środka), po którą wjechała.
    expect(scooter.position.lat).toBeLessThan(noRideCenter.lat);
    expect(distanceM(noRideCenter, scooter.position)).toBeGreaterThan(99);
    expect(distanceM(noRideCenter, scooter.position)).toBeLessThan(105);
    expect(scooter.snapshot().batteryPct).toBe(battery);

    // Bez release_stop stoi i nie planuje trasy.
    const waitedAt = scooter.position;
    for (let i = 0; i < 60; i++) {
      scooter.tick(1);
      expect(await rides.tick()).toBe(0);
    }
    expect(scooter.position).toEqual(waitedAt);
    expect(scooter.telemetry(now)).toMatchObject({ v: 0, locked: false });

    // Po release_stop nowa trasa z bieżącego miejsca do losowej strefy parkowania.
    expect(scooter.handle(command('release_stop'), now).ok).toBe(true);
    expect(await rides.tick()).toBe(1);
    expect(targets).toHaveLength(2);
    expect(parkingAnchors(apiZones)).toContainEqual(targets[1]);
    scooter.tick(1);
    expect(scooter.riding).toBe(true);
    expect(rides.escortOf(scooter)).toBeNull();
    expect(logs).toEqual([
      expect.stringMatching(/^Hulajnoga 0001: jazda do punktu 50.101,18.542034\.$/),
      expect.stringMatching(/strefie zakazu albo poza obszarem.*pieszo/),
      expect.stringMatching(/czeka na release_stop/),
      expect.stringMatching(/napęd przywrócony/),
    ]);
  });

  it('release_stop w trakcie prowadzenia kończy prowadzenie, a lock kasuje zatrzymanie', async () => {
    const released = await throughNoRide();
    for (let i = 0; i < 5; i++) released.scooter.tick(1);
    released.scooter.handle(command('release_stop'), now);
    expect(await released.rides.tick()).toBe(1);
    expect(released.scooter.walking).toBe(false);

    const paused = await throughNoRide();
    paused.scooter.tick(1);
    expect(paused.scooter.handle(command('lock'), now).ok).toBe(true);
    await paused.rides.tick();
    expect(paused.rides.escortOf(paused.scooter)).toBeNull();
    expect(paused.scooter.walking).toBe(false);
    expect(paused.scooter.driveStopped).toBe(false);
  });

  it('bez przebytej trasy poza strefę klient stoi', async () => {
    const scooter = start(noRideCenter);
    const { planner } = straightPlanner();
    const rides = new CommandRides([scooter], { zones: staticZones(apiZones), planner, log: quiet });
    await rides.tick();
    scooter.handle(command('stop_gradually'), now);
    scooter.tick(1);
    await rides.tick();
    expect(rides.escortOf(scooter)).toBe('stuck');
    expect(scooter.position).toEqual(noRideCenter);
  });
});

describe('cel następnej trasy z control goto (ADR 0046)', () => {
  it('czyta kod strefy albo punkt lat,lon', () => {
    expect(parseTarget('S-01')).toEqual({ code: 'S-01' });
    expect(parseTarget(' 50.1,18.5 ')).toEqual({ point: { lat: 50.1, lon: 18.5 } });
    expect(parseTarget('50.1, -18.5')).toEqual({ point: { lat: 50.1, lon: -18.5 } });
    expect(parseTarget('91,18')).toBeNull();
    expect(parseTarget('Z 01')).toBeNull();
    expect(parseTarget('')).toBeNull();
  });

  it('cel z pliku to jednorazowe polecenie goto: jazda do anchor strefy, potem znowu losowe strefy parkowania', async () => {
    const path = join(mkdtempSync(join(tmpdir(), 'simulator-control-')), 'control.json');
    writeControl(path, applyGoto(applyGoto(readControl(path), 142, 'z-01'), 7, '50.2, 18.6'));
    expect(readControl(path).goto).toEqual({ 7: '50.2, 18.6', 142: 'z-01' });

    const scooter = new VirtualScooter(142, { position: rynek, batteryPct: 80 });
    scooter.handle(command('unlock'), now);
    const { planner, targets } = straightPlanner();
    const rides = new CommandRides([scooter], { zones: fileZones, planner, random: mulberry32(1), log: quiet });
    const scenarios = new Scenarios({
      scooters: [scooter],
      links: [fakeLink(142)],
      rides,
      zones: fileZones,
      log: quiet,
    });
    const target = takeGoto(path, 142)!;
    expect(target).toEqual({ code: 'z-01' });
    expect(await scenarios.apply({ scooter: 142, action: 'goto', params: target }, now, 'control.json')).toEqual({
      ok: true,
    });
    await rides.tick();
    expect(targets).toEqual([placeZones.find((z) => z.code === 'Z-01')!.anchor]);
    expect(readControl(path).goto).toEqual({ 7: '50.2, 18.6' });

    // Po dojechaniu scenariusz się kończy, a kolejna jazda znowu prowadzi do losowej strefy parkowania.
    scooter.tick(1);
    rideUntilStopped(scooter);
    scenarios.tick(now);
    expect(scenarios.list(now)).toEqual([]);
    scooter.handle(command('lock'), now);
    scooter.handle(command('unlock'), now);
    await rides.tick();
    expect(parkingAnchors(placeZones)).toContainEqual(targets[1]);

    expect(takeGoto(path, 7)).toEqual({ point: { lat: 50.2, lon: 18.6 } });
    expect(JSON.parse(readFileSync(path, 'utf8'))).toEqual({ offline: [], silent: [], goto: {} });
    expect(takeGoto(path, 7)).toBeNull();
  });
});

describe('scenariusze symulatora (ADR 0059)', () => {
  /** Strefy z API z identyfikatorami UUID, jak w `GET /zones` (polecenia z panelu wskazują strefę po `zoneId`). */
  const zoneIds: Record<string, string> = {
    'AREA-TEST': '00000000-0000-4000-8000-000000000001',
    'P-10': '00000000-0000-4000-8000-000000000010',
    'P-11': '00000000-0000-4000-8000-000000000011',
    'S-10': '00000000-0000-4000-8000-000000000020',
    'Z-10': '00000000-0000-4000-8000-000000000030',
  };
  const uuidZones = parseZones({
    ...apiBody,
    features: apiBody.features.map((f) => ({ ...f, id: zoneIds[f.properties.code] })),
  });
  const idOf = (code: string) => zoneIds[code]!;
  const later = (seconds: number) => new Date(now.getTime() + seconds * 1000);

  const setup = (scooter = new VirtualScooter(7, { position: rynek, batteryPct: 80 })) => {
    const { planner, targets } = straightPlanner();
    const logs: string[] = [];
    let refreshes = 0;
    const zones = { zones: uuidZones, refresh: async () => void refreshes++ };
    const rides = new CommandRides([scooter], { zones, planner, random: mulberry32(2), log: quiet });
    const link = fakeLink(scooter.number);
    let changes = 0;
    const scenarios = new Scenarios({
      scooters: [scooter],
      links: [link],
      rides,
      zones,
      onChange: () => void changes++,
      log: (message) => logs.push(message),
    });
    const apply = (command: Parameters<Scenarios['apply']>[0], at = now) => scenarios.apply(command, at, 'test');
    return {
      scooter,
      rides,
      link,
      scenarios,
      apply,
      targets,
      logs,
      refreshes: () => refreshes,
      changes: () => changes,
    };
  };

  const status = (scenarios: Scenarios) =>
    simulatorStatus(
      {
        since: now.toISOString(),
        fleetSize: 1,
        connected: 1,
        riding: 0,
        messagesPerSecond: 0.2,
        ridesPerHour: 0,
        telemetryIntervalMs: 5000,
        ridesStarted: 0,
        commandsReceived: 3,
        commandsUnacked: 2,
        scenarios: scenarios.list(now),
      },
      now,
    );

  it('rozłączenie i powrót; na hulajnodze działa jeden scenariusz', async () => {
    const { link, scenarios, apply, logs, changes } = setup();
    expect(await apply({ scooter: 7, action: 'disconnect' })).toEqual({ ok: true });
    expect(link.offline).toBe(true);
    expect(changes()).toBe(1);
    for (const action of ['disconnect', 'silence'] as const) {
      expect(await apply({ scooter: 7, action })).toEqual({ ok: false, reason: 'SCENARIO_ACTIVE' });
    }
    expect(await apply({ scooter: 7, action: 'drain', params: { targetPct: 5, durationS: 30 } })).toEqual({
      ok: false,
      reason: 'SCENARIO_ACTIVE',
    });
    expect(await apply({ scooter: 7, action: 'unsilence' })).toEqual({ ok: false, reason: 'NO_SCENARIO' });
    expect(scenarios.list(later(5))).toEqual([
      { scooter: 7, kind: 'disconnect', startedAt: now.toISOString(), progress: {} },
    ]);

    link.buffered = 36;
    expect(await apply({ scooter: 7, action: 'restore' })).toEqual({ ok: true });
    expect(link.offline).toBe(false);
    expect(scenarios.list(now)).toEqual([]);
    expect(await apply({ scooter: 7, action: 'restore' })).toEqual({ ok: false, reason: 'NO_SCENARIO' });
    expect(await apply({ scooter: 8, action: 'disconnect' })).toEqual({ ok: false, reason: 'SCOOTER_NOT_FOUND' });
    expect(logs).toContainEqual('Hulajnoga 0007: powrót łączności, bufor telemetrii: 36 pkt.');
    expect(logs).toContainEqual('Hulajnoga 0007: polecenie silence odrzucone (SCENARIO_ACTIVE, test).');
  });

  it('milczenie: komendy bez potwierdzenia w postępie, unsilence przywraca potwierdzenia', async () => {
    const { link, scenarios, apply } = setup();
    expect(await apply({ scooter: 7, action: 'silence' })).toEqual({ ok: true });
    expect(link.silent).toBe(true);
    link.unacked = 2;
    expect(simulatorStatusSchema.parse({ ...status(scenarios), online: true })).toMatchObject({
      scenarios: [{ scooter: 7, kind: 'silence', progress: { unackedCommands: 2 } }],
    });
    expect(await apply({ scooter: 7, action: 'unsilence' })).toEqual({ ok: true });
    expect(link.silent).toBe(false);
  });

  it('rozładowanie: bateria spada liniowo do celu w zadanym czasie, potem tylko w jeździe', async () => {
    const { scooter, scenarios, apply } = setup();
    expect(await apply({ scooter: 7, action: 'drain', params: { targetPct: 5, durationS: 30 } })).toEqual({ ok: true });
    scenarios.tick(later(0));
    expect(scooter.batteryPct).toBe(80);
    scenarios.tick(later(10));
    expect(scooter.batteryLevel).toBeCloseTo(55, 5);
    scenarios.tick(later(15));
    expect(scooter.batteryLevel).toBeCloseTo(42.5, 5);
    expect(scenarios.list(later(15))).toEqual([
      {
        scooter: 7,
        kind: 'drain',
        startedAt: now.toISOString(),
        progress: { batteryPct: 42, targetPct: 5, remainingS: 15 },
      },
    ]);
    scenarios.tick(later(31));
    expect(scooter.batteryPct).toBe(5);
    expect(scenarios.list(later(31))).toEqual([]);
    // Po scenariuszu zwykłe rozładowanie: na postoju bateria się nie zmienia.
    scenarios.tick(later(60));
    expect(scooter.batteryPct).toBe(5);
  });

  it('rozładowanie do poziomu nie niższego niż bateria to błędne parametry', async () => {
    const { apply, scenarios } = setup(new VirtualScooter(7, { position: rynek, batteryPct: 4 }));
    expect(await apply({ scooter: 7, action: 'drain', params: { targetPct: 5, durationS: 30 } })).toEqual({
      ok: false,
      reason: 'INVALID_PARAMS',
    });
    expect(scenarios.list(now)).toEqual([]);
  });

  it('battery_swapped (kontrakt 1.3.0): bateria 100% i potwierdzenie ok; wymiana kończy rozładowanie', async () => {
    const { scooter, scenarios, apply, logs } = setup();
    await apply({ scooter: 7, action: 'drain', params: { targetPct: 5, durationS: 30 } });
    scenarios.tick(later(20));
    expect(scooter.batteryPct).toBe(30);
    const swap = command('battery_swapped');
    expect(scooter.handle(swap, later(21))).toEqual({
      commandId: swap.commandId,
      ok: true,
      ts: later(21).toISOString(),
    });
    expect(scooter.batteryPct).toBe(100);
    scenarios.tick(later(22));
    expect(scooter.batteryPct).toBe(100);
    expect(scenarios.list(later(22))).toEqual([]);
    expect(logs).toContainEqual('Hulajnoga 0007: wymiana baterii kończy rozładowanie.');
    // Po wymianie zwykła jazda zużywa baterię jak dotąd.
    expect(scooter.telemetry(later(22)).bat).toBe(100);
  });

  it('goto do strefy po zoneId: jadący klient skręca od razu, postęp to pozostała droga', async () => {
    const scooter = start();
    const { rides, scenarios, apply, targets } = setup(scooter);
    await rides.tick();
    for (let i = 0; i < 10; i++) scooter.tick(1);
    expect(await apply({ scooter: 1, action: 'goto', params: { zoneId: idOf('P-10') } })).toEqual({ ok: true });
    expect(scooter.awaitingRoute).toBe(true);
    expect(await rides.tick()).toBe(1);
    expect(targets).toHaveLength(2);
    expect(targets[1]).toEqual(dworzec);
    scooter.tick(1);
    const [scenario] = scenarios.list(now);
    expect(scenario).toMatchObject({ scooter: 1, kind: 'goto', target: { zoneId: idOf('P-10'), code: 'P-10' } });
    expect(scenario!.progress.remainingM).toBeGreaterThan(500);
    expect(scenario!.progress.remainingM).toBeLessThan(distanceM(rynek, dworzec));
    rideUntilStopped(scooter);
    scenarios.tick(now);
    expect(scenarios.list(now)).toEqual([]);
    expect(scooter.position).toEqual(dworzec);
  });

  it('goto na zablokowanej hulajnodze czeka na odblokowanie; punkt jako cel', async () => {
    const { scooter, rides, scenarios, apply, targets } = setup();
    const point = { lat: 50.0931, lon: 18.5401 };
    expect(await apply({ scooter: 7, action: 'goto', params: { point } })).toEqual({ ok: true });
    expect(scenarios.list(now)).toEqual([
      { scooter: 7, kind: 'goto', startedAt: now.toISOString(), progress: {}, target: { point } },
    ]);
    scenarios.tick(now);
    expect(scenarios.list(now)).toHaveLength(1);
    scooter.handle(command('unlock'), now);
    await rides.tick();
    expect(targets).toEqual([point]);
  });

  it('nieznana strefa po odświeżeniu stref z API to ZONE_NOT_FOUND', async () => {
    const { apply, refreshes } = setup();
    const unknown = '00000000-0000-4000-8000-0000000000ff';
    expect(await apply({ scooter: 7, action: 'goto', params: { zoneId: unknown } })).toEqual({
      ok: false,
      reason: 'ZONE_NOT_FOUND',
    });
    expect(refreshes()).toBe(1);
  });

  it('wjazd w strefę zakazu: najkrótsza trasa do strefy, koniec po wjeździe; strefa innego rodzaju odrzucona', async () => {
    const scooter = start();
    const { rides, scenarios, apply, targets } = setup(scooter);
    expect(await apply({ scooter: 1, action: 'enter_no_ride', params: { zoneId: idOf('P-10') } })).toEqual({
      ok: false,
      reason: 'INVALID_PARAMS',
    });
    expect(await apply({ scooter: 1, action: 'enter_no_ride', params: { zoneId: idOf('Z-10') } })).toEqual({
      ok: true,
    });
    await rides.tick();
    expect(targets).toEqual([noRideCenter]);
    for (let i = 0; i < 600 && scenarios.list(now).length; i++) {
      scooter.tick(1);
      scenarios.tick(now);
    }
    expect(scenarios.list(now)).toEqual([]);
    expect(zoneContains(noRide, scooter.position)).toBe(true);
    // Hulajnoga jedzie dalej, aż backend wyłączy napęd (`stop_gradually`); wtedy klient ją wyprowadza.
    expect(scooter.riding).toBe(true);
  });

  it('cancel przerywa dowolny scenariusz; przerwana jazda do celu wraca do losowej strefy parkowania', async () => {
    const scooter = start();
    const { rides, link, scenarios, apply, targets } = setup(scooter);
    expect(await apply({ scooter: 1, action: 'cancel' })).toEqual({ ok: false, reason: 'NO_SCENARIO' });
    await apply({ scooter: 1, action: 'disconnect' });
    expect(await apply({ scooter: 1, action: 'cancel' })).toEqual({ ok: true });
    expect(link.offline).toBe(false);

    await apply({ scooter: 1, action: 'goto', params: { zoneId: idOf('Z-10') } });
    await rides.tick();
    scooter.tick(1);
    expect(await apply({ scooter: 1, action: 'cancel' })).toEqual({ ok: true });
    expect(scenarios.list(now)).toEqual([]);
    expect(scooter.awaitingRoute).toBe(true);
    await rides.tick();
    expect(targets).toHaveLength(2);
    expect(parkingAnchors(uuidZones)).toContainEqual(targets[1]);
  });

  it('stan na simulator/status zgodny z kontraktem symulatora; publikacja przy zmianie i okresowo', async () => {
    const { scenarios, apply } = setup();
    await apply({ scooter: 7, action: 'drain', params: { targetPct: 5, durationS: 30 } });
    expect(simulatorStatusSchema.parse(status(scenarios))).toEqual(status(scenarios));
    expect(status(scenarios)).toMatchObject({ online: true, updatedAt: now.toISOString() });
    expect(statusDue({ changed: true, scenarios: 0, sinceLastMs: 0 })).toBe(true);
    expect(statusDue({ changed: false, scenarios: 0, sinceLastMs: STATUS_ACTIVE_MS })).toBe(false);
    expect(statusDue({ changed: false, scenarios: 0, sinceLastMs: STATUS_INTERVAL_MS })).toBe(true);
    expect(statusDue({ changed: false, scenarios: 1, sinceLastMs: STATUS_ACTIVE_MS })).toBe(true);
  });

  it('kanał simulator/control: wynik, powtórzony commandId, wygasłe i błędne polecenie', async () => {
    const { link, scenarios } = setup();
    const channel = new ControlChannel(scenarios, quiet);
    const message = (fields: object) =>
      JSON.stringify({
        commandId: crypto.randomUUID(),
        scooter: 7,
        issuedBy: '00000000-0000-4000-8000-0000000000aa',
        expiresAt: later(30).toISOString(),
        params: {},
        ...fields,
      });
    const disconnect = message({ action: 'disconnect' });
    const commandId = JSON.parse(disconnect).commandId as string;
    const result = await channel.handle(disconnect, now);
    expect(simulatorResultSchema.parse(result)).toEqual({ commandId, ok: true });
    expect(link.offline).toBe(true);
    // Ponowne dostarczenie (QoS 1) nie wykonuje polecenia drugi raz i nie daje SCENARIO_ACTIVE.
    expect(await channel.handle(disconnect, now)).toEqual({ commandId, ok: true });
    expect(await channel.handle(message({ action: 'silence' }), now)).toMatchObject({
      ok: false,
      reason: 'SCENARIO_ACTIVE',
    });
    expect(await channel.handle(message({ action: 'restore' }), later(31))).toMatchObject({
      ok: false,
      reason: 'EXPIRED',
    });
    expect(link.offline).toBe(true);
    expect(await channel.handle(message({ action: 'drain', params: { targetPct: 200 } }), now)).toMatchObject({
      ok: false,
      reason: 'INVALID_PARAMS',
    });
    expect(await channel.handle(message({ action: 'explode' }), now)).toMatchObject({ reason: 'INVALID_PARAMS' });
    expect(await channel.handle(message({ action: 'restore', scooter: 12 }), now)).toMatchObject({
      reason: 'SCOOTER_NOT_FOUND',
    });
    expect(channel.handle('{"action":"restore"}', now)).toBeNull();
    expect(channel.handle('nie json', now)).toBeNull();
    // Rozładowanie z wartościami domyślnymi kontraktu (5% w 30 s) po przywróceniu łączności.
    expect(await channel.handle(message({ action: 'restore' }), now)).toMatchObject({ ok: true });
    expect(await channel.handle(message({ action: 'drain' }), now)).toMatchObject({ ok: true });
    expect(scenarios.list(now)[0]).toMatchObject({ kind: 'drain', progress: { targetPct: 5, remainingS: 30 } });
  });

  it('plik sterujący: zmiany list to polecenia scenariuszy, więc późniejsze polecenie z panelu obowiązuje', async () => {
    expect(controlCommands(emptyControl(), { offline: [7], silent: [], goto: {} })).toEqual([
      { scooter: 7, action: 'disconnect' },
    ]);
    expect(
      controlCommands({ offline: [7], silent: [3], goto: {} }, { offline: [], silent: [3, 9], goto: { 5: 'S-01' } }),
    ).toEqual([
      { scooter: 7, action: 'restore' },
      { scooter: 9, action: 'silence' },
    ]);
    // Plik: offline [7]; panel: restore 7. Niezmieniony plik nie rozłącza hulajnogi ponownie.
    const { link, apply } = setup();
    for (const c of controlCommands(emptyControl(), { offline: [7], silent: [], goto: {} })) await apply(c);
    expect(await apply({ scooter: 7, action: 'restore' })).toEqual({ ok: true });
    const same = { offline: [7], silent: [], goto: {} };
    expect(controlCommands(same, same)).toEqual([]);
    expect(link.offline).toBe(false);
  });
});
