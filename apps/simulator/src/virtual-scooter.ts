/**
 * Wirtualna hulajnoga: stan urządzenia, jazda po trasie, bateria i odpowiedzi na komendy według
 * kontraktu MQTT (docs/kontrakty/asyncapi-mqtt.yaml). Bez wejścia-wyjścia, więc da się ją testować
 * bez brokera; połączenie zestawia `connection.ts`.
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

export class VirtualScooter {
  position: Point;
  locked = true;
  speedKmh = 0;
  lightsOn = false;
  speedLimitKmh: number | null = null;
  /** Bateria z ułamkiem; w telemetrii zaokrąglona w dół. */
  private battery: number;
  private odometerM: number;
  private route: Route | null = null;
  private progressM = 0;
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

  get riding(): boolean {
    return this.route !== null;
  }

  /** Jazda pokazowa (do iteracji 3) albo jazda po odblokowaniu: hulajnoga rusza po zadanej trasie. */
  startRide(route: Route): void {
    this.locked = false;
    this.route = route;
    this.progressM = 0;
    this.stopping = false;
  }

  /** Upływ czasu: ruch po trasie z prędkością ograniczoną limitem i zużycie baterii. */
  tick(seconds: number): void {
    if (!this.route) {
      this.speedKmh = 0;
      return;
    }
    if (this.stopping || this.battery <= 0) return this.finishRide();
    const target = Math.min(DEFAULT_SPEED_KMH, this.speedLimitKmh ?? Infinity);
    this.speedKmh = Math.round(target * (0.85 + Math.random() * 0.15) * 10) / 10;
    const step = Math.min((this.speedKmh / 3.6) * seconds, this.route.lengthM - this.progressM);
    this.progressM += step;
    this.odometerM += step;
    this.battery = Math.max(0, this.battery - step / METERS_PER_BATTERY_PCT);
    this.position = this.route.at(this.progressM);
    if (this.progressM >= this.route.lengthM) this.finishRide();
  }

  /** Koniec trasy: hulajnoga staje i blokuje się (przejazd pokazowy kończy się parkowaniem). */
  private finishRide(): void {
    this.route = null;
    this.speedKmh = 0;
    this.locked = true;
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

  /** Wykonuje komendę i zwraca potwierdzenie; powtórzony `commandId` dostaje to samo potwierdzenie bez wykonania. */
  handle(command: Command, now: Date): Ack {
    const known = this.acks.get(command.commandId);
    if (known) return known;
    const reason = this.execute(command);
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
        return null;
      case 'lock':
        if (this.locked && !this.route) return 'ALREADY_IN_STATE';
        this.finishRide();
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

  snapshot(): ScooterSnapshot {
    return {
      number: this.number,
      position: this.position,
      batteryPct: this.battery,
      locked: this.locked,
      odometerM: this.odometerM,
    };
  }
}
