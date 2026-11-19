import {
  isPermission,
  type InvitationRecord,
  type InvitationRepository,
  type Permission,
  type StaffAccess,
  type StaffAuthRecord,
  type StaffRepository,
} from '@hulajnogi/core';
import { staffResource, type ListQuery, type ListResponse, type StaffListItem } from '@hulajnogi/shared';
import { and, eq, inArray, isNull, sql } from 'drizzle-orm';
import { alias } from 'drizzle-orm/pg-core';
import { runListQuery, type ListSource } from '../admin/list-query.js';
import type { DbExecutor } from '../client.js';
import { staff, staffInvitations, staffRoles, vStaffOverview, vStaffPermissions } from '../schema/schema.js';
import { rethrowDatabaseRule, rethrowUniqueViolation } from './errors.js';

type StaffField = keyof typeof staffResource.fields;

const listSource: ListSource<StaffField> = {
  from: vStaffOverview,
  id: vStaffOverview.id,
  columns: {
    id: vStaffOverview.id,
    name: vStaffOverview.name,
    email: vStaffOverview.email,
    status: vStaffOverview.status,
    totpEnabled: vStaffOverview.totpEnabled,
    roles: vStaffOverview.roles,
    roleIds: vStaffOverview.roleIds,
    lastLoginAt: vStaffOverview.lastLoginAt,
    lockedUntil: vStaffOverview.lockedUntil,
    activeSessions: vStaffOverview.activeSessions,
    invitationExpiresAt: vStaffOverview.invitationExpiresAt,
    createdAt: vStaffOverview.createdAt,
    version: vStaffOverview.version,
  },
};

const authColumns = {
  id: staff.id,
  email: staff.email,
  name: staff.name,
  active: staff.active,
  passwordHash: staff.passwordHash,
  totpSecretEnc: staff.totpSecretEnc,
  totpConfirmedAt: staff.totpConfirmedAt,
  totpLastStep: staff.totpLastStep,
  failedLogins: staff.failedLogins,
  lockedUntil: staff.lockedUntil,
  version: staff.version,
};

type AuthRow = { [K in keyof typeof authColumns]: (typeof authColumns)[K]['_']['data'] | null };

function toAuth(row: AuthRow): StaffAuthRecord {
  return {
    id: row.id!,
    email: row.email!,
    name: row.name!,
    active: row.active!,
    passwordSet: row.passwordHash !== null,
    passwordHash: row.passwordHash,
    totpSecretEnc: row.totpSecretEnc,
    totpConfirmed: row.totpConfirmedAt !== null,
    totpLastStep: row.totpLastStep,
    failedLogins: row.failedLogins!,
    lockedUntil: row.lockedUntil,
    version: row.version!,
  };
}

const touch = { version: sql`${staff.version} + 1`, updatedAt: sql`now()` };

/** Moduł Dostęp: operatorzy panelu, ich logowanie i role (ADR 0019, ADR 0028). */
export class DrizzleStaffRepository implements StaffRepository {
  constructor(private readonly db: DbExecutor) {}

  list(query: ListQuery): Promise<ListResponse<StaffListItem>> {
    return runListQuery<StaffField, StaffListItem>(this.db, staffResource, listSource, query);
  }

  async details(id: string): Promise<StaffListItem | null> {
    const [row] = await this.db.select(listSource.columns).from(vStaffOverview).where(eq(vStaffOverview.id, id));
    return (row as unknown as StaffListItem | undefined) ?? null;
  }

  async findAuthByEmail(email: string): Promise<StaffAuthRecord | null> {
    const [row] = await this.db.select(authColumns).from(staff).where(eq(staff.email, email));
    return row ? toAuth(row) : null;
  }

  async findAuthById(id: string): Promise<StaffAuthRecord | null> {
    const [row] = await this.db.select(authColumns).from(staff).where(eq(staff.id, id));
    return row ? toAuth(row) : null;
  }

  async createInvited(input: { email: string; name: string }): Promise<{ id: string }> {
    try {
      const [row] = await this.db.insert(staff).values(input).returning({ id: staff.id });
      return row!;
    } catch (error) {
      rethrowUniqueViolation(error);
    }
  }

  async recordFailedLogin(id: string, failedLogins: number, lockedUntil: Date | null): Promise<void> {
    await this.db.update(staff).set({ failedLogins, lockedUntil }).where(eq(staff.id, id));
  }

  async recordLogin(id: string, now: Date, totpStep: number): Promise<void> {
    await this.db
      .update(staff)
      .set({ failedLogins: 0, lockedUntil: null, lastLoginAt: now, totpLastStep: totpStep })
      .where(eq(staff.id, id));
  }

  async setPassword(id: string, passwordHash: string): Promise<void> {
    await this.db
      .update(staff)
      .set({ passwordHash, ...touch })
      .where(eq(staff.id, id));
  }

  async setPendingTotp(id: string, secretEnc: string): Promise<void> {
    await this.db
      .update(staff)
      .set({ totpSecretEnc: secretEnc, totpConfirmedAt: null })
      .where(eq(staff.id, id));
  }

  async confirmTotp(id: string, now: Date, totpStep: number): Promise<void> {
    await this.db
      .update(staff)
      .set({ totpConfirmedAt: now, totpLastStep: totpStep, ...touch })
      .where(eq(staff.id, id));
  }

