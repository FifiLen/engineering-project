import type { DataExportContributor } from '@hulajnogi/core';
import { type Database, exportRentalData } from '@hulajnogi/db';
import { Inject, Injectable, type OnModuleInit } from '@nestjs/common';
import { DataExportRegistry } from '../data-export/data-export.registry.js';
import { DB } from '../database/database.module.js';

/** Port eksportu modułu Wypożyczenia (ADR 0069): przejazdy z wyceną i trasą z telemetrii (90 dni). */
@Injectable()
export class RentalDataExport implements DataExportContributor<'rentals'>, OnModuleInit {
  constructor(
    @Inject(DB) private readonly db: Database,
    private readonly registry: DataExportRegistry,
  ) {}

  onModuleInit(): void {
    this.registry.register('rentals', this);
  }

  exportForUser(userId: string) {
    return exportRentalData(this.db, userId);
  }
}
