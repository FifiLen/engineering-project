import { describe, expect, it } from 'vitest';
import {
  assessOtpAttempt,
  ensureCanIssueOtp,
  isOtpCodeFormat,
  normalizePhone,
  OTP_POLICY,
  otpExpiresAt,
  remainingOtpCodes,
} from './otp.js';
import { assessRefresh, refreshExpiresAt, SESSION_POLICY } from './sessions.js';
import {
  customerNextStep,
  ensureAcceptingCurrentVersion,
  ensureCanBlock,
  ensureCanUnblock,
  ensureConsentRevocable,
  ensureCustomerCanRent,
  ensureRegistrationComplete,
  missingRequiredConsents,
  staffConsentRevocation,
  type ConsentStatus,
} from './customers.js';
import { ensureCanStartDraft, ensureDraftEditable, ensurePublishable, nextVersionNo } from './legal-documents.js';

const t0 = new Date('2026-11-16T12:00:00Z');
const after = (seconds: number) => new Date(t0.getTime() + seconds * 1000);
const err = (code: string, details?: Record<string, unknown>) =>
  expect.objectContaining(details ? { code, details: expect.objectContaining(details) } : { code });

describe('kod SMS', () => {
  it('normalizuje numer do E.164, polski numer bez prefiksu dostaje +48', () => {
    expect(normalizePhone('512 345 678')).toBe('+48512345678');
    expect(normalizePhone('+48 512-345-678')).toBe('+48512345678');
    expect(normalizePhone('0048512345678')).toBe('+48512345678');
    expect(normalizePhone('+420601234567')).toBe('+420601234567');
    for (const bad of ['12345', '+48 512 345 67', 'abc', '+0123456789', '+4851234567890']) {
      expect(() => normalizePhone(bad), bad).toThrow(err('INVALID_PHONE'));
    }
  });

  it('ma 6 cyfr i jest ważny 5 minut', () => {
    expect(isOtpCodeFormat('048213')).toBe(true);
    expect(isOtpCodeFormat('4821')).toBe(false);
    expect(isOtpCodeFormat('48213a')).toBe(false);
    expect(otpExpiresAt(t0)).toEqual(after(300));
  });

  it('pilnuje odstępu między kodami i limitu kodów na godzinę', () => {
    expect(() => ensureCanIssueOtp([], t0)).not.toThrow();
    expect(() => ensureCanIssueOtp([after(-30)], t0)).toThrow(
      err('RATE_LIMITED', { reason: 'OTP_COOLDOWN', retryAfterSeconds: 30 }),
    );
    expect(() => ensureCanIssueOtp([after(-60)], t0)).not.toThrow();

    const five = [-3000, -2400, -1800, -1200, -600].map(after);
    // Najstarszy kod (50 min temu) wypadnie z okna godziny za 10 minut.
    expect(() => ensureCanIssueOtp(five, t0)).toThrow(
      err('RATE_LIMITED', { reason: 'OTP_HOURLY_LIMIT', retryAfterSeconds: 600 }),
    );
    expect(remainingOtpCodes(five, t0)).toBe(0);
    expect(remainingOtpCodes([after(-3700), after(-600)], t0)).toBe(4);
    expect(() => ensureCanIssueOtp([after(-3700), ...five.slice(1)], t0)).not.toThrow();
  });

  it('przyjmuje dobry kod, a zły liczy jako próbę z liczbą pozostałych', () => {
    const otp = { attempts: 0, expiresAt: after(300), consumedAt: null };
    expect(assessOtpAttempt(otp, true, t0)).toEqual({ accepted: true });
    expect(assessOtpAttempt(otp, false, t0)).toEqual({
      accepted: false,
      countAttempt: true,
      error: err('OTP_INVALID', { attemptsLeft: 4 }),
    });
    expect(assessOtpAttempt({ ...otp, attempts: OTP_POLICY.maxAttempts - 1 }, false, t0)).toMatchObject({
      countAttempt: true,
      error: err('OTP_ATTEMPTS_EXCEEDED'),
    });
  });

  it('odrzuca bez liczenia próby kod zużyty, przeterminowany i po wyczerpaniu prób, nawet gdy pasuje', () => {
    const otp = { attempts: 0, expiresAt: after(300), consumedAt: null };
    expect(assessOtpAttempt({ ...otp, consumedAt: t0 }, true, t0)).toMatchObject({ countAttempt: false, error: err('OTP_EXPIRED') });
    expect(assessOtpAttempt(otp, true, after(300))).toMatchObject({ countAttempt: false, error: err('OTP_EXPIRED') });
    expect(assessOtpAttempt({ ...otp, attempts: 5 }, true, t0)).toMatchObject({
      countAttempt: false,
      error: err('OTP_ATTEMPTS_EXCEEDED'),
    });
  });
});

