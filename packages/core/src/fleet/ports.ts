/**
 * Porty modułów Flota i Telemetria (ADR 0025). Implementacje są w packages/db, a apps/api składa je
 * z regułami z tego pakietu. Odczyt list w panelu idzie wspólnym mechanizmem list (ADR 0031) i nie
 * potrzebuje portu, bo nie wykonuje reguł.
 */
import type { GeoPoint } from '../zones/zones.js';
import type { CommandStatus, CommandType } from './commands.js';
import type { ScooterStatus } from './fleet-status.js';
import type { ScooterVariant } from './scooters.js';
import type { TelemetryReading } from '../telemetry/telemetry.js';

export interface ScooterState {
  id: string;
  number: number;
  status: ScooterStatus;
  online: boolean;
  batteryPct: number | null;
  modelId: string;
  version: number;
  hasOpenRental: boolean;
}

export interface ScooterDraft {
  number: number;
  serialNumber: string;
  variant: ScooterVariant;
  modelId: string;
  status: ScooterStatus;
  firmware: string | null;
}

export type ScooterChanges = Partial<Omit<ScooterDraft, 'number'>>;

export interface ScooterRepository {
  findState(id: string): Promise<ScooterState | null>;
  create(draft: ScooterDraft): Promise<{ id: string }>;
  /** Zapis z blokadą optymistyczną; `false`, gdy wersja w bazie jest inna niż `version`. */
  update(id: string, version: number, changes: ScooterChanges): Promise<boolean>;
}

export interface ScooterModelState {
  id: string;
  code: string;
  active: boolean;
  version: number;
  scootersTotal: number;
}

export interface ScooterModelDraft {
  code: string;
  name: string;
  manufacturer: string | null;
  maxSpeedKmh: number | null;
  batteryWh: number | null;
  rangeKm: number | null;
  weightKg: number | null;
  description: string | null;
  active: boolean;
}

export interface ScooterModelRepository {
  findState(id: string): Promise<ScooterModelState | null>;
  create(draft: ScooterModelDraft): Promise<{ id: string }>;
  update(id: string, version: number, changes: Partial<ScooterModelDraft>): Promise<boolean>;
  delete(id: string): Promise<void>;
}

/** Stan hulajnogi potrzebny przy przyjmowaniu telemetrii, wyszukiwany po numerze z tematu MQTT. */
export interface TelemetryTarget {
  id: string;
  number: number;
  status: ScooterStatus;
  online: boolean;
  batteryPct: number | null;
  lastSeenAt: Date | null;
  position: GeoPoint | null;
}

export interface CurrentStateUpdate {
  scooterId: string;
  reading: TelemetryReading;
  odometerIncrementM: number;
}

export interface TelemetryRepository {
  findTargets(numbers: readonly number[]): Promise<TelemetryTarget[]>;
  /** Historia i stan bieżący w jednej transakcji. */
  save(
    history: ReadonlyArray<{ scooterId: string; reading: TelemetryReading }>,
    current: readonly CurrentStateUpdate[],
  ): Promise<void>;
  setConnection(number: number, online: boolean, firmware: string | null): Promise<TelemetryTarget | null>;
}

export interface CommandRecord {
  id: string;
  scooterId: string;
  type: CommandType;
  status: CommandStatus;
  payload: Record<string, unknown>;
  sentAt: Date;
  ackedAt: Date | null;
}

export interface CommandRepository {
  create(scooterId: string, type: CommandType, payload: Record<string, unknown>, expiresAt?: Date): Promise<CommandRecord>;
  find(id: string): Promise<CommandRecord | null>;
  complete(id: string, status: CommandStatus, at: Date, reason?: string | null): Promise<CommandRecord | null>;
  /** Komenda bez odpowiedzi w limicie przechodzi w TIMEOUT; `null`, gdy już ma wynik. */
  timeout(id: string): Promise<CommandRecord | null>;
  /** Identyfikatory komend bez odpowiedzi wysłanych przed `sentBefore` (zadanie zabezpieczające). */
  overdue(sentBefore: Date): Promise<string[]>;
}
