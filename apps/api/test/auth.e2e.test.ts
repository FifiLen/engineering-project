import 'reflect-metadata';
import { randomUUID } from 'node:crypto';
import * as core from '@hulajnogi/core';
import { inviteAdministrator, runMigrations, seedDatabase, type PlacesFile } from '@hulajnogi/db';
import * as shared from '@hulajnogi/shared';
import type { NestFastifyApplication } from '@nestjs/platform-fastify';
import { Pool } from 'pg';
import { io } from 'socket.io-client';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { LoggingSmsGateway } from '../src/auth/sms.gateway.js';
import { totpCode } from '../src/auth/crypto/totp.js';
import { createApp } from '../src/bootstrap.js';
import { loadConfig } from '../src/config.js';
import { asStaff, staffToken } from './helpers.js';

const adminUrl = process.env.DATABASE_URL;
const dbName = `hulajnogi_auth_api_${randomUUID().slice(0, 8)}`;

const places: PlacesFile = {
  city: 'Test',
  note: '',
  serviceArea: { code: 'AREA-TEST', name: 'Obszar testowy', centerPlace: 'P-01', radiusM: 1000 },
  places: [{ code: 'P-01', name: 'Centrum', query: '', type: 'PARKING', radiusM: 100, lat: 50.0, lon: 18.5 }],
};

describe('wyliczenia kont w kontrakcie API są zgodne z packages/core', () => {
  it.each([
    ['USER_STATUSES', shared.USER_STATUSES, core.USER_STATUSES],
    ['BLOCK_REASONS', shared.BLOCK_REASONS, core.BLOCK_REASONS],
    ['CONSENT_TYPES', shared.CONSENT_TYPES, core.CONSENT_TYPES],
  ])('%s', (_name, fromShared, fromCore) => {
    expect([...fromShared]).toEqual([...fromCore]);
  });
});

