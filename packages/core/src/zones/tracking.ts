import type { ZoneCommand } from '../fleet/commands.js';
import { evaluatePosition, type Zone } from './zones.js';

/** Histereza wyjazdu ze strefy (pytanie 6 w planie iteracji 4, ADR 0043). */
export const ZONE_EXIT_READINGS = 2;
export const ZONE_EXIT_DISTANCE_M = 10;

/** Strefa, w której jest hulajnoga, z liczbą kolejnych odczytów poza nią. */
export interface ZonePresence {
  zone: Zone;
  enteredAt: Date;
  outsideCount: number;
}

/** Strefy w promieniu `ZONE_EXIT_DISTANCE_M` od odczytu z flagą „punkt w strefie”. */
export interface ZoneReading {
  at: Date;
  near: ReadonlyArray<{ zone: Zone; inside: boolean }>;
}

export interface ZoneTransition {
  kind: 'ENTERED' | 'EXITED';
  zone: Zone;
  at: Date;
}

export interface ZoneChanges {
  presence: ZonePresence[];
  transitions: ZoneTransition[];
}

/**
 * Przejścia stref dla jednego odczytu (ADR 0043). Wjazd od pierwszego odczytu w strefie; wyjazd po
 * `ZONE_EXIT_READINGS` kolejnych odczytach poza strefą albo od razu, gdy strefy nie ma nawet w promieniu
 * (oddalenie, dezaktywacja). `previous = null` to pierwszy odczyt przejazdu: stan bez zdarzeń.
 */
export function detectZoneChanges(previous: readonly ZonePresence[] | null, reading: ZoneReading): ZoneChanges {
  const inside = reading.near.filter((n) => n.inside).map((n) => n.zone);
  if (previous === null) {
    return { presence: inside.map((zone) => ({ zone, enteredAt: reading.at, outsideCount: 0 })), transitions: [] };
  }
  const near = new Map(reading.near.map((n) => [n.zone.id, n]));
  const presence: ZonePresence[] = [];
  const transitions: ZoneTransition[] = [];
  for (const current of previous) {
    const seen = near.get(current.zone.id);
    // Dane strefy (np. nowy limit) zawsze z bieżącego odczytu.
    const zone = seen?.zone ?? current.zone;
    if (seen?.inside) {
      presence.push({ zone, enteredAt: current.enteredAt, outsideCount: 0 });
      continue;
    }
    const outsideCount = current.outsideCount + 1;
    if (!seen || outsideCount >= ZONE_EXIT_READINGS) transitions.push({ kind: 'EXITED', zone, at: reading.at });
    else presence.push({ zone, enteredAt: current.enteredAt, outsideCount });
  }
  const known = new Set(previous.map((p) => p.zone.id));
  for (const zone of inside) {
    if (known.has(zone.id)) continue;
    presence.push({ zone, enteredAt: reading.at, outsideCount: 0 });
    transitions.push({ kind: 'ENTERED', zone, at: reading.at });
  }
  return { presence, transitions };
}

/** Stan hulajnogi wymagany przez strefy: zatrzymanie (zakaz, poza obszarem) i najniższy limit wolnej jazdy. */
export interface ZoneControl {
  stopped: boolean;
  speedLimitKmh: number | null;
}

export function desiredZoneControl(zones: readonly Zone[]): ZoneControl {
  const rules = evaluatePosition(zones);
  return { stopped: !rules.canRide, speedLimitKmh: rules.speedLimitKmh };
}

/** Stan zastosowany: ostatnio wysłany limit i zatrzymanie oraz to, czy hulajnoga je przyjęła albo czeka. */
export interface AppliedZoneControl extends ZoneControl {
  limitSynced: boolean;
  stopSynced: boolean;
}

/** Hulajnoga po odblokowaniu: bez limitu i z napędem (`lock` kasuje oba, kontrakt MQTT 1.2.0). */
export const RESET_ZONE_CONTROL: AppliedZoneControl = {
  stopped: false,
  speedLimitKmh: null,
  limitSynced: true,
  stopSynced: true,
};

export interface ZoneControlCommand {
  type: ZoneCommand;
  speedLimitKmh?: number | null;
}

/**
 * Uzgadnianie stanu docelowego (ADR 0044): komenda tylko przy różnicy albo po nieudanej poprzedniej.
 * Zatrzymanie ma pierwszeństwo, ale limit też jest wysyłany, żeby po wyjeździe ze strefy zakazu obowiązywał.
 */
export function zoneControlCommands(applied: AppliedZoneControl, desired: ZoneControl): ZoneControlCommand[] {
  const commands: ZoneControlCommand[] = [];
  if (desired.stopped !== applied.stopped || !applied.stopSynced) {
    commands.push({ type: desired.stopped ? 'STOP_GRADUALLY' : 'RELEASE_STOP' });
  }
  if (desired.speedLimitKmh !== applied.speedLimitKmh || !applied.limitSynced) {
    commands.push({ type: 'SPEED_LIMIT', speedLimitKmh: desired.speedLimitKmh });
  }
  return commands;
}
