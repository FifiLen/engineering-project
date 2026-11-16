import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import { initialState, randomDestination, type Area } from './area.js';
import type { ScooterConnection } from './connection.js';
import type { RoutePlanner } from './osrm.js';
import { VirtualScooter, type ScooterSnapshot } from './virtual-scooter.js';

/** Hulajnoga z baterią poniżej tego poziomu nie bierze udziału w przejazdach pokazowych. */
export const DEMO_RIDE_MIN_BATTERY = 20;

export interface FleetOptions {
  area: Area;
  planner: RoutePlanner;
  ridesPerHour: number;
  random?: () => number;
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
 * Przejazdy pokazowe: proces Poissona z zadaną liczbą przejazdów na godzinę. Losowana jest wolna,
 * zablokowana hulajnoga z wystarczającą baterią i cel w obszarze działania.
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
    const idle = this.scooters.filter((s) => s.locked && !s.riding && s.batteryPct >= DEMO_RIDE_MIN_BATTERY);
    if (!idle.length || this.pending > 5) return;
    const scooter = idle[Math.floor(this.random() * idle.length)]!;
    this.pending++;
    try {
      const route = await this.options.planner.route(
        scooter.position,
        randomDestination(this.options.area, this.random),
      );
      if (scooter.locked && !scooter.riding) scooter.startRide(route);
    } finally {
      this.pending--;
    }
  }
}

/** Uruchomiona flota: ruch co sekundę, telemetria każdej hulajnogi co `intervalMs` z przesunięciem fazy. */
export function runFleet(
  scooters: readonly VirtualScooter[],
  connections: readonly ScooterConnection[],
  traffic: DemoTraffic,
  intervalMs: number,
): () => void {
  const timers: NodeJS.Timeout[] = [];
  timers.push(
    setInterval(() => {
      for (const scooter of scooters) scooter.tick(1);
      void traffic.tick(1);
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
