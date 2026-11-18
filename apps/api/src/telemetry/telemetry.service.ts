import {
  evaluateTelemetry,
  shouldLockIdleScooter,
  type CurrentStateUpdate,
  type TelemetryReading,
  type TelemetryTarget,
} from '@hulajnogi/core';
import { DrizzleTelemetryRepository } from '@hulajnogi/db';
import { scooterIdFromTopic, statusSchema, telemetrySchema, type FleetMapScooter } from '@hulajnogi/shared';
import { Inject, Injectable, Logger, type OnApplicationShutdown, type OnModuleInit } from '@nestjs/common';
import { CONFIG, type AppConfig } from '../config.js';
import { CommandsService, safeJson } from '../fleet/commands.service.js';
import { FleetStatusService } from '../fleet/fleet-status.service.js';
import { MqttService } from '../mqtt/mqtt.service.js';
import { JOBS, JobsService } from '../jobs/jobs.service.js';
import { OperationsService } from '../operations/operations.service.js';
import { TicketsService } from '../operations/tickets.service.js';
import { FleetGateway } from '../realtime/fleet.gateway.js';
import { RentalsService } from '../rentals/rentals.service.js';
import { ZoneTracker } from '../zones/zone-tracker.service.js';

/** Partycje telemetrii zakładane z wyprzedzeniem; ponowne wywołanie niczego nie psuje. */
const PARTITION_DAYS_AHEAD = 7;
/** Bufor ponad tę liczbę odczytów jest zapisywany od razu, bez czekania na koniec okna. */
const MAX_BUFFER = 2000;

interface Incoming {
  number: number;
  reading: TelemetryReading;
}

/**
 * Moduł Telemetria (ADR 0033): odczyty z MQTT są zbierane w krótkim oknie, oceniane regułami
 * z packages/core i zapisywane jedną transakcją; panel dostaje jedną paczkę zmian na okno.
 */
@Injectable()
export class TelemetryService implements OnModuleInit, OnApplicationShutdown {
  private readonly logger = new Logger(TelemetryService.name);
  private buffer: Incoming[] = [];
  private flushing: Promise<void> = Promise.resolve();
  private timer?: NodeJS.Timeout;
  private readonly unknown = new Set<number>();

  constructor(
    @Inject(CONFIG) private readonly config: AppConfig,
    private readonly repository: DrizzleTelemetryRepository,
    private readonly fleetStatus: FleetStatusService,
    private readonly mqtt: MqttService,
    private readonly gateway: FleetGateway,
    private readonly jobs: JobsService,
    private readonly rentals: RentalsService,
    private readonly zones: ZoneTracker,
    private readonly commands: CommandsService,
    private readonly tickets: TicketsService,
    private readonly operations: OperationsService,
  ) {}

  async onModuleInit(): Promise<void> {
    await this.ensurePartitions();
    this.mqtt.onMessage((topic, payload) => {
      const id = scooterIdFromTopic(topic);
      if (!id) return;
      if (topic.endsWith('/telemetry')) this.accept(Number(id), safeJson(payload));
      else if (topic.endsWith('/status')) void this.handleStatus(Number(id), safeJson(payload));
    });
    // Partycje na kolejne dni zakłada codzienne zadanie pg-boss (ADR 0037); okno zapisu zostaje licznikiem (ADR 0033).
    this.jobs.handle(JOBS.telemetryPartitions, () => this.ensurePartitions());
    this.timer = setInterval(() => void this.flush(), this.config.TELEMETRY_FLUSH_MS);
    this.timer.unref();
  }

  async onApplicationShutdown(): Promise<void> {
    clearInterval(this.timer);
    await this.flush();
  }

  /** Walidacja kontraktu MQTT; niepoprawna wiadomość jest pomijana z ostrzeżeniem. */
  accept(number: number, payload: unknown): boolean {
    const parsed = telemetrySchema.safeParse(payload);
    if (!parsed.success) {
      this.logger.warn(`Odrzucono telemetrię #${number}: niezgodna z kontraktem MQTT`);
      return false;
    }
    const { ts, lat, lon, bat, v, locked, buffered } = parsed.data;
    this.buffer.push({
      number,
      reading: { recordedAt: new Date(ts), position: { lat, lon }, batteryPct: bat, speedKmh: v, locked, buffered },
    });
    if (this.buffer.length >= MAX_BUFFER) void this.flush();
    return true;
  }

