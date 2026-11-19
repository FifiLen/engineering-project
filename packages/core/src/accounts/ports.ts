/**
 * Porty modułów Konta i Dostęp (ADR 0025). Implementacje są w packages/db i przyjmują bazę albo
 * transakcję, więc serwis w API składa zmianę i wpis dziennika audytu w jedną jednostkę pracy.
 * Odczyty list i szczegółów dla panelu idą wspólnym mechanizmem list (ADR 0031) i nie mają portu.
 */
import type { Permission } from '../access/permissions.js';
import type { StaffAccess } from '../access/roles.js';
import type { AuditEntry } from '../audit/audit.js';
import type { BlockReason, ConsentStatus, ConsentType, CustomerState } from './customers.js';
import type { DocumentVersionState } from './legal-documents.js';
import type { OtpState } from './otp.js';
import type { RefreshSessionState } from './sessions.js';
import type { StaffLoginState } from './staff-login.js';

// --- Kody SMS ---------------------------------------------------------------------------------

export interface OtpRecord extends OtpState {
  id: string;
  codeHash: string;
}

export interface OtpRepository {
  /** Czasy wysłania kodów na numer od `since` (limity wysyłek). */
  issuedSince(phone: string, since: Date): Promise<Date[]>;
  /** `purpose`: `REGISTER`, gdy numer nie ma konta (lista Kody SMS, ADR 0076); domyślnie logowanie. */
  create(phone: string, codeHash: string, expiresAt: Date, purpose?: 'LOGIN' | 'REGISTER'): Promise<{ id: string }>;
  /** Najnowszy kod wysłany na numer; tylko on może posłużyć do logowania. */
  findLatest(phone: string): Promise<OtpRecord | null>;
  countAttempt(id: string): Promise<void>;
  /** `false`, gdy kod został już zużyty (dwa równoległe potwierdzenia). */
  consume(id: string, now: Date): Promise<boolean>;
}

// --- Sesje (klienci i operatorzy) -------------------------------------------------------------

export interface SessionRecord extends RefreshSessionState {
  id: string;
  ownerId: string;
  familyId: string;
}

export interface NewSession {
  ownerId: string;
  /** Rodzina sesji poprzednika przy rotacji; przy logowaniu powstaje nowa. */
  familyId?: string;
  tokenHash: string;
  expiresAt: Date;
  /** Nazwa urządzenia z aplikacji albo przeglądarka panelu. */
  device: string | null;
  /**
   * Platforma i wersja aplikacji klienta z żądania logowania albo odświeżenia (ADR 0076, opcjonalne). Przy rotacji
   * bez nich następca dziedziczy wartości poprzednika, tak samo jak nazwę urządzenia.
   */
  platform?: 'IOS' | 'ANDROID' | 'WEB' | null;
  appVersion?: string | null;
  /** Sesja operatora z „Zapamiętaj to urządzenie” (7 dni zamiast 12 h); rotacja zachowuje wartość poprzednika. */
  remembered?: boolean;
}

export interface SessionRepository {
  create(session: NewSession): Promise<{ id: string; familyId: string }>;
  findByTokenHash(tokenHash: string): Promise<SessionRecord | null>;
  /**
   * Zastąpienie tokenu następcą w tej samej rodzinie (unieważnia poprzednika i wskazuje następcę).
   * `null`, gdy poprzednika unieważniło w międzyczasie inne żądanie.
   */
  rotate(previousId: string, next: NewSession, now: Date): Promise<{ id: string; familyId: string } | null>;
  revoke(id: string, now: Date): Promise<void>;
  revokeFamily(familyId: string, now: Date): Promise<number>;
  revokeAllForOwner(ownerId: string): Promise<number>;
}

// --- Klienci i zgody --------------------------------------------------------------------------

export interface CustomerRecord extends CustomerState {
  id: string;
  phone: string | null;
  email: string | null;
  version: number;
}

export interface CustomerRepository {
  findByPhone(phone: string): Promise<CustomerRecord | null>;
  findById(id: string): Promise<CustomerRecord | null>;
  /** Nowe konto po pierwszym potwierdzonym kodzie SMS; drugi wyścig zwraca istniejące konto. */
  createOrGet(phone: string): Promise<{ record: CustomerRecord; created: boolean }>;
  updateProfile(id: string, version: number, changes: { name?: string; email?: string | null }): Promise<boolean>;
  block(id: string, version: number, reason: BlockReason, now: Date): Promise<boolean>;
  unblock(id: string, version: number): Promise<boolean>;
}

export interface CurrentDocument {
  consentType: ConsentType;
  slug: string;
  versionId: string;
  versionNo: number;
  title: string;
  changeSummary: string | null;
}

export interface ConsentRepository {
  statuses(userId: string): Promise<ConsentStatus[]>;
  /** Obowiązujące dokumenty, których aktualnej wersji klient nie zaakceptował. */
  pendingDocuments(userId: string): Promise<CurrentDocument[]>;
  currentDocument(type: ConsentType): Promise<CurrentDocument | null>;
  /** Zapis zgody; powtórzona zgoda na tę samą wersję niczego nie zmienia (idempotencja). */
  accept(
    userId: string,
    type: ConsentType,
    document: Pick<CurrentDocument, 'versionId' | 'versionNo'> | null,
    /** Skąd zgoda (ADR 0076): rejestracja, aplikacja albo panel. */
    source?: 'REGISTRATION' | 'APP' | 'PANEL',
  ): Promise<void>;
  revoke(userId: string, type: ConsentType, now: Date): Promise<number>;
}

