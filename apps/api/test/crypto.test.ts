import { describe, expect, it } from 'vitest';
import { JwtCodec } from '../src/auth/crypto/jwt.js';
import { OtpCodes, SecretBox } from '../src/auth/crypto/secrets.js';
import { base32Decode, base32Encode, matchTotpStep, otpauthUrl, totpCode } from '../src/auth/crypto/totp.js';

const t0 = new Date('2026-11-16T12:00:00Z');
const err = (reason: string) => expect.objectContaining({ code: 'UNAUTHENTICATED', details: { reason } });

describe('TOTP (RFC 6238)', () => {
  // Wektor testowy z dodatku B RFC 6238: sekret ASCII „12345678901234567890”, SHA1, T = 59 s.
  const secret = base32Encode(Buffer.from('12345678901234567890'));

  it('liczy kody zgodne z wektorami testowymi RFC', () => {
    expect(secret).toBe('GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ');
    expect(totpCode(secret, Math.floor(59 / 30), 8)).toBe('94287082');
    expect(totpCode(secret, Math.floor(1111111109 / 30), 8)).toBe('07081804');
    expect(totpCode(secret, Math.floor(59 / 30))).toBe('287082');
  });

  it('base32 w obie strony i dopasowanie kroku z okna', () => {
    expect(base32Decode(base32Encode(Buffer.from([0, 255, 16, 3, 99])))).toEqual(Buffer.from([0, 255, 16, 3, 99]));
    const code = totpCode(secret, 1001);
    expect(matchTotpStep(secret, code, [1000, 999, 1001])).toBe(1001);
    expect(matchTotpStep(secret, code, [1000, 999])).toBeNull();
    expect(otpauthUrl('[nazwa]', 'marta@operator.pl', 'ABC')).toBe(
      'otpauth://totp/%5Bnazwa%5D%3Amarta%40operator.pl?secret=ABC&issuer=%5Bnazwa%5D&algorithm=SHA1&digits=6&period=30',
    );
  });
});

describe('JWT', () => {
  const jwt = new JwtCodec('x'.repeat(32));

  it('przyjmuje podpisany i ważny token właściwego rodzaju', () => {
    const token = jwt.sign({ sub: 'u1', typ: 'customer', sid: 's1' }, 900, t0);
    expect(jwt.verify(token, 'customer', new Date(t0.getTime() + 899_000))).toMatchObject({ sub: 'u1', sid: 's1' });
  });

  it('odrzuca token wygasły, innego rodzaju, zmieniony i podpisany innym kluczem', () => {
    const token = jwt.sign({ sub: 'u1', typ: 'customer' }, 900, t0);
    expect(() => jwt.verify(token, 'customer', new Date(t0.getTime() + 900_000))).toThrow(err('TOKEN_EXPIRED'));
    expect(() => jwt.verify(token, 'staff', t0)).toThrow(err('TOKEN_INVALID'));
    const [h, p, s] = token.split('.');
    const forged = Buffer.from(JSON.stringify({ sub: 'admin', typ: 'customer', iat: 0, exp: 9e9 })).toString('base64url');
    expect(() => jwt.verify(`${h}.${forged}.${s}`, 'customer', t0)).toThrow(err('TOKEN_INVALID'));
    expect(() => new JwtCodec('y'.repeat(32)).verify(token, 'customer', t0)).toThrow(err('TOKEN_INVALID'));
    expect(() => jwt.verify(`${h}.${p}`, 'customer', t0)).toThrow(err('TOKEN_INVALID'));
  });
});

describe('sekrety', () => {
  it('SecretBox szyfruje z losowym wektorem i wykrywa zmianę szyfrogramu', () => {
    const box = new SecretBox(Buffer.alloc(32, 1).toString('base64'));
    const a = box.encrypt('KZXW6YTBOI4HK3TM');
    expect(a).not.toBe(box.encrypt('KZXW6YTBOI4HK3TM'));
    expect(box.decrypt(a)).toBe('KZXW6YTBOI4HK3TM');
    const parts = a.split('.');
    parts[3] = Buffer.from('zmienione').toString('base64url');
    expect(() => box.decrypt(parts.join('.'))).toThrow();
  });

  it('kody SMS mają 6 cyfr, a skrót zależy od numeru i klucza', () => {
    const codes = new OtpCodes('k'.repeat(32));
    expect(codes.generate()).toMatch(/^\d{6}$/);
    const h = codes.hash('+48500100100', '123456');
    expect(codes.matches('+48500100100', '123456', h)).toBe(true);
    expect(codes.matches('+48500100101', '123456', h)).toBe(false);
    expect(new OtpCodes('j'.repeat(32)).matches('+48500100100', '123456', h)).toBe(false);
  });
});
