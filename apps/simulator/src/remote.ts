/**
 * Kanał sterowania symulatorem przez MQTT (ADR 0059, docs/kontrakty/asyncapi-symulator.yaml 1.0.0):
 * polecenia z `simulator/control` (publikuje tylko backend), wynik na `simulator/control/result` i stan
 * na `simulator/status` (retained). Bez wejścia-wyjścia, więc da się go testować bez brokera.
 */
import {
  simulatorControlSchema,
  type SimulatorResult,
  type SimulatorScenario,
  type SimulatorStatus,
} from '@hulajnogi/shared';
import type { Scenarios } from './scenarios.js';

/** Pamięć wyników do idempotencji po `commandId` (QoS 1 może dostarczyć polecenie ponownie). */
const REMEMBERED_RESULTS = 200;
/** Stan publikowany co tyle bez zmian, a co `STATUS_ACTIVE_MS`, gdy trwa scenariusz z postępem. */
export const STATUS_INTERVAL_MS = 10_000;
export const STATUS_ACTIVE_MS = 2_000;

const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** `commandId` z wiadomości niezgodnej ze schematem, żeby backend dostał wynik `INVALID_PARAMS`. */
function commandIdOf(raw: unknown): string | null {
  if (typeof raw !== 'object' || raw === null) return null;
  const id = (raw as { commandId?: unknown }).commandId;
  return typeof id === 'string' && uuidPattern.test(id) ? id : null;
}

export class ControlChannel {
  private readonly results = new Map<string, Promise<SimulatorResult>>();

  constructor(
    private readonly scenarios: Scenarios,
    private readonly log: (message: string) => void = console.log,
  ) {}

  /**
   * Obsługa wiadomości `simulator/control`. Zwraca wynik do opublikowania albo `null`, gdy wiadomość nie ma
   * rozpoznawalnego `commandId` (wtedy nie ma komu odpowiedzieć). Powtórzony `commandId` dostaje ten sam
   * wynik bez ponownego wykonania; polecenie po `expiresAt` dostaje `EXPIRED`.
   */
  handle(payload: Buffer | string, now = new Date()): Promise<SimulatorResult> | null {
    let raw: unknown;
    try {
      raw = JSON.parse(payload.toString());
    } catch {
      this.log('simulator/control: wiadomość nie jest JSON-em, pominięta.');
      return null;
    }
    const commandId = commandIdOf(raw);
    if (!commandId) {
      this.log('simulator/control: wiadomość bez commandId, pominięta.');
      return null;
    }
    const known = this.results.get(commandId);
    if (known) return known;
    const result = this.execute(raw, commandId, now);
    this.results.set(commandId, result);
    if (this.results.size > REMEMBERED_RESULTS) this.results.delete(this.results.keys().next().value!);
    return result;
  }

  private async execute(raw: unknown, commandId: string, now: Date): Promise<SimulatorResult> {
    const parsed = simulatorControlSchema.safeParse(raw);
    if (!parsed.success) {
      this.log(`simulator/control: polecenie ${commandId} niezgodne z kontraktem, odrzucone (INVALID_PARAMS).`);
      return { commandId, ok: false, reason: 'INVALID_PARAMS' };
    }
    if (now.getTime() > Date.parse(parsed.data.expiresAt)) {
      this.log(`simulator/control: polecenie ${commandId} po terminie ważności, odrzucone (EXPIRED).`);
      return { commandId, ok: false, reason: 'EXPIRED' };
    }
    const outcome = await this.scenarios.apply(parsed.data, now, 'simulator/control');
    return outcome.ok ? { commandId, ok: true } : { commandId, ok: false, reason: outcome.reason };
  }
}

export interface StatusInput {
  since: string;
  fleetSize: number;
  connected: number;
  riding: number;
  messagesPerSecond: number;
  ridesPerHour: number;
  telemetryIntervalMs: number;
  ridesStarted: number;
  commandsReceived: number;
  commandsUnacked: number;
  scenarios: SimulatorScenario[];
}

/** Treść `simulator/status`: dotychczasowe pola i od kontraktu symulatora 1.0.0 scenariusze z postępem. */
export function simulatorStatus(input: StatusInput, now: Date): SimulatorStatus {
  return { online: true, ...input, updatedAt: now.toISOString() };
}

/**
 * Kiedy publikować stan: od razu po zmianie scenariuszy, co `STATUS_ACTIVE_MS` przy trwającym scenariuszu
 * (postęp rozładowania i jazdy w panelu) i co `STATUS_INTERVAL_MS` bez scenariuszy.
 */
export function statusDue(input: { changed: boolean; scenarios: number; sinceLastMs: number }): boolean {
  if (input.changed) return true;
  return input.sinceLastMs >= (input.scenarios > 0 ? STATUS_ACTIVE_MS : STATUS_INTERVAL_MS);
}
