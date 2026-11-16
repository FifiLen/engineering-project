import {
  assessRefresh,
  auditEntry,
  ensureInvitationUsable,
  ensurePasswordAcceptable,
  ensureStaffCanAttemptLogin,
  ensureTotpStepUnused,
  nextStepAfterPassword,
  normalizeEmail,
  refreshExpiresAt,
  registerFailedLogin,
  SESSION_POLICY,
  totpCandidateSteps,
  unauthenticated,
  type StaffAuthRecord,
} from '@hulajnogi/core';
import {
  type Database,
  type DbExecutor,
  DrizzleAuditLogRepository,
  DrizzleInvitationRepository,
  DrizzleStaffRepository,
  DrizzleStaffSessionRepository,
  generateToken,
  hashToken,
} from '@hulajnogi/db';
import type { InvitationView, StaffLoginStep, StaffMe, StaffSession, TotpSetup } from '@hulajnogi/shared';
import { Inject, Injectable } from '@nestjs/common';
import { DB } from '../database/database.module.js';
import { JWT, SECRET_BOX } from './auth.tokens.js';
import type { JwtCodec } from './crypto/jwt.js';
import { passwords, type SecretBox } from './crypto/secrets.js';
import { generateTotpSecret, matchTotpStep, otpauthUrl } from './crypto/totp.js';

const MFA_TOKEN_SECONDS = 5 * 60;
/** Wystawca w aplikacji uwierzytelniającej; nazwa marki jest otwartą decyzją (CLAUDE.md). */
const TOTP_ISSUER = '[nazwa]';
/**
 * Skrót porównywany przy nieistniejącym koncie, żeby czas odpowiedzi nie zdradzał, które adresy mają
 * konto. Powstaje raz przy starcie (argon2 z losowym hasłem).
 */
const dummyHash = passwords.hash(generateToken());

export interface StaffSessionWithRefresh extends StaffSession {
  refreshToken: string;
  refreshExpiresAt: Date;
}

/**
 * Logowanie operatora do panelu (ADR 0019, ADR 0035): hasło, potem kod TOTP albo jego konfiguracja.
 * Sesja panelu to token dostępowy w pamięci przeglądarki i token odświeżający w ciasteczku httpOnly.
 */
@Injectable()
export class StaffAuthService {
  constructor(
    @Inject(DB) private readonly db: Database,
    @Inject(JWT) private readonly jwt: JwtCodec,
    @Inject(SECRET_BOX) private readonly box: SecretBox,
  ) {}

  async login(email: string, password: string, remember: boolean): Promise<StaffLoginStep> {
    const now = new Date();
    const staff = new DrizzleStaffRepository(this.db);
    const record = await staff.findAuthByEmail(normalizeEmail(email));
    if (!record?.passwordHash) await passwords.verify(await dummyHash, password);
    ensureStaffCanAttemptLogin(record, now);
    if (!(await passwords.verify(record!.passwordHash!, password))) {
      const outcome = registerFailedLogin(record!, 'PASSWORD', now);
      await staff.recordFailedLogin(record!.id, outcome.failedLogins, outcome.lockedUntil);
      throw outcome.error;
    }
    return this.secondStep(staff, record!, remember, now);
  }

  async verifyTotp(mfaToken: string, code: string, userAgent: string | null): Promise<StaffSessionWithRefresh> {
    const now = new Date();
    const claims = this.jwt.verify(mfaToken, 'staff_mfa', now);
    const staff = new DrizzleStaffRepository(this.db);
    const record = await staff.findAuthById(claims.sub);
    ensureStaffCanAttemptLogin(record, now);
    const setup = claims.step === 'TOTP_SETUP';
    // Stan konta zmienił się między krokami (np. administrator zresetował TOTP): od nowa.
    if (!record!.totpSecretEnc || record!.totpConfirmed === setup) throw unauthenticated('LOGIN_STATE_CHANGED');

    const matched = matchTotpStep(this.box.decrypt(record!.totpSecretEnc), code, totpCandidateSteps(now));
    try {
      if (matched === null) throw new Error('TOTP');
      ensureTotpStepUnused(matched, record!.totpLastStep);
    } catch {
      const outcome = registerFailedLogin(record!, 'TOTP', now);
      await staff.recordFailedLogin(record!.id, outcome.failedLogins, outcome.lockedUntil);
      throw outcome.error;
    }

    return this.db.transaction(async (tx) => {
      const repo = new DrizzleStaffRepository(tx);
      const audit = new DrizzleAuditLogRepository(tx);
      if (setup) {
        await repo.confirmTotp(record!.id, now, matched!);
        await audit.append(
          auditEntry({ staffId: record!.id, action: 'staff.totp_enabled', entityType: 'staff', entityId: record!.id, data: {} }),
        );
      }
      await repo.recordLogin(record!.id, now, matched!);
      const session = await this.openSession(tx, record!.id, claims.remember === true, userAgent, now);
      await audit.append(
        auditEntry({
          staffId: record!.id,
          action: 'staff.signed_in',
          entityType: 'staff',
          entityId: record!.id,
          data: { device: userAgent, remember: claims.remember === true },
        }),
      );
      return session;
    });
  }

