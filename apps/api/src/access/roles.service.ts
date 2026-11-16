import {
  countRoleManagers,
  diffForAudit,
  diffPermissions,
  ensureRoleManagerRemains,
  ensureRoleRemovable,
  ensureVersion,
  notFound,
  parseRolePermissions,
  type Permission,
} from '@hulajnogi/core';
import { type Database, type DbExecutor, DrizzleRoleRepository, DrizzleStaffRepository } from '@hulajnogi/db';
import type {
  ListQuery,
  ListResponse,
  PermissionView,
  RemovalResult,
  RoleCreate,
  RoleDetails,
  RoleListItem,
  RoleUpdate,
} from '@hulajnogi/shared';
import { Inject, Injectable } from '@nestjs/common';
import { AuditedTransaction } from '../audit/audited-transaction.js';
import { StaffPermissionsService } from '../auth/staff-permissions.service.js';
import { DB } from '../database/database.module.js';

/** Role i macierz uprawnień (ADR 0028); zmiana uprawnień działa od następnego żądania operatorów. */
@Injectable()
export class RolesService {
  constructor(
    @Inject(DB) private readonly db: Database,
    private readonly transaction: AuditedTransaction,
    private readonly permissions: StaffPermissionsService,
  ) {}

  list(query: ListQuery): Promise<ListResponse<RoleListItem>> {
    return new DrizzleRoleRepository(this.db).list(query);
  }

  catalog(): Promise<PermissionView[]> {
    return new DrizzleRoleRepository(this.db).catalog();
  }

  async details(id: string, db: DbExecutor = this.db): Promise<RoleDetails> {
    const roles = new DrizzleRoleRepository(db);
    const row = await roles.details(id);
    if (!row) throw notFound('role', id);
    return { ...row, staff: await roles.staffWithRole(id) };
  }

  async create(actorId: string, input: RoleCreate): Promise<RoleDetails> {
    const permissions = parseRolePermissions(input.permissions);
    const id = await this.transaction.run(actorId, async ({ tx, audit }) => {
      const roles = new DrizzleRoleRepository(tx);
      const { id: roleId } = await roles.create({ name: input.name, description: input.description });
      if (permissions.length > 0) await roles.setPermissions(roleId, 1, permissions);
      await audit({
        action: 'role.created',
        entityType: 'role',
        entityId: roleId,
        data: { name: input.name, permissions },
      });
      return roleId;
    });
    return this.details(id);
  }

  async update(actorId: string, id: string, { version, permissions: codes, ...changes }: RoleUpdate): Promise<RoleDetails> {
    const permissions = codes ? parseRolePermissions(codes) : undefined;
    await this.transaction.run(actorId, async ({ tx, audit }) => {
      const roles = new DrizzleRoleRepository(tx);
      const role = await roles.findById(id);
      if (!role) throw notFound('role', id);
      ensureVersion(version, role.version);
      const diff = diffForAudit(role, changes);
      const permissionDiff = permissions ? diffPermissions(role.permissions, permissions) : { added: [], removed: [] };
      const permissionsChanged = permissionDiff.added.length + permissionDiff.removed.length > 0;
      let current = version;

      if (Object.keys(diff).length > 0) {
        if (!(await roles.update(id, current, changes))) ensureVersion(version, (await roles.findById(id))!.version);
        current += 1;
      }
      if (permissions && permissionsChanged) {
        if (permissionDiff.removed.length > 0) await this.ensureManagerRemains(tx, id, permissions);
        if (!(await roles.setPermissions(id, current, permissions))) ensureVersion(version, (await roles.findById(id))!.version);
      }
      if (Object.keys(diff).length === 0 && !permissionsChanged) return;
      await audit({
        action: permissionsChanged && Object.keys(diff).length === 0 ? 'role.permissions_changed' : 'role.updated',
        entityType: 'role',
        entityId: id,
        data: { changes: diff, ...(permissionsChanged ? { permissions: permissionDiff } : {}) },
      });
    });
    // Rola dotyczy wielu operatorów: czyścimy całą pamięć podręczną uprawnień.
    this.permissions.invalidate();
    return this.details(id);
  }

  async remove(actorId: string, id: string, version: number): Promise<RemovalResult> {
    await this.transaction.run(actorId, async ({ tx, audit }) => {
      const roles = new DrizzleRoleRepository(tx);
      const role = await roles.findById(id);
      if (!role) throw notFound('role', id);
      ensureVersion(version, role.version);
      ensureRoleRemovable(role);
      await roles.delete(id);
      await audit({ action: 'role.deleted', entityType: 'role', entityId: id, data: { name: role.name, permissions: role.permissions } });
    });
    return { outcome: 'DELETED' };
  }

  private async ensureManagerRemains(tx: DbExecutor, roleId: string, permissions: readonly Permission[]): Promise<void> {
    const [snapshot, map] = await Promise.all([
      new DrizzleStaffRepository(tx).accessSnapshot(),
      new DrizzleRoleRepository(tx).permissionMap(),
    ]);
    map.set(roleId, [...permissions]);
    ensureRoleManagerRemains(countRoleManagers(snapshot, map));
  }
}
