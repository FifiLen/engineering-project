import { DomainError } from '../errors.js';
import type { ScooterStatus } from './fleet-status.js';

/** Komendy do hulajnogi (typ `command_type`); w MQTT te same nazwy małymi literami. */
export const COMMAND_TYPES = ['UNLOCK', 'LOCK', 'SPEED_LIMIT', 'STOP_GRADUALLY', 'RING', 'LIGHTS'] as const;
export type CommandType = (typeof COMMAND_TYPES)[number];

export const COMMAND_STATUSES = ['SENT', 'ACKED', 'REJECTED', 'TIMEOUT'] as const;
export type CommandStatus = (typeof COMMAND_STATUSES)[number];

/** Komendy dostępne dla operatora w panelu; limit prędkości i zatrzymanie wysyła system w trakcie przejazdu. */
export const PANEL_COMMANDS = ['UNLOCK', 'LOCK', 'RING', 'LIGHTS'] as const satisfies readonly CommandType[];
export type PanelCommand = (typeof PANEL_COMMANDS)[number];

/** Czas na potwierdzenie komendy (ADR 0016: limit 10 s na potwierdzenie odblokowania). */
export const COMMAND_ACK_TIMEOUT_MS = 10_000;

export interface CommandTarget {
  status: ScooterStatus;
  online: boolean;
  hasOpenRental: boolean;
}

/**
 * Reguły komend z panelu. Odblokowanie poza przejazdem jest dozwolone tylko w serwisie: dostępną
 * hulajnogę odblokowuje wyłącznie proces wypożyczenia, inaczej można by nią odjechać bez opłaty.
 */
export function ensurePanelCommandAllowed(
  command: CommandType,
  target: CommandTarget,
): asserts command is PanelCommand {
  if (!(PANEL_COMMANDS as readonly CommandType[]).includes(command)) {
    throw new DomainError('COMMAND_NOT_ALLOWED', { command });
  }
  if (target.status === 'RETIRED') throw new DomainError('SCOOTER_RETIRED');
  if (!target.online) throw new DomainError('SCOOTER_OFFLINE');
  if (command === 'UNLOCK') {
    if (target.hasOpenRental) throw new DomainError('SCOOTER_HAS_OPEN_RENTAL');
    if (target.status !== 'MAINTENANCE') throw new DomainError('UNLOCK_REQUIRES_MAINTENANCE');
  }
}

/** Status komendy po potwierdzeniu z hulajnogi; potwierdzenie spóźnione po przekroczeniu czasu nie zmienia statusu. */
export function commandStatusAfterAck(current: CommandStatus, ok: boolean): CommandStatus {
  if (current !== 'SENT') return current;
  return ok ? 'ACKED' : 'REJECTED';
}

export function isCommandTimedOut(sentAt: Date, now: Date): boolean {
  return now.getTime() - sentAt.getTime() >= COMMAND_ACK_TIMEOUT_MS;
}
