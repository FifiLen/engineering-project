import { StaffPermissions } from '@hulajnogi/core';
import { type Database, DrizzleStaffRepository } from '@hulajnogi/db';
import { Inject, Injectable } from '@nestjs/common';
import { DB } from '../database/database.module.js';

const TTL_MS = 10_000;

/**
 * Uprawnienia operatora z `v_staff_permissions` z krótką pamięcią podręczną (ADR 0028, ADR 0035).
 * Widok pomija nieaktywnych operatorów, więc dezaktywacja odcina dostęp przy następnym odczycie.
 * Zmiana ról w tej instancji czyści pamięć od razu (`invalidate`).
 */
@Injectable()
export class StaffPermissionsService {
  private readonly cache = new Map<string, { value: StaffAccessState; at: number }>();
  private readonly staff: DrizzleStaffRepository;

  constructor(@Inject(DB) db: Database) {
    this.staff = new DrizzleStaffRepository(db);
  }

  async get(staffId: string, now = Date.now()): Promise<StaffAccessState> {
    const hit = this.cache.get(staffId);
    if (hit && now - hit.at < TTL_MS) return hit.value;
    const record = await this.staff.findAuthById(staffId);
    const value: StaffAccessState = record?.active
      ? { active: true, permissions: new StaffPermissions(await this.staff.permissions(staffId)) }
      : { active: false, permissions: new StaffPermissions([]) };
    this.cache.set(staffId, { value, at: now });
    return value;
  }

  /** Bez argumentu: zmiana uprawnień roli dotyczy wielu operatorów naraz. */
  invalidate(staffId?: string): void {
    if (staffId) this.cache.delete(staffId);
    else this.cache.clear();
  }
}

export interface StaffAccessState {
  active: boolean;
  permissions: StaffPermissions;
}
