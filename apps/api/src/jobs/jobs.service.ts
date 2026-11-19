import { DATA_EXPORT_JOB_EXPIRE_MS, DOCUMENT_JOB_EXPIRE_MS } from '@hulajnogi/core';
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
  // Treści (ADR 0062, ADR 0065): odświeżenie strony po zmianie (tag cache Next.js) i granice publikacji aktualności.
  siteRevalidate: 'site.revalidate',
  newsBoundary: 'content.news-boundary',
  // Wydruki (ADR 0066, ADR 0068): generowanie wydruku i usuwanie plików po 30 dniach; eksport danych klienta
  // (ADR 0069): budowa pliku i usuwanie plików po 7 dniach albo po usunięciu konta. Sprzątanie co 5 min kończy
  // wydruki i eksporty porzucone po restarcie API (bez zadania w kolejce) jako nieudane.
  documentGenerate: 'document.generate',
  documentsRetention: 'documents.retention',
  documentsSweep: 'documents.sweep',
  dataExportGenerate: 'data-export.generate',
  dataExportsPurge: 'data-exports.purge',
  dataExportsSweep: 'data-exports.sweep',
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
  [JOBS.documentsRetention, '30 3 * * *'],
  [JOBS.dataExportsPurge, '45 3 * * *'],
  [JOBS.documentsSweep, '*/5 * * * *'],
  [JOBS.dataExportsSweep, '*/5 * * * *'],
];

/**
 * Kolejki z własnym limitem i ponowieniami (ADR 0066): wydruk najwyżej 2 na proces (kolejka Gotenberga), 120 s na
 * zadanie i do 2 ponowień z rosnącym odstępem; obsługa ponawia tylko niedostępny silnik (`RENDERER_UNAVAILABLE`).
 * Limity czasu są te same co w core (`DOCUMENT_JOB_EXPIRE_MS`, `DATA_EXPORT_JOB_EXPIRE_MS`): po nich ponowienie
 * przejmuje wiersz `RUNNING`. Kolejki z ponowieniami pobierają po jednym zadaniu (`batchSize: 1`): pg-boss oznacza
 * błąd całej partii, więc błąd jednego eksportu przy partii 5 zostawiał pozostałe zlecenia w `QUEUED` na zawsze.
 */
const QUEUE_OPTIONS: Partial<
  Record<
    JobName,
    {
      queue: { expireInSeconds?: number; retryLimit?: number; retryDelay?: number; retryBackoff?: boolean };
      localConcurrency?: number;
      batchSize?: number;
    }
  >
> = {
  [JOBS.documentGenerate]: {
    queue: { expireInSeconds: DOCUMENT_JOB_EXPIRE_MS / 1000, retryLimit: 2, retryDelay: 5, retryBackoff: true },
    localConcurrency: 2,
    batchSize: 1,
  },
  [JOBS.dataExportGenerate]: {
    queue: { expireInSeconds: DATA_EXPORT_JOB_EXPIRE_MS / 1000, retryLimit: 2, retryDelay: 10, retryBackoff: true },
    batchSize: 1,
  },
};

/** Opcje pracownika pg-boss kolejki: partia 5 domyślnie, 1 dla kolejek z ponowieniami albo własną współbieżnością. */
export function workerOptions(name: JobName): {
  pollingIntervalSeconds: number;
  batchSize: number;
  localConcurrency?: number;
} {
  const options = QUEUE_OPTIONS[name];
  return {
    pollingIntervalSeconds: 1,
    batchSize: options?.batchSize ?? 5,
    ...(options?.localConcurrency ? { localConcurrency: options.localConcurrency } : {}),
  };
}

/**
 * Kolejki z polityką inną niż `standard`: `short` przyjmuje najwyżej jedno oczekujące zadanie na `singletonKey`
 * (sprawdzenie łączności planowane przy każdej utracie łączności tej samej hulajnogi).
 */
const QUEUE_POLICIES: Partial<Record<JobName, 'short'>> = {
  [JOBS.ticketsOfflineCheck]: 'short',
};

