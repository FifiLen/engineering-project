import {
  COMMAND_ACK_TIMEOUT_MS,
  commandStatusAfterAck,
  ensurePanelCommandAllowed,
  notFound,
  type CommandRecord,
  type CommandType,
} from '@hulajnogi/core';
import { type Database, DrizzleCommandRepository, DrizzleScooterRepository } from '@hulajnogi/db';
import {
  ackSchema,
  scooterIdFromTopic,
  scooterTopicId,
  topics,
  type Command,
  type CommandView,
  type PanelCommand,
} from '@hulajnogi/shared';
import { Inject, Injectable, Logger, type OnModuleInit } from '@nestjs/common';
import { AuditedTransaction } from '../audit/audited-transaction.js';
import { DB } from '../database/database.module.js';
import { JOBS, JobsService } from '../jobs/jobs.service.js';
import { MqttService } from '../mqtt/mqtt.service.js';
import { FleetGateway } from '../realtime/fleet.gateway.js';

/** Potwierdzenie z hulajnogi po walidacji kontraktu MQTT. */
export interface AckResult {
  ok: boolean;
  reason?: string;
  at: Date;
}

/** Obsługa komend przejazdu z modułu Wypożyczenia; `false` oznacza komendę bez przejazdu. */
export type RentalCommandHandler = (commandId: string, ack: AckResult | null) => Promise<boolean>;

/** Komenda do publikacji: zapisana w `scooter_commands` (id = commandId) z terminem ważności (ADR 0038). */
export interface OutgoingCommand {
  id: string;
  scooterNumber: number;
  type: CommandType;
  sentAt: Date;
  expiresAt: Date | null;
  params?: Command['params'];
}

/**
 * Komendy do hulajnóg: zapis w `scooter_commands`, publikacja w MQTT z terminem ważności, potwierdzenia
 * i limit potwierdzenia jako zadanie pg-boss (ADR 0037). Komendy przejazdu obsługuje moduł Wypożyczenia;
 * każda zmiana statusu trafia do panelu przez Socket.IO.
 */
@Injectable()
export class CommandsService implements OnModuleInit {
  private readonly logger = new Logger(CommandsService.name);
  private rentalHandler: RentalCommandHandler = () => Promise.resolve(false);

  constructor(
    private readonly commands: DrizzleCommandRepository,
    private readonly scooters: DrizzleScooterRepository,
    private readonly mqtt: MqttService,
    private readonly gateway: FleetGateway,
    private readonly transaction: AuditedTransaction,
    private readonly jobs: JobsService,
    @Inject(DB) private readonly db: Database,
  ) {}

  onModuleInit(): void {
    this.mqtt.onMessage((topic, payload) => {
      if (topic.endsWith('/ack') && scooterIdFromTopic(topic)) {
        void this.handleAck(payload).catch((e: Error) => this.logger.error(`Potwierdzenie: ${e.message}`));
      }
    });
    this.jobs.handle(JOBS.commandAckTimeout, async ({ commandId }) => {
      await this.timeout(commandId as string);
    });
    // Zabezpieczenie: komendy, których zadanie limitu się zgubiło (ADR 0037).
    this.jobs.handle(JOBS.timeoutSweep, async () => {
      for (const record of await this.commands.overdue(new Date())) await this.timeout(record);
    });
  }

  attachRentalHandler(handler: RentalCommandHandler): void {
    this.rentalHandler = handler;
  }

  async send(staffId: string, scooterId: string, type: PanelCommand, params: Command['params']): Promise<CommandView> {
    const scooter = await this.scooters.findState(scooterId);
    if (!scooter) throw notFound('scooter', scooterId);
    ensurePanelCommandAllowed(type, scooter);
    // Zapis komendy z wpisem w dzienniku i zadaniem limitu; publikacja w MQTT dopiero po zatwierdzeniu transakcji.
    const record = await this.transaction.run(staffId, async ({ tx, audit }) => {
      const expiresAt = new Date(Date.now() + COMMAND_ACK_TIMEOUT_MS);
      const created = await new DrizzleCommandRepository(tx).create(scooterId, type, params ?? {}, expiresAt, staffId);
      await this.jobs.sendInTransaction(tx, JOBS.commandAckTimeout, { commandId: created.id }, expiresAt);
      await audit({
        action: 'scooter.command_sent',
        entityType: 'scooter',
        entityId: scooterId,
        data: { command: type, commandId: created.id, ...(params ? { params } : {}) },
      });
      return { ...created, expiresAt };
    });
    await this.dispatch({ ...record, scooterNumber: scooter.number, params });
    return this.publish(record);
  }