describe('sesje i rotacja tokenu odświeżającego', () => {
  const session = { expiresAt: after(3600), revokedAt: null, replacedBy: null };

  it('wydaje token klienta na 30 dni, a operatora na zmianę albo 7 dni po zapamiętaniu urządzenia', () => {
    expect(refreshExpiresAt('CUSTOMER', t0)).toEqual(after(30 * 86400));
    expect(refreshExpiresAt('STAFF', t0)).toEqual(after(12 * 3600));
    expect(refreshExpiresAt('STAFF', t0, true)).toEqual(after(7 * 86400));
  });

  it('rotuje ważny token', () => {
    expect(assessRefresh(session, t0)).toEqual({ action: 'ROTATE' });
  });

  it('ponowne użycie zastąpionego tokenu unieważnia całą rodzinę', () => {
    const rotated = { ...session, revokedAt: after(-60), replacedBy: 'next' };
    expect(assessRefresh(rotated, t0)).toEqual({
      action: 'REJECT',
      revokeFamily: true,
      error: err('UNAUTHENTICATED', { reason: 'SESSION_REUSED' }),
    });
  });

  it('równoległe odświeżenie tuż po rotacji nie unieważnia rodziny', () => {
    const justRotated = { ...session, revokedAt: after(-SESSION_POLICY.reuseGraceSeconds), replacedBy: 'next' };
    expect(assessRefresh(justRotated, t0)).toMatchObject({ revokeFamily: false, error: err('UNAUTHENTICATED', { reason: 'SESSION_ROTATED' }) });
  });

  it('odrzuca token unieważniony i przeterminowany', () => {
    expect(assessRefresh({ ...session, revokedAt: after(-5) }, t0)).toMatchObject({
      revokeFamily: false,
      error: err('UNAUTHENTICATED', { reason: 'SESSION_REVOKED' }),
    });
    expect(assessRefresh({ ...session, expiresAt: t0 }, t0)).toMatchObject({
      error: err('UNAUTHENTICATED', { reason: 'SESSION_EXPIRED' }),
    });
  });
});

