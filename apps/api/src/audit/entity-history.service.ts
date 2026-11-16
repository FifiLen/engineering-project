import { type Database, DrizzleAuditLogRepository } from '@hulajnogi/db';
import type { AuditLogDetails } from '@hulajnogi/shared';
import { Inject, Injectable } from '@nestjs/common';
import { DB } from '../database/database.module.js';

/**
 * Historia zmian rekordu do karty „Historia zmian” w formularzu (ADR 0031). Uprawnienie do historii
 * jest takie jak do odczytu rekordu, więc punkt jest w kontrolerze zasobu, a nie w dzienniku audytu.
 */
@Injectable()
export class EntityHistory {
  private readonly audit: DrizzleAuditLogRepository;

  constructor(@Inject(DB) db: Database) {
    this.audit = new DrizzleAuditLogRepository(db);
  }

  of(entityType: string, entityId: string, limit = 20): Promise<AuditLogDetails[]> {
    return this.audit.forEntity(entityType, entityId, limit);
  }
}
