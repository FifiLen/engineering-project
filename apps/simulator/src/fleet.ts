import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import { scooterTopicId } from '@hulajnogi/shared';
import { initialState, randomDestination, type Area } from './area.js';
import type { ScooterConnection } from './connection.js';
import type { Point, Route } from './geo.js';
import type { RoutePlanner } from './osrm.js';
import { VirtualScooter, type ScooterSnapshot } from './virtual-scooter.js';
import { canRideAt, rideDestination, zoneContains, type Zone, type ZoneProvider } from './zones.js';

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

export interface CommandRideOptions {
  planner: RoutePlanner;
  /** Strefy widoczne dla klienta (`GET /zones`, ADR 0046). */
  zones: ZoneProvider;
  random?: () => number;
  log?: (message: string) => void;
}

/**
 * Cel jazdy ze scenariusza symulatora (`goto`, `enter_no_ride`, ADR 0059): punkt, opis do logu i strefa,
 * której wnętrze kończy scenariusz (wjazd w strefę zakazu).
 */
export interface RideTarget {
  point: Point;
  label: string;
  zone?: Zone;
}

/** Postęp jazdy do celu: czeka na odblokowanie albo trasę, jedzie (`remainingM`) albo zakończona. */
export type SteeringProgress = { state: 'waiting' } | { state: 'driving'; remainingM: number } | { state: 'done' };

/**
 * Wirtualny klient przy zatrzymanej hulajnodze (ADR 0046): `walking` prowadzi ją pieszo wstecz po trasie,
 * `waiting` stoi w dozwolonym miejscu i czeka na `release_stop`, `stuck` nie ma już dokąd się cofać.
 */
type Escort = 'walking' | 'waiting' | 'stuck';

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
 * Wirtualny klient w jeździe po odblokowaniu komendą (ADR 0039, ADR 0046). `handle()` odpowiada na komendę
 * od razu, a hulajnoga odblokowana bez trasy czeka na nią (`awaitingRoute`); planista co sekundę odświeża
 * strefy z API i pobiera z OSRM trasę do `anchor` losowej strefy parkowania (albo do celu scenariusza `goto`
 * lub `enter_no_ride`, ADR 0059).
 * Gdy backend wyłączy napęd (`stop_gradually`), klient prowadzi hulajnogę pieszo wstecz po trasie, aż według
 * stref z API wolno jechać, i tam czeka na `release_stop`; potem planuje nową trasę.
 */
export class CommandRides {
  private readonly random: () => number;
  private readonly log: (message: string) => void;
  private readonly planning = new Set<VirtualScooter>();
  private readonly escorts = new Map<VirtualScooter, Escort>();
  /** Cele ze scenariuszy i trasa, którą do nich wyznaczono (`null` przed wyznaczeniem). */
  private readonly steering = new Map<VirtualScooter, RideTarget & { route: Route | null }>();

  constructor(
    private readonly scooters: readonly VirtualScooter[],
    private readonly options: CommandRideOptions,
  ) {
    this.random = options.random ?? Math.random;
    this.log = options.log ?? console.log;
  }

  /**
   * Krok klienta: prowadzenie zatrzymanych hulajnóg i trasy dla czekających; kończy się, gdy wszystkie trasy
   * są gotowe. Zwraca liczbę zaplanowanych tras.
   */
  async tick(): Promise<number> {
    for (const scooter of this.scooters) this.escort(scooter);
    const waiting = this.scooters.filter((s) => s.awaitingRoute && !this.planning.has(s));
    await Promise.all(waiting.map((s) => this.plan(s)));
    return waiting.length;
  }

  /**
   * Scenariusz jazdy do celu (ADR 0059). Klient w trakcie jazdy porzuca trasę i planista od razu wyznacza
   * nową z bieżącego miejsca; zablokowana hulajnoga jedzie do celu po odblokowaniu, a zatrzymana napędem
   * (strefa zakazu) po `release_stop`.
   */
  steer(scooter: VirtualScooter, target: RideTarget): void {
    this.steering.set(scooter, { ...target, route: null });
    if (scooter.onCommandTrip && !scooter.driveStopped) scooter.abandonRoute();
  }

  /**
   * Koniec scenariusza jazdy. Przerwany w drodze (`abandon`) zostawia klienta bez celu, więc planista
   * wyznacza trasę do losowej strefy parkowania, jak po zwykłym odblokowaniu.
   */
  unsteer(scooter: VirtualScooter, abandon = false): void {
    const steering = this.steering.get(scooter);
    this.steering.delete(scooter);
    if (abandon && steering?.route && scooter.route === steering.route && !scooter.driveStopped) {
      scooter.abandonRoute();
    }
  }

