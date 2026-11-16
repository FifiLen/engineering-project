/**
 * Testy integracyjne modułów Konta i Dostęp (iteracja 2) na prawdziwym PostgreSQL: repozytoria,
 * listy panelu, zaproszenie administratora z terminala i strażnik ostatniego zarządzającego rolami.
 */
import { randomUUID } from 'node:crypto';
import { auditEntry, countRoleManagers, PERMISSIONS, type Permission } from '@hulajnogi/core';
import {
  auditLogResource,
  parseListQuery,
  staffResource,
  usersResource,
  type ListQuery,
  type ResourceDefinition,
} from '@hulajnogi/shared';
import { Pool } from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { inviteAdministrator } from './bootstrap.js';
import { createDb, type Database } from './client.js';
import { runMigrations } from './migrator.js';
import { DrizzleAuditLogRepository } from './repositories/audit.repository.js';
import { DrizzleConsentRepository } from './repositories/consents.repository.js';
import { DrizzleCustomerRepository } from './repositories/customers.repository.js';
import { DrizzleLegalDocumentRepository } from './repositories/legal-documents.repository.js';
import { DrizzleOtpRepository } from './repositories/otp.repository.js';
import { DrizzleRoleRepository } from './repositories/roles.repository.js';
import { DrizzleCustomerSessionRepository, DrizzleStaffSessionRepository } from './repositories/sessions.repository.js';
import { DrizzleInvitationRepository, DrizzleStaffRepository } from './repositories/staff.repository.js';
import { seedDatabase } from './seed.js';
import { hashToken } from './tokens.js';

const adminUrl = process.env.DATABASE_URL;
const dbName = `hulajnogi_accounts_${randomUUID().slice(0, 8)}`;
const t0 = new Date('2026-11-16T12:00:00Z');
const after = (seconds: number) => new Date(t0.getTime() + seconds * 1000);

const parse = (def: ResourceDefinition, qs: string): ListQuery => {
  const result = parseListQuery(def, new URLSearchParams(qs));
  if (!result.ok) throw new Error(JSON.stringify(result.issues));
  return result.query;
};

