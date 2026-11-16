import { describe, expect, it } from 'vitest';
import {
  ensureCanInvite,
  ensureInvitationUsable,
  ensurePasswordAcceptable,
  ensureStaffCanAttemptLogin,
  ensureTotpStepUnused,
  invitationExpiresAt,
  nextStepAfterPassword,
  normalizeEmail,
  passwordProblems,
  registerFailedLogin,
  totpCandidateSteps,
  totpStep,
} from './staff-login.js';

const t0 = new Date('2026-11-16T12:00:00Z');
const after = (seconds: number) => new Date(t0.getTime() + seconds * 1000);
const err = (code: string, details?: Record<string, unknown>) =>
  expect.objectContaining(details ? { code, details: expect.objectContaining(details) } : { code });

describe('logowanie operatora', () => {
  const staff = { active: true, passwordSet: true, failedLogins: 0, lockedUntil: null };

  it('konto nieistniejące, nieaktywne i zaproszone dają ten sam błąd co złe hasło', () => {
    expect(() => ensureStaffCanAttemptLogin(staff, t0)).not.toThrow();
    for (const s of [null, { ...staff, active: false }, { ...staff, passwordSet: false }]) {
      expect(() => ensureStaffCanAttemptLogin(s, t0)).toThrow(err('INVALID_CREDENTIALS'));
    }
  });

  it('po 5 nieudanych próbach blokuje konto na 15 minut', () => {
    let state: { failedLogins: number; lockedUntil: Date | null } = staff;
    for (let i = 1; i <= 4; i++) {
      const outcome = registerFailedLogin(state, 'TOTP', t0);
      expect(outcome.error).toEqual(err('TOTP_INVALID', { attemptsLeft: 5 - i }));
      state = outcome;
    }
    const locked = registerFailedLogin(state, 'PASSWORD', t0);
    expect(locked.lockedUntil).toEqual(after(900));
    expect(locked.error).toEqual(err('ACCOUNT_LOCKED', { retryAfterSeconds: 900 }));
    expect(() => ensureStaffCanAttemptLogin({ ...staff, ...locked }, after(600))).toThrow(
      err('ACCOUNT_LOCKED', { retryAfterSeconds: 300 }),
    );
    expect(() => ensureStaffCanAttemptLogin({ ...staff, ...locked }, after(900))).not.toThrow();
    // Pierwsza pomyłka po odblokowaniu liczy się od nowa.
    expect(registerFailedLogin(locked, 'PASSWORD', after(900)).failedLogins).toBe(1);
  });

  it('błąd hasła nie zdradza liczby pozostałych prób', () => {
    const outcome = registerFailedLogin(staff, 'PASSWORD', t0);
    expect(outcome.error.code).toBe('INVALID_CREDENTIALS');
    expect(outcome.error.details).toBeUndefined();
  });

  it('po haśle prosi o kod albo o konfigurację TOTP', () => {
    expect(nextStepAfterPassword(true)).toBe('TOTP');
    expect(nextStepAfterPassword(false)).toBe('TOTP_SETUP');
  });

  it('sprawdza kod z bieżącego, poprzedniego i następnego kroku 30 s i nie przyjmuje go drugi raz', () => {
    const step = totpStep(t0);
    expect(step).toBe(Math.floor(t0.getTime() / 30000));
    expect(totpCandidateSteps(t0)).toEqual([step, step - 1, step + 1]);
    expect(() => ensureTotpStepUnused(step, null)).not.toThrow();
    expect(() => ensureTotpStepUnused(step, step - 1)).not.toThrow();
    expect(() => ensureTotpStepUnused(step, step)).toThrow(err('TOTP_INVALID', { reason: 'REUSED' }));
    expect(() => ensureTotpStepUnused(step - 1, step)).toThrow(err('TOTP_INVALID'));
  });

  it('normalizuje adres e-mail', () => {
    expect(normalizeEmail('  Marta.W@Operator.PL ')).toBe('marta.w@operator.pl');
  });
});

describe('hasło i zaproszenie operatora', () => {
  it('wymaga co najmniej 12 znaków i hasła innego niż adres e-mail', () => {
    expect(passwordProblems('krótkie', 'kamil.nowak@operator.pl')).toEqual(['TOO_SHORT']);
    expect(passwordProblems('Kamil.Nowak-2026!', 'kamil.nowak@operator.pl')).toEqual(['CONTAINS_EMAIL']);
    expect(passwordProblems('zielony-tramwaj-rybnik', 'kamil.nowak@operator.pl')).toEqual([]);
    expect(passwordProblems('x'.repeat(129), 'a@b.pl')).toEqual(['TOO_LONG']);
    expect(() => ensurePasswordAcceptable('krótkie', 'a@b.pl')).toThrow(err('WEAK_PASSWORD', { problems: ['TOO_SHORT'] }));
  });

  it('zaproszenie jest ważne 72 godziny i da się je przyjąć raz', () => {
    const invitation = { expiresAt: invitationExpiresAt(t0), acceptedAt: null, revokedAt: null, staffActive: true };
    expect(invitation.expiresAt).toEqual(after(72 * 3600));
    expect(() => ensureInvitationUsable(invitation, after(3600))).not.toThrow();
    expect(() => ensureInvitationUsable(invitation, after(72 * 3600))).toThrow(err('INVITATION_EXPIRED'));
    expect(() => ensureInvitationUsable({ ...invitation, acceptedAt: t0 }, t0)).toThrow(err('INVITATION_INVALID'));
    expect(() => ensureInvitationUsable({ ...invitation, revokedAt: t0 }, t0)).toThrow(err('INVITATION_INVALID'));
    expect(() => ensureInvitationUsable({ ...invitation, staffActive: false }, t0)).toThrow(err('INVITATION_INVALID'));
    expect(() => ensureInvitationUsable(null, t0)).toThrow(err('INVITATION_INVALID'));
  });

  it('nowe zaproszenie tylko dla aktywnego konta bez hasła', () => {
    expect(() => ensureCanInvite({ active: true, passwordSet: false })).not.toThrow();
    expect(() => ensureCanInvite({ active: true, passwordSet: true })).toThrow(err('STAFF_ALREADY_ACTIVATED'));
    expect(() => ensureCanInvite({ active: false, passwordSet: false })).toThrow(err('STAFF_INACTIVE'));
  });
});