  /** Zapisy idą po kolei: kolejne okno czeka na poprzednie. */
  flush(): Promise<void> {
    return this.enqueue(() => this.flushBatch(this.takeBuffer()));
  }

  private takeBuffer(): Incoming[] {
    const batch = this.buffer;
    this.buffer = [];
    return batch;
  }

  /**
   * Telemetria i zmiany łączności idą przez jedną kolejkę, w kolejności przyjścia. Inaczej zapis
   * partii mógłby odczytać stan sprzed zmiany łączności i wysłać do panelu nieaktualny status.
   */
  private enqueue(task: () => Promise<void>): Promise<void> {
    this.flushing = this.flushing.then(task).catch((e: Error) => this.logger.error(e.message));
    return this.flushing;
  }

  private async flushBatch(batch: Incoming[]): Promise<void> {
    if (!batch.length) return;
    batch.sort((a, b) => a.reading.recordedAt.getTime() - b.reading.recordedAt.getTime());
    const targets = new Map(
      (await this.repository.findTargets([...new Set(batch.map((b) => b.number))])).map((t) => [t.number, t]),
    );

    const now = new Date();
    const history: Array<{ scooterId: string; reading: TelemetryReading }> = [];
    const current = new Map<string, CurrentStateUpdate>();
    for (const { number, reading } of batch) {
      const target = targets.get(number);
      if (!target) {
        if (!this.unknown.has(number)) this.logger.warn(`Telemetria od nieznanej hulajnogi #${number}`);
        this.unknown.add(number);
        continue;
      }
      const decision = evaluateTelemetry(target, reading, now);
      if (!decision.accepted) continue;
      history.push({ scooterId: target.id, reading });
      if (!decision.updatesCurrentState) continue;
      // Kolejne odczyty z okna oceniamy względem poprzedniego, a do bazy idzie ostatni z sumą przebiegu.
      const previous = current.get(target.id);
      current.set(target.id, {
        scooterId: target.id,
        reading,
        odometerIncrementM: (previous?.odometerIncrementM ?? 0) + decision.odometerIncrementM,
      });
      targets.set(number, {
        ...target,
        lastSeenAt: reading.recordedAt,
        position: reading.position,
        batteryPct: reading.batteryPct,
      });
    }

    await this.repository.save(history, [...current.values()]);
    const byId = new Map([...targets.values()].map((t) => [t.id, t]));
    const updates = await Promise.all(
      [...current.values()].map(({ scooterId, reading }) => this.toMapUpdate(byId.get(scooterId)!, reading)),
    );
    this.gateway.updates(updates);
    // Strefy hulajnóg w przejeździe po zapisie partii (ADR 0043); błąd stref nie wstrzymuje telemetrii.
    await this.zones
      .track(
        history.map(({ scooterId, reading }) => ({
          scooterId,
          position: reading.position,
          recordedAt: reading.recordedAt,
          buffered: reading.buffered,
        })),
      )
      .catch((e: Error) => this.logger.error(`Strefy: ${e.message}`));
    // Bateria w trakcie jazdy i ruch po zakończeniu offline (ADR 0056) po strefach, bo limit baterii uzgadnia się
    // z bieżącymi strefami; błąd nie wstrzymuje telemetrii.
    await this.rentals
      .onTelemetry(
        history.map(({ scooterId, reading }) => ({
          scooterId,
          recordedAt: reading.recordedAt,
          batteryPct: reading.batteryPct,
          buffered: reading.buffered,
        })),
      )
      .catch((e: Error) => this.logger.error(`Przejazd: ${e.message}`));
    await this.lockIdleScooters(current).catch((e: Error) => this.logger.error(`Blokada: ${e.message}`));
    // Hulajnoga w serwisie z przyczyną `BATTERY_BELOW_THRESHOLD` wraca do floty po odczycie bieżącym baterii ponad
    // progiem (np. po `battery_swapped`, ADR 0059), jeśli nic innego jej nie zatrzymuje.
    const recovered = [...current.values()]
      .filter(({ scooterId, reading }) => !reading.buffered && byId.get(scooterId)?.status === 'MAINTENANCE')
      .map(({ scooterId }) => scooterId);
    if (recovered.length) {
      await this.operations
        .returnAfterBatteryRecovered(recovered)
        .catch((e: Error) => this.logger.error(`Powrót do floty: ${e.message}`));
    }
  }

