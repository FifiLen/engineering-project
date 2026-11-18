import { randomUUID } from 'node:crypto';
import { DomainError } from '@hulajnogi/core';
import { type Database, DrizzleAuditLogRepository, DrizzleScooterRepository } from '@hulajnogi/db';
import {
  SIMULATOR_COMMAND_TTL_MS,
  SIMULATOR_STALE_AFTER_MS,
  simulatorControlSchema,
  simulatorResultSchema,
  simulatorStatusSchema,
  simulatorTopics,
  type SimulatorAction,
  type SimulatorCommandAccepted,
  type SimulatorCommandRequest,
  type SimulatorCommandView,
  type SimulatorOverview,
  type SimulatorResultReason,
  type SimulatorStatus,
  type SimulatorStatusView,
} from '@hulajnogi/shared';
import { Inject, Injectable, Logger, type OnModuleInit } from '@nestjs/common';
import { AuditedTransaction } from '../audit/audited-transaction.js';
import { CONFIG, type AppConfig } from '../config.js';
import { DB } from '../database/database.module.js';
import { safeJson } from '../fleet/commands.service.js';
import { MqttService } from '../mqtt/mqtt.service.js';
import { FleetGateway } from '../realtime/fleet.gateway.js';

/** Publikacja na brokerze bez odpowiedzi (broker niedostępny) nie blokuje żądania panelu dłużej niż 5 s. */
const PUBLISH_TIMEOUT_MS = 5000;
/** „Ostatnie polecenia” w makiecie `symulator`. */
const RECENT_COMMANDS = 10;
/** Wyniki poleceń trzymane w pamięci API (przyjmowane tylko dla poleceń wysłanych przez to API). */
const MAX_RESULTS = 200;

/**
 * Symulator sterowany z panelu (ADR 0059): polecenie z `simulator.manage` trafia do dziennika audytu
 * (`simulator.command`) i na temat `simulator/control`, który publikuje tylko backend. Stan z `simulator/status`
 * (retained) i wyniki z `simulator/control/result` API przekazuje do pokoju `simulator` w Socket.IO. Tylko
 * środowisko deweloperskie: przy `SIMULATOR_CONTROL_ENABLED=false` punkty zwracają 404, a API nie subskrybuje
 * tematów symulatora.
 */
@Injectable()
export class SimulatorService implements OnModuleInit {
  private readonly logger = new Logger(SimulatorService.name);
  private status: SimulatorStatus | null = null;
  private receivedAt: Date | null = null;
  private readonly results = new Map<string, { ok: boolean; reason: SimulatorResultReason | null; at: Date }>();

  constructor(
    @Inject(DB) private readonly db: Database,
    @Inject(CONFIG) private readonly config: AppConfig,
    private readonly mqtt: MqttService,
    private readonly gateway: FleetGateway,
    private readonly audited: AuditedTransaction,
  ) {}

  onModuleInit(): void {
    if (!this.config.SIMULATOR_CONTROL_ENABLED) return;
    this.mqtt.subscribe(simulatorTopics.status);
    this.mqtt.subscribe(simulatorTopics.result);
    this.mqtt.onMessage((topic, payload) => {
      if (topic === simulatorTopics.status) this.handleStatus(safeJson(payload));
      else if (topic === simulatorTopics.result) this.handleResult(safeJson(payload));
    });
  }

  /** Stan z `simulator/status`; wiadomość niezgodna z kontraktem jest pomijana z ostrzeżeniem. */
  handleStatus(payload: unknown, now = new Date()): void {
    const parsed = simulatorStatusSchema.safeParse(payload);
    if (!parsed.success) {
      this.logger.warn('Odrzucono stan symulatora: niezgodny z kontraktem symulatora');
      return;
    }
    this.status = parsed.data;
    this.receivedAt = now;
    this.gateway.simulatorStatus(this.statusView(now));
  }

  /** Wynik z `simulator/control/result`; panel dostaje go zdarzeniem `simulator.result`. */
  handleResult(payload: unknown, now = new Date()): void {
    const parsed = simulatorResultSchema.safeParse(payload);
    if (!parsed.success) {
      this.logger.warn('Odrzucono wynik polecenia symulatora: niezgodny z kontraktem symulatora');
      return;
    }
    this.results.set(parsed.data.commandId, { ok: parsed.data.ok, reason: parsed.data.reason ?? null, at: now });
    while (this.results.size > MAX_RESULTS) this.results.delete(this.results.keys().next().value!);
    this.gateway.simulatorResult(parsed.data);
  }

