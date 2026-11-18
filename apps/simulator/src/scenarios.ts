/**
 * Scenariusze awarii i jazdy do demo (ADR 0059): jedna obsługa poleceń z `simulator/control` (panel przez
 * backend) i z pliku sterującego (CLI). Na hulajnodze działa najwyżej jeden scenariusz; drugi dostaje
 * `SCENARIO_ACTIVE`, a polecenie kończące scenariusz bez scenariusza dostaje `NO_SCENARIO`. Między źródłami
 * nie ma pierwszeństwa: obowiązuje polecenie, które przyszło ostatnie.
 */
import { scooterTopicId, type SimulatorResultReason, type SimulatorScenario } from '@hulajnogi/shared';
import type { ScooterLink } from './connection.js';
import type { CommandRides, RideTarget } from './fleet.js';
import type { Point } from './geo.js';
import type { VirtualScooter } from './virtual-scooter.js';
import { findZone, findZoneById, type Zone, type ZoneProvider } from './zones.js';

/** Strefa po identyfikatorze z panelu albo po kodzie z pliku sterującego (`control goto`). */
type ZoneRef = { zoneId: string } | { code: string };

/** Polecenie scenariusza niezależnie od źródła (bez pól wiadomości MQTT: `commandId`, `expiresAt`). */
export type ScenarioCommand =
  | { scooter: number; action: 'disconnect' | 'restore' | 'silence' | 'unsilence' | 'cancel' }
  | { scooter: number; action: 'drain'; params: { targetPct: number; durationS: number } }
  | { scooter: number; action: 'goto'; params: ZoneRef | { point: Point } }
  | { scooter: number; action: 'enter_no_ride'; params: ZoneRef };

export type ScenarioOutcome = { ok: true } | { ok: false; reason: SimulatorResultReason };

type Target = NonNullable<SimulatorScenario['target']>;

type Active =
  | { kind: 'disconnect' | 'silence'; startedAt: Date }
  | {
      kind: 'drain';
      startedAt: Date;
      fromPct: number;
      targetPct: number;
      durationS: number;
      /** Poziom ustawiony w ostatnim kroku; wyższa bateria oznacza wymianę (`battery_swapped`). */
      applied: number;
    }
  | { kind: 'goto' | 'enter_no_ride'; startedAt: Date; target: Target };

export interface ScenarioOptions {
  scooters: readonly VirtualScooter[];
  links: readonly ScooterLink[];
  rides: CommandRides;
  /** Strefy z API (ADR 0046): cel `goto` i `enter_no_ride`. */
  zones: ZoneProvider;
  /** Zmiana zbioru scenariuszy (start albo koniec): symulator publikuje wtedy stan od razu. */
  onChange?: () => void;
  log?: (message: string) => void;
}

const ok: ScenarioOutcome = { ok: true };
const fail = (reason: SimulatorResultReason): ScenarioOutcome => ({ ok: false, reason });

export class Scenarios {
  private readonly active = new Map<number, Active>();
  private readonly scooters = new Map<number, VirtualScooter>();
  private readonly links = new Map<number, ScooterLink>();
  private readonly log: (message: string) => void;
  /** Polecenia wykonywane po kolei: wyszukanie strefy czeka na API, a kolejne polecenie na wynik poprzedniego. */
  private queue: Promise<unknown> = Promise.resolve();

  constructor(private readonly options: ScenarioOptions) {
    for (const scooter of options.scooters) this.scooters.set(scooter.number, scooter);
    for (const link of options.links) this.links.set(link.number, link);
    this.log = options.log ?? console.log;
  }

  /** Wykonuje polecenie; `source` trafia do logu (np. `simulator/control`, `control.json`). */
  apply(command: ScenarioCommand, now: Date, source: string): Promise<ScenarioOutcome> {
    const run = this.queue.then(() => this.execute(command, now));
    this.queue = run.catch(() => undefined);
    return run.then((outcome) => {
      const id = scooterTopicId(command.scooter);
      if (!outcome.ok)
        this.log(`Hulajnoga ${id}: polecenie ${command.action} odrzucone (${outcome.reason}, ${source}).`);
      else this.log(`Hulajnoga ${id}: polecenie ${command.action} wykonane (${source}).`);
      return outcome;
    });
  }

