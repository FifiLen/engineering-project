import {
  assessOtpAttempt,
  assessRefresh,
  customerNextStep,
  DOCUMENT_CONSENTS,
  DomainError,
  ensureCanIssueOtp,
  ensureConsentRevocable,
  ensureRegistrationComplete,
  normalizePhone,
  notFound,
  OTP_POLICY,
  otpExpiresAt,
  refreshExpiresAt,
  remainingOtpCodes,
  SESSION_POLICY,
  unauthenticated,
  type CurrentDocument,
  type CustomerRecord,
} from '@hulajnogi/core';
import {
  currentMinUserAge,
  type Database,
  type DbExecutor,
  DrizzleConsentRepository,
  DrizzleCustomerRepository,
  DrizzleCustomerSessionRepository,
  DrizzleLegalDocumentRepository,
  DrizzleOtpRepository,
  generateToken,
  hashToken,
} from '@hulajnogi/db';
import type {
  CustomerSession,
  CustomerTokens,
  LegalDocumentView,
  MeResponse,
  OtpRequestResult,
  ProfileUpdate,
  Registration,
} from '@hulajnogi/shared';
import { Inject, Injectable } from '@nestjs/common';
import { DB } from '../database/database.module.js';
import { JWT, OTP_CODES } from './auth.tokens.js';
import type { JwtCodec } from './crypto/jwt.js';
import type { OtpCodes } from './crypto/secrets.js';
import { SmsGateway } from './sms.gateway.js';

const HOUR_MS = 60 * 60 * 1000;

/**
 * Konto klienta w aplikacji (ADR 0019, ADR 0035): kod SMS, sesje z rotacją tokenu, rejestracja
 * i zgody na obowiązujące wersje dokumentów. Reguły z packages/core, dane z repozytoriów packages/db.
 */
@Injectable()
export class CustomerAuthService {
  constructor(
    @Inject(DB) private readonly db: Database,
    @Inject(JWT) private readonly jwt: JwtCodec,
    @Inject(OTP_CODES) private readonly codes: OtpCodes,
    private readonly sms: SmsGateway,
  ) {}

  async requestOtp(rawPhone: string): Promise<OtpRequestResult> {
    const now = new Date();
    const phone = normalizePhone(rawPhone);
    const otp = new DrizzleOtpRepository(this.db);
    const issued = await otp.issuedSince(phone, new Date(now.getTime() - HOUR_MS));
    ensureCanIssueOtp(issued, now);
    const code = this.codes.generate();
    await otp.create(phone, this.codes.hash(phone, code), otpExpiresAt(now));
    // Treść SMS-a trafi do szablonów powiadomień w iteracji 6 (ADR 0027); kod jest jedyną zmienną.
    await this.sms.send(phone, `[nazwa]: ${code} to Twój kod logowania. Nie podawaj go nikomu.`);
    return {
      phone,
      expiresInSeconds: OTP_POLICY.ttlSeconds,
      resendInSeconds: OTP_POLICY.resendCooldownSeconds,
      remainingCodes: remainingOtpCodes([...issued, now], now),
    };
  }

  async verifyOtp(rawPhone: string, code: string, device: string | null): Promise<CustomerSession> {
    const now = new Date();
    const phone = normalizePhone(rawPhone);
    const otp = new DrizzleOtpRepository(this.db);
    const latest = await otp.findLatest(phone);
    if (!latest) throw new DomainError('OTP_EXPIRED');
    const result = assessOtpAttempt(latest, this.codes.matches(phone, code, latest.codeHash), now);
    if (!result.accepted) {
      if (result.countAttempt) await otp.countAttempt(latest.id);
      throw result.error;
    }
    // Dwa równoległe potwierdzenia tego samego kodu: zalogowane zostaje tylko jedno.
    if (!(await otp.consume(latest.id, now))) throw new DomainError('OTP_EXPIRED');

    return this.db.transaction(async (tx) => {
      const { record, created } = await new DrizzleCustomerRepository(tx).createOrGet(phone);
      const tokens = await this.openSession(tx, record.id, device, now);
      return { ...tokens, me: await this.me(record.id, tx), created };
    });
  }

