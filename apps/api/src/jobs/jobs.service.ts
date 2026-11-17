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
} as const;
export type JobName = (typeof JOBS)[keyof typeof JOBS];

/** Harmonogramy w czasie UTC (rozdzielczość minuty). */
const SCHEDULES: ReadonlyArray<[JobName, string]> = [
  [JOBS.expireSweep, '* * * * *'],
  [JOBS.timeoutSweep, '* * * * *'],
  [JOBS.telemetryPartitions, '5 0 * * *'],
  [JOBS.telemetryPurge, '0 3 * * *'],
  [JOBS.authPurge, '15 3 * * *'],
];

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
  readonly sent: Array<{ name: JobName; data: Record<string, unknown>; startAfter: Date | null }> = [];

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
      await boss.createQueue(name);
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
