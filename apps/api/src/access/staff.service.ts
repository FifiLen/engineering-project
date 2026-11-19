import {
  countRoleManagers,
  diffForAudit,
  ensureCanInvite,
  ensureNotSelf,
  ensureRoleManagerRemains,
  ensureVersion,
  invitationExpiresAt,
  normalizeEmail,
  notFound,
  type StaffAccess,
} from '@hulajnogi/core';
import {
  type Database,
  type DbExecutor,
  DrizzleInvitationRepository,
  DrizzleRoleRepository,
  DrizzleStaffRepository,
  DrizzleStaffSessionRepository,
  generateToken,
  hashToken,
} from '@hulajnogi/db';
import type {
  ListQuery,
  ListResponse,
  RemovalResult,
  StaffDetails,
  StaffInvitationResult,
  StaffInvite,
  StaffListItem,
  StaffUpdate,
} from '@hulajnogi/shared';
import { Inject, Injectable } from '@nestjs/common';
import { AuditedTransaction, type AuditScope } from '../audit/audited-transaction.js';
import { StaffPermissionsService } from '../auth/staff-permissions.service.js';
import { CONFIG, type AppConfig } from '../config.js';
import { DB } from '../database/database.module.js';

/**
 * Operatorzy panelu (ADR 0028): zaproszenia, role, dezaktywacja, reset TOTP i sesje. Każda zmiana
 * z dziennikiem audytu; reguła ostatniego zarządzającego rolami z core, a w razie wyścigu z bazy.
 */
@Injectable()
export class StaffService {
  constructor(
    @Inject(DB) private readonly db: Database,
    @Inject(CONFIG) private readonly config: AppConfig,
    private readonly transaction: AuditedTransaction,
    private readonly permissions: StaffPermissionsService,
  ) {}

  list(query: ListQuery, db: DbExecutor = this.db): Promise<ListResponse<StaffListItem>> {
    return new DrizzleStaffRepository(db).list(query);
  }

  async details(id: string, db: DbExecutor = this.db): Promise<StaffDetails> {
    const row = await new DrizzleStaffRepository(db).details(id);
    if (!row) throw notFound('staff', id);
    return { ...row, sessions: await new DrizzleStaffSessionRepository(db).active(id, new Date()) };
  }

  /** Konto bez hasła z rolami i link aktywacji pokazywany raz (do czasu wysyłki e-maili). */
  async invite(actorId: string, input: StaffInvite): Promise<StaffInvitationResult> {
    const now = new Date();
    const token = generateToken();
    const id = await this.transaction.run(actorId, async ({ tx, audit }) => {
      const roleNames = await roleNamesOf(tx, input.roleIds);
      const staff = new DrizzleStaffRepository(tx);
      const { id: staffId } = await staff.createInvited({ email: normalizeEmail(input.email), name: input.name });
      await staff.setRoles(staffId, input.roleIds, actorId);
      await new DrizzleInvitationRepository(tx).create(staffId, hashToken(token), invitationExpiresAt(now), actorId, now);
      await audit({
        action: 'staff.invited',
        entityType: 'staff',
        entityId: staffId,
        data: { email: normalizeEmail(input.email), name: input.name, roles: roleNames },
      });
      return staffId;
    });
    return { staff: await this.details(id), invitationUrl: this.invitationUrl(token) };
  }

  /**
   * Nowe zaproszenie zastępujące otwarte (`replaced_by`, ADR 0076). Z karty operatora z wersją rekordu, z listy
   * zaproszeń bez niej (`version = null`, `replaces` to zaproszenie z wiersza listy).
   */
  async resendInvitation(
    actorId: string,
    id: string,
    version: number | null,
    context: { replaces?: string } = {},
  ): Promise<StaffInvitationResult> {
    const now = new Date();
    const token = generateToken();
    await this.transaction.run(actorId, async ({ tx, audit }) => {
      const record =
        version === null ? await new DrizzleStaffRepository(tx).findAuthById(id) : await this.load(tx, id, version);
      if (!record) throw notFound('staff', id);
      ensureCanInvite(record);
      const invitation = await new DrizzleInvitationRepository(tx).create(
        id,
        hashToken(token),
        invitationExpiresAt(now),
        actorId,
        now,
      );
      await audit({
        action: 'staff.invitation_resent',
        entityType: 'staff',
        entityId: id,
        data: { invitationId: invitation.id, ...(context.replaces ? { replaces: context.replaces } : {}) },
      });
    });
    return { staff: await this.details(id), invitationUrl: this.invitationUrl(token) };
  }