  /** Rotacja tokenu odświeżającego; ponowne użycie zastąpionego tokenu unieważnia całą rodzinę. */
  async refresh(refreshToken: string, device: string | null = null): Promise<CustomerTokens> {
    const now = new Date();
    const sessions = new DrizzleCustomerSessionRepository(this.db);
    const session = await sessions.findByTokenHash(hashToken(refreshToken));
    if (!session) throw unauthenticated('SESSION_UNKNOWN');
    const decision = assessRefresh(session, now);
    if (decision.action === 'REJECT') {
      // Poza transakcją: unieważnienie rodziny musi zostać zapisane mimo błędu odpowiedzi.
      if (decision.revokeFamily) await sessions.revokeFamily(session.familyId, now);
      throw decision.error;
    }
    return this.db.transaction(async (tx) => {
      const token = generateToken();
      const rotated = await new DrizzleCustomerSessionRepository(tx).rotate(
        session.id,
        {
          ownerId: session.ownerId,
          familyId: session.familyId,
          tokenHash: hashToken(token),
          expiresAt: refreshExpiresAt('CUSTOMER', now),
          device,
        },
        now,
      );
      if (!rotated) throw unauthenticated('SESSION_ROTATED');
      return this.tokens(session.ownerId, rotated.id, token, now);
    });
  }

  /** Wylogowanie z tego urządzenia: unieważnia rodzinę sesji tokenu. */
  async logout(refreshToken: string): Promise<void> {
    const sessions = new DrizzleCustomerSessionRepository(this.db);
    const session = await sessions.findByTokenHash(hashToken(refreshToken));
    if (session) await sessions.revokeFamily(session.familyId, new Date());
  }

  async me(userId: string, db: DbExecutor = this.db): Promise<MeResponse> {
    const record = await new DrizzleCustomerRepository(db).findById(userId);
    if (!record || record.status === 'DELETED') throw unauthenticated('USER_DELETED');
    const consents = new DrizzleConsentRepository(db);
    const [statuses, pending, details, minUserAge] = await Promise.all([
      consents.statuses(userId),
      consents.pendingDocuments(userId),
      new DrizzleCustomerRepository(db).details(userId),
      currentMinUserAge(db),
    ]);
    return {
      id: record.id,
      phone: record.phone!,
      name: record.name,
      email: record.email,
      status: record.status,
      blockedReason: details?.blockedReason ?? null,
      nextStep: customerNextStep(record, statuses),
      pendingDocuments: pending,
      marketingConsent: statuses.some((s) => s.type === 'MARKETING' && s.isCurrent),
      minUserAge,
    };
  }

  /** Ekran danych z makiety `konto-dane`: imię, e-mail, wiek, zgody na dokumenty i dobrowolna marketingowa. */
  async register(userId: string, input: Registration): Promise<MeResponse> {
    const now = new Date();
    return this.db.transaction(async (tx) => {
      const record = await this.activeCustomer(tx, userId);
      const consents = new DrizzleConsentRepository(tx);
      const documents = await this.acceptedDocuments(consents, input.acceptedVersionIds);
      ensureRegistrationComplete({
        name: input.name,
        ageConfirmed: input.ageConfirmed,
        acceptedDocuments: documents.map((d) => d.consentType),
      });
      await this.saveProfile(tx, record, { name: input.name, email: input.email });
      for (const doc of documents) await consents.accept(userId, doc.consentType, doc);
      await consents.accept(userId, 'AGE', null);
      if (input.marketing) await consents.accept(userId, 'MARKETING', null);
      else await consents.revoke(userId, 'MARKETING', now);
      return this.me(userId, tx);
    });
  }

