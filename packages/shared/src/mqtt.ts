/**
 * Kontrakt MQTT między hulajnogą (lub symulatorem) a backendem.
 * Źródło prawdy: docs/kontrakty/asyncapi-mqtt.yaml. Każda zmiana tutaj wymaga zmiany kontraktu.
 */
import { z } from 'zod';

/** Numer hulajnogi w tematach MQTT: cztery cyfry z zerami wiodącymi, np. 0142. */
export const scooterTopicId = (number: number): string => number.toString().padStart(4, '0');

export const topics = {
  telemetry: (id: string) => `scooters/${id}/telemetry`,
  status: (id: string) => `scooters/${id}/status`,
  command: (id: string) => `scooters/${id}/cmd`,
  ack: (id: string) => `scooters/${id}/ack`,
  /** Subskrypcje backendu dla całej floty. */
  allTelemetry: 'scooters/+/telemetry',
  allStatus: 'scooters/+/status',
  allAcks: 'scooters/+/ack',
} as const;

/** Wyciąga numer hulajnogi z tematu, np. scooters/0142/telemetry -> "0142". */
export const scooterIdFromTopic = (topic: string): string | null => {
  const match = /^scooters\/(\d{4})\/(telemetry|status|cmd|ack)$/.exec(topic);
  return match?.[1] ?? null;
};

export const telemetrySchema = z.object({
  ts: z.iso.datetime(),
  lat: z.number().min(-90).max(90),
  lon: z.number().min(-180).max(180),
  bat: z.number().int().min(0).max(100),
  v: z.number().min(0),
  locked: z.boolean(),
  buffered: z.boolean().default(false),
});
export type Telemetry = z.infer<typeof telemetrySchema>;

export const statusSchema = z.object({
  online: z.boolean(),
  firmware: z.string().optional(),
  since: z.iso.datetime().optional(),
});
export type Status = z.infer<typeof statusSchema>;

/**
 * Kontrakt 1.2.0 (ADR 0044): `release_stop` przywraca napęd po `stop_gradually`, `speed_limit` bez `kmh` zdejmuje
 * limit, a `lock` kasuje limit i zatrzymanie w urządzeniu.
 */
export const commandNames = [
  'unlock',
  'lock',
  'speed_limit',
  'stop_gradually',
  'ring',
  'lights',
  'release_stop',
] as const;
export type CommandName = (typeof commandNames)[number];

export const commandSchema = z.object({
  commandId: z.uuid(),
  cmd: z.enum(commandNames),
  issuedAt: z.iso.datetime(),
  /** Kontrakt 1.1.0 (ADR 0038): po tym czasie hulajnoga nie wykonuje komendy i odpowiada powodem EXPIRED. */
  expiresAt: z.iso.datetime().optional(),
  params: z
    .object({
      kmh: z.number().int().min(0).optional(),
      on: z.boolean().optional(),
    })
    .optional(),
});
export type Command = z.infer<typeof commandSchema>;

export const ackReasons = ['LOW_BATTERY', 'ALREADY_IN_STATE', 'HARDWARE_ERROR', 'UNKNOWN_COMMAND', 'EXPIRED'] as const;

export const ackSchema = z.object({
  commandId: z.uuid(),
  ok: z.boolean(),
  reason: z.enum(ackReasons).optional(),
  ts: z.iso.datetime(),
});
export type Ack = z.infer<typeof ackSchema>;

/** Treść, którą broker publikuje jako Last Will po zerwaniu połączenia hulajnogi. */
export const lastWillPayload: Status = { online: false };