  private async execute(command: ScenarioCommand, now: Date): Promise<ScenarioOutcome> {
    const scooter = this.scooters.get(command.scooter);
    const link = this.links.get(command.scooter);
    if (!scooter || !link) return fail('SCOOTER_NOT_FOUND');
    const current = this.active.get(command.scooter);
    switch (command.action) {
      case 'restore':
        if (current?.kind !== 'disconnect') return fail('NO_SCENARIO');
        this.stop(scooter, current);
        return ok;
      case 'unsilence':
        if (current?.kind !== 'silence') return fail('NO_SCENARIO');
        this.stop(scooter, current);
        return ok;
      case 'cancel':
        if (!current) return fail('NO_SCENARIO');
        this.stop(scooter, current, true);
        return ok;
    }
    if (current) return fail('SCENARIO_ACTIVE');
    switch (command.action) {
      case 'disconnect':
        link.setOffline(true);
        return this.start(scooter, { kind: 'disconnect', startedAt: now });
      case 'silence':
        link.setSilent(true);
        return this.start(scooter, { kind: 'silence', startedAt: now });
      case 'drain': {
        const { targetPct, durationS } = command.params;
        // Rozładowanie nie podnosi baterii: cel nie niższy niż bieżący poziom to błąd polecenia.
        if (targetPct >= scooter.batteryLevel) return fail('INVALID_PARAMS');
        const fromPct = scooter.batteryLevel;
        return this.start(scooter, { kind: 'drain', startedAt: now, fromPct, targetPct, durationS, applied: fromPct });
      }
      case 'goto':
      case 'enter_no_ride': {
        const resolved = await this.target(command);
        if ('reason' in resolved) return fail(resolved.reason);
        // W międzyczasie (wyszukanie strefy w API) mogło przyjść inne polecenie.
        if (this.active.has(command.scooter)) return fail('SCENARIO_ACTIVE');
        this.options.rides.steer(scooter, resolved.ride);
        return this.start(scooter, { kind: command.action, startedAt: now, target: resolved.target });
      }
    }
  }

  /** Cel jazdy: strefa (`anchor`) albo punkt; wjazd w strefę zakazu tylko do strefy rodzaju `NO_RIDE`. */
  private async target(
    command: Extract<ScenarioCommand, { action: 'goto' | 'enter_no_ride' }>,
  ): Promise<{ ride: RideTarget; target: Target } | { reason: SimulatorResultReason }> {
    const { params } = command;
    if ('point' in params) {
      const { lat, lon } = params.point;
      return { ride: { point: params.point, label: `punktu ${lat},${lon}` }, target: { point: params.point } };
    }
    const zone = await this.findZone(params);
    if (!zone) return { reason: 'ZONE_NOT_FOUND' };
    if (command.action === 'enter_no_ride' && zone.type !== 'NO_RIDE') return { reason: 'INVALID_PARAMS' };
    return {
      ride: {
        point: zone.anchor,
        label: `strefy ${zone.code} „${zone.name}”`,
        ...(command.action === 'enter_no_ride' ? { zone } : {}),
      },
      target: { ...(zone.id ? { zoneId: zone.id } : {}), code: zone.code },
    };
  }

  /** Strefa ze znanych stref, a bez niej po odświeżeniu z API (strefa mogła właśnie powstać w panelu). */
  private async findZone(ref: ZoneRef): Promise<Zone | undefined> {
    const lookup = () =>
      'zoneId' in ref
        ? findZoneById(this.options.zones.zones, ref.zoneId)
        : findZone(this.options.zones.zones, ref.code);
    const known = lookup();
    if (known) return known;
    await this.options.zones.refresh();
    return lookup();
  }

