import { DomainError, ensureVersion, notFound, staffConsentRevocation, type ConsentType } from '@hulajnogi/core';
import {
  type Database,
  type DbExecutor,
  DrizzleAdminListsRepository,
  DrizzleCustomerSessionRepository,
  DrizzleStaffSessionRepository,
  purgeExpiredOtp,
} from '@hulajnogi/db';
import {
  type ConsentListItem,
  type ListQuery,
  type ListResponse,
  type OtpPurgePreview,
  type OtpPurgeResult,
  type PermissionListItem,
  type PermissionUpdate,
  type SessionListItem,
  type StaffInvitationListItem,
  type StaffInvitationResult,
  type StaffSessionListItem,
} from '@hulajnogi/shared';
import { Inject, Injectable } from '@nestjs/common';
import { AuditedTransaction } from '../audit/audited-transaction.js';
import { DB } from '../database/database.module.js';
import { NotificationsService } from '../notifications/notifications.service.js';
import { StaffService } from './staff.service.js';

const byId = (field: string, value: string): ListQuery => ({
  filters: [{ field, op: 'eq', values: [value] }],
  sort: [],
  page: 1,
  pageSize: 1,
  facets: [],
});

/**
 * Listy i polecenia kont z domknięcia macierzy operacji (ADR 0076): zgody, sesje i kody SMS klientów, zapisane miejsca,
 * sesje i zaproszenia operatorów, opisy uprawnień. Listy czytają widoki z migracji 0013 przez wspólny kontrakt list
 * (ADR 0031), a każde polecenie zapisuje wpis w dzienniku audytu w tej samej transakcji (ADR 0028).
 */
@Injectable()
export class AccountListsService {
  constructor(
    @Inject(DB) private readonly db: Database,
    private readonly transaction: AuditedTransaction,
    private readonly staff: StaffService,
    private readonly notifications: NotificationsService,
  ) {}

  private repo(db: DbExecutor = this.db) {
    return new DrizzleAdminListsRepository(db);
  }

  // --- Listy ---------------------------------------------------------------------------------------------

  consents(query: ListQuery, db?: DbExecutor) {
    return this.repo(db).consents(query);
  }

  sessions(query: ListQuery, db?: DbExecutor) {
    return this.repo(db).sessions(query);
  }

  otpCodes(query: ListQuery, db?: DbExecutor) {
    return this.repo(db).otpCodes(query);
  }

  savedPlaces(query: ListQuery, db?: DbExecutor) {
    return this.repo(db).savedPlaces(query);
  }

  staffSessions(query: ListQuery, db?: DbExecutor) {
    return this.repo(db).staffSessions(query);
  }

  staffInvitations(query: ListQuery, db?: DbExecutor) {
    return this.repo(db).staffInvitations(query);
  }

  permissions(query: ListQuery, db?: DbExecutor) {
    return this.repo(db).permissions(query);
  }

  // --- Zgody ---------------------------------------------------------------------------------------------

  /**
   * Wycofanie zgody marketingowej przez operatora z powodem (ADR 0076): inne typy to `CONSENT_NOT_REVOCABLE`, zgoda
   * już wycofana niczego nie zmienia. Wpis `consent.revoked` na kliencie w tej samej transakcji.
   */
  async revokeConsent(actorId: string, id: string, reason: string): Promise<ConsentListItem> {
    await this.transaction.run(actorId, async ({ tx, audit }) => {
      const repo = this.repo(tx);
      const consent = await repo.consent(id);
      if (!consent) throw notFound('consent', id);
      if (staffConsentRevocation(consent.type as ConsentType, consent.revokedAt) === 'UNCHANGED') return;
      await repo.revokeConsentByStaff(id, actorId);
      await audit({
        action: 'consent.revoked',
        entityType: 'user',
        entityId: consent.userId,
        data: { consentId: id, type: consent.type, reason },
      });
    });
    return this.one('id', id, (q) => this.repo().consents(q));
  }

  // --- Sesje ---------------------------------------------------------------------------------------------

  /**
   * Unieważnienie jednej rodziny sesji klienta (`id` z listy to `family_id`, ADR 0076): odświeżenie przestaje działać,
   * tokeny push rodziny znikają jak przy wylogowaniu, a token dostępu działa do wygaśnięcia (do 15 min, ADR 0035).
   */
  async revokeSession(actorId: string, familyId: string, reason?: string): Promise<SessionListItem> {
    await this.transaction.run(actorId, async ({ tx, audit }) => {
      const family = await this.repo(tx).sessionFamily(familyId);
      if (!family) throw notFound('session', familyId);
      const revoked = await new DrizzleCustomerSessionRepository(tx).revokeFamily(familyId, new Date());
      if (revoked === 0) return;
      await this.notifications.forgetSessionFamily(tx, familyId);
      await audit({
        action: 'session.revoked',
        entityType: 'user',
        entityId: family.userId,
        data: { sessionId: familyId, sessionsRevoked: revoked, ...(reason ? { reason } : {}) },
      });
    });
    return this.one('id', familyId, (q) => this.repo().sessions(q));
  }