  /**
   * Hulajnoga bez przejazdu, która zgłasza się odblokowana (np. po zakończeniu offline, `END_UNCONFIRMED` albo
   * zdalnym zakończeniu bez łączności), dostaje `lock` bez `rental_id` (ADR 0056), także w serwisie, chyba że
   * operator odblokował ją z panelu (`shouldLockIdleScooter`). Liczy się odczyt bieżący nowszy niż koniec ostatniego
   * przejazdu, żeby odczyt sprzed potwierdzenia blokady nie wysłał drugiej komendy.
   */
  private async lockIdleScooters(current: Map<string, CurrentStateUpdate>): Promise<void> {
    const unlocked = [...current.values()].filter(({ reading }) => !reading.locked && !reading.buffered);
    if (!unlocked.length) return;
    const states = await this.rentals.lockStates(unlocked.map((u) => u.scooterId));
    const now = new Date();
    for (const { scooterId, reading } of unlocked) {
      const state = states.get(scooterId);
      if (!state) continue;
      if (state.lastEndedAt && reading.recordedAt <= state.lastEndedAt) continue;
      if (shouldLockIdleScooter({ ...state, locked: reading.locked, now })) {
        await this.commands.sendSystem(scooterId, 'LOCK');
      }
    }
  }

  /** Status (retained, Last Will przy zerwaniu): najpierw zapis telemetrii sprzed zmiany, potem łączność. */
  handleStatus(number: number, payload: unknown): Promise<void> {
    const parsed = statusSchema.safeParse(payload);
    if (!parsed.success) return Promise.resolve();
    // Odczyty, które przyszły przed zmianą łączności, zapisujemy przed nią; późniejsze czekają na kolejne okno.
    const before = this.takeBuffer();
    return this.enqueue(async () => {
      await this.flushBatch(before);
      const target = await this.repository.setConnection(number, parsed.data.online, parsed.data.firmware ?? null);
      if (!target) return;
      this.gateway.updates([await this.toMapUpdate(target)]);
      await this.rentals.onConnectionChange(target.id, target.online);
      // Zgłoszenie `OFFLINE` (ADR 0055): sprawdzenie po 5 min przy zmianie online → offline (nie przy powtórzonym
      // statusie po restarcie API), automatyczne zamknięcie po powrocie łączności. Błąd nie wstrzymuje telemetrii.
      if (!target.online && target.wasOnline) {
        await this.tickets
          .scheduleOfflineCheck(target.id, new Date())
          .catch((e: Error) => this.logger.error(`Zgłoszenie offline: ${e.message}`));
      }
      if (target.online) {
        await this.tickets
          .onConnectionRestored(target.id)
          .catch((e: Error) => this.logger.error(`Zgłoszenie offline: ${e.message}`));
      }
    });
  }

  private async toMapUpdate(target: TelemetryTarget, reading?: TelemetryReading): Promise<FleetMapScooter> {
    return {
      id: target.id,
      number: target.number,
      lat: target.position?.lat ?? null,
      lon: target.position?.lon ?? null,
      batteryPct: target.batteryPct,
      fleetStatus: await this.fleetStatus.statusOf(target),
      online: target.online,
      lastSeenAt: target.lastSeenAt?.toISOString() ?? null,
      speedKmh: reading?.speedKmh ?? null,
      locked: reading?.locked ?? null,
    };
  }

  private async ensurePartitions(): Promise<void> {
    try {
      const created = await this.repository.ensurePartitions(new Date(), PARTITION_DAYS_AHEAD);
      if (created) this.logger.log(`Utworzono partycje telemetrii: ${created}`);
    } catch (error) {
      this.logger.error(`Partycje telemetrii: ${(error as Error).message}`);
    }
  }
}
