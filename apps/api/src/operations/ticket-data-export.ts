import type { DataExportContributor } from '@hulajnogi/core';
import { type Database, exportTicketData } from '@hulajnogi/db';
import { Inject, Injectable, type OnModuleInit } from '@nestjs/common';
import { DataExportRegistry } from '../data-export/data-export.registry.js';
import { DB } from '../database/database.module.js';

/** Port eksportu modułu Operacje (ADR 0069): zgłoszenia klienta bez notatek wewnętrznych i metadane zdjęć. */
@Injectable()
export class TicketDataExport implements DataExportContributor<'tickets' | 'photos'>, OnModuleInit {
  constructor(
    @Inject(DB) private readonly db: Database,
    private readonly registry: DataExportRegistry,
  ) {}

  onModuleInit(): void {
    this.registry.register('operations', this);
  }

  exportForUser(userId: string) {
    return exportTicketData(this.db, userId);
  }
}