  /**
   * Komenda systemu bez przejazdu i bez operatora (np. `lock` hulajnogi, która bez przejazdu zgłasza się
   * odblokowana, ADR 0056): zapis z terminem ważności i zadaniem limitu, publikacja po zatwierdzeniu.
   */
  async sendSystem(scooterId: string, type: CommandType): Promise<CommandView> {
    const scooter = await this.scooters.findState(scooterId);
    if (!scooter) throw notFound('scooter', scooterId);
    const record = await this.db.transaction(async (tx) => {
      const expiresAt = new Date(Date.now() + COMMAND_ACK_TIMEOUT_MS);
      const created = await new DrizzleCommandRepository(tx).create(scooterId, type, {}, expiresAt);
      await this.jobs.sendInTransaction(tx, JOBS.commandAckTimeout, { commandId: created.id }, expiresAt);
      return { ...created, expiresAt };
    });
    await this.dispatch({ ...record, scooterNumber: scooter.number });
    return this.publish(record);
  }

  /** Publikacja zapisanej komendy w MQTT; panel widzi ją od razu w dzienniku komunikacji hulajnogi. */
  async dispatch(command: OutgoingCommand): Promise<void> {
    const message: Command = {
      commandId: command.id,
      cmd: command.type.toLowerCase() as Command['cmd'],
      issuedAt: command.sentAt.toISOString(),
      ...(command.expiresAt ? { expiresAt: command.expiresAt.toISOString() } : {}),
      ...(command.params ? { params: command.params } : {}),
    };
    await this.mqtt.publish(topics.command(scooterTopicId(command.scooterNumber)), message);
    await this.notifyPanel(command.id);
  }

  async notifyPanel(commandId: string): Promise<void> {
    const record = await this.commands.find(commandId);
    if (record) await this.publish(record);
  }

  recent(scooterId: string): Promise<CommandView[]> {
    return this.commands.recentForScooter(scooterId, 10);
  }

  /** Potwierdzenie z hulajnogi; nieznane, powtórzone i spóźnione potwierdzenia nie zmieniają stanu. */
  async handleAck(payload: Buffer): Promise<void> {
    const parsed = ackSchema.safeParse(safeJson(payload));
    if (!parsed.success) return void this.logger.warn('Odrzucono potwierdzenie niezgodne z kontraktem MQTT');
    const ack: AckResult = { ok: parsed.data.ok, reason: parsed.data.reason, at: new Date(parsed.data.ts) };
    if (await this.rentalHandler(parsed.data.commandId, ack)) return;
    const record = await this.commands.find(parsed.data.commandId);
    if (!record) return;
    const status = commandStatusAfterAck(record.status, parsed.data.ok);
    if (status === record.status) return;
    const updated = await this.commands.complete(record.id, status, ack.at, parsed.data.reason ?? null);
    if (updated) await this.publish(updated);
  }

  /** Limit potwierdzenia (zadanie `command.ack-timeout`): komenda w statusie SENT przechodzi w TIMEOUT. */
  async timeout(commandId: string): Promise<void> {
    if (await this.rentalHandler(commandId, null)) return;
    const updated = await this.commands.timeout(commandId);
    if (updated) await this.publish(updated);
  }

  private async publish(record: CommandRecord): Promise<CommandView> {
    const view = await this.commands.view(record);
    this.gateway.command(view);
    return view;
  }
}

export function safeJson(payload: Buffer): unknown {
  try {
    return JSON.parse(payload.toString('utf8'));
  } catch {
    return undefined;
  }
}
