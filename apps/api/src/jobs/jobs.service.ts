import { type DbExecutor, sql } from '@hulajnogi/db';
import { Inject, Injectable, Logger, type OnApplicationBootstrap, type OnApplicationShutdown } from '@nestjs/common';
import { fromDrizzle, PgBoss } from 'pg-boss';
import { CONFIG, type AppConfig } from '../config.js';

/** Zadania jednorazowe i cykliczne (ADR 0037); nazwa jest jednocześnie kolejką pg-boss. */
export const JOBS = {
  reservationExpire: 'rental.reservation-expire',
  commandAckTimeout: 'command.ack-timeout',
  expireSweep: 'rentals.expire-sweep',
  timeoutSweep: 'commands.timeout-sweep',
  telemetryPartitions: 'telemetry.partitions',
  telemetryPurge: 'telemetry.purge',
  authPurge: 'auth.purge',
  // Płatności (ADR 0049, ADR 0050): obciążenie karty po zakończeniu, ponowienie po 24 h, webhook, status.
  chargeRide: 'payment.charge-ride',
  retryRideCharge: 'payment.retry-ride',
  paymentsWebhook: 'payments.webhook',
  paymentsReconcile: 'payments.reconcile',
  // Przejazd bez łączności (ADR 0056): koniec oczekiwania na blokadę po żądaniu offline, limit 30 min naliczania.
  offlineEndTimeout: 'rental.offline-end-timeout',
  offlineBillingStop: 'rental.offline-billing-stop',
  // Pliki (ADR 0057): nieprzypięte po 24 h, zdjęcia parkowania po 30 dniach.
  filesCleanup: 'files.cleanup',
  filesRetention: 'files.retention',
  // Zgłoszenie automatyczne `OFFLINE` (ADR 0055): sprawdzenie 5 min po utracie łączności, jedno na hulajnogę.
  ticketsOfflineCheck: 'tickets.offline-check',
  // Powiadomienia (ADR 0058): wysyłka po zdarzeniu, potwierdzenia po 15 min, ponowienie zgubionych z kolejki,
  // przypomnienie 2 min przed końcem rezerwacji.
  notificationSend: 'notification.send',
  notificationReceipts: 'notification.receipts',
  notificationsSweep: 'notifications.sweep',
  reservationEnding: 'rental.reservation-ending',
} as const;
export type JobName = (typeof JOBS)[keyof typeof JOBS];

/** Harmonogramy w czasie UTC (rozdzielczość minuty). */
const SCHEDULES: ReadonlyArray<[JobName, string]> = [
  [JOBS.expireSweep, '* * * * *'],
  [JOBS.timeoutSweep, '* * * * *'],
  [JOBS.telemetryPartitions, '5 0 * * *'],
  [JOBS.telemetryPurge, '0 3 * * *'],
  [JOBS.authPurge, '15 3 * * *'],
  [JOBS.paymentsReconcile, '* * * * *'],
  [JOBS.filesCleanup, '30 * * * *'],
  [JOBS.filesRetention, '45 3 * * *'],
  [JOBS.notificationsSweep, '*/5 * * * *'],
];

/**
 * Kolejki z polityką inną niż `standard`: `short` przyjmuje najwyżej jedno oczekujące zadanie na `singletonKey`
 * (sprawdzenie łączności planowane przy każdej utracie łączności tej samej hulajnogi).
 */
const QUEUE_POLICIES: Partial<Record<JobName, 'short'>> = {
  [JOBS.ticketsOfflineCheck]: 'short',
};

export type JobHandler = (data: Record<string, unknown>) => Promise<void>;

/**
 * Kolejka zadań w bazie projektu, schemat `pgboss` (ADR 0037). Moduły rejestrują obsługę w `onModuleInit`,
 * a kolejka startuje po inicjalizacji wszystkich modułów. Zadanie wywołane zmianą stanu planujemy w tej
 * samej transakcji (`sendInTransaction`), więc powstaje tylko wtedy, gdy zmiana się zatwierdziła.
 */
@Injectable()
export class JobsService implements OnApplicationBootstrap, OnApplicationShutdown {
  private readonly logger = new Logger(JobsService.name);
  private boss: PgBoss | null = null;
  private readonly handlers = new Map<JobName, JobHandler>();
  /** Zadania przy wyłączonej kolejce (testy). */
  readonly sent: Array<{
    name: JobName;
    data: Record<string, unknown>;
    startAfter: Date | null;
    singletonKey?: string;
  }> = [];

  constructor(@Inject(CONFIG) private readonly config: AppConfig) {}

  handle(name: JobName, handler: JobHandler): void {
    this.handlers.set(name, handler);
  }

  async onApplicationBootstrap(): Promise<void> {
    if (!this.config.JOBS_ENABLED) return;
    const boss = new PgBoss({ connectionString: this.config.DATABASE_URL, schema: 'pgboss', max: 4 });
    boss.on('error', (error: Error) => this.logger.error(`pg-boss: ${error.message}`));
    await boss.start();
    for (const name of Object.values(JOBS)) {
      const policy = QUEUE_POLICIES[name];
      await boss.createQueue(name, policy ? { policy } : undefined);
      const handler = this.handlers.get(name);
      if (!handler) continue;
      await boss.work<Record<string, unknown>>(name, { pollingIntervalSeconds: 1, batchSize: 5 }, async (jobs) => {
        for (const job of jobs) await handler(job.data ?? {});
      });
    }
    for (const [name, cron] of SCHEDULES) await boss.schedule(name, cron, {}, { tz: 'UTC' });
    this.boss = boss;
    this.logger.log('Kolejka zadań pg-boss uruchomiona');
  }

  async onApplicationShutdown(): Promise<void> {
    await this.boss?.stop({ graceful: true, timeout: 5000 });
  }

  /** Zadanie zaplanowane w transakcji zmiany stanu (ADR 0016). */
  async sendInTransaction(
    tx: DbExecutor,
    name: JobName,
    data: Record<string, unknown>,
    startAfter: Date,
  ): Promise<void> {
    if (!this.config.JOBS_ENABLED) {
      this.sent.push({ name, data, startAfter });
      return;
    }
    await this.requireBoss().send(name, data, { startAfter, db: fromDrizzle(tx, sql) });
  }

  /**
   * Zadanie poza transakcją zmiany stanu (np. po zdarzeniu z MQTT); `singletonKey` w kolejce `short` odrzuca
   * drugie oczekujące zadanie z tym samym kluczem.
   */
  async send(
    name: JobName,
    data: Record<string, unknown>,
    options: { startAfter: Date; singletonKey?: string },
  ): Promise<void> {
    if (!this.config.JOBS_ENABLED) {
      this.sent.push({ name, data, startAfter: options.startAfter, singletonKey: options.singletonKey });
      return;
    }
    await this.requireBoss().send(name, data, {
      startAfter: options.startAfter,
      ...(options.singletonKey ? { singletonKey: options.singletonKey } : {}),
    });
  }

  /** Wywołanie obsługi zadania poza kolejką: przy starcie API i w testach. */
  async run(name: JobName, data: Record<string, unknown> = {}): Promise<void> {
    const handler = this.handlers.get(name);
    if (!handler) throw new Error(`Brak obsługi zadania ${name}`);
    await handler(data);
  }

  private requireBoss(): PgBoss {
    if (!this.boss) throw new Error('Kolejka zadań nie jest uruchomiona');
    return this.boss;
  }
}
