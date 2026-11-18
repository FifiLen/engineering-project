import 'reflect-metadata';
import { randomUUID } from 'node:crypto';
import { PERMISSIONS } from '@hulajnogi/core';
import { runMigrations, seedDatabase, type PlacesFile } from '@hulajnogi/db';
import type * as shared from '@hulajnogi/shared';
import type { NestFastifyApplication } from '@nestjs/platform-fastify';
import { Pool } from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { LoggingSmsGateway } from '../src/auth/sms.gateway.js';
import { createApp } from '../src/bootstrap.js';
import { loadConfig } from '../src/config.js';
import { asStaff, staffToken } from './helpers.js';

const adminUrl = process.env.DATABASE_URL;
const dbName = `hulajnogi_access_api_${randomUUID().slice(0, 8)}`;

const places: PlacesFile = {
  city: 'Test',
  note: '',
  serviceArea: { code: 'AREA-TEST', name: 'Obszar testowy', centerPlace: 'P-01', radiusM: 1000 },
  places: [{ code: 'P-01', name: 'Centrum', query: '', type: 'PARKING', radiusM: 100, lat: 50.0, lon: 18.5 }],
};

describe.skipIf(!adminUrl)('API: zasoby panelu Dostęp i dziennik audytu', () => {
  let admin: Pool;
  let pool: Pool;
  let app: NestFastifyApplication;
  let adminApi: ReturnType<typeof asStaff>;
  let adminId: string;
  const idOf = async (email: string) =>
    (await pool.query<{ id: string }>('SELECT id FROM staff WHERE email = $1', [email])).rows[0]!.id;
  const roleId = async (name: string) =>
    (await pool.query<{ id: string }>('SELECT id FROM roles WHERE name = $1', [name])).rows[0]!.id;
  const as = async (email: string) => asStaff(app, staffToken(app, await idOf(email)));

  /** Klient z aplikacji: kod SMS i zakończona rejestracja. */
  async function customer(phone: string): Promise<shared.CustomerSession> {
    await app.inject({ method: 'POST', url: '/auth/otp', payload: { phone } });
    const code = /(\d{6})/.exec(app.get(LoggingSmsGateway).sent.at(-1)!.text)![1];
    const session = (await app.inject({ method: 'POST', url: '/auth/otp/verify', payload: { phone, code } })).json<shared.CustomerSession>();
    await app.inject({
      method: 'POST',
      url: '/me/registration',
      headers: { authorization: `Bearer ${session.accessToken}` },
      payload: { name: 'Anna Kowalczyk', ageConfirmed: true, acceptedVersionIds: session.me.pendingDocuments.map((d) => d.versionId) },
    });
    return session;
  }

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
      fleetSize: 2,
      admin: { email: 'a@test.local', name: 'Piotr Mazur', passwordHash: 'x' },
      staff: [{ email: 'd@test.local', name: 'Marta Wiśniewska', role: 'Dyspozytor', passwordHash: 'x' }],
      documents: [
        { slug: 'regulamin', name: 'Regulamin', consentType: 'TERMS', title: 'Regulamin', bodyMd: 'Wersja 1' },
        { slug: 'polityka-prywatnosci', name: 'Polityka', consentType: 'PRIVACY', title: 'Polityka', bodyMd: 'Wersja 1' },
      ],
    });
    app = await createApp(
      loadConfig({ NODE_ENV: 'test', DATABASE_URL: url.toString(), MQTT_ENABLED: 'false',
        JOBS_ENABLED: 'false', PANEL_URL: 'http://panel.test' }),
      { logger: false },
    );
    await app.init();
    await app.getHttpAdapter().getInstance().ready();
    adminId = await idOf('a@test.local');
    adminApi = asStaff(app, staffToken(app, adminId));
  });

  afterAll(async () => {
    await app?.close();
    await pool?.end();
    await admin?.query(`DROP DATABASE IF EXISTS ${dbName} WITH (FORCE)`);
    await admin?.end();
  });

  it('zapisy floty z iteracji 1 mają autora w dzienniku i historię rekordu', async () => {
    const scooterId = (await pool.query<{ id: string }>('SELECT id FROM scooters WHERE number = 1')).rows[0]!.id;
    const edited = await adminApi({ method: 'PATCH', url: `/admin/scooters/${scooterId}`, payload: { version: 1, firmware: 'v2.4.2' } });
    expect(edited.statusCode).toBe(200);
    await adminApi({ method: 'PATCH', url: `/admin/scooters/${scooterId}`, payload: { version: 2, status: 'MAINTENANCE' } });
    const history = (await adminApi({ method: 'GET', url: `/admin/scooters/${scooterId}/history` })).json<shared.AuditLogDetails[]>();
    expect(history.map((h) => [h.action, h.staffName, h.data.changes])).toEqual([
      // Formularz floty zapisuje przyczynę serwisu (`OTHER`) razem ze stanem (ADR 0055).
      ['scooter.status_changed', 'Piotr Mazur', { status: ['AVAILABLE', 'MAINTENANCE'], statusReason: [null, 'OTHER'] }],
      ['scooter.updated', 'Piotr Mazur', { firmware: ['v2.4.1', 'v2.4.2'] }],
    ]);
    // Konflikt wersji nie zostawia wpisu: zmiana i wpis są w jednej transakcji.
    const stale = await adminApi({ method: 'PATCH', url: `/admin/scooters/${scooterId}`, payload: { version: 1, firmware: 'x' } });
    expect(stale.statusCode).toBe(409);
    expect((await adminApi({ method: 'GET', url: `/admin/scooters/${scooterId}/history` })).json()).toHaveLength(2);
  });

  describe('operatorzy i role', () => {
    let invitedId: string;

    it('zaproszenie zakłada konto z rolami i zwraca link aktywacji z adresem panelu', async () => {
      const res = await adminApi({
        method: 'POST',
        url: '/admin/staff',
        payload: { email: 'Kamil.Nowak@operator.pl', name: 'Kamil Nowak', roleIds: [await roleId('Dyspozytor')] },
      });
      expect(res.statusCode).toBe(201);
      const body = res.json<shared.StaffInvitationResult>();
      expect(body.invitationUrl).toMatch(/^http:\/\/panel\.test\/admin\/aktywacja\?token=[\w-]{43}$/);
      expect(body.staff).toMatchObject({ email: 'kamil.nowak@operator.pl', status: 'INVITED', roles: ['Dyspozytor'], sessions: [] });
      invitedId = body.staff.id;

      const duplicate = await adminApi({ method: 'POST', url: '/admin/staff', payload: { email: 'kamil.nowak@operator.pl', name: 'Kamil N', roleIds: [await roleId('Dyspozytor')] } });
      expect(duplicate.json()).toMatchObject({ code: 'ALREADY_EXISTS', details: { field: 'email' } });
      const list = await adminApi({ method: 'GET', url: `/admin/staff?status=INVITED&roleIds=${await roleId('Dyspozytor')}` });
      expect(list.json().items.map((s: shared.StaffListItem) => s.email)).toEqual(['kamil.nowak@operator.pl']);
      const resent = await adminApi({ method: 'POST', url: `/admin/staff/${invitedId}/invitation`, payload: { version: 1 } });
      expect(resent.json<shared.StaffInvitationResult>().invitationUrl).not.toBe(body.invitationUrl);
    });

    it('role operatora: zmiana z wpisem nazw ról; własnych ról i siebie zmienić nie można', async () => {
      const res = await adminApi({
        method: 'PATCH',
        url: `/admin/staff/${invitedId}`,
        payload: { version: 1, roleIds: [await roleId('Dyspozytor'), await roleId('Serwisant')] },
      });
      expect(res.json()).toMatchObject({ roles: ['Dyspozytor', 'Serwisant'], version: 2 });
      const history = (await adminApi({ method: 'GET', url: `/admin/staff/${invitedId}/history` })).json<shared.AuditLogDetails[]>();
      expect(history[0]).toMatchObject({ action: 'staff.roles_changed', data: { changes: { roles: [['Dyspozytor'], ['Dyspozytor', 'Serwisant']] } } });

      const own = await adminApi({ method: 'PATCH', url: `/admin/staff/${adminId}`, payload: { version: 1, roleIds: [await roleId('Serwisant')] } });
      expect(own.json()).toMatchObject({ code: 'CANNOT_CHANGE_OWN_ROLES' });
      const self = await adminApi({ method: 'DELETE', url: `/admin/staff/${adminId}?version=1` });
      expect(self.json()).toMatchObject({ code: 'CANNOT_DEACTIVATE_SELF' });
    });

    it('dezaktywacja odcina dostęp od razu, mimo pamięci podręcznej uprawnień', async () => {
      const dispatcher = await as('d@test.local');
      expect((await dispatcher({ method: 'GET', url: '/admin/scooters' })).statusCode).toBe(200);
      const res = await adminApi({ method: 'DELETE', url: `/admin/staff/${await idOf('d@test.local')}?version=1` });
      expect(res.json()).toEqual({ outcome: 'ARCHIVED' });
      expect((await dispatcher({ method: 'GET', url: '/admin/scooters' })).json()).toMatchObject({ details: { reason: 'STAFF_INACTIVE' } });
    });

    it('macierz uprawnień: rola własna, wersja rekordu, nieznane uprawnienie, usuwanie', async () => {
      expect((await adminApi({ method: 'GET', url: '/admin/permissions' })).json()).toHaveLength(PERMISSIONS.length);
      const created = await adminApi({
        method: 'POST',
        url: '/admin/roles',
        payload: { name: 'Kadry', description: 'Zaproszenia i dezaktywacje', permissions: ['staff.read', 'staff.manage'] },
      });
      expect(created.json()).toMatchObject({ name: 'Kadry', permissions: ['staff.manage', 'staff.read'], staff: [] });
      const id = created.json<shared.RoleDetails>().id;
      const version = created.json<shared.RoleDetails>().version;

      const unknown = await adminApi({ method: 'PATCH', url: `/admin/roles/${id}`, payload: { version, permissions: ['staff.fire'] } });
      expect(unknown.statusCode).toBe(400);
      const updated = await adminApi({
        method: 'PATCH',
        url: `/admin/roles/${id}`,
        payload: { version, permissions: ['staff.read', 'staff.manage', 'audit.read'] },
      });
      expect(updated.json()).toMatchObject({ permissions: ['audit.read', 'staff.manage', 'staff.read'], permissionsCount: 3 });
      const stale = await adminApi({ method: 'PATCH', url: `/admin/roles/${id}`, payload: { version, name: 'Kadry stare' } });
      expect(stale.json()).toMatchObject({ code: 'CONFLICT' });
      const history = (await adminApi({ method: 'GET', url: `/admin/roles/${id}/history` })).json<shared.AuditLogDetails[]>();
      expect(history[0]).toMatchObject({ action: 'role.permissions_changed', data: { permissions: { added: ['audit.read'], removed: [] } } });

      // Systemowa jest tylko rola Administrator (migracja 0002); Serwisant ma operatora z poprzedniego testu.
      const system = await adminApi({ method: 'DELETE', url: `/admin/roles/${await roleId('Administrator')}?version=1` });
      expect(system.json()).toMatchObject({ code: 'ROLE_SYSTEM' });
      const inUse = await adminApi({ method: 'DELETE', url: `/admin/roles/${await roleId('Serwisant')}?version=1` });
      expect(inUse.json()).toMatchObject({ code: 'ROLE_IN_USE', details: { staffCount: 1 } });
      const free = await adminApi({ method: 'DELETE', url: `/admin/roles/${id}?version=${version + 1}` });
      expect(free.json()).toEqual({ outcome: 'DELETED' });
    });

    it('nie da się zostawić panelu bez operatora z roles.manage: ani przez macierz, ani przez dezaktywację', async () => {
      const adminRole = (await adminApi({ method: 'GET', url: `/admin/roles/${await roleId('Administrator')}` })).json<shared.RoleDetails>();
      const matrix = await adminApi({
        method: 'PATCH',
        url: `/admin/roles/${adminRole.id}`,
        payload: { version: adminRole.version, permissions: adminRole.permissions.filter((p) => p !== 'roles.manage') },
      });
      expect(matrix.statusCode).toBe(409);
      expect(matrix.json()).toMatchObject({ code: 'LAST_ROLE_MANAGER' });

      // Operator kadr ma staff.manage, ale nie roles.manage: dezaktywacja jedynego administratora jest odrzucana.
      const hr = await adminApi({ method: 'POST', url: '/admin/roles', payload: { name: 'Kadry 2', permissions: ['staff.read', 'staff.manage'] } });
      const { rows } = await pool.query<{ id: string }>(
        `INSERT INTO staff (email, name, password_hash) VALUES ('kadry@test.local', 'Kadry', 'x') RETURNING id`,
      );
      await pool.query('INSERT INTO staff_roles (staff_id, role_id) VALUES ($1, $2)', [rows[0]!.id, hr.json().id]);
      const hrApi = asStaff(app, staffToken(app, rows[0]!.id));
      const version = (await adminApi({ method: 'GET', url: `/admin/staff/${adminId}` })).json<shared.StaffDetails>().version;
      const lastAdmin = await hrApi({ method: 'DELETE', url: `/admin/staff/${adminId}?version=${version}` });
      expect(lastAdmin.json()).toMatchObject({ code: 'LAST_ROLE_MANAGER' });
    });
  });

  describe('klienci, dokumenty i dziennik audytu', () => {
    it('blokada wylogowuje klienta, powód widzi klient, notatka jest tylko w dzienniku', async () => {
      const session = await customer('+48512000111');
      const users = (await adminApi({ method: 'GET', url: '/admin/users?q=512000111' })).json<shared.ListResponse<shared.UserListItem>>();
      expect(users.items).toEqual([expect.objectContaining({ name: 'Anna Kowalczyk', status: 'ACTIVE', activeSessions: 1 })]);
      const id = users.items[0]!.id;
      const details = (await adminApi({ method: 'GET', url: `/admin/users/${id}` })).json<shared.UserDetails>();
      expect(details.consents.map((c) => [c.type, c.isCurrent])).toEqual([
        ['TERMS', true],
        ['PRIVACY', true],
        ['AGE', true],
      ]);

      const blocked = await adminApi({
        method: 'POST',
        url: `/admin/users/${id}/block`,
        payload: { version: details.version, reason: 'UNPAID_BALANCE', note: 'Płatność odrzucona trzykrotnie' },
      });
      expect(blocked.json()).toMatchObject({ status: 'BLOCKED', blockedReason: 'UNPAID_BALANCE', sessions: [] });
      const refresh = await app.inject({ method: 'POST', url: '/auth/refresh', payload: { refreshToken: session.refreshToken } });
      expect(refresh.json()).toMatchObject({ details: { reason: 'SESSION_REVOKED' } });
      const me = await app.inject({ method: 'GET', url: '/me', headers: { authorization: `Bearer ${session.accessToken}` } });
      expect(me.json()).toMatchObject({ status: 'BLOCKED', blockedReason: 'UNPAID_BALANCE', nextStep: 'BLOCKED' });

      const audit = await adminApi({ method: 'GET', url: `/admin/audit-log?entityType=user&entityId=${id}` });
      const entry = (await adminApi({ method: 'GET', url: `/admin/audit-log/${audit.json().items[0].id}` })).json<shared.AuditLogDetails>();
      expect(entry).toMatchObject({ action: 'user.blocked', data: { reason: 'UNPAID_BALANCE', note: 'Płatność odrzucona trzykrotnie', sessionsRevoked: 1 } });

      const again = await adminApi({ method: 'POST', url: `/admin/users/${id}/block`, payload: { version: details.version + 1, reason: 'TERMS_VIOLATION' } });
      expect(again.json()).toMatchObject({ code: 'ALREADY_BLOCKED' });
      const unblocked = await adminApi({ method: 'POST', url: `/admin/users/${id}/unblock`, payload: { version: details.version + 1 } });
      expect(unblocked.json()).toMatchObject({ status: 'ACTIVE', blockedReason: null });
    });

    it('nowa wersja regulaminu: wersja robocza, „najważniejsze zmiany”, publikacja i ponowna akceptacja', async () => {
      const session = await customer('+48512000222');
      const docs = (await adminApi({ method: 'GET', url: '/admin/legal-documents' })).json<shared.LegalDocumentSummary[]>();
      const terms = docs.find((d) => d.slug === 'regulamin')!;
      const draft = (await adminApi({ method: 'POST', url: `/admin/legal-documents/${terms.id}/drafts` })).json<shared.DocumentVersionDetails>();
      expect(draft).toMatchObject({ versionNo: 2, status: 'DRAFT', bodyMd: 'Wersja 1' });
      expect((await adminApi({ method: 'POST', url: `/admin/legal-documents/${terms.id}/drafts` })).json()).toMatchObject({ code: 'DRAFT_EXISTS' });

      await adminApi({ method: 'PATCH', url: `/admin/legal-documents/versions/${draft.id}`, payload: { bodyMd: 'Wersja 2' } });
      const noSummary = await adminApi({ method: 'POST', url: `/admin/legal-documents/versions/${draft.id}/publish` });
      expect(noSummary.json()).toMatchObject({ code: 'VALIDATION_FAILED', details: { fields: ['changeSummary'] } });
      await adminApi({ method: 'PATCH', url: `/admin/legal-documents/versions/${draft.id}`, payload: { changeSummary: 'Nowe zasady parkowania' } });
      const published = await adminApi({ method: 'POST', url: `/admin/legal-documents/versions/${draft.id}/publish` });
      expect(published.json<shared.LegalDocumentDetails>().versions.map((v) => [v.versionNo, v.status])).toEqual([
        [2, 'PUBLISHED'],
        [1, 'ARCHIVED'],
      ]);
      const locked = await adminApi({ method: 'PATCH', url: `/admin/legal-documents/versions/${draft.id}`, payload: { title: 'X' } });
      expect(locked.json()).toMatchObject({ code: 'DOCUMENT_VERSION_LOCKED' });

      const auth = { authorization: `Bearer ${session.accessToken}` };
      const me = (await app.inject({ method: 'GET', url: '/me', headers: auth })).json<shared.MeResponse>();
      expect(me).toMatchObject({ nextStep: 'CONSENTS', pendingDocuments: [{ slug: 'regulamin', versionNo: 2, changeSummary: 'Nowe zasady parkowania' }] });
      const accepted = await app.inject({ method: 'POST', url: '/me/consents', headers: auth, payload: { acceptedVersionIds: [draft.id] } });
      expect(accepted.json()).toMatchObject({ nextStep: 'READY', pendingDocuments: [] });
      const versions = (await adminApi({ method: 'GET', url: `/admin/legal-documents/${terms.id}` })).json<shared.LegalDocumentDetails>().versions;
      expect(versions[0]).toMatchObject({ versionNo: 2, acceptances: 1 });
    });

    it('dziennik audytu wymaga audit.read i ma liczniki rodzajów obiektów', async () => {
      const list = await adminApi({ method: 'GET', url: '/admin/audit-log?facets=entityType&sort=-createdAt' });
      expect(list.statusCode).toBe(200);
      expect(Object.keys(list.json().facets.entityType).sort()).toEqual(['legal_document', 'role', 'scooter', 'staff', 'user']);
      const service = await asStaff(app, staffToken(app, await idOf('kadry@test.local')))({ method: 'GET', url: '/admin/users' });
      expect(service.json()).toMatchObject({ code: 'FORBIDDEN', details: { permission: 'users.read' } });
    });
  });
});
