import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import { initialState, randomDestination, rideDestinationHub, type Area } from './area.js';
import type { ScooterConnection } from './connection.js';
import type { RoutePlanner } from './osrm.js';
import { VirtualScooter, type ScooterSnapshot } from './virtual-scooter.js';

/** Hulajnoga z baterią poniżej tego poziomu nie bierze udziału w przejazdach pokazowych. */
export const DEMO_RIDE_MIN_BATTERY = 20;

export interface RideOptions {
  area: Area;
  planner: RoutePlanner;
  random?: () => number;
}

export interface FleetOptions extends RideOptions {
  ridesPerHour: number;
}

/** Stan floty z pliku; brakujące hulajnogi startują z pozycji danych startowych. */
export function restoreFleet(size: number, area: Area, saved: ScooterSnapshot[]): VirtualScooter[] {
  const byNumber = new Map(saved.map((s) => [s.number, s]));
  return Array.from({ length: size }, (_, i) => {
    const number = i + 1;
    return new VirtualScooter(number, byNumber.get(number) ?? initialState(area, number));
  });
}

export function readState(path: string): ScooterSnapshot[] {
  try {
    return JSON.parse(readFileSync(path, 'utf8')) as ScooterSnapshot[];
  } catch {
    return [];
  }
}

export function writeState(path: string, scooters: readonly VirtualScooter[]): void {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, JSON.stringify(scooters.map((s) => s.snapshot())) + '\n');
}

/**
 * Trasy jazdy po odblokowaniu komendą (ADR 0039). `handle()` odpowiada na komendę od razu, a hulajnoga
 * odblokowana bez trasy czeka na nią (`awaitingRoute`); planista co sekundę pobiera z OSRM trasę do środka
 * losowej strefy parkowania i przekazuje ją hulajnodze, która rusza w następnym takcie.
 */
export class CommandRides {
  private readonly random: () => number;
  private readonly planning = new Set<VirtualScooter>();

  constructor(
    private readonly scooters: readonly VirtualScooter[],
    private readonly options: RideOptions,
  ) {
    this.random = options.random ?? Math.random;
  }

  /** Planuje trasy dla czekających hulajnóg; kończy się, gdy wszystkie są gotowe. Zwraca ich liczbę. */
  async tick(): Promise<number> {
    const waiting = this.scooters.filter((s) => s.awaitingRoute && !this.planning.has(s));
    await Promise.all(waiting.map((s) => this.plan(s)));
    return waiting.length;
  }

  private async plan(scooter: VirtualScooter): Promise<void> {
    this.planning.add(scooter);
    try {
      const hub = rideDestinationHub(this.options.area, scooter.position, this.random);
      scooter.assignRoute(await this.options.planner.route(scooter.position, { lat: hub.lat, lon: hub.lon }));
    } finally {
      this.planning.delete(scooter);
    }
  }
}

/**
 * Przejazdy pokazowe: proces Poissona z zadaną liczbą przejazdów na godzinę (domyślnie wyłączone).
 * Losowana jest wolna, zablokowana hulajnoga z wystarczającą baterią, której nie używa klient, i cel
 * w obszarze działania.
 */
export class DemoTraffic {
  private readonly random: () => number;
  private pending = 0;

  constructor(
    private readonly scooters: readonly VirtualScooter[],
    private readonly options: FleetOptions,
  ) {
    this.random = options.random ?? Math.random;
  }

  async tick(seconds: number): Promise<number> {
    const expected = (this.options.ridesPerHour / 3600) * seconds;
    let started = 0;
    // Dla małych wartości oczekiwanych to przybliżenie rozkładu Poissona jedną próbą.
    if (this.random() < expected - Math.floor(expected)) started++;
    started += Math.floor(expected);
    for (let i = 0; i < started; i++) await this.startOne();
    return started;
  }

  private async startOne(): Promise<void> {
    const idle = this.scooters.filter((s) => s.idle && s.batteryPct >= DEMO_RIDE_MIN_BATTERY);
    if (!idle.length || this.pending > 5) return;
    const scooter = idle[Math.floor(this.random() * idle.length)]!;
    this.pending++;
    try {
      const route = await this.options.planner.route(
        scooter.position,
        randomDestination(this.options.area, this.random),
      );
      if (scooter.idle) scooter.startDemoRide(route);
    } finally {
      this.pending--;
    }
  }
}

/**
 * Uruchomiona flota: ruch i planowanie tras co sekundę, telemetria każdej hulajnogi co `intervalMs`
 * z przesunięciem fazy.
 */
export function runFleet(
  scooters: readonly VirtualScooter[],
  connections: readonly ScooterConnection[],
  rides: { commands: CommandRides; demo: DemoTraffic },
  intervalMs: number,
): () => void {
  const timers: NodeJS.Timeout[] = [];
  timers.push(
    setInterval(() => {
      for (const scooter of scooters) scooter.tick(1);
      void rides.commands.tick();
      void rides.demo.tick(1);
    }, 1000),
  );
  connections.forEach((connection, i) => {
    const start = setTimeout(
      () => {
        connection.sendTelemetry(new Date());
        timers.push(setInterval(() => connection.sendTelemetry(new Date()), intervalMs));
      },
      (intervalMs * i) / connections.length,
    );
    timers.push(start);
  });
  return () => timers.forEach((t) => clearInterval(t));
}
