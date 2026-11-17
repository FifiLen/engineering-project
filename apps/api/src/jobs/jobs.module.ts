import { type Database, purgeExpiredAuth, purgeTelemetry } from '@hulajnogi/db';
import { Global, Inject, Injectable, Logger, Module, type OnModuleInit } from '@nestjs/common';
import { DB } from '../database/database.module.js';
import { JOBS, JobsService } from './jobs.service.js';

/** Retencja z planu iteracji 3 (pytanie 10): telemetria 90 dni, sesje, zaproszenia i kody 30 dni po wygaśnięciu. */
export const TELEMETRY_KEEP_DAYS = 90;
export const AUTH_KEEP_DAYS = 30;

/** Czyszczenie danych technicznych procedurami bazy (ADR 0026, ADR 0037). */
@Injectable()
class MaintenanceJobs implements OnModuleInit {
  private readonly logger = new Logger('Maintenance');

  constructor(
    @Inject(DB) private readonly db: Database,
    private readonly jobs: JobsService,
  ) {}

  onModuleInit(): void {
    this.jobs.handle(JOBS.telemetryPurge, async () => {
      const dropped = await purgeTelemetry(this.db, TELEMETRY_KEEP_DAYS);
      if (dropped) this.logger.log(`Usunięte partycje telemetrii: ${dropped}`);
    });
    this.jobs.handle(JOBS.authPurge, async () => {
      const { otpCodes, sessions } = await purgeExpiredAuth(this.db, AUTH_KEEP_DAYS);
      if (otpCodes || sessions) this.logger.log(`Usunięte kody SMS: ${otpCodes}, sesje i zaproszenia: ${sessions}`);
    });
  }
}

@Global()
@Module({ providers: [JobsService, MaintenanceJobs], exports: [JobsService] })
export class JobsModule {}