describe('konto klienta', () => {
  const all: ConsentStatus[] = [
    { type: 'TERMS', isCurrent: true },
    { type: 'PRIVACY', isCurrent: true },
    { type: 'AGE', isCurrent: true },
  ];

  it('kieruje nowego klienta do danych, a po nowej wersji dokumentu do akceptacji', () => {
    expect(customerNextStep({ status: 'ACTIVE', name: null }, [])).toBe('PROFILE');
    expect(customerNextStep({ status: 'ACTIVE', name: 'Anna' }, all)).toBe('READY');
    const outdated = all.map((c) => (c.type === 'TERMS' ? { ...c, isCurrent: false } : c));
    expect(customerNextStep({ status: 'ACTIVE', name: 'Anna' }, outdated)).toBe('CONSENTS');
    expect(missingRequiredConsents(outdated)).toEqual(['TERMS']);
    expect(customerNextStep({ status: 'BLOCKED', name: 'Anna' }, all)).toBe('BLOCKED');
  });

  it('wypożyczenie wymaga aktywnego konta i aktualnych zgód; marketing jest dobrowolny', () => {
    expect(() => ensureCustomerCanRent({ status: 'ACTIVE', name: 'Anna' }, all)).not.toThrow();
    expect(() => ensureCustomerCanRent({ status: 'BLOCKED', name: 'Anna' }, all)).toThrow(err('ACCOUNT_BLOCKED'));
    expect(() => ensureCustomerCanRent({ status: 'ACTIVE', name: 'Anna' }, all.slice(1))).toThrow(
      err('CONSENT_REQUIRED', { missing: ['TERMS'] }),
    );
    expect(() => ensureConsentRevocable('MARKETING')).not.toThrow();
    expect(() => ensureConsentRevocable('TERMS')).toThrow(err('CONSENT_REQUIRED_FOR_ACCOUNT'));
  });

  it('operator wycofuje tylko zgodę marketingową, a powtórne wycofanie niczego nie zmienia (ADR 0076)', () => {
    expect(staffConsentRevocation('MARKETING', null)).toBe('REVOKE');
    expect(staffConsentRevocation('MARKETING', t0)).toBe('UNCHANGED');
    for (const type of ['TERMS', 'PRIVACY', 'AGE'] as const) {
      expect(() => staffConsentRevocation(type, null)).toThrow(err('CONSENT_NOT_REVOCABLE', { type }));
    }
  });

  it('rejestracja wymaga imienia, potwierdzenia wieku i akceptacji regulaminu i polityki', () => {
    const input = { name: 'Anna', ageConfirmed: true, acceptedDocuments: ['TERMS', 'PRIVACY'] as const };
    expect(() => ensureRegistrationComplete(input)).not.toThrow();
    expect(() => ensureRegistrationComplete({ ...input, name: '  ' })).toThrow(err('VALIDATION_FAILED'));
    expect(() => ensureRegistrationComplete({ ...input, ageConfirmed: false })).toThrow(err('AGE_NOT_CONFIRMED'));
    expect(() => ensureRegistrationComplete({ ...input, acceptedDocuments: ['TERMS'] })).toThrow(
      err('CONSENT_REQUIRED', { missing: ['PRIVACY'] }),
    );
  });

  it('akceptowana wersja dokumentu musi być obowiązująca', () => {
    expect(() => ensureAcceptingCurrentVersion('v4', 'v4')).not.toThrow();
    expect(() => ensureAcceptingCurrentVersion('v3', 'v4')).toThrow(err('DOCUMENT_VERSION_OUTDATED', { currentVersionId: 'v4' }));
    expect(() => ensureAcceptingCurrentVersion('v3', null)).toThrow(err('DOCUMENT_NOT_PUBLISHED'));
  });

  it('blokuje tylko aktywne konto i odblokowuje tylko zablokowane', () => {
    expect(() => ensureCanBlock('ACTIVE')).not.toThrow();
    expect(() => ensureCanBlock('BLOCKED')).toThrow(err('ALREADY_BLOCKED'));
    expect(() => ensureCanBlock('DELETED')).toThrow(err('USER_DELETED'));
    expect(() => ensureCanUnblock('BLOCKED')).not.toThrow();
    expect(() => ensureCanUnblock('ACTIVE')).toThrow(err('NOT_BLOCKED'));
  });
});

describe('dokumenty z wersjami', () => {
  const draft = { status: 'DRAFT' as const, title: 'Regulamin', bodyMd: 'Treść', changeSummary: null };

  it('opublikowanej i archiwalnej wersji nie da się edytować', () => {
    expect(() => ensureDraftEditable(draft)).not.toThrow();
    expect(() => ensureDraftEditable({ status: 'PUBLISHED' })).toThrow(err('DOCUMENT_VERSION_LOCKED'));
    expect(() => ensureCanStartDraft(true)).toThrow(err('DRAFT_EXISTS'));
  });

  it('kolejna wersja dokumentu ze zgodą wymaga najważniejszych zmian', () => {
    expect(() => ensurePublishable(draft, true, true)).not.toThrow();
    expect(() => ensurePublishable(draft, true, false)).toThrow(err('VALIDATION_FAILED', { fields: ['changeSummary'] }));
    expect(() => ensurePublishable(draft, false, false)).not.toThrow();
    expect(() => ensurePublishable({ ...draft, bodyMd: ' ' }, false, true)).toThrow(err('VALIDATION_FAILED', { fields: ['bodyMd'] }));
    expect(nextVersionNo(null)).toBe(1);
    expect(nextVersionNo(3)).toBe(4);
  });
});
