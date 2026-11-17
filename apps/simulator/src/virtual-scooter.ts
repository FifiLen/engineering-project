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
/** `stop_gradually`: prędkość spada do zera w tym czasie (kontrakt 1.2.0, ADR 0046). */
export const STOP_DURATION_S = 3;
/** Hulajnoga prowadzona pieszo przez wirtualnego klienta (ADR 0046). */
export const WALK_SPEED_KMH = 4;

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
 * w trakcie drogi tylko ją wstrzymuje: kolejne odblokowanie jedzie dalej tą samą trasą. Wirtualny klient
 * może porzucić trasę (`abandonRoute`), żeby planista wyznaczył nową z bieżącego miejsca (ADR 0046).
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
  /** Napęd wyłączony komendą `stop_gradually` do `release_stop` albo `lock` (kontrakt 1.2.0). */
  private stopped = false;
  /** Opóźnienie hamowania po `stop_gradually`, km/h na sekundę. */
  private brakingKmhPerS = 0;
  /** Klient prowadzi hulajnogę pieszo wstecz po trasie: ruch bez napędu i bez zużycia baterii. */
  private pushed = false;
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

  /** Hulajnoga jedzie o własnym napędzie: odblokowana, z napędem, baterią i resztą trasy przed sobą. */
  get riding(): boolean {
    const route = this.trip?.route;
    return !this.locked && !this.stopped && this.battery > 0 && route != null && this.trip!.progressM < route.lengthM;
  }

  /** Napęd wyłączony komendą `stop_gradually`; hulajnoga zwalnia, a potem stoi albo jest prowadzona. */
  get driveStopped(): boolean {
    return this.stopped;
  }

  /** Klient prowadzi hulajnogę pieszo (ADR 0046). */
  get walking(): boolean {
    return this.pushed;
  }

  /** Trwa jazda klienta po odblokowaniu komendą (także wstrzymana blokadą). */
  get onCommandTrip(): boolean {
    return this.trip?.kind === 'command';
  }

  /** Wolna do przejazdu pokazowego: zablokowana i bez wstrzymanej jazdy po komendzie. */
  get idle(): boolean {
    return this.locked && this.trip === null;
  }

  /** Odblokowana komendą, z napędem, i czeka na trasę od planisty floty. */
  get awaitingRoute(): boolean {
    return this.trip?.kind === 'command' && this.trip.route === null && !this.locked && !this.stopped;
  }

  /** Przejazd pokazowy: hulajnoga rusza po zadanej trasie i blokuje się na jej końcu. */
  startDemoRide(route: Route): void {
    this.locked = false;
    this.trip = { kind: 'demo', route, progressM: 0 };
    this.stopped = false;
  }

  /** Trasa jazdy po odblokowaniu komendą; ignorowana, jeśli jazda w międzyczasie się skończyła albo ma trasę. */
  assignRoute(route: Route): void {
    if (this.trip?.kind === 'command' && this.trip.route === null) this.trip.route = route;
  }

  /** Porzuca trasę jazdy po komendzie; po przywróceniu napędu planista wyznaczy nową z bieżącego miejsca. */
  abandonRoute(): void {
    if (this.trip?.kind !== 'command') return;
    this.trip.route = null;
    this.trip.progressM = 0;
    this.pushed = false;
  }

  /**
   * Klient zaczyna prowadzić hulajnogę pieszo wstecz po przebytej trasie (ADR 0046). Zwraca `false`, gdy
   * nie ma dokąd się cofać: hulajnoga zablokowana, bez trasy albo na jej początku.
   */
  walkBack(): boolean {
    const trip = this.trip;
    if (this.locked || !trip?.route || trip.progressM <= 0) return false;
    this.pushed = true;
    return true;
  }

  stopWalking(): void {
    if (!this.pushed) return;
    this.pushed = false;
    this.speedKmh = 0;
  }

  /**
   * Upływ czasu: ruch po trasie z prędkością ograniczoną limitem i zużycie baterii, po `stop_gradually`
   * hamowanie bez napędu, a w trakcie prowadzenia ruch wstecz z prędkością pieszego.
   */
  tick(seconds: number): void {
    const trip = this.trip;
    const route = trip?.route;
    if (!trip || !route || this.locked) {
      this.speedKmh = 0;
      return;
    }
    if (this.pushed) return this.walk(trip, route, seconds);
    if (this.stopped) return this.brake(trip, route, seconds);
    if (this.battery <= 0 || trip.progressM >= route.lengthM) {
      this.speedKmh = 0;
      if (trip.kind === 'demo') this.lockNow();
      return;
    }
    const target = Math.min(DEFAULT_SPEED_KMH, this.speedLimitKmh ?? Infinity);
    this.speedKmh = Math.round(target * (0.85 + Math.random() * 0.15) * 10) / 10;
    const step = this.advance(trip, route, (this.speedKmh / 3.6) * seconds);
    this.battery = Math.max(0, this.battery - step / METERS_PER_BATTERY_PCT);
    if (trip.progressM < route.lengthM) return;
    // Koniec trasy: przejazd pokazowy parkuje się sam, jazda po komendzie staje i czeka na `lock`.
    this.speedKmh = 0;
    if (trip.kind === 'demo') this.lockNow();
  }

  /** Przesunięcie po trasie o `meters` (ujemne: wstecz) w jej granicach; zwraca przebytą drogę. */
  private advance(trip: Trip, route: Route, meters: number): number {
    const next = Math.min(route.lengthM, Math.max(0, trip.progressM + meters));
    const step = Math.abs(next - trip.progressM);
    trip.progressM = next;
    this.odometerM += step;
    this.position = route.at(next);
    return step;
  }

  /** Hamowanie po `stop_gradually`: hulajnoga toczy się bez napędu i staje po około `STOP_DURATION_S`. */
  private brake(trip: Trip, route: Route, seconds: number): void {
    const before = this.speedKmh;
    const t = Math.min(seconds, this.brakingKmhPerS > 0 ? before / this.brakingKmhPerS : 0);
    const after = before - this.brakingKmhPerS * t;
    // Prędkość w telemetrii jest zaokrąglana, więc resztka poniżej 0,5 km/h to już postój.
    this.speedKmh = after < 0.5 ? 0 : Math.round(after * 10) / 10;
    this.advance(trip, route, ((before - (this.brakingKmhPerS * t) / 2) / 3.6) * t);
    if (trip.progressM >= route.lengthM) this.speedKmh = 0;
    // Przejazd pokazowy nie ma klienta, który by hulajnogę wyprowadził: kończy się w miejscu zatrzymania.
    if (this.speedKmh === 0 && trip.kind === 'demo') this.lockNow();
  }

  /** Prowadzenie pieszo wstecz po trasie; na jej początku klient staje. */
  private walk(trip: Trip, route: Route, seconds: number): void {
    this.speedKmh = Math.round(WALK_SPEED_KMH * (0.92 + Math.random() * 0.16) * 10) / 10;
    this.advance(trip, route, -(this.speedKmh / 3.6) * seconds);
    if (trip.progressM > 0) return;
    this.pushed = false;
    this.speedKmh = 0;
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
    this.clearZoneControl();
  }

  /** `lock` kasuje limit prędkości i zatrzymanie (kontrakt 1.2.0); klient przestaje prowadzić hulajnogę. */
  private clearZoneControl(): void {
    this.speedLimitKmh = null;
    this.stopped = false;
    this.brakingKmhPerS = 0;
    this.pushed = false;
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
        // Zablokowana hulajnoga też kasuje limit i zatrzymanie: backend po potwierdzeniu blokady (także
        // `ALREADY_IN_STATE`) zeruje stan zastosowany stref (ADR 0044).
        if (this.locked) {
          this.clearZoneControl();
          return 'ALREADY_IN_STATE';
        }
        this.lockNow();
        return null;
      case 'stop_gradually':
        // Powtórzenie jest potwierdzane jako sukces: backend ponawia komendy stref po utracie potwierdzenia.
        if (!this.stopped) this.brakingKmhPerS = Math.max(this.speedKmh, 1) / STOP_DURATION_S;
        this.stopped = true;
        return null;
      case 'release_stop':
        if (!this.stopped) return 'ALREADY_IN_STATE';
        this.stopped = false;
        this.brakingKmhPerS = 0;
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
