import type { CommandRecord, CommandRepository, CommandStatus, CommandType } from '@hulajnogi/core';
import type { CommandView } from '@hulajnogi/shared';
import { and, desc, eq, lt } from 'drizzle-orm';
import type { DbExecutor } from '../client.js';
import { scooterCommands, scooters } from '../schema/schema.js';

const recordColumns = {
  id: scooterCommands.id,
  scooterId: scooterCommands.scooterId,
  type: scooterCommands.type,
  status: scooterCommands.status,
  payload: scooterCommands.payload,
  sentAt: scooterCommands.sentAt,
  ackedAt: scooterCommands.ackedAt,
};

const toRecord = (r: { [K in keyof typeof recordColumns]: unknown }): CommandRecord => ({
  ...(r as Omit<CommandRecord, 'payload'>),
  payload: (r.payload ?? {}) as Record<string, unknown>,
});

/** Moduł Flota: komendy MQTT; `id` jest jednocześnie `commandId` w wiadomości (idempotencja, arc42 §8.2). */
export class DrizzleCommandRepository implements CommandRepository {
  constructor(private readonly db: DbExecutor) {}

  /** `expiresAt`: termin z kontraktu MQTT 1.1.0, po którym hulajnoga nie wykona komendy (ADR 0038). */
  async create(
    scooterId: string,
    type: CommandType,
    payload: Record<string, unknown>,
    expiresAt?: Date,
  ): Promise<CommandRecord> {
    const [row] = await this.db
      .insert(scooterCommands)
      .values({ scooterId, type, payload, expiresAt })
      .returning(recordColumns);
    return toRecord(row!);
  }

  async find(id: string): Promise<CommandRecord | null> {
    const [row] = await this.db.select(recordColumns).from(scooterCommands).where(eq(scooterCommands.id, id));
    return row ? toRecord(row) : null;
  }

  /** Zmienia tylko komendę czekającą na odpowiedź; powtórzone lub spóźnione potwierdzenie nic nie zmienia. */
  async complete(
    id: string,
    status: CommandStatus,
    at: Date,
    reason: string | null = null,
  ): Promise<CommandRecord | null> {
    const [row] = await this.db
      .update(scooterCommands)
      .set({ status, ackedAt: at, ackReason: reason })
      .where(and(eq(scooterCommands.id, id), eq(scooterCommands.status, 'SENT')))
      .returning(recordColumns);
    return row ? toRecord(row) : null;
  }

  async timeout(id: string): Promise<CommandRecord | null> {
    const [row] = await this.db
      .update(scooterCommands)
      .set({ status: 'TIMEOUT' })
      .where(and(eq(scooterCommands.id, id), eq(scooterCommands.status, 'SENT')))
      .returning(recordColumns);
    return row ? toRecord(row) : null;
  }

  async overdue(sentBefore: Date): Promise<string[]> {
    const rows = await this.db
      .select({ id: scooterCommands.id })
      .from(scooterCommands)
      .where(and(eq(scooterCommands.status, 'SENT'), lt(scooterCommands.sentAt, sentBefore)))
      .orderBy(scooterCommands.sentAt)
      .limit(100);
    return rows.map((r) => r.id);
  }

  /** Ostatnie komendy hulajnogi do karty na mapie floty. */
  async recentForScooter(scooterId: string, limit: number): Promise<CommandView[]> {
    const rows = await this.db
      .select({ ...recordColumns, scooterNumber: scooters.number })
      .from(scooterCommands)
      .innerJoin(scooters, eq(scooters.id, scooterCommands.scooterId))
      .where(eq(scooterCommands.scooterId, scooterId))
      .orderBy(desc(scooterCommands.sentAt))
      .limit(limit);
    return rows.map(toView);
  }

  async view(record: CommandRecord): Promise<CommandView> {
    const [row] = await this.db
      .select({ number: scooters.number })
      .from(scooters)
      .where(eq(scooters.id, record.scooterId));
    return toView({ ...record, scooterNumber: row?.number ?? 0 });
  }
}

function toView(r: Omit<CommandRecord, 'payload'> & { scooterNumber: number; payload?: unknown }): CommandView {
  return {
    id: r.id,
    scooterId: r.scooterId,
    scooterNumber: r.scooterNumber,
    type: r.type,
    status: r.status,
    sentAt: r.sentAt.toISOString(),
    ackedAt: r.ackedAt?.toISOString() ?? null,
  };
}
