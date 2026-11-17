/**
 * Wirtualna hulajnoga: stan urządzenia, jazda po trasie, bateria i odpowiedzi na komendy według
 * kontraktu MQTT (docs/kontrakty/asyncapi-mqtt.yaml). Bez wejścia-wyjścia, więc da się ją testować
 * bez brokera; połączenie zestawia `connection.ts`, a trasę jazdy po odblokowaniu planuje `fleet.ts`.
 */
import type { Ack, Command, Telemetry } from '@hulajnogi/shared';
import type { Point, Route } from './geo.js';

/** Poniżej tego poziomu hulajnoga odmawia odblokowania (ochrona akumulatora w sterowniku). */
export const UNLOCK_MIN_BATTERY = 5;
/** Zużycie baterii w jeździe: 1 punkt procentowy na tyle metrów. */
export const METERS_PER_BATTERY_PCT = 300;
/** Pamięć wykonanych komend do idempotencji po `commandId`. */
const REMEMBERED_COMMANDS = 200;
const DEFAULT_SPEED_KMH = 18;

export interface ScooterSnapshot {
  number: number;
  position: Point;
  batteryPct: number;
  locked: boolean;
  odometerM: number;
}

/**
 * Jazda hulajnogi (ADR 0039). Pokazowa (`demo`) blokuje się sama na końcu trasy. Jazda po odblokowaniu
 * komendą (`command`) czeka na trasę od planisty (`route: null`), na końcu staje odblokowana, a blokada
 * w trakcie drogi tylko ją wstrzymuje: kolejne odblokowanie jedzie dalej tą samą trasą.
 */
interface Trip {
  kind: 'demo' | 'command';
  route: Route | null;
  progressM: number;
}

export class VirtualScooter {
  position: Point;
  locked = true;
  speedKmh = 0;
  lightsOn = false;
  speedLimitKmh: number | null = null;
  /** Bateria z ułamkiem; w telemetrii zaokrąglona w dół. */
  private battery: number;
  private odometerM: number;
  private trip: Trip | null = null;
  private stopping = false;
  private readonly acks = new Map<string, Ack>();

  constructor(
    readonly number: number,
    initial: { position: Point; batteryPct: number; locked?: boolean; odometerM?: number },
  ) {
    this.position = initial.position;
    this.battery = initial.batteryPct;
    this.locked = initial.locked ?? true;
    this.odometerM = initial.odometerM ?? 0;
  }

  get batteryPct(): number {
    return Math.max(0, Math.floor(this.battery));
  }

  /** Hulajnoga jest w ruchu: odblokowana, z baterią i resztą trasy przed sobą. */
  get riding(): boolean {
    const route = this.trip?.route;
    return !this.locked && this.battery > 0 && route != null && this.trip!.progressM < route.lengthM;
  }

  /** Wolna do przejazdu pokazowego: zablokowana i bez wstrzymanej jazdy po komendzie. */
  get idle(): boolean {
    return this.locked && this.trip === null;
  }

  /** Odblokowana komendą i czeka na trasę od planisty floty. */
  get awaitingRoute(): boolean {
    return this.trip?.kind === 'command' && this.trip.route === null && !this.locked;
  }

  /** Przejazd pokazowy: hulajnoga rusza po zadanej trasie i blokuje się na jej końcu. */
  startDemoRide(route: Route): void {
    this.locked = false;
    this.trip = { kind: 'demo', route, progressM: 0 };
    this.stopping = false;
  }

  /** Trasa jazdy po odblokowaniu komendą; ignorowana, jeśli jazda w międzyczasie się skończyła albo ma trasę. */
  assignRoute(route: Route): void {
    if (this.trip?.kind === 'command' && this.trip.route === null) this.trip.route = route;
  }

