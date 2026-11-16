import { isPermission, type Permission, type RoleRecord, type RoleRepository } from '@hulajnogi/core';
import {
  rolesResource,
  type ListQuery,
  type ListResponse,
  type PermissionView,
  type RoleListItem,
  type StaffStatus,
} from '@hulajnogi/shared';
import { and, asc, eq, inArray, sql } from 'drizzle-orm';
import { runListQuery, type ListSource } from '../admin/list-query.js';
import type { DbExecutor } from '../client.js';
import { permissions, rolePermissions, roles, staffRoles, vRolesOverview, vStaffOverview } from '../schema/schema.js';
import { rethrowDatabaseRule, rethrowUniqueViolation } from './errors.js';

type RoleField = keyof typeof rolesResource.fields;

const listSource: ListSource<RoleField> = {
  from: vRolesOverview,
  id: vRolesOverview.id,
  columns: {
    id: vRolesOverview.id,
    name: vRolesOverview.name,
    description: vRolesOverview.description,
    isSystem: vRolesOverview.isSystem,
    permissionsCount: vRolesOverview.permissionsCount,
    staffCount: vRolesOverview.staffCount,
    updatedAt: vRolesOverview.updatedAt,
    version: vRolesOverview.version,
  },
};

const touch = { version: sql`${roles.version} + 1`, updatedAt: sql`now()` };

/** Moduł Dostęp: role i ich uprawnienia (ADR 0028). */
export class DrizzleRoleRepository implements RoleRepository {
  constructor(private readonly db: DbExecutor) {}

  list(query: ListQuery): Promise<ListResponse<RoleListItem>> {
    return runListQuery<RoleField, RoleListItem>(this.db, rolesResource, listSource, query);
  }

  async details(id: string): Promise<(RoleListItem & { permissions: Permission[] }) | null> {
    const [row] = await this.db.select(listSource.columns).from(vRolesOverview).where(eq(vRolesOverview.id, id));
    if (!row) return null;
    return { ...(row as unknown as RoleListItem), permissions: await this.permissionsOf(id) };
  }

  /** Operatorzy z rolą (także zaproszeni i nieaktywni) do karty roli. */
  async staffWithRole(id: string): Promise<Array<{ id: string; name: string; status: StaffStatus }>> {
    const rows = await this.db
      .select({ id: vStaffOverview.id, name: vStaffOverview.name, status: vStaffOverview.status })
      .from(staffRoles)
      .innerJoin(vStaffOverview, eq(vStaffOverview.id, staffRoles.staffId))
      .where(eq(staffRoles.roleId, id))
      .orderBy(asc(vStaffOverview.name));
    return rows as Array<{ id: string; name: string; status: StaffStatus }>;
  }

  /** Katalog uprawnień z opisami do macierzy w edycji roli. */
  async catalog(): Promise<PermissionView[]> {
    return this.db
      .select({ code: permissions.code, module: permissions.module, description: permissions.description })
      .from(permissions)
      .orderBy(asc(permissions.module), asc(permissions.code));
  }

  async findById(id: string): Promise<RoleRecord | null> {
    const [row] = await this.db
      .select({
        id: vRolesOverview.id,
        name: vRolesOverview.name,
        description: vRolesOverview.description,
        isSystem: vRolesOverview.isSystem,
        staffCount: sql<number>`(SELECT count(*)::int FROM staff_roles sr WHERE sr.role_id = v_roles_overview.id)`,
        version: vRolesOverview.version,
      })
      .from(vRolesOverview)
      .where(eq(vRolesOverview.id, id));
    if (!row) return null;
    return {
      id: row.id!,
      name: row.name!,
      description: row.description,
      isSystem: row.isSystem === true,
      staffCount: Number(row.staffCount),
      version: row.version!,
      permissions: await this.permissionsOf(id),
    };
  }

  async permissionMap(): Promise<Map<string, Permission[]>> {
    const rows = await this.db
      .select({ roleId: rolePermissions.roleId, code: rolePermissions.permissionCode })
      .from(rolePermissions);
    const map = new Map<string, Permission[]>();
    for (const { roleId, code } of rows) {
      if (!isPermission(code)) continue;
      map.set(roleId, [...(map.get(roleId) ?? []), code]);
    }
    return map;
  }

  async create(input: { name: string; description: string | null }): Promise<{ id: string }> {
    try {
      const [row] = await this.db.insert(roles).values(input).returning({ id: roles.id });
      return row!;
    } catch (error) {
      rethrowUniqueViolation(error);
    }
  }

  async update(
    id: string,
    version: number,
    changes: { name?: string; description?: string | null },
  ): Promise<boolean> {
    const set = Object.fromEntries(Object.entries(changes).filter(([, v]) => v !== undefined));
    try {
      const rows = await this.db
        .update(roles)
        .set({ ...set, ...touch })
        .where(and(eq(roles.id, id), eq(roles.version, version)))
        .returning({ id: roles.id });
      return rows.length > 0;
    } catch (error) {
      rethrowUniqueViolation(error);
    }
  }

  async setPermissions(id: string, version: number, codes: readonly Permission[]): Promise<boolean> {
    try {
      return await this.replacePermissions(id, version, codes);
    } catch (error) {
      rethrowDatabaseRule(error);
    }
  }

  private async replacePermissions(id: string, version: number, codes: readonly Permission[]): Promise<boolean> {
    // Wersja roli chroni macierz przed nadpisaniem zmian drugiego administratora.
    const bumped = await this.db
      .update(roles)
      .set(touch)
      .where(and(eq(roles.id, id), eq(roles.version, version)))
      .returning({ id: roles.id });
    if (bumped.length === 0) return false;
    // Tylko różnica: usunięcie wszystkich i ponowne wstawienie chwilowo odbierałoby roles.manage roli
    // Administrator, a strażnik z migracji 0004 sprawdza stan także po każdej instrukcji poza transakcją.
    const current = await this.permissionsOf(id);
    const removed = current.filter((c) => !codes.includes(c));
    const added = codes.filter((c) => !current.includes(c));
    if (removed.length > 0) {
      await this.db
        .delete(rolePermissions)
        .where(and(eq(rolePermissions.roleId, id), inArray(rolePermissions.permissionCode, removed)));
    }
    if (added.length > 0) {
      await this.db.insert(rolePermissions).values(added.map((permissionCode) => ({ roleId: id, permissionCode })));
    }
    return true;
  }

  async delete(id: string): Promise<void> {
    await this.db.delete(roles).where(eq(roles.id, id));
  }

  private async permissionsOf(id: string): Promise<Permission[]> {
    const rows = await this.db
      .select({ code: rolePermissions.permissionCode })
      .from(rolePermissions)
      .where(eq(rolePermissions.roleId, id))
      .orderBy(asc(rolePermissions.permissionCode));
    return rows.map((r) => r.code).filter(isPermission);
  }
}