  /**
   * Postęp jazdy do celu: koniec po dojechaniu, po wjeździe do strefy celu albo gdy jazda straciła trasę
   * do celu (koniec przejazdu, nowa trasa po `release_stop`).
   */
  steeringProgress(scooter: VirtualScooter): SteeringProgress | null {
    const steering = this.steering.get(scooter);
    if (!steering) return null;
    if (!steering.route) return { state: 'waiting' };
    const remainingM = scooter.route === steering.route ? scooter.remainingM : null;
    if (remainingM === null || remainingM <= 0) return { state: 'done' };
    if (steering.zone && zoneContains(steering.zone, scooter.position)) return { state: 'done' };
    return { state: 'driving', remainingM };
  }

  /** Stan prowadzenia hulajnogi przez klienta (do testów i statystyk). */
  escortOf(scooter: VirtualScooter): Escort | null {
    return this.escorts.get(scooter) ?? null;
  }

  private escort(scooter: VirtualScooter): void {
    const state = this.escorts.get(scooter);
    const id = scooterTopicId(scooter.number);
    if (!scooter.onCommandTrip || scooter.locked) {
      // `lock` kasuje zatrzymanie. Po wyprowadzeniu wznowienie nie wraca starą trasą do strefy zakazu.
      if (state === 'waiting') scooter.abandonRoute();
      this.escorts.delete(scooter);
      return;
    }
    if (!scooter.driveStopped) {
      if (!state) return;
      // `release_stop`: klient wsiada i jedzie nową trasą z bieżącego miejsca.
      scooter.abandonRoute();
      this.escorts.delete(scooter);
      this.log(`Hulajnoga ${id}: napęd przywrócony, klient jedzie dalej.`);
      return;
    }
    // Hulajnoga jeszcze hamuje po `stop_gradually`.
    if (scooter.speedKmh > 0 && !scooter.walking) return;
    // Backend mógł zatrzymać hulajnogę przez strefę dodaną w panelu po ostatnim odczycie stref.
    if (!state) void this.options.zones.refresh();
    let next: Escort;
    if (canRideAt(this.options.zones.zones, scooter.position)) next = 'waiting';
    else next = scooter.walking || scooter.walkBack() ? 'walking' : 'stuck';
    if (next !== 'walking') scooter.stopWalking();
    if (next === state) return;
    this.escorts.set(scooter, next);
    this.log(
      {
        walking: `Hulajnoga ${id}: napęd wyłączony w strefie zakazu albo poza obszarem, klient prowadzi ją pieszo wstecz po trasie.`,
        waiting: `Hulajnoga ${id}: klient stoi tam, gdzie wolno jechać, i czeka na release_stop.`,
        stuck: `Hulajnoga ${id}: klient nie ma dokąd cofnąć hulajnogi po trasie i stoi.`,
      }[next],
    );
  }

  private async plan(scooter: VirtualScooter): Promise<void> {
    this.planning.add(scooter);
    try {
      await this.options.zones.refresh();
      const pending = this.pendingTarget(scooter);
      if (pending) this.log(`Hulajnoga ${scooterTopicId(scooter.number)}: jazda do ${pending.label}.`);
      const route = await this.options.planner.route(scooter.position, pending?.point ?? this.destination(scooter));
      if (!scooter.assignRoute(route)) return;
      // Trasa należy do celu, z którym ją wyznaczono. Nowy cel ustawiony w trakcie planowania odrzuca ją,
      // więc w następnym kroku planista wyznaczy trasę do niego.
      if (pending && this.steering.get(scooter) === pending) pending.route = route;
      else if (this.pendingTarget(scooter)) scooter.abandonRoute();
    } finally {
      this.planning.delete(scooter);
    }
  }

  /** Cel scenariusza, do którego nie wyznaczono jeszcze trasy. */
  private pendingTarget(scooter: VirtualScooter) {
    const steering = this.steering.get(scooter);
    return steering && !steering.route ? steering : undefined;
  }

  /** Cel bez scenariusza: `anchor` losowej strefy parkowania. */
  private destination(scooter: VirtualScooter): Point {
    const parking = rideDestination(this.options.zones.zones, scooter.position, this.random);
    if (parking) return parking.anchor;
    this.log(`Hulajnoga ${scooterTopicId(scooter.number)}: brak aktywnych stref parkowania, klient stoi w miejscu.`);
    return scooter.position;
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
