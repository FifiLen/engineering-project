import { createCipheriv, createDecipheriv, createHmac, randomBytes, randomInt, timingSafeEqual } from 'node:crypto';
import { OTP_POLICY } from '@hulajnogi/core';
import { hash, verify } from '@node-rs/argon2';

/**
 * Szyfrowanie sekretów TOTP w bazie: AES-256-GCM, losowy wektor 12 bajtów, znacznik uwierzytelniający.
 * Format zapisu: `v1.<iv>.<tag>.<szyfrogram>` w base64url (wersja pozwala później zmienić klucz).
 */
export class SecretBox {
  private readonly key: Buffer;

  constructor(base64Key: string) {
    this.key = Buffer.from(base64Key, 'base64');
    if (this.key.length !== 32) throw new Error('Klucz SecretBox musi mieć 32 bajty');
  }

  encrypt(plain: string): string {
    const iv = randomBytes(12);
    const cipher = createCipheriv('aes-256-gcm', this.key, iv);
    const data = Buffer.concat([cipher.update(plain, 'utf8'), cipher.final()]);
    return ['v1', iv, cipher.getAuthTag(), data].map((p) => (typeof p === 'string' ? p : p.toString('base64url'))).join('.');
  }

  decrypt(sealed: string): string {
    const [version, iv, tag, data] = sealed.split('.');
    if (version !== 'v1' || !iv || !tag || !data) throw new Error('Nieznany format zaszyfrowanego sekretu');
    const decipher = createDecipheriv('aes-256-gcm', this.key, Buffer.from(iv, 'base64url'));
    decipher.setAuthTag(Buffer.from(tag, 'base64url'));
    return Buffer.concat([decipher.update(Buffer.from(data, 'base64url')), decipher.final()]).toString('utf8');
  }
}

/** Hasła operatorów: argon2id z parametrami domyślnymi biblioteki (ADR 0019). */
export const passwords = {
  hash: (password: string) => hash(password),
  verify: (passwordHash: string, password: string) => verify(passwordHash, password).catch(() => false),
};

/**
 * Kody SMS: losowe 6 cyfr i skrót HMAC z kluczem serwera. Skrót z kluczem, bo milion możliwych kodów
 * da się przejrzeć w ułamku sekundy, gdyby wyciekła sama baza.
 */
export class OtpCodes {
  constructor(private readonly key: string) {}

  generate(): string {
    return String(randomInt(0, 10 ** OTP_POLICY.length)).padStart(OTP_POLICY.length, '0');
  }

  hash(phone: string, code: string): string {
    return createHmac('sha256', this.key).update(`${phone}:${code}`).digest('hex');
  }

  matches(phone: string, code: string, codeHash: string): boolean {
    const expected = Buffer.from(this.hash(phone, code));
    const given = Buffer.from(codeHash);
    return expected.length === given.length && timingSafeEqual(expected, given);
  }
}