  /** Unieważnienie jednej rodziny sesji operatora (`staff.manage`); wpis `session.revoked` na operatorze. */
  async revokeStaffSession(actorId: string, familyId: string, reason?: string): Promise<StaffSessionListItem> {
    await this.transaction.run(actorId, async ({ tx, audit }) => {
      const family = await this.repo(tx).staffSessionFamily(familyId);
      if (!family) throw notFound('staff_session', familyId);
      const revoked = await new DrizzleStaffSessionRepository(tx).revokeFamily(familyId, new Date());
      if (revoked === 0) return;
      await audit({
        action: 'session.revoked',
        entityType: 'staff',
        entityId: family.staffId,
        data: { sessionId: familyId, sessionsRevoked: revoked, ...(reason ? { reason } : {}) },
      });
    });
    return this.one('id', familyId, (q) => this.repo().staffSessions(q));
  }

  // --- Zaproszenia operatorów ------------------------------------------------------------------------------

  /** Unieważnienie oczekującego zaproszenia: link przestaje działać, konto zostaje „Zaproszony” bez hasła. */
  async revokeInvitation(actorId: string, id: string): Promise<StaffInvitationListItem> {
    await this.transaction.run(actorId, async ({ tx, audit }) => {
      const repo = this.repo(tx);
      const invitation = await repo.invitation(id);
      if (!invitation) throw notFound('staff_invitation', id);
      if (invitation.state !== 'PENDING' || !(await repo.revokeInvitation(id))) {
        throw new DomainError('INVITATION_NOT_PENDING', { state: invitation.state });
      }
      await audit({
        action: 'staff.invitation_revoked',
        entityType: 'staff',
        entityId: invitation.staffId,
        data: { invitationId: id },
      });
    });
    return this.one('id', id, (q) => this.repo().staffInvitations(q));
  }

  /**
   * „Wyślij ponownie” z listy zaproszeń: nowe zaproszenie zastępuje otwarte (`replaced_by`), link pokazywany raz
   * (do czasu wysyłki e-maili). Przyjęte zaproszenie albo aktywne konto to `ALREADY_ACTIVE` z reguły w core.
   */
  async resendInvitation(actorId: string, id: string): Promise<StaffInvitationResult> {
    const invitation = await this.repo().invitation(id);
    if (!invitation) throw notFound('staff_invitation', id);
    return this.staff.resendInvitation(actorId, invitation.staffId, null, { replaces: id });
  }

  // --- Kody SMS ----------------------------------------------------------------------------------------------

  async purgeableOtp(): Promise<OtpPurgePreview> {
    return { count: await this.repo().purgeableOtpCodes() };
  }

  /** „Usuń wygasłe kody” (`sp_purge_expired_otp`): faktyczna liczba w odpowiedzi i we wpisie `otp.purged`. */
  async purgeOtp(actorId: string): Promise<OtpPurgeResult> {
    return this.transaction.run(actorId, async ({ tx, audit }) => {
      const deleted = await purgeExpiredOtp(tx);
      await audit({ action: 'otp.purged', entityType: 'otp_code', entityId: null, data: { deleted } });
      return { deleted };
    });
  }

  // --- Zapisane miejsca --------------------------------------------------------------------------------------

  /** Usunięcie zapisanego miejsca klienta (`users.manage`); dodawanie i edycja są tylko w aplikacji. */
  async deleteSavedPlace(actorId: string, id: string): Promise<void> {
    await this.transaction.run(actorId, async ({ tx, audit }) => {
      const place = await this.repo(tx).deleteSavedPlace(id);
      if (!place) throw notFound('saved_place', id);
      await audit({
        action: 'saved_place.deleted',
        entityType: 'user',
        entityId: place.userId,
        data: { placeId: id, label: place.label, name: place.name },
      });
    });
  }

  // --- Uprawnienia --------------------------------------------------------------------------------------------

  /**
   * Opis uprawnienia (`roles.manage`, ADR 0076) z blokadą optymistyczną: konflikt wersji to `409 CONFLICT`, ten sam
   * opis niczego nie zmienia. Kody pochodzą z katalogu w core; migracje dopisują nowe kody bez nadpisywania opisu.
   */
  async updatePermission(actorId: string, code: string, body: PermissionUpdate): Promise<PermissionListItem> {
    await this.transaction.run(actorId, async ({ tx, audit }) => {
      const repo = this.repo(tx);
      const current = await repo.permission(code);
      if (!current) throw notFound('permission', code);
      ensureVersion(body.version, current.version);
      if (current.description === body.description) return;
      if (!(await repo.updatePermissionDescription(code, body.version, body.description, actorId))) {
        ensureVersion(body.version, (await repo.permission(code))!.version);
      }
      await audit({
        action: 'permission.updated',
        entityType: 'permission',
        entityId: null,
        data: { code, changes: { description: [current.description, body.description] } },
      });
    });
    return this.one('code', code, (q) => this.repo().permissions(q));
  }

  /** Wiersz listy po zmianie (odpowiedź polecenia ma ten sam kształt co lista). */
  private async one<T>(field: string, value: string, list: (query: ListQuery) => Promise<ListResponse<T>>): Promise<T> {
    const item = (await list(byId(field, value))).items[0];
    if (!item) throw notFound(field, value);
    return item;
  }
}