  async resetTotp(id: string): Promise<void> {
    await this.db
      .update(staff)
      .set({ totpSecretEnc: null, totpConfirmedAt: null, totpLastStep: null, ...touch })
      .where(eq(staff.id, id));
  }

  async update(
    id: string,
    version: number,
    changes: { name?: string; email?: string; active?: boolean },
  ): Promise<boolean> {
    const set = Object.fromEntries(Object.entries(changes).filter(([, v]) => v !== undefined));
    try {
      const rows = await this.db
        .update(staff)
        .set({ ...set, ...touch })
        .where(and(eq(staff.id, id), eq(staff.version, version)))
        .returning({ id: staff.id });
      return rows.length > 0;
    } catch (error) {
      rethrowDatabaseRule(error);
    }
  }

  async setRoles(id: string, roleIds: readonly string[], assignedBy: string): Promise<string[]> {
    try {
      return await this.replaceRoles(id, roleIds, assignedBy);
    } catch (error) {
      rethrowDatabaseRule(error);
    }
  }

  private async replaceRoles(id: string, roleIds: readonly string[], assignedBy: string): Promise<string[]> {
    const before = await this.db.select({ roleId: staffRoles.roleId }).from(staffRoles).where(eq(staffRoles.staffId, id));
    const previous = before.map((r) => r.roleId);
    const toRemove = previous.filter((r) => !roleIds.includes(r));
    const toAdd = roleIds.filter((r) => !previous.includes(r));
    for (const roleId of toRemove) {
      await this.db.delete(staffRoles).where(and(eq(staffRoles.staffId, id), eq(staffRoles.roleId, roleId)));
    }
    if (toAdd.length > 0) {
      await this.db.insert(staffRoles).values(toAdd.map((roleId) => ({ staffId: id, roleId, assignedBy })));
    }
    return previous;
  }

  async accessSnapshot(): Promise<StaffAccess[]> {
    const rows = await this.db
      .select({ id: vStaffOverview.id, active: vStaffOverview.active, roleIds: vStaffOverview.roleIds })
      .from(vStaffOverview);
    return rows.map((r) => ({ id: r.id!, active: r.active === true, roleIds: (r.roleIds as unknown as string[]) ?? [] }));
  }

  async permissions(id: string): Promise<Permission[]> {
    const rows = await this.db
      .select({ code: vStaffPermissions.permissionCode })
      .from(vStaffPermissions)
      .where(eq(vStaffPermissions.staffId, id));
    return rows.map((r) => r.code!).filter(isPermission).sort();
  }
}

const inviter = alias(staff, 'inviter');

/** Moduł Dostęp: zaproszenia operatorów (skrót tokenu z linku, nigdy sam token). */
export class DrizzleInvitationRepository implements InvitationRepository {
  constructor(private readonly db: DbExecutor) {}

  async create(
    staffId: string,
    tokenHash: string,
    expiresAt: Date,
    invitedBy: string | null,
    now: Date,
  ): Promise<{ id: string }> {
    // Ponowne wysłanie unieważnia otwarte zaproszenie i wskazuje następcę (`replaced_by`, ADR 0076), więc lista
    // odróżnia zastąpienie od ręcznego unieważnienia.
    const replaced = await this.db
      .update(staffInvitations)
      .set({ revokedAt: now })
      .where(
        and(
          eq(staffInvitations.staffId, staffId),
          isNull(staffInvitations.acceptedAt),
          isNull(staffInvitations.revokedAt),
        ),
      )
      .returning({ id: staffInvitations.id });
    const [row] = await this.db
      .insert(staffInvitations)
      .values({ staffId, tokenHash, expiresAt, invitedBy })
      .returning({ id: staffInvitations.id });
    if (replaced.length) {
      await this.db
        .update(staffInvitations)
        .set({ replacedBy: row!.id })
        .where(inArray(staffInvitations.id, replaced.map((r) => r.id)));
    }
    return row!;
  }

  async findByTokenHash(tokenHash: string): Promise<InvitationRecord | null> {
    const [row] = await this.db
      .select({
        id: staffInvitations.id,
        staffId: staffInvitations.staffId,
        staffEmail: staff.email,
        staffName: staff.name,
        staffActive: staff.active,
        invitedByName: inviter.name,
        expiresAt: staffInvitations.expiresAt,
        acceptedAt: staffInvitations.acceptedAt,
        revokedAt: staffInvitations.revokedAt,
      })
      .from(staffInvitations)
      .innerJoin(staff, eq(staff.id, staffInvitations.staffId))
      .leftJoin(inviter, eq(inviter.id, staffInvitations.invitedBy))
      .where(eq(staffInvitations.tokenHash, tokenHash));
    return row ?? null;
  }

  async accept(id: string, now: Date): Promise<boolean> {
    const rows = await this.db
      .update(staffInvitations)
      .set({ acceptedAt: now })
      .where(
        and(eq(staffInvitations.id, id), isNull(staffInvitations.acceptedAt), isNull(staffInvitations.revokedAt)),
      )
      .returning({ id: staffInvitations.id });
    return rows.length > 0;
  }
}
