import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto';
import { STAFF_LOGIN_POLICY } from '@hulajnogi/core';

const ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';

/** Base32 (RFC 4648) bez dopełnienia: format sekretu w aplikacjach uwierzytelniających. */
export function base32Encode(data: Buffer): string {
  let bits = 0;
  let value = 0;
  let out = '';
  for (const byte of data) {
    value = (value << 8) | byte;
    bits += 8;
    while (bits >= 5) {
      out += ALPHABET[(value >>> (bits - 5)) & 31];
      bits -= 5;
    }
  }
  if (bits > 0) out += ALPHABET[(value << (5 - bits)) & 31];
  return out;
}

export function base32Decode(text: string): Buffer {
  const clean = text.replace(/[\s=]/g, '').toUpperCase();
  let bits = 0;
  let value = 0;
  const out: number[] = [];
  for (const char of clean) {
    const index = ALPHABET.indexOf(char);
    if (index < 0) throw new Error('Nieprawidłowy znak base32');
    value = (value << 5) | index;
    bits += 5;
    if (bits >= 8) {
      out.push((value >>> (bits - 8)) & 255);
      bits -= 8;
    }
  }
  return Buffer.from(out);
}

/** Nowy sekret: 160 bitów, jak zaleca RFC 4226 dla HMAC-SHA1. */
export function generateTotpSecret(): string {
  return base32Encode(randomBytes(20));
}

/** Kod HOTP (RFC 4226) dla kroku czasu; TOTP (RFC 6238) to HOTP z numerem kroku 30 s. */
export function totpCode(secret: string, step: number, digits: number = STAFF_LOGIN_POLICY.totpDigits): string {
  const counter = Buffer.alloc(8);
  counter.writeBigUInt64BE(BigInt(step));
  const mac = createHmac('sha1', base32Decode(secret)).update(counter).digest();
  const offset = mac[mac.length - 1]! & 0x0f;
  const binary = (mac.readUInt32BE(offset) & 0x7fffffff) % 10 ** digits;
  return String(binary).padStart(digits, '0');
}

/** Krok, którego kod zgadza się z wpisanym (porównanie w stałym czasie), albo `null`. */
export function matchTotpStep(secret: string, code: string, candidateSteps: readonly number[]): number | null {
  const given = Buffer.from(code);
  let matched: number | null = null;
  for (const step of candidateSteps) {
    const expected = Buffer.from(totpCode(secret, step));
    if (expected.length === given.length && timingSafeEqual(expected, given) && matched === null) matched = step;
  }
  return matched;
}

/** Adres `otpauth://` dla kodu QR (format Key URI z Google Authenticator). */
export function otpauthUrl(issuer: string, account: string, secret: string): string {
  const label = encodeURIComponent(`${issuer}:${account}`);
  const params = new URLSearchParams({
    secret,
    issuer,
    algorithm: 'SHA1',
    digits: String(STAFF_LOGIN_POLICY.totpDigits),
    period: String(STAFF_LOGIN_POLICY.totpStepSeconds),
  });
  return `otpauth://totp/${label}?${params.toString()}`;
}