  /**
   * `POST /admin/simulator/commands`: wpis `simulator.command` w dzienniku audytu (na karcie hulajnogi), potem
   * publikacja z `commandId`, `issuedBy` i `expiresAt` (30 s). Wynik przychodzi zdarzeniem `simulator.result`.
   */
  async command(staffId: string, body: SimulatorCommandRequest): Promise<SimulatorCommandAccepted> {
    this.ensureEnabled();
    const scooterId = await new DrizzleScooterRepository(this.db).idByNumber(body.scooter);
    if (!scooterId) throw new DomainError('NOT_FOUND', { entity: 'scooter', number: body.scooter });
    const commandId = randomUUID();
    const expiresAt = new Date(Date.now() + SIMULATOR_COMMAND_TTL_MS).toISOString();
    const message = simulatorControlSchema.parse({ ...body, commandId, issuedBy: staffId, expiresAt });
    await this.audited.run(staffId, ({ audit }) =>
      audit({
        action: 'simulator.command',
        entityType: 'scooter',
        entityId: scooterId,
        data: { commandId, action: message.action, scooter: message.scooter, params: message.params, expiresAt },
      }),
    );
    await this.publish(message);
    return { commandId, expiresAt };
  }

  /** `GET /admin/simulator/status`: ostatni stan, „nie odpowiada” po 30 s i ostatnie polecenia z wynikami. */
  async overview(now = new Date()): Promise<SimulatorOverview> {
    this.ensureEnabled();
    const entries = await new DrizzleAuditLogRepository(this.db).forAction('simulator.command', RECENT_COMMANDS);
    const commands = entries.map((entry): SimulatorCommandView => {
      const data = entry.data as {
        commandId: string;
        action: SimulatorAction;
        scooter: number;
        params: Record<string, unknown>;
        expiresAt: string;
      };
      const result = this.results.get(data.commandId);
      return {
        commandId: data.commandId,
        at: new Date(entry.createdAt).toISOString(),
        staffId: entry.staffId,
        staffName: entry.staffName,
        action: data.action,
        scooter: data.scooter,
        params: data.params ?? {},
        expiresAt: data.expiresAt,
        result: result ? { ok: result.ok, reason: result.reason, at: result.at.toISOString() } : null,
      };
    });
    return { ...this.statusView(now), commands };
  }

  private statusView(now: Date): SimulatorStatusView {
    return {
      status: this.status,
      receivedAt: this.receivedAt?.toISOString() ?? null,
      enabled: this.config.SIMULATOR_CONTROL_ENABLED,
      stale: this.isStale(now),
    };
  }

  /**
   * Brak stanu albo stan starszy niż 30 s. Stan retained przychodzi od razu po subskrypcji także po restarcie API,
   * więc wiek liczymy od `updatedAt` z wiadomości, a dla symulatora sprzed kontraktu 1.0.0 od chwili odbioru.
   */
  private isStale(now: Date): boolean {
    if (!this.status || !this.receivedAt) return true;
    const updatedAt = this.status.online ? this.status.updatedAt : undefined;
    const seenAt = updatedAt ? Math.min(Date.parse(updatedAt), this.receivedAt.getTime()) : this.receivedAt.getTime();
    return now.getTime() - seenAt > SIMULATOR_STALE_AFTER_MS;
  }

  private ensureEnabled(): void {
    if (!this.config.SIMULATOR_CONTROL_ENABLED) throw new DomainError('NOT_FOUND', { entity: 'simulator' });
  }

  private async publish(message: unknown): Promise<void> {
    let timer: NodeJS.Timeout | undefined;
    const timeout = new Promise<never>((_, reject) => {
      timer = setTimeout(() => reject(new Error('timeout')), PUBLISH_TIMEOUT_MS);
    });
    try {
      await Promise.race([this.mqtt.publish(simulatorTopics.control, message), timeout]);
    } catch (error) {
      // Wpis w dzienniku zostaje: polecenie mogło dotrzeć później (QoS 1), a wynik i tak pokaże panel.
      this.logger.warn(`Nie opublikowano polecenia symulatora: ${(error as Error).message}`);
      throw new DomainError('SIMULATOR_UNAVAILABLE');
    } finally {
      clearTimeout(timer);
    }
  }
}
