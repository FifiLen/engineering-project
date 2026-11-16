import { DomainError } from '../errors.js';

/**
 * Jednorazowy kod SMS do logowania i rejestracji klienta (ADR 0019). Kod losuje i skraca adapter
 * w API; tutaj są reguły: ważność, limit prób, odstęp między kodami i limit kodów na numer.
 */
export const OTP_POLICY = {
  length: 6,
  ttlSeconds: 5 * 60,
  maxAttempts: 5,
  resendCooldownSeconds: 60,
  maxCodesPerHour: 5,
} as const;

const HOUR_MS = 60 * 60 * 1000;

/** Numer w formacie E.164. Dziewięć cyfr bez prefiksu to numer polski (+48), jak w polu na makiecie. */
export function normalizePhone(input: string): string {
  const compact = input.replace(/[\s\-()]/g, '');
  const withPlus = compact.startsWith('00') ? `+${compact.slice(2)}` : compact;
  const e164 = /^\d{9}$/.test(withPlus) ? `+48${withPlus}` : withPlus;
  if (!/^\+[1-9]\d{7,14}$/.test(e164)) throw new DomainError('INVALID_PHONE');
  if (e164.startsWith('+48') && e164.length !== 12) throw new DomainError('INVALID_PHONE');
  return e164;
}

export function isOtpCodeFormat(code: string): boolean {
  return new RegExp(`^\\d{${OTP_POLICY.length}}$`).test(code);
}

export function otpExpiresAt(now: Date): Date {
  return new Date(now.getTime() + OTP_POLICY.ttlSeconds * 1000);
}

/**
 * Czy można wysłać nowy kod na numer. `issuedAt` to czasy wysłania kodów na ten numer (wystarczy
 * ostatnia godzina). Przekroczenie kończy się `RATE_LIMITED` z czasem, po którym można spróbować ponownie.
 */
export function ensureCanIssueOtp(issuedAt: readonly Date[], now: Date): void {
  const recent = issuedAt.filter((t) => now.getTime() - t.getTime() < HOUR_MS).sort((a, b) => a.getTime() - b.getTime());
  const last = recent.at(-1);
  if (last) {
    const cooldownEnd = last.getTime() + OTP_POLICY.resendCooldownSeconds * 1000;
    if (cooldownEnd > now.getTime()) throw rateLimited('OTP_COOLDOWN', cooldownEnd - now.getTime());
  }
  if (recent.length >= OTP_POLICY.maxCodesPerHour) {
    // Kolejny kod będzie możliwy, gdy najstarszy z ostatniej godziny wypadnie z okna.
    const oldest = recent[recent.length - OTP_POLICY.maxCodesPerHour]!;
    throw rateLimited('OTP_HOURLY_LIMIT', oldest.getTime() + HOUR_MS - now.getTime());
  }
}

/** Ile kodów można jeszcze wysłać na numer w ciągu godziny (tekst pod przyciskiem „Wyślij nowy kod”). */
export function remainingOtpCodes(issuedAt: readonly Date[], now: Date): number {
  const recent = issuedAt.filter((t) => now.getTime() - t.getTime() < HOUR_MS).length;
  return Math.max(0, OTP_POLICY.maxCodesPerHour - recent);
}

export interface OtpState {
  attempts: number;
  expiresAt: Date;
  consumedAt: Date | null;
}

export type OtpAttemptResult =
  | { accepted: true }
  /** `countAttempt`: próbę trzeba zapisać w bazie, zanim błąd trafi do klienta. */
  | { accepted: false; countAttempt: boolean; error: DomainError };

/**
 * Ocena wpisanego kodu. `matches` mówi, czy skrót wpisanego kodu zgadza się z zapisanym
 * (porównanie w stałym czasie robi adapter). Kod zużyty, przeterminowany albo z wyczerpanymi
 * próbami jest odrzucany bez liczenia próby, nawet gdy pasuje.
 */
export function assessOtpAttempt(otp: OtpState, matches: boolean, now: Date): OtpAttemptResult {
  if (otp.consumedAt) return { accepted: false, countAttempt: false, error: new DomainError('OTP_EXPIRED') };
  if (otp.attempts >= OTP_POLICY.maxAttempts) {
    return { accepted: false, countAttempt: false, error: new DomainError('OTP_ATTEMPTS_EXCEEDED') };
  }
  if (otp.expiresAt.getTime() <= now.getTime()) {
    return { accepted: false, countAttempt: false, error: new DomainError('OTP_EXPIRED') };
  }
  if (matches) return { accepted: true };
  const attemptsLeft = OTP_POLICY.maxAttempts - otp.attempts - 1;
  return {
    accepted: false,
    countAttempt: true,
    error: attemptsLeft > 0 ? new DomainError('OTP_INVALID', { attemptsLeft }) : new DomainError('OTP_ATTEMPTS_EXCEEDED'),
  };
}

function rateLimited(reason: 'OTP_COOLDOWN' | 'OTP_HOURLY_LIMIT', waitMs: number): DomainError {
  return new DomainError('RATE_LIMITED', { reason, retryAfterSeconds: Math.ceil(waitMs / 1000) });
}