  /** Upływ czasu: ruch po trasie z prędkością ograniczoną limitem i zużycie baterii. */
  tick(seconds: number): void {
    if (this.stopping) return this.lockNow();
    const trip = this.trip;
    if (!trip?.route || this.locked || this.battery <= 0 || trip.progressM >= trip.route.lengthM) {
      this.speedKmh = 0;
      if (trip?.kind === 'demo' && !this.locked) this.lockNow();
      return;
    }
    const target = Math.min(DEFAULT_SPEED_KMH, this.speedLimitKmh ?? Infinity);
    this.speedKmh = Math.round(target * (0.85 + Math.random() * 0.15) * 10) / 10;
    const step = Math.min((this.speedKmh / 3.6) * seconds, trip.route.lengthM - trip.progressM);
    trip.progressM += step;
    this.odometerM += step;
    this.battery = Math.max(0, this.battery - step / METERS_PER_BATTERY_PCT);
    this.position = trip.route.at(trip.progressM);
    if (trip.progressM < trip.route.lengthM) return;
    // Koniec trasy: przejazd pokazowy parkuje się sam, jazda po komendzie staje i czeka na `lock`.
    this.speedKmh = 0;
    if (trip.kind === 'demo') this.lockNow();
  }

  /**
   * Blokada: hulajnoga staje w miejscu. Jazda po komendzie przerwana w drodze zostaje wstrzymana (pauza),
   * a po dojechaniu do celu albo w przejeździe pokazowym się kończy.
   */
  private lockNow(): void {
    const trip = this.trip;
    const unfinished = trip?.kind === 'command' && (trip.route === null || trip.progressM < trip.route.lengthM);
    if (!unfinished) this.trip = null;
    this.locked = true;
    this.speedKmh = 0;
    this.stopping = false;
  }

  telemetry(now: Date, buffered = false): Telemetry {
    return {
      ts: now.toISOString(),
      lat: Math.round(this.position.lat * 1e6) / 1e6,
      lon: Math.round(this.position.lon * 1e6) / 1e6,
      bat: this.batteryPct,
      v: this.speedKmh,
      locked: this.locked,
      buffered,
    };
  }

  /**
   * Wykonuje komendę i zwraca potwierdzenie; powtórzony `commandId` dostaje to samo potwierdzenie bez
   * wykonania, a komenda po `expiresAt` nie jest wykonywana (ADR 0038), także dostarczona po powrocie online.
   */
  handle(command: Command, now: Date): Ack {
    const known = this.acks.get(command.commandId);
    if (known) return known;
    const expired = command.expiresAt !== undefined && now.getTime() > Date.parse(command.expiresAt);
    const reason = expired ? 'EXPIRED' : this.execute(command);
    const ack: Ack = {
      commandId: command.commandId,
      ok: reason === null,
      ...(reason ? { reason } : {}),
      ts: now.toISOString(),
    };
    this.acks.set(command.commandId, ack);
    if (this.acks.size > REMEMBERED_COMMANDS) this.acks.delete(this.acks.keys().next().value!);
    return ack;
  }

  private execute(command: Command): Ack['reason'] | null {
    switch (command.cmd) {
      case 'unlock':
        if (!this.locked) return 'ALREADY_IN_STATE';
        if (this.batteryPct < UNLOCK_MIN_BATTERY) return 'LOW_BATTERY';
        this.locked = false;
        // Nowa jazda czeka na trasę; wstrzymana jedzie dalej tą samą trasą (ADR 0039).
        this.trip ??= { kind: 'command', route: null, progressM: 0 };
        return null;
      case 'lock':
        if (this.locked) return 'ALREADY_IN_STATE';
        this.lockNow();
        return null;
      case 'stop_gradually':
        this.stopping = true;
        return null;
      case 'speed_limit':
        this.speedLimitKmh = command.params?.kmh ?? null;
        return null;
      case 'lights':
        this.lightsOn = command.params?.on ?? !this.lightsOn;
        return null;
      case 'ring':
        return null;
      default:
        return 'UNKNOWN_COMMAND';
    }
  }

  /** Stan do pliku; przejazd pokazowy przerwany restartem kończy się parkowaniem w bieżącym miejscu. */
  snapshot(): ScooterSnapshot {
    return {
      number: this.number,
      position: this.position,
      batteryPct: this.battery,
      locked: this.locked || this.trip?.kind === 'demo',
      odometerM: this.odometerM,
    };
  }
}
