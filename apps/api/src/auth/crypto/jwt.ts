import { createHmac, timingSafeEqual } from 'node:crypto';
import { unauthenticated } from '@hulajnogi/core';

/** Rodzaje tokenów: dostęp klienta, dostęp operatora, drugi krok logowania operatora (ADR 0035). */
export type TokenType = 'customer' | 'staff' | 'staff_mfa';

export interface TokenClaims {
  sub: string;
  typ: TokenType;
  /** Sesja (wiersz `sessions` albo `staff_sessions`); w tokenie drugiego kroku brak. */
  sid?: string;
  /** Tylko `staff_mfa`: kolejny krok i „Zapamiętaj to urządzenie”. */
  step?: 'TOTP' | 'TOTP_SETUP';
  remember?: boolean;
  iat: number;
  exp: number;
}

const HEADER = Buffer.from(JSON.stringify({ alg: 'HS256', typ: 'JWT' })).toString('base64url');

/**
 * JWT HS256 na `node:crypto`: podpis, ważność i rodzaj tokenu. Własna implementacja zamiast biblioteki,
 * bo obsługujemy jeden algorytm i jeden nagłówek, a weryfikacja odrzuca wszystko inne.
 */
export class JwtCodec {
  constructor(private readonly secret: string) {}

  sign(claims: Omit<TokenClaims, 'iat' | 'exp'>, ttlSeconds: number, now: Date): string {
    const iat = Math.floor(now.getTime() / 1000);
    const payload = Buffer.from(JSON.stringify({ ...claims, iat, exp: iat + ttlSeconds })).toString('base64url');
    return `${HEADER}.${payload}.${this.signature(`${HEADER}.${payload}`)}`;
  }

  /** Token podpisany tym kluczem, ważny i podanego rodzaju; inaczej `UNAUTHENTICATED`. */
  verify(token: string, type: TokenType, now: Date): TokenClaims {
    const parts = token.split('.');
    if (parts.length !== 3 || parts[0] !== HEADER) throw unauthenticated('TOKEN_INVALID');
    const expected = Buffer.from(this.signature(`${parts[0]}.${parts[1]}`));
    const given = Buffer.from(parts[2]!);
    if (expected.length !== given.length || !timingSafeEqual(expected, given)) throw unauthenticated('TOKEN_INVALID');
    let claims: TokenClaims;
    try {
      claims = JSON.parse(Buffer.from(parts[1]!, 'base64url').toString('utf8')) as TokenClaims;
    } catch {
      throw unauthenticated('TOKEN_INVALID');
    }
    if (claims.typ !== type || typeof claims.sub !== 'string') throw unauthenticated('TOKEN_INVALID');
    if (typeof claims.exp !== 'number' || claims.exp * 1000 <= now.getTime()) throw unauthenticated('TOKEN_EXPIRED');
    return claims;
  }

  private signature(input: string): string {
    return createHmac('sha256', this.secret).update(input).digest('base64url');
  }
}
