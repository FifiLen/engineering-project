import type { DataExportContributor } from '@hulajnogi/core';
import { type Database, exportAccountData } from '@hulajnogi/db';
import { Inject, Injectable, type OnModuleInit } from '@nestjs/common';
import { DataExportRegistry } from '../data-export/data-export.registry.js';
import { DB } from '../database/database.module.js';

/** Port eksportu modułu Konta (ADR 0069): profil, preferencje, urządzenia, sesje bez tokenów i zgody. */
@Injectable()
export class AccountDataExport implements DataExportContributor<'profile' | 'consents'>, OnModuleInit {
  constructor(
    @Inject(DB) private readonly db: Database,
    private readonly registry: DataExportRegistry,
  ) {}

  onModuleInit(): void {
    this.registry.register('accounts', this);
  }

  exportForUser(userId: string) {
    return exportAccountData(this.db, userId);
  }
}