describe.skipIf(!adminUrl)('API: logowanie klientów i operatorów, strażnik uprawnień', () => {
  let admin: Pool;
  let pool: Pool;
  let app: NestFastifyApplication;
  const sms = () => app.get(LoggingSmsGateway);
  const lastCode = (phone: string) => /(\d{6})/.exec(sms().sent.filter((m) => m.phone === phone).at(-1)!.text)![1]!;
  const staffId = async (email: string) =>
    (await pool.query<{ id: string }>('SELECT id FROM staff WHERE email = $1', [email])).rows[0]!.id;
  const cookieOf = (res: { cookies: Array<{ name: string; value: string }> }) =>
    res.cookies.find((c) => c.name === shared.STAFF_REFRESH_COOKIE);

  beforeAll(async () => {
    admin = new Pool({ connectionString: adminUrl });
    await admin.query(`CREATE DATABASE ${dbName}`);
    const url = new URL(adminUrl!);
    url.pathname = `/${dbName}`;
    pool = new Pool({ connectionString: url.toString() });
    pool.on('error', () => undefined);
    await runMigrations(pool);
    await seedDatabase(pool, {
      places,
      fleetSize: 1,
      admin: { email: 'a@test.local', name: 'A', passwordHash: 'x' },
      staff: [{ email: 'd@test.local', name: 'D', role: 'Dyspozytor', passwordHash: 'x' }],
      documents: [
        { slug: 'regulamin', name: 'Regulamin', consentType: 'TERMS', title: 'Regulamin', bodyMd: 'Treść' },
        { slug: 'polityka-prywatnosci', name: 'Polityka', consentType: 'PRIVACY', title: 'Polityka', bodyMd: 'Treść' },
      ],
    });
    app = await createApp(loadConfig({ NODE_ENV: 'test', DATABASE_URL: url.toString(), MQTT_ENABLED: 'false' }), {
      logger: false,
    });
    await app.listen({ port: 0, host: '127.0.0.1' });
  });

  afterAll(async () => {
    await app?.close();
    await pool?.end();
    await admin?.query(`DROP DATABASE IF EXISTS ${dbName} WITH (FORCE)`);
    await admin?.end();
  });

  describe('strażnik', () => {
    it('punkty publiczne działają bez tokenu, panel wymaga tokenu operatora', async () => {
      expect((await app.inject({ method: 'GET', url: '/health' })).statusCode).toBe(200);
      expect((await app.inject({ method: 'GET', url: '/legal/regulamin' })).json()).toMatchObject({ versionNo: 1 });
      const anonymous = await app.inject({ method: 'GET', url: '/admin/scooters' });
      expect(anonymous.statusCode).toBe(401);
      expect(anonymous.json()).toMatchObject({ code: 'UNAUTHENTICATED', details: { reason: 'TOKEN_MISSING' } });
      const garbage = await app.inject({ method: 'GET', url: '/admin/scooters', headers: { authorization: 'Bearer abc' } });
      expect(garbage.json()).toMatchObject({ code: 'UNAUTHENTICATED', details: { reason: 'TOKEN_INVALID' } });
    });

    it('operator bez uprawnienia dostaje 403 z nazwą uprawnienia, a dezaktywowany 401', async () => {
      const dispatcher = asStaff(app, staffToken(app, await staffId('d@test.local')));
      expect((await dispatcher({ method: 'GET', url: '/admin/scooters' })).statusCode).toBe(200);
      const create = await dispatcher({ method: 'POST', url: '/admin/scooter-models', payload: { code: 'X-1', name: 'X' } });
      expect(create.statusCode).toBe(403);
      expect(create.json()).toEqual({ code: 'FORBIDDEN', message: 'FORBIDDEN', details: { permission: 'scooters.write' } });

      const { rows } = await pool.query<{ id: string }>(
        `INSERT INTO staff (email, name, password_hash, active) VALUES ('off@test.local', 'Off', 'x', false) RETURNING id`,
      );
      const inactive = await asStaff(app, staffToken(app, rows[0]!.id))({ method: 'GET', url: '/admin/scooters' });
      expect(inactive.statusCode).toBe(401);
      expect(inactive.json()).toMatchObject({ details: { reason: 'STAFF_INACTIVE' } });
    });

    it('token klienta nie otwiera panelu, a Socket.IO wymaga tokenu operatora z scooters.read', async () => {
      const phone = '+48500900900';
      await app.inject({ method: 'POST', url: '/auth/otp', payload: { phone } });
      const session = (
        await app.inject({ method: 'POST', url: '/auth/otp/verify', payload: { phone, code: lastCode(phone) } })
      ).json<shared.CustomerSession>();
      const res = await asStaff(app, session.accessToken)({ method: 'GET', url: '/admin/scooters' });
      expect(res.json()).toMatchObject({ code: 'UNAUTHENTICATED', details: { reason: 'TOKEN_INVALID' } });

      const url = await app.getUrl();
      const anonymous = io(url, { transports: ['websocket'] });
      await new Promise<void>((resolve) => anonymous.on('disconnect', () => resolve()));
      const staffSocket = io(url, { transports: ['websocket'], auth: { token: staffToken(app, await staffId('d@test.local')) } });
      expect(await staffSocket.emitWithAck('fleet.subscribe')).toEqual({ ok: true });
      staffSocket.disconnect();
    });
  });

  describe('klient: kod SMS, rejestracja, sesje', () => {
    const phone = '+48512345678';

    it('wysyła kod, liczy błędne próby i pilnuje odstępu między kodami', async () => {
      const sent = await app.inject({ method: 'POST', url: '/auth/otp', payload: { phone: '512 345 678' } });
      expect(sent.statusCode).toBe(202);
      expect(sent.json()).toEqual({ phone, expiresInSeconds: 300, resendInSeconds: 60, remainingCodes: 4 });
      expect(lastCode(phone)).toMatch(/^\d{6}$/);

      const again = await app.inject({ method: 'POST', url: '/auth/otp', payload: { phone } });
      expect(again.statusCode).toBe(429);
      expect(again.json()).toMatchObject({ code: 'RATE_LIMITED', details: { reason: 'OTP_COOLDOWN' } });
      expect(Number(again.headers['retry-after'])).toBeGreaterThan(50);

      const wrongCode = lastCode(phone) === '000000' ? '111111' : '000000';
      const wrong = await app.inject({ method: 'POST', url: '/auth/otp/verify', payload: { phone, code: wrongCode } });
      expect(wrong.statusCode).toBe(401);
      expect(wrong.json()).toMatchObject({ code: 'OTP_INVALID', details: { attemptsLeft: 4 } });
      const bad = await app.inject({ method: 'POST', url: '/auth/otp', payload: { phone: '123' } });
      expect(bad.statusCode).toBe(400);
    });

    let tokens: shared.CustomerTokens;

    it('dobry kod zakłada konto i kieruje do ekranu danych; kodu nie da się użyć drugi raz', async () => {
      const code = lastCode(phone);
      const res = await app.inject({ method: 'POST', url: '/auth/otp/verify', payload: { phone, code, device: 'iPhone 15' } });
      expect(res.statusCode).toBe(200);
      const session = res.json<shared.CustomerSession>();
      expect(session).toMatchObject({ created: true, me: { phone, nextStep: 'PROFILE', status: 'ACTIVE', minUserAge: 18 } });
      expect(session.me.pendingDocuments.map((d) => d.slug)).toEqual(['regulamin', 'polityka-prywatnosci']);
      tokens = session;
      const reused = await app.inject({ method: 'POST', url: '/auth/otp/verify', payload: { phone, code } });
      expect(reused.json()).toMatchObject({ code: 'OTP_EXPIRED' });
    });

    it('rejestracja wymaga obowiązujących wersji dokumentów i potwierdzenia wieku', async () => {
      const auth = { authorization: `Bearer ${tokens.accessToken}` };
      const me = (await app.inject({ method: 'GET', url: '/me', headers: auth })).json<shared.MeResponse>();
      const versionIds = me.pendingDocuments.map((d) => d.versionId);
      const payload = { name: 'Anna', email: 'anna@przyklad.pl', ageConfirmed: true, acceptedVersionIds: versionIds };

      const noAge = await app.inject({ method: 'POST', url: '/me/registration', headers: auth, payload: { ...payload, ageConfirmed: false } });
      expect(noAge.json()).toMatchObject({ code: 'AGE_NOT_CONFIRMED' });
      const stale = await app.inject({
        method: 'POST',
        url: '/me/registration',
        headers: auth,
        payload: { ...payload, acceptedVersionIds: [randomUUID()] },
      });
      expect(stale.json()).toMatchObject({ code: 'DOCUMENT_VERSION_OUTDATED' });

      const done = await app.inject({ method: 'POST', url: '/me/registration', headers: auth, payload: { ...payload, marketing: true } });
      expect(done.statusCode).toBe(200);
      expect(done.json()).toMatchObject({ name: 'Anna', nextStep: 'READY', pendingDocuments: [], marketingConsent: true });
      const optOut = await app.inject({ method: 'PATCH', url: '/me', headers: auth, payload: { marketing: false } });
      expect(optOut.json()).toMatchObject({ marketingConsent: false, nextStep: 'READY' });
    });

    it('odświeżenie rotuje token; stary token i wylogowanie kończą sesję', async () => {
      const refreshed = await app.inject({ method: 'POST', url: '/auth/refresh', payload: { refreshToken: tokens.refreshToken } });
      expect(refreshed.statusCode).toBe(200);
      const next = refreshed.json<shared.CustomerTokens>();
      expect(next.refreshToken).not.toBe(tokens.refreshToken);

      const old = await app.inject({ method: 'POST', url: '/auth/refresh', payload: { refreshToken: tokens.refreshToken } });
      expect(old.json()).toMatchObject({ code: 'UNAUTHENTICATED', details: { reason: 'SESSION_ROTATED' } });

      expect((await app.inject({ method: 'POST', url: '/auth/logout', payload: { refreshToken: next.refreshToken } })).statusCode).toBe(204);
      const after = await app.inject({ method: 'POST', url: '/auth/refresh', payload: { refreshToken: next.refreshToken } });
      expect(after.json()).toMatchObject({ code: 'UNAUTHENTICATED', details: { reason: 'SESSION_REVOKED' } });
    });
  });

  describe('operator: zaproszenie, TOTP, sesja w ciasteczku, blokada', () => {
    const email = 'nowy@test.local';
    const password = 'zielony-tramwaj-rybnik';
    let invitationToken: string;
    let secret: string;
    const step = () => core.totpStep(new Date());

    it('zaproszenie z terminala: dane zaproszenia, słabe hasło, hasło i konfiguracja TOTP', async () => {
      invitationToken = (await inviteAdministrator(pool, { email, name: 'Nowy Admin' })).token;
      const view = await app.inject({ method: 'GET', url: `/admin/auth/invitations/${invitationToken}` });
      expect(view.json()).toMatchObject({ email, name: 'Nowy Admin', invitedByName: null });

      const weak = await app.inject({
        method: 'POST',
        url: `/admin/auth/invitations/${invitationToken}/accept`,
        payload: { name: 'Nowy Admin', password: 'krótkie' },
      });
      expect(weak.statusCode).toBe(400);
      expect(weak.json()).toMatchObject({ code: 'WEAK_PASSWORD', details: { problems: ['TOO_SHORT'] } });

      const accepted = await app.inject({
        method: 'POST',
        url: `/admin/auth/invitations/${invitationToken}/accept`,
        payload: { name: 'Nowy Administrator', password },
      });
      const loginStep = accepted.json<shared.StaffLoginStep>();
      expect(loginStep).toMatchObject({ step: 'TOTP_SETUP', email });
      expect(loginStep.totpSetup!.otpauthUrl).toContain(`secret=${loginStep.totpSetup!.secret}`);
      secret = loginStep.totpSetup!.secret;
      const reused = await app.inject({ method: 'GET', url: `/admin/auth/invitations/${invitationToken}` });
      expect(reused.json()).toMatchObject({ code: 'INVITATION_INVALID' });

      const session = await app.inject({
        method: 'POST',
        url: '/admin/auth/totp',
        payload: { mfaToken: loginStep.mfaToken, code: totpCode(secret, step()) },
        headers: { 'user-agent': 'Chrome, macOS' },
      });
      expect(session.statusCode).toBe(200);
      expect(session.json<shared.StaffSession>().staff).toMatchObject({ name: 'Nowy Administrator', roles: ['Administrator'] });
      expect(session.json<shared.StaffSession>().staff.permissions).toHaveLength(core.PERMISSIONS.length);
      expect(cookieOf(session)).toMatchObject({ httpOnly: true, sameSite: 'Strict', path: '/admin/auth' });
    });

    it('logowanie hasłem i kodem; ten sam kod drugi raz nie działa; odświeżenie z ciasteczka', async () => {
      const login = await app.inject({ method: 'POST', url: '/admin/auth/login', payload: { email: 'NOWY@test.local', password } });
      expect(login.json()).toMatchObject({ step: 'TOTP', totpSetup: null });
      const { mfaToken } = login.json<shared.StaffLoginStep>();
      // Kod z tego samego kroku co przy konfiguracji jest odrzucany jako ponownie użyty.
      const replay = await app.inject({ method: 'POST', url: '/admin/auth/totp', payload: { mfaToken, code: totpCode(secret, step()) } });
      expect(replay.json()).toMatchObject({ code: 'TOTP_INVALID', details: { attemptsLeft: 4 } });

      const ok = await app.inject({ method: 'POST', url: '/admin/auth/totp', payload: { mfaToken, code: totpCode(secret, step() + 1) } });
      expect(ok.statusCode).toBe(200);
      const cookie = cookieOf(ok)!;
      const me = await asStaff(app, ok.json<shared.StaffSession>().accessToken)({ method: 'GET', url: '/admin/auth/me' });
      expect(me.json()).toMatchObject({ email });

      const refreshed = await app.inject({ method: 'POST', url: '/admin/auth/refresh', cookies: { [cookie.name]: cookie.value } });
      expect(refreshed.statusCode).toBe(200);
      expect(cookieOf(refreshed)!.value).not.toBe(cookie.value);
      const old = await app.inject({ method: 'POST', url: '/admin/auth/refresh', cookies: { [cookie.name]: cookie.value } });
      expect(old.statusCode).toBe(401);

      const next = cookieOf(refreshed)!;
      expect((await app.inject({ method: 'POST', url: '/admin/auth/logout', cookies: { [next.name]: next.value } })).statusCode).toBe(204);
      expect((await app.inject({ method: 'POST', url: '/admin/auth/refresh', cookies: { [next.name]: next.value } })).statusCode).toBe(401);

      const audit = await pool.query(`SELECT action FROM audit_log WHERE entity_id = $1 ORDER BY id`, [await staffId(email)]);
      expect(audit.rows.map((r) => r.action)).toEqual(['staff.invitation_accepted', 'staff.totp_enabled', 'staff.signed_in', 'staff.signed_in']);
    });

    it('po 5 nieudanych próbach logowanie jest wstrzymane; nieistniejące konto daje ten sam błąd', async () => {
      const attempt = (pwd: string, mail = email) =>
        app.inject({ method: 'POST', url: '/admin/auth/login', payload: { email: mail, password: pwd } });
      const unknown = await attempt('cokolwiek', 'nikt@test.local');
      expect(unknown.json()).toEqual({ code: 'INVALID_CREDENTIALS', message: 'INVALID_CREDENTIALS' });
      // Udane logowanie wyzerowało licznik po błędnym kodzie TOTP: blokuje dopiero piąta pomyłka.
      for (let i = 0; i < 4; i++) expect((await attempt('złe-hasło-123')).statusCode).toBe(401);
      const locked = await attempt('złe-hasło-123');
      expect(locked.statusCode).toBe(429);
      expect(locked.json()).toMatchObject({ code: 'ACCOUNT_LOCKED', details: { retryAfterSeconds: 900 } });
      expect((await attempt(password)).json()).toMatchObject({ code: 'ACCOUNT_LOCKED' });
    });
  });
});
