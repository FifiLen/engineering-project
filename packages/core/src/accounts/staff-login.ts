import { DomainError } from '../errors.js';

/**
 * Logowanie operatora (ADR 0019): e-mail i hasło, potem kod TOTP. Hasło skraca argon2, a kod TOTP
 * liczy adapter w API (HMAC); tutaj są reguły blokady, okna TOTP, zaproszeń i siły hasła.
 */
export const STAFF_LOGIN_POLICY = {
  maxFailedAttempts: 5,
  lockMinutes: 15,
  invitationHours: 72,
  minPasswordLength: 12,
  /** Górna granica chroni przed kosztownym skracaniem bardzo długich ciągów. */
  maxPasswordLength: 128,
  totpStepSeconds: 30,
  /** Akceptujemy kod z kroku poprzedniego i następnego (różnica zegarów telefonu i serwera). */
  totpWindow: 1,
  totpDigits: 6,
} as const;

export function normalizeEmail(input: string): string {
  return input.trim().toLowerCase();
}

export interface StaffLoginState {
  active: boolean;
  /** Hasło jest ustawione dopiero po przyjęciu zaproszenia. */
  passwordSet: boolean;
  failedLogins: number;
  lockedUntil: Date | null;
}

/**
 * Czy operator może teraz podać hasło albo kod. Konto nieaktywne i zaproszone dają ten sam błąd
 * co złe hasło, żeby logowanie nie zdradzało, które adresy mają konto.
 */
export function ensureStaffCanAttemptLogin(staff: StaffLoginState | null, now: Date): void {
  if (!staff || !staff.active || !staff.passwordSet) throw new DomainError('INVALID_CREDENTIALS');
  if (staff.lockedUntil && staff.lockedUntil.getTime() > now.getTime()) {
    throw new DomainError('ACCOUNT_LOCKED', {
      retryAfterSeconds: Math.ceil((staff.lockedUntil.getTime() - now.getTime()) / 1000),
    });
  }
}

export interface FailedLoginOutcome {
  failedLogins: number;
  lockedUntil: Date | null;
  error: DomainError;
}

/**
 * Nieudana próba (hasło albo kod TOTP liczą się razem). Po wyczerpaniu prób konto jest blokowane
 * na kwadrans, a licznik zaczyna się od zera po odblokowaniu.
 */
export function registerFailedLogin(
  staff: Pick<StaffLoginState, 'failedLogins' | 'lockedUntil'>,
  step: 'PASSWORD' | 'TOTP',
  now: Date,
): FailedLoginOutcome {
  const lockExpired = staff.lockedUntil !== null && staff.lockedUntil.getTime() <= now.getTime();
  const failed = (lockExpired ? 0 : staff.failedLogins) + 1;
  if (failed >= STAFF_LOGIN_POLICY.maxFailedAttempts) {
    const lockedUntil = new Date(now.getTime() + STAFF_LOGIN_POLICY.lockMinutes * 60 * 1000);
    return {
      failedLogins: 0,
      lockedUntil,
      error: new DomainError('ACCOUNT_LOCKED', { retryAfterSeconds: STAFF_LOGIN_POLICY.lockMinutes * 60 }),
    };
  }
  const attemptsLeft = STAFF_LOGIN_POLICY.maxFailedAttempts - failed;
  const code = step === 'PASSWORD' ? 'INVALID_CREDENTIALS' : 'TOTP_INVALID';
  // Liczbę prób pokazujemy tylko przy kodzie TOTP: przy haśle zdradzałaby, że konto istnieje.
  return {
    failedLogins: failed,
    lockedUntil: null,
    error: new DomainError(code, step === 'TOTP' ? { attemptsLeft } : undefined),
  };
}

/** Po haśle: kod z aplikacji albo, gdy TOTP nie jest jeszcze potwierdzony, jego konfiguracja. */
export function nextStepAfterPassword(totpConfirmed: boolean): 'TOTP' | 'TOTP_SETUP' {
  return totpConfirmed ? 'TOTP' : 'TOTP_SETUP';
}

/** Numer kroku TOTP (RFC 6238) dla chwili `now`. */
export function totpStep(now: Date): number {
  return Math.floor(now.getTime() / 1000 / STAFF_LOGIN_POLICY.totpStepSeconds);
}

/** Kroki, których kody adapter porównuje z wpisanym, od bieżącego. */
export function totpCandidateSteps(now: Date): number[] {
  const current = totpStep(now);
  const steps = [current];
  for (let d = 1; d <= STAFF_LOGIN_POLICY.totpWindow; d++) steps.push(current - d, current + d);
  return steps;
}

/**
 * Kod TOTP z kroku, który już raz posłużył do logowania, jest odrzucany: podsłuchany kod nie
 * pozwoli zalogować się drugi raz w tym samym oknie.
 */
export function ensureTotpStepUnused(matchedStep: number, lastUsedStep: number | null): void {
  if (lastUsedStep !== null && matchedStep <= lastUsedStep) throw new DomainError('TOTP_INVALID', { reason: 'REUSED' });
}

export function isTotpCodeFormat(code: string): boolean {
  return new RegExp(`^\\d{${STAFF_LOGIN_POLICY.totpDigits}}$`).test(code);
}

export type PasswordProblem = 'TOO_SHORT' | 'TOO_LONG' | 'CONTAINS_EMAIL';

/** Wymagania z ekranu aktywacji konta; zwraca wszystkie niespełnione, żeby pokazać je naraz. */
export function passwordProblems(password: string, email: string): PasswordProblem[] {
  const problems: PasswordProblem[] = [];
  const length = [...password].length;
  if (length < STAFF_LOGIN_POLICY.minPasswordLength) problems.push('TOO_SHORT');
  if (length > STAFF_LOGIN_POLICY.maxPasswordLength) problems.push('TOO_LONG');
  const local = normalizeEmail(email).split('@')[0] ?? '';
  const lower = password.toLowerCase();
  if (lower.includes(normalizeEmail(email)) || (local.length >= 4 && lower.includes(local))) problems.push('CONTAINS_EMAIL');
  return problems;
}

export function ensurePasswordAcceptable(password: string, email: string): void {
  const problems = passwordProblems(password, email);
  if (problems.length > 0) throw new DomainError('WEAK_PASSWORD', { problems });
}

export function invitationExpiresAt(now: Date): Date {
  return new Date(now.getTime() + STAFF_LOGIN_POLICY.invitationHours * 60 * 60 * 1000);
}

export interface InvitationState {
  expiresAt: Date;
  acceptedAt: Date | null;
  revokedAt: Date | null;
  staffActive: boolean;
}

/** Zaproszenie da się przyjąć raz, przed wygaśnięciem, dla aktywnego konta. */
export function ensureInvitationUsable(invitation: InvitationState | null, now: Date): void {
  if (!invitation || invitation.acceptedAt || invitation.revokedAt || !invitation.staffActive) {
    throw new DomainError('INVITATION_INVALID');
  }
  if (invitation.expiresAt.getTime() <= now.getTime()) throw new DomainError('INVITATION_EXPIRED');
}

/**
 * Ponowne zaproszenie ma sens tylko dla konta, które jeszcze nie ustawiło hasła; aktywny operator,
 * który zgubił telefon, dostaje reset TOTP, a nie nowe zaproszenie.
 */
export function ensureCanInvite(staff: { active: boolean; passwordSet: boolean }): void {
  if (!staff.active) throw new DomainError('STAFF_INACTIVE');
  if (staff.passwordSet) throw new DomainError('STAFF_ALREADY_ACTIVATED');
}
