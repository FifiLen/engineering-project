import type { DataExportContributor } from '@hulajnogi/core';
import { type Database, exportPaymentData } from '@hulajnogi/db';
import { Inject, Injectable, type OnModuleInit } from '@nestjs/common';
import { DataExportRegistry } from '../data-export/data-export.registry.js';
import { DB } from '../database/database.module.js';

/** Port eksportu modułu Płatności (ADR 0069): portfel, płatności, zwroty i paragony, bez identyfikatorów u operatora. */
@Injectable()
export class PaymentDataExport
  implements DataExportContributor<'wallet' | 'payments' | 'refunds' | 'receipts'>, OnModuleInit
{
  constructor(
    @Inject(DB) private readonly db: Database,
    private readonly registry: DataExportRegistry,
  ) {}

  onModuleInit(): void {
    this.registry.register('payments', this);
  }

  exportForUser(userId: string) {
    return exportPaymentData(this.db, userId);
  }
}
