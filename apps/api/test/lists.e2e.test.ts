import 'reflect-metadata';
import type * as shared from '@hulajnogi/shared';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { LoggingSmsGateway } from '../src/auth/sms.gateway.js';
import { asStaff, staffToken } from './helpers.js';
import { operationsContext, type OperationsContext } from './operations-helpers.js';

const adminUrl = process.env.DATABASE_URL;

type Api = ReturnType<typeof asStaff>;
const items = async <T>(who: Api, url: string): Promise<T[]> => {
  const res = await who({ method: 'GET', url });
  expect(res.statusCode).toBe(200);
  return res.json<shared.ListResponse<T>>().items;
};

describe.skipIf(!adminUrl)('API: nowe listy i polecenia z domknięcia macierzy operacji (ADR 0076)', () => {
  let ctx: OperationsContext;
  let editor: Api;
  let customer: { id: string; session: shared.CustomerSession };
  const phone = '+48500200001';

  const smsCode = (to: string) =>
    /(\d{6})/.exec(
      ctx.app
        .get(LoggingSmsGateway)
        .sent.filter((m) => m.phone === to)
        .at(-1)!.text,
    )![1]!;

  const audits = async (action: string) =>
    (
      await ctx.pool.query<{
        entity_type: string;
        entity_id: string | null;
        staff_id: string;
        data: Record<string, unknown>;
      }>(`SELECT entity_type, entity_id, staff_id, data FROM audit_log WHERE action = $1 ORDER BY id`, [action])
    ).rows;

  beforeAll(async () => {
    ctx = await operationsContext('lists', 2);
    const editorId = (
      await ctx.pool.query<{ id: string }>(
        `INSERT INTO staff (email, name, password_hash) VALUES ('r@test.local', 'Redaktor Testowy', 'x') RETURNING id`,
      )
    ).rows[0]!.id;
    await ctx.pool.query(
      `INSERT INTO staff_roles (staff_id, role_id) SELECT $1, id FROM roles WHERE name = 'Redaktor'`,
      [editorId],
    );
    editor = asStaff(ctx.app, staffToken(ctx.app, editorId));

    // Klient z aplikacji: urządzenie, platforma i wersja przy logowaniu, zgoda marketingowa przy rejestracji.
    await ctx.app.inject({ method: 'POST', url: '/auth/otp', payload: { phone } });
    const session = (
      await ctx.app.inject({
        method: 'POST',
        url: '/auth/otp/verify',
        payload: { phone, code: smsCode(phone), device: 'iPhone testowy', platform: 'IOS', appVersion: '2.1.0' },
      })
    ).json<shared.CustomerSession>();
    const registration = await ctx.app.inject({
      method: 'POST',
      url: '/me/registration',
      headers: { authorization: `Bearer ${session.accessToken}` },
      payload: {
        name: 'Ewa Listowa',
        ageConfirmed: true,
        marketing: true,
        acceptedVersionIds: session.me.pendingDocuments.map((d) => d.versionId),
      },
    });
    expect(registration.statusCode).toBe(200);
    customer = { id: session.me.id, session };
  });

  afterAll(async () => {
    await ctx?.close();
  });

  it('każda nowa lista wymaga uprawnienia z ADR 0076 (403 bez niego)', async () => {
    const cases: Array<[string, Api, Api, string]> = [
      ['/admin/consents', ctx.staff.dispatcher, ctx.staff.technician, 'users.read'],
      ['/admin/sessions', ctx.staff.dispatcher, ctx.staff.technician, 'users.read'],
      ['/admin/otp-codes', ctx.staff.dispatcher, ctx.staff.technician, 'users.read'],
      ['/admin/saved-places', ctx.staff.dispatcher, ctx.staff.technician, 'users.read'],
      ['/admin/staff-sessions', ctx.staff.admin, ctx.staff.dispatcher, 'staff.read'],
      ['/admin/staff-invitations', ctx.staff.admin, ctx.staff.dispatcher, 'staff.read'],
      ['/admin/permissions', ctx.staff.admin, ctx.staff.dispatcher, 'roles.manage'],
      ['/admin/scooter-commands', ctx.staff.technician, editor, 'scooters.read'],
      ['/admin/scooter-status-history', ctx.staff.technician, editor, 'scooters.read'],
      ['/admin/rental-events', ctx.staff.dispatcher, ctx.staff.technician, 'rentals.read'],
      ['/admin/zone-presence', ctx.staff.technician, editor, 'zones.read'],
      ['/admin/zone-control', ctx.staff.technician, editor, 'zones.read'],
      ['/admin/payment-customers', ctx.staff.dispatcher, ctx.staff.technician, 'payments.read'],
    ];
    for (const [url, allowed, denied, permission] of cases) {
      const ok = await allowed({ method: 'GET', url });
      expect({ url, status: ok.statusCode }).toEqual({ url, status: 200 });
      expect(ok.json()).toMatchObject({ page: 1, total: expect.any(Number), items: expect.any(Array) });
      const forbidden = await denied({ method: 'GET', url });
      expect({ url, status: forbidden.statusCode }).toEqual({ url, status: 403 });
      expect(forbidden.json()).toMatchObject({ code: 'FORBIDDEN', details: { permission } });
      const exported = await denied({
        method: 'POST',
        url: `${url}/export`,
        payload: { format: 'csv', columns: [{ field: 'id', label: 'Id' }] },
      });
      expect({ url, status: exported.statusCode }).toEqual({ url, status: 403 });
    }
    // Katalog uprawnień do macierzy roli przeniesiony pod /catalog (lista z filtrami zajęła /admin/permissions).
    const catalog = await ctx.staff.admin({ method: 'GET', url: '/admin/permissions/catalog' });
    expect(catalog.json<shared.PermissionView[]>().length).toBeGreaterThan(30);
  });

  it('zgody: źródło z rejestracji i aplikacji; operator wycofuje tylko zgodę marketingową z powodem', async () => {
    const consents = await items<shared.ConsentListItem>(
      ctx.staff.admin,
      `/admin/consents?userId=${customer.id}&sort=type`,
    );
    expect(consents.map((c) => `${c.type}:${c.source}:${c.state}`).sort()).toEqual([
      'AGE:REGISTRATION:CONFIRMED',
      'MARKETING:REGISTRATION:CURRENT',
      'PRIVACY:REGISTRATION:CURRENT',
      'TERMS:REGISTRATION:CURRENT',
    ]);
    const marketing = consents.find((c) => c.type === 'MARKETING')!;
    const terms = consents.find((c) => c.type === 'TERMS')!;
    const url = (id: string) => `/admin/consents/${id}/revoke`;

    expect(
      (await ctx.staff.dispatcher({ method: 'POST', url: url(marketing.id), payload: { reason: 'Prośba klienta' } }))
        .statusCode,
    ).toBe(403);
    expect(
      (await ctx.staff.admin({ method: 'POST', url: url(marketing.id), payload: { reason: 'x' } })).statusCode,
    ).toBe(400);
    const revoked = await ctx.staff.admin({
      method: 'POST',
      url: url(marketing.id),
      payload: { reason: 'Prośba klienta' },
    });
    expect(revoked.statusCode).toBe(200);
    expect(revoked.json()).toMatchObject({
      state: 'REVOKED',
      revokedByName: 'Admin Testowy',
      revokedAt: expect.any(String),
    });
    // Powtórne wycofanie niczego nie zmienia i nie dopisuje wpisu.
    expect(
      (await ctx.staff.admin({ method: 'POST', url: url(marketing.id), payload: { reason: 'Drugi raz' } })).statusCode,
    ).toBe(200);
    expect(await audits('consent.revoked')).toEqual([
      {
        entity_type: 'user',
        entity_id: customer.id,
        staff_id: ctx.staffIds.admin,
        data: { consentId: marketing.id, type: 'MARKETING', reason: 'Prośba klienta' },
      },
    ]);
    const notRevocable = await ctx.staff.admin({
      method: 'POST',
      url: url(terms.id),
      payload: { reason: 'Prośba klienta' },
    });
    expect(notRevocable.statusCode).toBe(409);
    expect(notRevocable.json()).toMatchObject({ code: 'CONSENT_NOT_REVOCABLE', details: { type: 'TERMS' } });
    const me = (
      await ctx.app.inject({
        method: 'GET',
        url: '/me',
        headers: { authorization: `Bearer ${customer.session.accessToken}` },
      })
    ).json<shared.MeResponse>();
    expect(me.marketingConsent).toBe(false);

    // Ponowna zgoda w aplikacji ma źródło APP.
    await ctx.app.inject({
      method: 'PATCH',
      url: '/me',
      headers: { authorization: `Bearer ${customer.session.accessToken}` },
      payload: { marketing: true },
    });
    const latest = await items<shared.ConsentListItem>(
      ctx.staff.admin,
      `/admin/consents?userId=${customer.id}&type=MARKETING&isLatest=true`,
    );
    expect(latest).toEqual([expect.objectContaining({ source: 'APP', state: 'CURRENT' })]);
  });

  it('sesje: platforma i wersja z logowania, dziedziczone przy rotacji; unieważnienie jednej rodziny', async () => {
    const [session] = await items<shared.SessionListItem>(
      ctx.staff.dispatcher,
      `/admin/sessions?userId=${customer.id}`,
    );
    expect(session).toMatchObject({
      deviceName: 'iPhone testowy',
      platform: 'IOS',
      appVersion: '2.1.0',
      rotations: 0,
      state: 'ACTIVE',
      userName: 'Ewa Listowa',
    });
    expect(session).not.toHaveProperty('refreshTokenHash');
    const refreshed = await ctx.app.inject({
      method: 'POST',
      url: '/auth/refresh',
      payload: { refreshToken: customer.session.refreshToken },
    });
    expect(refreshed.statusCode).toBe(200);
    const tokens = refreshed.json<shared.CustomerTokens>();
    const [rotated] = await items<shared.SessionListItem>(ctx.staff.admin, `/admin/sessions?userId=${customer.id}`);
    expect(rotated).toMatchObject({ id: session!.id, rotations: 1, platform: 'IOS', deviceName: 'iPhone testowy' });

    expect(
      (await ctx.staff.dispatcher({ method: 'POST', url: `/admin/sessions/${session!.id}/revoke`, payload: {} }))
        .statusCode,
    ).toBe(403);
    const revoked = await ctx.staff.admin({
      method: 'POST',
      url: `/admin/sessions/${session!.id}/revoke`,
      payload: { reason: 'Zgubiony telefon' },
    });
    expect(revoked.statusCode).toBe(200);
    expect(revoked.json()).toMatchObject({ id: session!.id, state: 'REVOKED' });
    const after = await ctx.app.inject({
      method: 'POST',
      url: '/auth/refresh',
      payload: { refreshToken: tokens.refreshToken },
    });
    expect(after.statusCode).toBe(401);
    expect(await audits('session.revoked')).toEqual([
      {
        entity_type: 'user',
        entity_id: customer.id,
        staff_id: ctx.staffIds.admin,
        data: { sessionId: session!.id, sessionsRevoked: 1, reason: 'Zgubiony telefon' },
      },
    ]);
    // Unieważniona rodzina niczego już nie zmienia; nieznana sesja to 404.
    expect((await ctx.staff.admin({ method: 'POST', url: `/admin/sessions/${session!.id}/revoke` })).statusCode).toBe(
      200,
    );
    expect(await audits('session.revoked')).toHaveLength(1);
    expect((await ctx.staff.admin({ method: 'POST', url: `/admin/sessions/${customer.id}/revoke` })).statusCode).toBe(
      404,
    );
  });

  it('kody SMS: cel REGISTER dla nowego numeru, LOGIN dla konta; „Usuń wygasłe” z podglądem i wpisem otp.purged', async () => {
    await ctx.pool.query(`INSERT INTO users (phone, name) VALUES ('+48500200009', 'Konto Istniejące')`);
    await ctx.app.inject({ method: 'POST', url: '/auth/otp', payload: { phone: '+48500200009' } });
    const codes = await items<shared.OtpCodeListItem>(ctx.staff.dispatcher, '/admin/otp-codes?sort=-createdAt');
    const byLast3 = Object.fromEntries(codes.map((c) => [c.phoneLast3, c]));
    expect(byLast3['001']).toMatchObject({ purpose: 'REGISTER', state: 'CONSUMED', userName: 'Ewa Listowa' });
    expect(byLast3['009']).toMatchObject({ purpose: 'LOGIN', state: 'ACTIVE', phoneMasked: '+48 ••• ••• 009' });
    expect(Object.keys(byLast3['009']!)).not.toContain('codeHash');

    await ctx.pool.query(
      `INSERT INTO otp_codes (phone, code_hash, expires_at, created_at)
       VALUES ('+48500200099', 'x', now() - interval '3 days', now() - interval '3 days')`,
    );
    expect((await ctx.staff.dispatcher({ method: 'GET', url: '/admin/otp-codes/purge' })).statusCode).toBe(403);
    expect((await ctx.staff.admin({ method: 'GET', url: '/admin/otp-codes/purge' })).json()).toEqual({ count: 1 });
    expect((await ctx.staff.dispatcher({ method: 'POST', url: '/admin/otp-codes/purge' })).statusCode).toBe(403);
    const purged = await ctx.staff.admin({ method: 'POST', url: '/admin/otp-codes/purge' });
    expect(purged.json()).toEqual({ deleted: 1 });
    expect((await audits('otp.purged')).map((a) => [a.entity_type, a.data])).toEqual([['otp_code', { deleted: 1 }]]);
    expect(await items(ctx.staff.admin, '/admin/otp-codes?purgeable=true')).toEqual([]);
  });

  it('zapisane miejsca: lista z filtrem klienta, usunięcie z users.manage i wpisem saved_place.deleted', async () => {
    const place = (
      await ctx.pool.query<{ id: string }>(
        `INSERT INTO saved_places (user_id, label, name, position)
         VALUES ($1, 'HOME', 'Dom', ST_SetSRID(ST_MakePoint(18.54, 50.09), 4326)) RETURNING id`,
        [customer.id],
      )
    ).rows[0]!.id;
    const places = await items<shared.SavedPlaceListItem>(
      ctx.staff.dispatcher,
      `/admin/saved-places?userId=${customer.id}`,
    );
    expect(places).toEqual([
      expect.objectContaining({
        id: place,
        label: 'HOME',
        name: 'Dom',
        lon: 18.54,
        lat: 50.09,
        userName: 'Ewa Listowa',
      }),
    ]);
    expect((await ctx.staff.dispatcher({ method: 'DELETE', url: `/admin/saved-places/${place}` })).statusCode).toBe(
      403,
    );
    expect((await ctx.staff.admin({ method: 'DELETE', url: `/admin/saved-places/${place}` })).statusCode).toBe(204);
    expect((await ctx.staff.admin({ method: 'DELETE', url: `/admin/saved-places/${place}` })).statusCode).toBe(404);
    expect(await items(ctx.staff.admin, `/admin/saved-places?userId=${customer.id}`)).toEqual([]);
    expect((await audits('saved_place.deleted')).map((a) => [a.entity_id, a.data])).toEqual([
      [customer.id, { placeId: place, label: 'HOME', name: 'Dom' }],
    ]);
  });

  it('sesje operatorów: zapamiętanie urządzenia i unieważnienie rodziny z staff.manage', async () => {
    const family = (
      await ctx.pool.query<{ family_id: string }>(
        `INSERT INTO staff_sessions (staff_id, refresh_token_hash, expires_at, user_agent, remembered)
         VALUES ($1, 'hash-test-1', now() + interval '7 days', 'Mozilla/5.0 (Macintosh)', true) RETURNING family_id`,
        [ctx.staffIds.dispatcher],
      )
    ).rows[0]!.family_id;
    const [row] = await items<shared.StaffSessionListItem>(
      ctx.staff.admin,
      `/admin/staff-sessions?staffId=${ctx.staffIds.dispatcher}`,
    );
    expect(row).toMatchObject({ id: family, remembered: true, state: 'ACTIVE', staffName: 'Dyspozytor Testowy' });
    const revoked = await ctx.staff.admin({
      method: 'POST',
      url: `/admin/staff-sessions/${family}/revoke`,
      payload: {},
    });
    expect(revoked.json()).toMatchObject({ id: family, state: 'REVOKED' });
    expect((await audits('session.revoked')).filter((a) => a.entity_type === 'staff')).toEqual([
      expect.objectContaining({ entity_id: ctx.staffIds.dispatcher, data: { sessionId: family, sessionsRevoked: 1 } }),
    ]);
  });

  it('zaproszenia: ponowne wysłanie zastępuje otwarte (REPLACED), unieważnienie tylko oczekującego', async () => {
    const roleId = (await ctx.pool.query<{ id: string }>(`SELECT id FROM roles WHERE name = 'Serwisant'`)).rows[0]!.id;
    const invited = await ctx.staff.admin({
      method: 'POST',
      url: '/admin/staff',
      payload: { email: 'nowy.serwisant@test.local', name: 'Nowy Serwisant', roleIds: [roleId] },
    });
    expect(invited.statusCode).toBe(201);
    const staffId = invited.json<shared.StaffInvitationResult>().staff.id;
    const [first] = await items<shared.StaffInvitationListItem>(
      ctx.staff.admin,
      `/admin/staff-invitations?staffId=${staffId}`,
    );
    expect(first).toMatchObject({
      state: 'PENDING',
      isResend: false,
      staffRoles: ['Serwisant'],
      invitedByName: 'Admin Testowy',
    });

    const resent = await ctx.staff.admin({ method: 'POST', url: `/admin/staff-invitations/${first!.id}/resend` });
    expect(resent.statusCode).toBe(200);
    expect(resent.json<shared.StaffInvitationResult>().invitationUrl).toMatch(/aktywacja\?token=/);
    const after = await items<shared.StaffInvitationListItem>(
      ctx.staff.admin,
      `/admin/staff-invitations?staffId=${staffId}&sort=-createdAt`,
    );
    expect(after.map((i) => i.state)).toEqual(['PENDING', 'REPLACED']);
    expect(after[1]!.replacedBy).toBe(after[0]!.id);
    expect(after[0]!.isResend).toBe(true);

    const revoked = await ctx.staff.admin({ method: 'POST', url: `/admin/staff-invitations/${after[0]!.id}/revoke` });
    expect(revoked.json()).toMatchObject({ state: 'REVOKED', replacedBy: null });
    const again = await ctx.staff.admin({ method: 'POST', url: `/admin/staff-invitations/${after[0]!.id}/revoke` });
    expect(again.statusCode).toBe(409);
    expect(again.json()).toMatchObject({ code: 'INVITATION_NOT_PENDING', details: { state: 'REVOKED' } });
    expect((await audits('staff.invitation_revoked')).map((a) => [a.entity_id, a.data])).toEqual([
      [staffId, { invitationId: after[0]!.id }],
    ]);
    expect((await audits('staff.invitation_resent')).at(-1)!.data).toEqual({
      invitationId: after[0]!.id,
      replaces: first!.id,
    });
  });

  it('zaproszenia: dwa równoczesne „Wyślij ponownie” tego samego zaproszenia — jedno wysłane, drugie 409, jedno otwarte', async () => {
    const roleId = (await ctx.pool.query<{ id: string }>(`SELECT id FROM roles WHERE name = 'Serwisant'`)).rows[0]!.id;
    const invited = await ctx.staff.admin({
      method: 'POST',
      url: '/admin/staff',
      payload: { email: 'rownoczesny@test.local', name: 'Równoczesny Serwisant', roleIds: [roleId] },
    });
    const staffId = invited.json<shared.StaffInvitationResult>().staff.id;
    const [open] = await items<shared.StaffInvitationListItem>(
      ctx.staff.admin,
      `/admin/staff-invitations?staffId=${staffId}`,
    );
    // Wcześniej oba ponowienia unieważniały to samo zaproszenie, a drugie wstawienie trafiało w indeks
    // `staff_invitations_one_open` (500) albo zapisywało `replaces` wskazujące już zastąpione zaproszenie.
    const results = await Promise.all(
      [1, 2, 3].map(() => ctx.staff.admin({ method: 'POST', url: `/admin/staff-invitations/${open!.id}/resend` })),
    );
    expect(results.map((r) => r.statusCode).sort()).toEqual([200, 409, 409]);
    expect(results.find((r) => r.statusCode === 409)!.json()).toMatchObject({ code: 'INVITATION_NOT_PENDING' });
    const after = await items<shared.StaffInvitationListItem>(
      ctx.staff.admin,
      `/admin/staff-invitations?staffId=${staffId}&sort=-createdAt`,
    );
    expect(after.map((i) => i.state)).toEqual(['PENDING', 'REPLACED']);
    // Ponowienie z karty operatora (bez wiersza listy) po ponowieniu z listy zastępuje nowe zaproszenie.
    const { version } = (await ctx.staff.admin({ method: 'GET', url: `/admin/staff/${staffId}` })).json<{
      version: number;
    }>();
    const fromCard = await Promise.all(
      [1, 2].map(() =>
        ctx.staff.admin({ method: 'POST', url: `/admin/staff/${staffId}/invitation`, payload: { version } }),
      ),
    );
    expect(fromCard.map((r) => r.statusCode)).toEqual([200, 200]);
    const open2 = (
      await ctx.pool.query<{ n: number }>(
        `SELECT count(*)::int AS n FROM staff_invitations WHERE staff_id = $1 AND accepted_at IS NULL AND revoked_at IS NULL`,
        [staffId],
      )
    ).rows[0]!.n;
    expect(open2).toBe(1);
  });

  it('uprawnienia: lista z grupą i rolami, opis z blokadą optymistyczną i wpisem permission.updated', async () => {
    const reports = await items<shared.PermissionListItem>(
      ctx.staff.admin,
      '/admin/permissions?module=reports&sort=code',
    );
    expect(reports.find((p) => p.code === 'reports.manage')).toMatchObject({
      inAdministrator: true,
      roleNames: ['Administrator'],
      updatedBy: null,
      version: 1,
    });
    const url = '/admin/permissions/reports.manage';
    expect(
      (await ctx.staff.dispatcher({ method: 'PATCH', url, payload: { version: 1, description: 'x' } })).statusCode,
    ).toBe(403);
    expect(
      (await ctx.staff.admin({ method: 'PATCH', url, payload: { version: 1, description: 'x'.repeat(161) } }))
        .statusCode,
    ).toBe(400);
    const updated = await ctx.staff.admin({
      method: 'PATCH',
      url,
      payload: { version: 1, description: 'Nazwy, opisy i kolejność raportów' },
    });
    expect(updated.statusCode).toBe(200);
    expect(updated.json()).toMatchObject({
      description: 'Nazwy, opisy i kolejność raportów',
      version: 2,
      updatedByName: 'Admin Testowy',
    });
    const stale = await ctx.staff.admin({ method: 'PATCH', url, payload: { version: 1, description: 'Inny opis' } });
    expect(stale.statusCode).toBe(409);
    expect(stale.json()).toMatchObject({ code: 'CONFLICT' });
    expect(
      (
        await ctx.staff.admin({
          method: 'PATCH',
          url: '/admin/permissions/nope.read',
          payload: { version: 1, description: 'x' },
        })
      ).statusCode,
    ).toBe(404);
    const [entry] = await audits('permission.updated');
    expect(entry).toMatchObject({ entity_type: 'permission', entity_id: null });
    expect(entry!.data).toMatchObject({
      code: 'reports.manage',
      changes: { description: [expect.any(String), 'Nazwy, opisy i kolejność raportów'] },
    });
    const catalog = (await ctx.staff.admin({ method: 'GET', url: '/admin/permissions/catalog' })).json<
      shared.PermissionView[]
    >();
    expect(catalog.find((p) => p.code === 'reports.manage')!.description).toBe('Nazwy, opisy i kolejność raportów');
  });

  it('komendy, zdarzenia przejazdu i historia stanów z udziałami czasu po przejeździe', async () => {
    const rider = await ctx.register('+48500200002', 'Jan Przejazdowy');
    const scooterId = await ctx.idOf(1);
    const rentalId = await ctx.ride(rider.token, 1);
    await ctx.endRide(rider.token, 1);
    const ring = await ctx.staff.admin({
      method: 'POST',
      url: `/admin/scooters/${scooterId}/commands`,
      payload: { type: 'RING' },
    });
    expect(ring.statusCode).toBe(202);

    const commands = await items<shared.ScooterCommandListItem>(
      ctx.staff.technician,
      `/admin/scooter-commands?scooterId=${scooterId}&sort=sentAt`,
    );
    expect(commands.map((c) => `${c.type}:${c.source}`)).toEqual(['UNLOCK:RENTAL', 'LOCK:RENTAL', 'RING:STAFF']);
    expect(commands[0]).toMatchObject({ rentalId, status: 'ACKED', responseMs: expect.any(Number) });
    expect(commands[2]).toMatchObject({ staffName: 'Admin Testowy', rentalId: null, status: 'SENT' });

    const events = await items<shared.RentalEventListItem>(
      ctx.staff.dispatcher,
      `/admin/rental-events?rentalId=${rentalId}`,
    );
    expect(events.length).toBeGreaterThan(0);
    expect(events.every((e) => e.userName === 'Jan Przejazdowy' && e.scooterNumber === 1)).toBe(true);
    // Rola z `rentals.read` bez `users.read`: imię klienta zamaskowane, sortowanie po nim zabronione.
    const role = (
      await ctx.pool.query<{ id: string }>(
        `INSERT INTO roles (name, description) VALUES ('Podgląd przejazdów', '-') RETURNING id`,
      )
    ).rows[0]!.id;
    await ctx.pool.query(`INSERT INTO role_permissions (role_id, permission_code) VALUES ($1, 'rentals.read')`, [role]);
    const viewerId = (
      await ctx.pool.query<{ id: string }>(
        `INSERT INTO staff (email, name, password_hash) VALUES ('p@test.local', 'Podgląd', 'x') RETURNING id`,
      )
    ).rows[0]!.id;
    await ctx.pool.query(`INSERT INTO staff_roles (staff_id, role_id) VALUES ($1, $2)`, [viewerId, role]);
    const viewer = asStaff(ctx.app, staffToken(ctx.app, viewerId));
    const masked = await items<shared.RentalEventListItem>(viewer, `/admin/rental-events?rentalId=${rentalId}`);
    expect(masked.every((e) => e.userName === null)).toBe(true);
    expect((await viewer({ method: 'GET', url: '/admin/rental-events?sort=userName' })).statusCode).toBe(403);

    const from = new Date(Date.now() - 3_600_000).toISOString();
    const to = new Date(Date.now() + 3_600_000).toISOString();
    const history = await items<shared.ScooterStatusHistoryItem>(
      ctx.staff.technician,
      `/admin/scooter-status-history?scooterId=${scooterId}&from=${from}&to=${to}&sort=validFrom`,
    );
    expect(history.map((h) => h.status)).toEqual(expect.arrayContaining(['AVAILABLE', 'IN_USE']));
    expect(history.at(-1)).toMatchObject({ isOpen: true, validTo: null });
    expect(
      (await ctx.staff.technician({ method: 'GET', url: `/admin/scooter-status-history?from=${from}` })).statusCode,
    ).toBe(400);

    const time = await ctx.staff.technician({
      method: 'GET',
      url: `/admin/scooters/${scooterId}/status-time?from=${from}&to=${to}`,
    });
    expect(time.statusCode).toBe(200);
    const body = time.json<shared.ScooterStatusTime>();
    expect(body.intervals.map((i) => i.category)).toEqual(expect.arrayContaining(['AVAILABLE', 'IN_RIDE']));
    // Historia zaczyna się przy założeniu hulajnogi (wyzwalacz), więc kategorie pokrywają czas od jej początku.
    const sum = Object.values(body.totals).reduce((a, b) => a + b, 0);
    const covered = (Date.parse(body.now) - Date.parse(body.historySince!)) / 1000;
    expect(Math.abs(sum - covered)).toBeLessThanOrEqual(1);
    expect(body.periodSeconds).toBeGreaterThanOrEqual(3599);
    expect(body.utilization).toBeCloseTo(body.totals.IN_RIDE / body.periodSeconds, 6);
    expect(body.availability).toBeCloseTo(
      (body.totals.AVAILABLE + body.totals.RESERVED + body.totals.IN_RIDE) / body.periodSeconds,
      6,
    );
    const tooLong = await ctx.staff.technician({
      method: 'GET',
      url: `/admin/scooters/${scooterId}/status-time?from=2026-01-01T00:00:00Z&to=2026-06-01T00:00:00Z`,
    });
    expect(tooLong.statusCode).toBe(400);
    expect(
      (await editor({ method: 'GET', url: `/admin/scooters/${scooterId}/status-time?from=${from}&to=${to}` }))
        .statusCode,
    ).toBe(403);
  });
});