  async update(actorId: string, id: string, { version, roleIds, ...changes }: StaffUpdate): Promise<StaffDetails> {
    await this.transaction.run(actorId, async ({ tx, audit }) => {
      const record = await this.load(tx, id, version);
      const staff = new DrizzleStaffRepository(tx);
      const fields = { name: changes.name, email: changes.email ? normalizeEmail(changes.email) : undefined };
      const diff = diffForAudit(record, fields);
      let roles: { before: string[]; after: string[] } | undefined;

      if (roleIds) {
        ensureNotSelf(actorId, id, 'ROLES');
        await this.ensureManagerRemains(tx, (s) => (s.id === id ? { ...s, roleIds } : s));
        const after = await roleNamesOf(tx, roleIds);
        const previous = await staff.setRoles(id, roleIds, actorId);
        const before = await roleNamesOf(tx, previous);
        if (before.join() !== after.join()) roles = { before, after };
      }
      if (Object.keys(diff).length > 0 || roles) {
        if (!(await staff.update(id, version, fields))) ensureVersion(version, (await staff.findAuthById(id))!.version);
      }
      // Nowy adres e-mail to nowe dane logowania: wszystkie sesje operatora wygasają.
      if (diff.email) await new DrizzleStaffSessionRepository(tx).revokeAllForOwner(id);
      if (Object.keys(diff).length > 0 || roles) {
        await audit({
          action: roles && Object.keys(diff).length === 0 ? 'staff.roles_changed' : 'staff.updated',
          entityType: 'staff',
          entityId: id,
          data: { changes: { ...diff, ...(roles ? { roles: [roles.before, roles.after] } : {}) } },
        });
      }
    });
    this.permissions.invalidate(id);
    return this.details(id);
  }

  /** „Usunięcie” operatora to dezaktywacja: wpisy dziennika wskazują autora (ADR 0031). */
  async deactivate(actorId: string, id: string, version: number): Promise<RemovalResult> {
    await this.transaction.run(actorId, async ({ tx, audit }) => {
      const record = await this.load(tx, id, version);
      ensureNotSelf(actorId, id, 'DEACTIVATE');
      if (!record.active) return;
      await this.ensureManagerRemains(tx, (s) => (s.id === id ? { ...s, active: false } : s));
      if (!(await new DrizzleStaffRepository(tx).update(id, version, { active: false }))) {
        ensureVersion(version, (await new DrizzleStaffRepository(tx).findAuthById(id))!.version);
      }
      const sessions = await new DrizzleStaffSessionRepository(tx).revokeAllForOwner(id);
      await audit({
        action: 'staff.deactivated',
        entityType: 'staff',
        entityId: id,
        data: { changes: { active: [true, false] }, sessionsRevoked: sessions },
      });
    });
    this.permissions.invalidate(id);
    return { outcome: 'ARCHIVED' };
  }

  /** Zgubiony telefon: przy następnym logowaniu operator skonfiguruje TOTP od nowa. */
  async resetTotp(actorId: string, id: string, version: number): Promise<StaffDetails> {
    await this.transaction.run(actorId, async ({ tx, audit }) => {
      await this.load(tx, id, version);
      await new DrizzleStaffRepository(tx).resetTotp(id);
      const sessions = await new DrizzleStaffSessionRepository(tx).revokeAllForOwner(id);
      await audit({ action: 'staff.totp_reset', entityType: 'staff', entityId: id, data: { sessionsRevoked: sessions } });
    });
    return this.details(id);
  }

  async revokeSessions(actorId: string, id: string): Promise<StaffDetails> {
    await this.transaction.run(actorId, async ({ tx, audit }) => {
      if (!(await new DrizzleStaffRepository(tx).findAuthById(id))) throw notFound('staff', id);
      const sessions = await new DrizzleStaffSessionRepository(tx).revokeAllForOwner(id);
      await audit({ action: 'staff.sessions_revoked', entityType: 'staff', entityId: id, data: { sessionsRevoked: sessions } });
    });
    return this.details(id);
  }

  private async load(tx: DbExecutor, id: string, version: number) {
    const record = await new DrizzleStaffRepository(tx).findAuthById(id);
    if (!record) throw notFound('staff', id);
    ensureVersion(version, record.version);
    return record;
  }

  /** Stan operatorów po planowanej zmianie musi zostawić aktywnego operatora z `roles.manage`. */
  private async ensureManagerRemains(tx: DbExecutor, change: (s: StaffAccess) => StaffAccess): Promise<void> {
    const [snapshot, rolePermissions] = await Promise.all([
      new DrizzleStaffRepository(tx).accessSnapshot(),
      new DrizzleRoleRepository(tx).permissionMap(),
    ]);
    ensureRoleManagerRemains(countRoleManagers(snapshot.map(change), rolePermissions));
  }

  private invitationUrl(token: string): string {
    return `${this.config.PANEL_URL}/admin/aktywacja?token=${token}`;
  }
}

/** Nazwy ról do dziennika (czytelne bez złączeń); nieistniejąca rola to `NOT_FOUND`. */
async function roleNamesOf(tx: AuditScope['tx'], roleIds: readonly string[]): Promise<string[]> {
  const roles = new DrizzleRoleRepository(tx);
  const names: string[] = [];
  for (const id of roleIds) {
    const role = await roles.findById(id);
    if (!role) throw notFound('role', id);
    names.push(role.name);
  }
  return names.sort();
}
