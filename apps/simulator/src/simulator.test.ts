import { mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { commandSchema, telemetrySchema, type Command } from '@hulajnogi/shared';
import { describe, expect, it } from 'vitest';
import { initialState, loadArea, randomDestination } from './area.js';
import { loadConfig } from './config.js';
import {
  applyControl,
  applyGoto,
  parseControl,
  parseTarget,
  readControl,
  takeGoto,
  writeControl,
  type ControlTarget,
} from './control.js';
import { CommandRides, DemoTraffic, restoreFleet } from './fleet.js';
import { distanceM, mulberry32, Route, type Point } from './geo.js';
import { RoutePlanner } from './osrm.js';
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
    let target: ControlTarget | null = { point: beyondNoRide };
    const rides = new CommandRides([scooter], {
      zones: staticZones(apiZones),
      planner,
      random: mulberry32(4),
      takeTarget: () => {
        const once = target;
        target = null;
        return once;
      },
      log: (message) => logs.push(message),
    });
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
      expect.stringMatching(/^Hulajnoga 0001: jazda do punktu 50.101,18.542034 \(control goto\)/),
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

  it('następna trasa prowadzi do anchor podanej strefy, a cel znika z pliku sterującego', async () => {
    const path = join(mkdtempSync(join(tmpdir(), 'simulator-control-')), 'control.json');
    writeControl(path, applyGoto(applyGoto(readControl(path), 142, 'z-01'), 7, '50.2, 18.6'));
    expect(readControl(path).goto).toEqual({ 7: '50.2, 18.6', 142: 'z-01' });

    const scooter = new VirtualScooter(142, { position: rynek, batteryPct: 80 });
    scooter.handle(command('unlock'), now);
    const { planner, targets } = straightPlanner();
    const rides = new CommandRides([scooter], {
      zones: fileZones,
      planner,
      random: mulberry32(1),
      takeTarget: (number) => takeGoto(path, number),
      log: quiet,
    });
    await rides.tick();
    expect(targets).toEqual([placeZones.find((z) => z.code === 'Z-01')!.anchor]);
    expect(readControl(path).goto).toEqual({ 7: '50.2, 18.6' });

    // Cel jest jednorazowy: kolejna jazda znowu do losowej strefy parkowania.
    scooter.tick(1);
    rideUntilStopped(scooter);
    scooter.handle(command('lock'), now);
    scooter.handle(command('unlock'), now);
    await rides.tick();
    expect(parkingAnchors(placeZones)).toContainEqual(targets[1]);

    expect(takeGoto(path, 7)).toEqual({ point: { lat: 50.2, lon: 18.6 } });
    expect(JSON.parse(readFileSync(path, 'utf8'))).toEqual({ offline: [], silent: [], goto: {} });
    expect(takeGoto(path, 7)).toBeNull();
  });
});