// --- Operatorzy, zaproszenia, role ------------------------------------------------------------

export interface StaffAuthRecord extends StaffLoginState {
  id: string;
  email: string;
  name: string;
  passwordHash: string | null;
  totpSecretEnc: string | null;
  totpConfirmed: boolean;
  totpLastStep: number | null;
  version: number;
}

export interface StaffRepository {
  findAuthByEmail(email: string): Promise<StaffAuthRecord | null>;
  findAuthById(id: string): Promise<StaffAuthRecord | null>;
  createInvited(input: { email: string; name: string }): Promise<{ id: string }>;
  recordFailedLogin(id: string, failedLogins: number, lockedUntil: Date | null): Promise<void>;
  /** Udane logowanie: zeruje licznik i zapamiętuje użyty krok TOTP. */
  recordLogin(id: string, now: Date, totpStep: number): Promise<void>;
  setPassword(id: string, passwordHash: string): Promise<void>;
  /** Nowy, jeszcze niepotwierdzony sekret TOTP (konfiguracja albo po resecie). */
  setPendingTotp(id: string, secretEnc: string): Promise<void>;
  confirmTotp(id: string, now: Date, totpStep: number): Promise<void>;
  resetTotp(id: string): Promise<void>;
  update(id: string, version: number, changes: { name?: string; email?: string; active?: boolean }): Promise<boolean>;
  /** Role operatora; zwraca poprzednie identyfikatory ról (do dziennika audytu). */
  setRoles(id: string, roleIds: readonly string[], assignedBy: string): Promise<string[]>;
  /** Wszyscy operatorzy z rolami: stan do reguły ostatniego zarządzającego rolami. */
  accessSnapshot(): Promise<StaffAccess[]>;
  permissions(id: string): Promise<Permission[]>;
}

export interface InvitationRecord {
  id: string;
  staffId: string;
  staffEmail: string;
  staffName: string;
  staffActive: boolean;
  invitedByName: string | null;
  expiresAt: Date;
  acceptedAt: Date | null;
  revokedAt: Date | null;
}

export interface InvitationRepository {
  /** Nowe zaproszenie unieważnia poprzednie otwarte zaproszenie tego operatora. */
  create(
    staffId: string,
    tokenHash: string,
    expiresAt: Date,
    invitedBy: string | null,
    now: Date,
  ): Promise<{ id: string }>;
  findByTokenHash(tokenHash: string): Promise<InvitationRecord | null>;
  accept(id: string, now: Date): Promise<boolean>;
}

export interface RoleRecord {
  id: string;
  name: string;
  description: string | null;
  isSystem: boolean;
  staffCount: number;
  permissions: Permission[];
  version: number;
}

export interface RoleRepository {
  findById(id: string): Promise<RoleRecord | null>;
  /** Uprawnienia każdej roli: stan do reguły ostatniego zarządzającego rolami. */
  permissionMap(): Promise<Map<string, Permission[]>>;
  create(input: { name: string; description: string | null }): Promise<{ id: string }>;
  update(id: string, version: number, changes: { name?: string; description?: string | null }): Promise<boolean>;
  /** Zastępuje uprawnienia roli i zwiększa wersję rekordu roli. */
  setPermissions(id: string, version: number, permissions: readonly Permission[]): Promise<boolean>;
  delete(id: string): Promise<void>;
}

// --- Dokumenty z wersjami ---------------------------------------------------------------------

export interface DocumentVersionRecord extends DocumentVersionState {
  id: string;
  pageId: string;
  versionNo: number;
  /** Blokada optymistyczna wersji roboczej (migracja 0011, ADR 0062). */
  version: number;
}

export interface LegalDocumentRecord {
  id: string;
  slug: string;
  consentType: ConsentType | null;
  draft: DocumentVersionRecord | null;
  published: DocumentVersionRecord | null;
  highestVersionNo: number | null;
}

export interface LegalDocumentRepository {
  findById(pageId: string): Promise<LegalDocumentRecord | null>;
  findVersion(versionId: string, options?: { lock?: boolean }): Promise<DocumentVersionRecord | null>;
  createDraft(
    pageId: string,
    versionNo: number,
    from: Pick<DocumentVersionState, 'title' | 'bodyMd'>,
    createdBy: string,
  ): Promise<{ id: string }>;
  /** Zapis z blokadą optymistyczną; `false` przy niezgodnej wersji. */
  updateDraft(
    versionId: string,
    expectedVersion: number,
    changes: Partial<Pick<DocumentVersionState, 'title' | 'bodyMd' | 'changeSummary'>>,
  ): Promise<boolean>;
  /** Archiwizuje obowiązującą wersję i publikuje roboczą (jedna obowiązująca wersja pilnowana przez bazę). */
  publish(versionId: string, now: Date): Promise<void>;
  deleteDraft(versionId: string): Promise<void>;
}

// --- Dziennik audytu --------------------------------------------------------------------------

export interface AuditLogRepository {
  append(entry: AuditEntry): Promise<void>;
}
