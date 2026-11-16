import {
  COMMAND_ACK_TIMEOUT_MS,
  commandStatusAfterAck,
  ensurePanelCommandAllowed,
  notFound,
  type CommandRecord,
} from '@hulajnogi/core';
import { DrizzleCommandRepository, DrizzleScooterRepository } from '@hulajnogi/db';
import {
  ackSchema,
  scooterIdFromTopic,
  scooterTopicId,
  topics,
  type Command,
  type CommandView,
  type PanelCommand,
} from '@hulajnogi/shared';
import { Injectable, Logger, type OnApplicationShutdown, type OnModuleInit } from '@nestjs/common';
import { MqttService } from '../mqtt/mqtt.service.js';
import { FleetGateway } from '../realtime/fleet.gateway.js';

/** Co ile sprawdzamy komendy bez potwierdzenia; stan jest w bazie, więc restart niczego nie gubi. */
const TIMEOUT_SWEEP_MS = 2000;

/**
 * Komendy do hulajnóg: zapis w `scooter_commands` (id = commandId), publikacja w MQTT, potwierdzenia
 * i przekroczenie czasu. Każda zmiana statusu trafia do panelu przez Socket.IO.
 */
@Injectable()
export class CommandsService implements OnModuleInit, OnApplicationShutdown {
  private readonly logger = new Logger(CommandsService.name);
  private sweep?: NodeJS.Timeout;

  constructor(
    private readonly commands: DrizzleCommandRepository,
    private readonly scooters: DrizzleScooterRepository,
    private readonly mqtt: MqttService,
    private readonly gateway: FleetGateway,
  ) {}

  onModuleInit(): void {
    this.mqtt.onMessage((topic, payload) => {
      if (topic.endsWith('/ack') && scooterIdFromTopic(topic)) void this.handleAck(payload);
    });
    this.sweep = setInterval(
      () => void this.expirePending().catch((e: Error) => this.logger.error(e.message)),
      TIMEOUT_SWEEP_MS,
    );
    this.sweep.unref();
  }

  onApplicationShutdown(): void {
    clearInterval(this.sweep);
  }

  async send(scooterId: string, type: PanelCommand, params: Command['params']): Promise<CommandView> {
    const scooter = await this.scooters.findState(scooterId);
    if (!scooter) throw notFound('scooter', scooterId);
    ensurePanelCommandAllowed(type, scooter);
    const record = await this.commands.create(scooterId, type, params ?? {});
    const message: Command = {
      commandId: record.id,
      cmd: type.toLowerCase() as Command['cmd'],
      issuedAt: record.sentAt.toISOString(),
      ...(params ? { params } : {}),
    };
    await this.mqtt.publish(topics.command(scooterTopicId(scooter.number)), message);
    return this.publish(record);
  }

  recent(scooterId: string): Promise<CommandView[]> {
    return this.commands.recentForScooter(scooterId, 10);
  }

  /** Potwierdzenie z hulajnogi; nieznane, powtórzone i spóźnione potwierdzenia nic nie zmieniają. */
  async handleAck(payload: Buffer): Promise<void> {
    const parsed = ackSchema.safeParse(safeJson(payload));
    if (!parsed.success) return void this.logger.warn('Odrzucono potwierdzenie niezgodne z kontraktem MQTT');
    const record = await this.commands.find(parsed.data.commandId);
    if (!record) return;
    const status = commandStatusAfterAck(record.status, parsed.data.ok);
    if (status === record.status) return;
    const updated = await this.commands.complete(record.id, status, new Date(parsed.data.ts));
    if (updated) await this.publish(updated);
  }

  async expirePending(now = new Date()): Promise<void> {
    const expired = await this.commands.expirePending(new Date(now.getTime() - COMMAND_ACK_TIMEOUT_MS));
    for (const record of expired) await this.publish(record);
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
