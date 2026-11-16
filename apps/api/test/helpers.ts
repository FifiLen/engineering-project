import { randomUUID } from 'node:crypto';
import type { NestFastifyApplication } from '@nestjs/platform-fastify';
import { SESSION_POLICY } from '@hulajnogi/core';
import type { InjectOptions } from 'fastify';
import { JWT } from '../src/auth/auth.tokens.js';
import type { JwtCodec } from '../src/auth/crypto/jwt.js';

/**
 * Token dostępowy operatora podpisany kluczem aplikacji. Strażnik sprawdza podpis, ważność i uprawnienia
 * z bazy (ADR 0035), więc testy modułów panelu nie muszą przechodzić całego logowania z TOTP; sam
 * przepływ logowania sprawdza `auth.e2e.test.ts`.
 */
export function staffToken(app: NestFastifyApplication, staffId: string): string {
  return app.get<JwtCodec>(JWT).sign({ sub: staffId, typ: 'staff', sid: randomUUID() }, SESSION_POLICY.accessTokenSeconds, new Date());
}

/** `app.inject` z nagłówkiem `Authorization` operatora. */
export function asStaff(app: NestFastifyApplication, token: string) {
  return (options: InjectOptions) =>
    app.inject({ ...options, headers: { ...options.headers, authorization: `Bearer ${token}` } });
}