  /** Odświeżenie z ciasteczka; dezaktywowany operator traci wszystkie sesje. */
  async refresh(refreshToken: string | undefined, userAgent: string | null): Promise<StaffSessionWithRefresh> {
    if (!refreshToken) throw unauthenticated('SESSION_MISSING');
    const now = new Date();
    const sessions = new DrizzleStaffSessionRepository(this.db);
    const session = await sessions.findByTokenHash(hashToken(refreshToken));
    if (!session) throw unauthenticated('SESSION_UNKNOWN');
    const decision = assessRefresh(session, now);
    if (decision.action === 'REJECT') {
      if (decision.revokeFamily) await sessions.revokeFamily(session.familyId, now);
      throw decision.error;
    }
    const record = await new DrizzleStaffRepository(this.db).findAuthById(session.ownerId);
    if (!record?.active) {
      await sessions.revokeAllForOwner(session.ownerId);
      throw unauthenticated('STAFF_INACTIVE');
    }
    // Sesja zachowuje swój termin: odświeżanie nie przedłuża zmiany ani zapamiętanego urządzenia.
    const remaining = session.expiresAt;
    return this.db.transaction(async (tx) => {
      const token = generateToken();
      const rotated = await new DrizzleStaffSessionRepository(tx).rotate(
        session.id,
        { ownerId: record.id, familyId: session.familyId, tokenHash: hashToken(token), expiresAt: remaining, device: userAgent },
        now,
      );
      if (!rotated) throw unauthenticated('SESSION_ROTATED');
      return this.session(tx, record.id, rotated.id, token, remaining, now);
    });
  }

  async logout(refreshToken: string | undefined): Promise<void> {
    if (!refreshToken) return;
    const sessions = new DrizzleStaffSessionRepository(this.db);
    const session = await sessions.findByTokenHash(hashToken(refreshToken));
    if (session) await sessions.revokeFamily(session.familyId, new Date());
  }

  async me(staffId: string, db: DbExecutor = this.db): Promise<StaffMe> {
    const staff = new DrizzleStaffRepository(db);
    const [details, permissions] = await Promise.all([staff.details(staffId), staff.permissions(staffId)]);
    if (!details) throw unauthenticated('STAFF_INACTIVE');
    return { id: details.id, name: details.name, email: details.email, roles: details.roles, permissions };
  }

  async invitation(token: string): Promise<InvitationView> {
    const invitation = await new DrizzleInvitationRepository(this.db).findByTokenHash(hashToken(token));
    ensureInvitationUsable(invitation, new Date());
    return {
      email: invitation!.staffEmail,
      name: invitation!.staffName,
      invitedByName: invitation!.invitedByName,
      expiresAt: invitation!.expiresAt.toISOString(),
    };
  }

  /** Przyjęcie zaproszenia: hasło i imię, a potem od razu konfiguracja TOTP (krok 2 z 2 na makiecie). */
  async acceptInvitation(token: string, name: string, password: string): Promise<StaffLoginStep> {
    const now = new Date();
    const invitations = new DrizzleInvitationRepository(this.db);
    const invitation = await invitations.findByTokenHash(hashToken(token));
    ensureInvitationUsable(invitation, now);
    ensurePasswordAcceptable(password, invitation!.staffEmail);
    const passwordHash = await passwords.hash(password);
    return this.db.transaction(async (tx) => {
      if (!(await new DrizzleInvitationRepository(tx).accept(invitation!.id, now))) {
        ensureInvitationUsable(null, now);
      }
      const staff = new DrizzleStaffRepository(tx);
      await staff.setPassword(invitation!.staffId, passwordHash);
      const record = (await staff.findAuthById(invitation!.staffId))!;
      if (record.name !== name) await staff.update(record.id, record.version, { name });
      await new DrizzleAuditLogRepository(tx).append(
        auditEntry({
          staffId: record.id,
          action: 'staff.invitation_accepted',
          entityType: 'staff',
          entityId: record.id,
          data: {},
        }),
      );
      return this.secondStep(staff, { ...record, totpConfirmed: false }, false, now);
    });
  }

  /** Token drugiego kroku; przy konfiguracji TOTP nowy, jeszcze niepotwierdzony sekret. */
  private async secondStep(
    staff: DrizzleStaffRepository,
    record: StaffAuthRecord,
    remember: boolean,
    now: Date,
  ): Promise<StaffLoginStep> {
    const step = nextStepAfterPassword(record.totpConfirmed);
    let totpSetup: TotpSetup | null = null;
    if (step === 'TOTP_SETUP') {
      const secret = generateTotpSecret();
      await staff.setPendingTotp(record.id, this.box.encrypt(secret));
      totpSetup = { secret, otpauthUrl: otpauthUrl(TOTP_ISSUER, record.email, secret) };
    }
    return {
      step,
      mfaToken: this.jwt.sign({ sub: record.id, typ: 'staff_mfa', step, remember }, MFA_TOKEN_SECONDS, now),
      email: record.email,
      totpSetup,
    };
  }

  private async openSession(
    tx: DbExecutor,
    staffId: string,
    remember: boolean,
    userAgent: string | null,
    now: Date,
  ): Promise<StaffSessionWithRefresh> {
    const token = generateToken();
    const expiresAt = refreshExpiresAt('STAFF', now, remember);
    const session = await new DrizzleStaffSessionRepository(tx).create({
      ownerId: staffId,
      tokenHash: hashToken(token),
      expiresAt,
      device: userAgent,
    });
    return this.session(tx, staffId, session.id, token, expiresAt, now);
  }

  private async session(
    tx: DbExecutor,
    staffId: string,
    sessionId: string,
    refreshToken: string,
    refreshExpiresAt: Date,
    now: Date,
  ): Promise<StaffSessionWithRefresh> {
    return {
      accessToken: this.jwt.sign({ sub: staffId, typ: 'staff', sid: sessionId }, SESSION_POLICY.accessTokenSeconds, now),
      expiresInSeconds: SESSION_POLICY.accessTokenSeconds,
      staff: await this.me(staffId, tx),
      refreshToken,
      refreshExpiresAt,
    };
  }
}