/** Próba zadania: numer ponowienia i limit z kolejki (obsługa decyduje, czy błąd ponowić, czy zapisać). */
export interface JobAttempt {
  retryCount: number;
  retryLimit: number;
}

export type JobHandler = (data: Record<string, unknown>, attempt: JobAttempt) => Promise<void>;

/** Opcje zadania planowanego w transakcji (`sendInTransaction`). */
export interface TransactionJobOptions {
  singletonKey?: string;
  /** Okno singletonu w sekundach (`singletonNextSlot`: zadanie w zajętym oknie przechodzi do następnego). */
  singletonSeconds?: number;
  /**
   * `false`: drugie zadanie z tym kluczem w tym samym oknie jest odrzucane zamiast przesunięte do następnego okna
   * (przesunięcie zmienia `startAfter`, czego nie chcą zadania o czasie, np. granice aktualności). Domyślnie `true`.
   */
  singletonNextSlot?: boolean;
  /** Ponowienia z rosnącym odstępem od `retryDelaySeconds`. */
  retryLimit?: number;
  retryDelaySeconds?: number;
}

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
    options?: TransactionJobOptions;
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
      const options = QUEUE_OPTIONS[name];
      await boss.createQueue(
        name,
        policy || options ? { ...(policy ? { policy } : {}), ...options?.queue } : undefined,
      );
      const handler = this.handlers.get(name);
      if (!handler) continue;
      const retryLimit = options?.queue.retryLimit ?? 0;
      await boss.work<Record<string, unknown>>(name, workerOptions(name), async (jobs) => {
        for (const job of jobs) await handler(job.data ?? {}, { retryCount: job.retryCount, retryLimit });
      });
    }
    for (const [name, cron] of SCHEDULES) await boss.schedule(name, cron, {}, { tz: 'UTC' });
    this.boss = boss;
    this.logger.log('Kolejka zadań pg-boss uruchomiona');
  }

  async onApplicationShutdown(): Promise<void> {
    await this.boss?.stop({ graceful: true, timeout: 5000 });
  }

  /**
   * Zadanie zaplanowane w transakcji zmiany stanu (ADR 0016). Opcje: klucz singletonu z oknem (seria zmian w oknie
   * daje jedno zadanie, a zmiana po wykonaniu trafia do następnego okna) i ponowienia z rosnącym odstępem.
   */
  async sendInTransaction(
    tx: DbExecutor,
    name: JobName,
    data: Record<string, unknown>,
    startAfter: Date,
    options: TransactionJobOptions = {},
  ): Promise<void> {
    if (!this.config.JOBS_ENABLED) {
      this.sent.push({
        name,
        data,
        startAfter,
        ...(options.singletonKey ? { singletonKey: options.singletonKey } : {}),
        ...(Object.keys(options).length ? { options } : {}),
      });
      return;
    }
    await this.requireBoss().send(name, data, {
      startAfter,
      db: fromDrizzle(tx, sql),
      ...(options.singletonKey ? { singletonKey: options.singletonKey } : {}),
      ...(options.singletonSeconds
        ? { singletonSeconds: options.singletonSeconds, singletonNextSlot: options.singletonNextSlot ?? true }
        : {}),
      ...(options.retryLimit !== undefined
        ? { retryLimit: options.retryLimit, retryDelay: options.retryDelaySeconds ?? 1, retryBackoff: true }
        : {}),
    });
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
  async run(
    name: JobName,
    data: Record<string, unknown> = {},
    attempt: JobAttempt = { retryCount: 0, retryLimit: 0 },
  ): Promise<void> {
    const handler = this.handlers.get(name);
    if (!handler) throw new Error(`Brak obsługi zadania ${name}`);
    await handler(data, attempt);
  }

  private requireBoss(): PgBoss {
    if (!this.boss) throw new Error('Kolejka zadań nie jest uruchomiona');
    return this.boss;
  }
}