  private start(scooter: VirtualScooter, scenario: Active): ScenarioOutcome {
    this.active.set(scooter.number, scenario);
    this.options.onChange?.();
    return ok;
  }

  /** Koniec scenariusza: przywraca łączność i potwierdzenia, a przerwana jazda do celu traci cel. */
  private stop(scooter: VirtualScooter, scenario: Active, cancelled = false): void {
    const link = this.links.get(scooter.number)!;
    switch (scenario.kind) {
      case 'disconnect': {
        const buffered = link.buffered;
        link.setOffline(false);
        this.log(`Hulajnoga ${scooterTopicId(scooter.number)}: powrót łączności, bufor telemetrii: ${buffered} pkt.`);
        break;
      }
      case 'silence':
        link.setSilent(false);
        break;
      case 'goto':
      case 'enter_no_ride':
        this.options.rides.unsteer(scooter, cancelled);
        break;
      case 'drain':
        // Bateria zostaje na osiągniętym poziomie i dalej spada tylko w jeździe.
        break;
    }
    this.active.delete(scooter.number);
    this.options.onChange?.();
  }

  /**
   * Krok scenariuszy (co sekundę): liniowy spadek baterii, koniec rozładowania po czasie albo po wymianie
   * baterii, koniec jazdy do celu po dojechaniu albo wjeździe w strefę.
   */
  tick(now: Date): void {
    for (const [number, scenario] of [...this.active]) {
      const scooter = this.scooters.get(number)!;
      const id = scooterTopicId(number);
      if (scenario.kind === 'drain') {
        if (scooter.batteryLevel > scenario.applied + 0.5) {
          this.log(`Hulajnoga ${id}: wymiana baterii kończy rozładowanie.`);
          this.stop(scooter, scenario);
          continue;
        }
        const elapsed = (now.getTime() - scenario.startedAt.getTime()) / 1000;
        const share = Math.min(1, elapsed / scenario.durationS);
        scooter.lowerBattery(scenario.fromPct - (scenario.fromPct - scenario.targetPct) * share);
        scenario.applied = scooter.batteryLevel;
        if (share < 1) continue;
        this.log(`Hulajnoga ${id}: rozładowanie do ${scenario.targetPct}% zakończone.`);
        this.stop(scooter, scenario);
      } else if (scenario.kind === 'goto' || scenario.kind === 'enter_no_ride') {
        if (this.options.rides.steeringProgress(scooter)?.state !== 'done') continue;
        this.log(`Hulajnoga ${id}: scenariusz ${scenario.kind} zakończony (cel osiągnięty albo jazda bez celu).`);
        this.stop(scooter, scenario);
      }
    }
  }

  /** Aktywne scenariusze z postępem do `simulator/status`. */
  list(now: Date): SimulatorScenario[] {
    return [...this.active]
      .sort(([a], [b]) => a - b)
      .map(([number, scenario]) => {
        const scooter = this.scooters.get(number)!;
        const base = { scooter: number, kind: scenario.kind, startedAt: scenario.startedAt.toISOString() };
        switch (scenario.kind) {
          case 'disconnect':
            return { ...base, progress: {} };
          case 'silence':
            return { ...base, progress: { unackedCommands: this.links.get(number)!.unacked } };
          case 'drain': {
            const elapsed = (now.getTime() - scenario.startedAt.getTime()) / 1000;
            const remainingS = Math.max(0, Math.ceil(scenario.durationS - elapsed));
            return { ...base, progress: { batteryPct: scooter.batteryPct, targetPct: scenario.targetPct, remainingS } };
          }
          case 'goto':
          case 'enter_no_ride': {
            const progress = this.options.rides.steeringProgress(scooter);
            const remainingM = progress?.state === 'driving' ? Math.round(progress.remainingM) : undefined;
            return { ...base, progress: remainingM === undefined ? {} : { remainingM }, target: scenario.target };
          }
        }
      });
  }

  /** Liczba aktywnych scenariuszy. */
  get size(): number {
    return this.active.size;
  }
}