describe.skipIf(!adminUrl)('konta i dostęp w bazie', () => {
  let admin: Pool;
  let pool: Pool;
  let db: Database;
  let adminId: string;

  beforeAll(async () => {
    admin = new Pool({ connectionString: adminUrl });
    await admin.query(`CREATE DATABASE ${dbName}`);
    const url = new URL(adminUrl!);
    url.pathname = `/${dbName}`;
    pool = new Pool({ connectionString: url.toString() });
    pool.on('error', () => undefined);
    await runMigrations(pool);
    await seedDatabase(pool, {
      places: {
        city: 'Test',
        note: '',
        serviceArea: { code: 'AREA-TEST', name: 'Obszar', centerPlace: 'P-01', radiusM: 1000 },
        places: [{ code: 'P-01', name: 'Centrum', query: '', type: 'PARKING', radiusM: 100, lat: 50, lon: 18.5 }],
      },
      fleetSize: 1,
      admin: { email: 'a@test.local', name: 'Piotr Mazur', passwordHash: 'x' },
      staff: [{ email: 'd@test.local', name: 'Marta Wiśniewska', role: 'Dyspozytor', passwordHash: 'x' }],
      documents: [
        { slug: 'regulamin', name: 'Regulamin', consentType: 'TERMS', title: 'Regulamin', bodyMd: 'Wersja 1' },
        { slug: 'polityka-prywatnosci', name: 'Polityka', consentType: 'PRIVACY', title: 'Polityka', bodyMd: 'Wersja 1' },
        { slug: 'zasady-jazdy', name: 'Zasady jazdy', consentType: null, title: 'Zanim ruszysz', bodyMd: 'Kask' },
      ],
    });
    db = createDb(pool);
    adminId = (await pool.query<{ id: string }>(`SELECT id FROM staff WHERE email = 'a@test.local'`)).rows[0]!.id;
  });

  afterAll(async () => {
    await pool?.end();
    await admin?.query(`DROP DATABASE IF EXISTS ${dbName} WITH (FORCE)`);
    await admin?.end();
  });

  it('kody SMS: najnowszy kod, liczenie prób i jednokrotne zużycie', async () => {
    const otp = new DrizzleOtpRepository(db);
    await otp.create('+48500100100', 'h1', after(300));
    await otp.create('+48500100100', 'h2', after(360));
    expect(await otp.issuedSince('+48500100100', after(-60))).toHaveLength(2);
    const latest = (await otp.findLatest('+48500100100'))!;
    expect(latest.codeHash).toBe('h2');
    await otp.countAttempt(latest.id);
    expect((await otp.findLatest('+48500100100'))!.attempts).toBe(1);
    expect(await otp.consume(latest.id, t0)).toBe(true);
    expect(await otp.consume(latest.id, t0)).toBe(false);
  });

  it('klienci: jedno konto na numer, blokada z wersją rekordu, lista z filtrami', async () => {
    const customers = new DrizzleCustomerRepository(db);
    const first = await customers.createOrGet('+48500200200');
    const second = await customers.createOrGet('+48500200200');
    expect(first.created).toBe(true);
    expect(second).toEqual({ record: first.record, created: false });

    const { id, version } = first.record;
    expect(await customers.updateProfile(id, version, { name: 'Anna Kowalczyk', email: 'anna@przyklad.pl' })).toBe(true);
    expect(await customers.block(id, version, 'UNPAID_BALANCE', t0)).toBe(false);
    expect(await customers.block(id, version + 1, 'UNPAID_BALANCE', t0)).toBe(true);

    const blocked = await customers.list(parse(usersResource, 'status=BLOCKED&facets=blockedReason'));
    expect(blocked.items.map((u) => u.name)).toEqual(['Anna Kowalczyk']);
    expect(blocked.facets.blockedReason).toEqual({ UNPAID_BALANCE: 1 });
    expect((await customers.list(parse(usersResource, 'q=500 200'))).total).toBe(0);
    expect((await customers.list(parse(usersResource, 'q=500200'))).total).toBe(1);

    expect(await customers.unblock(id, version + 2)).toBe(true);
    expect((await customers.findById(id))!.status).toBe('ACTIVE');
    const other = await customers.createOrGet('+48500200201');
    await expect(customers.updateProfile(other.record.id, 1, { email: 'anna@przyklad.pl' })).rejects.toThrow(
      expect.objectContaining({ code: 'ALREADY_EXISTS', details: { field: 'email' } }),
    );
  });

  it('sesje: rotacja w rodzinie, wyścig dwóch rotacji, unieważnienie rodziny i wszystkich sesji', async () => {
    const customers = new DrizzleCustomerRepository(db);
    const { record } = await customers.createOrGet('+48500300300');
    const sessions = new DrizzleCustomerSessionRepository(db);
    const first = await sessions.create({ ownerId: record.id, tokenHash: 't1', expiresAt: after(86400), device: 'iPhone 15' });
    const next = await sessions.rotate(first.id, { ownerId: record.id, familyId: first.familyId, tokenHash: 't2', expiresAt: after(86400), device: 'iPhone 15' }, t0);
    expect(next!.familyId).toBe(first.familyId);
    expect(await sessions.rotate(first.id, { ownerId: record.id, familyId: first.familyId, tokenHash: 't3', expiresAt: after(86400), device: null }, t0)).toBeNull();
    expect(await sessions.findByTokenHash('t1')).toMatchObject({ replacedBy: next!.id, revokedAt: t0 });
    expect(await sessions.findByTokenHash('t3')).toBeNull();

    await sessions.create({ ownerId: record.id, tokenHash: 't4', expiresAt: after(86400), device: 'Pixel 8' });
    expect(await sessions.active(record.id, t0)).toHaveLength(2);
    expect(await sessions.revokeFamily(first.familyId, t0)).toBe(1);
    expect(await sessions.revokeAllForOwner(record.id)).toBe(1);
    expect(await sessions.active(record.id, t0)).toEqual([]);

    const staffSessions = new DrizzleStaffSessionRepository(db);
    await staffSessions.create({ ownerId: adminId, tokenHash: 's1', expiresAt: after(3600), device: 'Chrome, macOS' });
    expect((await staffSessions.active(adminId, t0))[0]).toMatchObject({ device: 'Chrome, macOS' });
    expect(await staffSessions.revokeAllForOwner(adminId)).toBe(1);
  });

  it('zgody: dokumenty do akceptacji, idempotentny zapis i nowa wersja dokumentu', async () => {
    const { record } = await new DrizzleCustomerRepository(db).createOrGet('+48500400400');
    const consentsRepo = new DrizzleConsentRepository(db);
    const legal = new DrizzleLegalDocumentRepository(db);
    expect((await consentsRepo.pendingDocuments(record.id)).map((d) => d.slug)).toEqual(['regulamin', 'polityka-prywatnosci']);

    for (const type of ['TERMS', 'PRIVACY'] as const) {
      const doc = await consentsRepo.currentDocument(type);
      await consentsRepo.accept(record.id, type, doc);
      await consentsRepo.accept(record.id, type, doc);
    }
    await consentsRepo.accept(record.id, 'AGE', null);
    expect(await consentsRepo.pendingDocuments(record.id)).toEqual([]);
    expect(await consentsRepo.statuses(record.id)).toEqual(
      expect.arrayContaining([{ type: 'TERMS', isCurrent: true }, { type: 'AGE', isCurrent: true }]),
    );

    const page = (await legal.list()).find((d) => d.slug === 'regulamin')!;
    const draft = await legal.createDraft(page.id, 2, { title: 'Regulamin', bodyMd: 'Wersja 2' }, adminId);
    await legal.updateDraft(draft.id, { changeSummary: 'Nowe zasady parkowania' });
    expect((await legal.findById(page.id))!.draft).toMatchObject({ versionNo: 2, changeSummary: 'Nowe zasady parkowania' });
    await legal.publish(draft.id, t0);

    expect(await consentsRepo.pendingDocuments(record.id)).toEqual([
      expect.objectContaining({ slug: 'regulamin', versionNo: 2, changeSummary: 'Nowe zasady parkowania' }),
    ]);
    const views = await consentsRepo.views(record.id);
    expect(views.find((v) => v.type === 'TERMS')).toMatchObject({ versionNo: 1, currentVersionNo: 2, isCurrent: false });
    const versions = await legal.versions(page.id);
    expect(versions.map((v) => [v.versionNo, v.status, v.acceptances])).toEqual([
      [2, 'PUBLISHED', 0],
      [1, 'ARCHIVED', 1],
    ]);
    expect(versions[1]!.supersededAt).toEqual(t0);
    expect((await legal.published('regulamin'))!.versionNo).toBe(2);
    expect((await legal.list()).find((d) => d.slug === 'regulamin')).toMatchObject({ publishedVersionNo: 2, hasDraft: false });
    expect(await consentsRepo.revoke(record.id, 'TERMS', t0)).toBe(1);
  });

  it('zaproszenie administratora z terminala: konto z rolą, link jednorazowy, ponowne zaproszenie', async () => {
    const first = await inviteAdministrator(pool, { email: ' Nowy.Admin@Operator.pl ', name: 'Nowy Admin' }, t0);
    expect(first.created).toBe(true);
    const invitations = new DrizzleInvitationRepository(db);
    const found = (await invitations.findByTokenHash(hashToken(first.token)))!;
    expect(found).toMatchObject({ staffEmail: 'nowy.admin@operator.pl', invitedByName: null, expiresAt: after(72 * 3600) });

    const again = await inviteAdministrator(pool, { email: 'nowy.admin@operator.pl', name: 'Nowy Admin' }, after(60));
    expect(again).toMatchObject({ staffId: first.staffId, created: false });
    expect((await invitations.findByTokenHash(hashToken(first.token)))!.revokedAt).toEqual(after(60));

    const staffRepo = new DrizzleStaffRepository(db);
    expect(await staffRepo.permissions(first.staffId)).toEqual([...PERMISSIONS].sort());
    const listed = await staffRepo.list(parse(staffResource, 'status=INVITED'));
    expect(listed.items).toEqual([expect.objectContaining({ email: 'nowy.admin@operator.pl', roles: ['Administrator'] })]);

    const invitation = (await invitations.findByTokenHash(hashToken(again.token)))!;
    expect(await invitations.accept(invitation.id, after(120))).toBe(true);
    expect(await invitations.accept(invitation.id, after(120))).toBe(false);
    await staffRepo.setPassword(first.staffId, 'argon2-hash');
    await expect(inviteAdministrator(pool, { email: 'nowy.admin@operator.pl', name: 'X' })).rejects.toThrow(
      expect.objectContaining({ code: 'STAFF_ALREADY_ACTIVATED' }),
    );
  });

  it('operatorzy: logowanie, TOTP, role, filtr ról na liście i reguła ostatniego zarządzającego', async () => {
    const staffRepo = new DrizzleStaffRepository(db);
    const roleRepo = new DrizzleRoleRepository(db);
    const dispatcherId = (await staffRepo.findAuthByEmail('d@test.local'))!.id;

    await staffRepo.recordFailedLogin(dispatcherId, 2, null);
    await staffRepo.setPendingTotp(dispatcherId, 'enc');
    expect(await staffRepo.findAuthById(dispatcherId)).toMatchObject({ failedLogins: 2, totpConfirmed: false, passwordSet: true });
    await staffRepo.confirmTotp(dispatcherId, t0, 100);
    await staffRepo.recordLogin(dispatcherId, t0, 101);
    expect(await staffRepo.findAuthById(dispatcherId)).toMatchObject({ failedLogins: 0, totpConfirmed: true, totpLastStep: 101 });

    const roleIds = Object.fromEntries((await pool.query<{ name: string; id: string }>('SELECT name, id FROM roles')).rows.map((r) => [r.name, r.id]));
    const previous = await staffRepo.setRoles(dispatcherId, [roleIds.Dyspozytor!, roleIds.Serwisant!], adminId);
    expect(previous).toEqual([roleIds.Dyspozytor]);
    const byRole = await staffRepo.list(parse(staffResource, `roleIds=${roleIds.Serwisant}&facets=status,totpEnabled`));
    expect(byRole.items.map((s) => s.email)).toEqual(['d@test.local']);
    expect(byRole.items[0]!.roles).toEqual(['Dyspozytor', 'Serwisant']);
    expect(byRole.facets.totpEnabled).toEqual({ true: 1 });

    const snapshot = await staffRepo.accessSnapshot();
    const map = await roleRepo.permissionMap();
    expect(countRoleManagers(snapshot, map)).toBeGreaterThanOrEqual(1);
    const withoutManage = new Map(map);
    withoutManage.set(roleIds.Administrator!, map.get(roleIds.Administrator!)!.filter((p) => p !== 'roles.manage'));
    expect(countRoleManagers(snapshot, withoutManage)).toBe(0);

    // Zapis macierzy Administratora bez roles.manage odrzuca baza (wyzwalacz z migracji 0004).
    const adminRole = (await roleRepo.findById(roleIds.Administrator!))!;
    await expect(
      roleRepo.setPermissions(adminRole.id, adminRole.version, adminRole.permissions.filter((p) => p !== 'roles.manage')),
    ).rejects.toThrow(expect.objectContaining({ code: 'LAST_ROLE_MANAGER' }));
  });

  it('role: tworzenie, macierz uprawnień z wersją, unikalna nazwa, usunięcie', async () => {
    const roleRepo = new DrizzleRoleRepository(db);
    const { id } = await roleRepo.create({ name: 'Koordynator serwisu', description: null });
    await expect(roleRepo.create({ name: 'Koordynator serwisu', description: null })).rejects.toThrow(
      expect.objectContaining({ code: 'ALREADY_EXISTS', details: { field: 'name' } }),
    );
    const perms: Permission[] = ['service.read', 'service.manage', 'reports.reliability'];
    expect(await roleRepo.setPermissions(id, 1, perms)).toBe(true);
    expect(await roleRepo.setPermissions(id, 1, ['service.read'])).toBe(false);
    expect(await roleRepo.setPermissions(id, 2, ['service.read', 'tickets.read'])).toBe(true);
    const role = (await roleRepo.findById(id))!;
    expect(role).toMatchObject({ permissions: ['service.read', 'tickets.read'], staffCount: 0, isSystem: false, version: 3 });
    expect((await roleRepo.details(id))!.permissionsCount).toBe(2);
    expect((await roleRepo.catalog()).length).toBe(PERMISSIONS.length);
    await roleRepo.delete(id);
    expect(await roleRepo.findById(id)).toBeNull();
  });

  it('dziennik audytu: wpis bez sekretów, lista z filtrami i historia rekordu', async () => {
    const audit = new DrizzleAuditLogRepository(db);
    const entityId = randomUUID();
    await audit.append(
      auditEntry({
        staffId: adminId,
        action: 'scooter.updated',
        entityType: 'scooter',
        entityId,
        data: { changes: { variant: ['GRAFIT', 'KOBALT'] } },
      }),
    );
    await audit.append(
      auditEntry({ staffId: adminId, action: 'staff.invited', entityType: 'staff', entityId: null, data: { invitationToken: 'abc' } }),
    );
    const history = await audit.forEntity('scooter', entityId);
    expect(history).toEqual([expect.objectContaining({ staffName: 'Piotr Mazur', data: { changes: { variant: ['GRAFIT', 'KOBALT'] } } })]);
    const list = await audit.list(parse(auditLogResource, 'entityType=staff&facets=entityType'));
    expect(list.items.map((i) => i.action)).toEqual(['staff.invited']);
    // Liczniki pola pomijają jego własny filtr, żeby szybkie filtry pokazywały wszystkie wartości.
    expect(list.facets.entityType).toEqual({ staff: 1, scooter: 1 });
    expect((await audit.details(list.items[0]!.id))!.data).toEqual({ invitationToken: '[REDACTED]' });
  });
});