  /** Akceptacja nowych wersji dokumentów (ekran `konto-nowa-wersja`). */
  async acceptDocuments(userId: string, versionIds: readonly string[]): Promise<MeResponse> {
    return this.db.transaction(async (tx) => {
      await this.activeCustomer(tx, userId);
      const consents = new DrizzleConsentRepository(tx);
      const documents = await this.acceptedDocuments(consents, versionIds);
      for (const doc of documents) await consents.accept(userId, doc.consentType, doc);
      return this.me(userId, tx);
    });
  }

  async updateProfile(userId: string, input: ProfileUpdate): Promise<MeResponse> {
    const now = new Date();
    return this.db.transaction(async (tx) => {
      const record = await this.activeCustomer(tx, userId);
      await this.saveProfile(tx, record, { name: input.name, email: input.email });
      const consents = new DrizzleConsentRepository(tx);
      if (input.marketing === true) await consents.accept(userId, 'MARKETING', null);
      if (input.marketing === false) {
        ensureConsentRevocable('MARKETING');
        await consents.revoke(userId, 'MARKETING', now);
      }
      return this.me(userId, tx);
    });
  }

  async legalDocument(slug: string): Promise<LegalDocumentView> {
    const version = await new DrizzleLegalDocumentRepository(this.db).published(slug);
    if (!version) throw notFound('legalDocument', slug);
    return {
      slug,
      title: version.title,
      versionNo: version.versionNo,
      bodyMd: version.bodyMd,
      publishedAt: version.publishedAt.toISOString(),
    };
  }

  private async openSession(tx: DbExecutor, userId: string, device: string | null, now: Date): Promise<CustomerTokens> {
    const token = generateToken();
    const session = await new DrizzleCustomerSessionRepository(tx).create({
      ownerId: userId,
      tokenHash: hashToken(token),
      expiresAt: refreshExpiresAt('CUSTOMER', now),
      device,
    });
    return this.tokens(userId, session.id, token, now);
  }

  private tokens(userId: string, sessionId: string, refreshToken: string, now: Date): CustomerTokens {
    return {
      accessToken: this.jwt.sign({ sub: userId, typ: 'customer', sid: sessionId }, SESSION_POLICY.accessTokenSeconds, now),
      refreshToken,
      expiresInSeconds: SESSION_POLICY.accessTokenSeconds,
    };
  }

  /** Zablokowany klient widzi ekran blokady, ale nie zmienia danych ani zgód. */
  private async activeCustomer(tx: DbExecutor, userId: string): Promise<CustomerRecord> {
    const record = await new DrizzleCustomerRepository(tx).findById(userId);
    if (!record || record.status === 'DELETED') throw unauthenticated('USER_DELETED');
    if (record.status === 'BLOCKED') throw new DomainError('ACCOUNT_BLOCKED');
    return record;
  }

  private async saveProfile(
    tx: DbExecutor,
    record: CustomerRecord,
    changes: { name?: string; email?: string | null },
  ): Promise<void> {
    if (changes.name === undefined && changes.email === undefined) return;
    // Klient edytuje własne dane, więc wersja z bazy (a nie z formularza) wystarcza.
    if (!(await new DrizzleCustomerRepository(tx).updateProfile(record.id, record.version, changes))) {
      throw new DomainError('CONFLICT');
    }
  }

  /**
   * Obowiązujące dokumenty ze zgodą, których wersje klient zaakceptował. Identyfikator wersji, która
   * nie obowiązuje (klient czytał ekran sprzed publikacji), kończy się `DOCUMENT_VERSION_OUTDATED`.
   */
  private async acceptedDocuments(consents: DrizzleConsentRepository, versionIds: readonly string[]) {
    const current: CurrentDocument[] = [];
    for (const type of DOCUMENT_CONSENTS) {
      const doc = await consents.currentDocument(type);
      if (doc) current.push(doc);
    }
    const stale = versionIds.find((id) => !current.some((d) => d.versionId === id));
    if (stale) throw new DomainError('DOCUMENT_VERSION_OUTDATED', { versionId: stale });
    return current.filter((d) => versionIds.includes(d.versionId));
  }
}
