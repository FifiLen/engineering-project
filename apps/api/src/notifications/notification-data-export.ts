import type { DataExportContributor } from '@hulajnogi/core';
import { type Database, exportNotificationData } from '@hulajnogi/db';
import { Inject, Injectable, type OnModuleInit } from '@nestjs/common';
import { DataExportRegistry } from '../data-export/data-export.registry.js';
import { DB } from '../database/database.module.js';

/** Port eksportu modułu Powiadomienia (ADR 0069): wysłane powiadomienia z treścią z chwili wysyłki. */
@Injectable()
export class NotificationDataExport implements DataExportContributor<'notifications'>, OnModuleInit {
  constructor(
    @Inject(DB) private readonly db: Database,
    private readonly registry: DataExportRegistry,
  ) {}

  onModuleInit(): void {
    this.registry.register('notifications', this);
  }

  exportForUser(userId: string) {
    return exportNotificationData(this.db, userId);
  }
}
