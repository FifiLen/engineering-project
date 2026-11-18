import { describe, expect, it } from 'vitest';
import { diffForAudit, auditEntry, REDACTED, systemAuditEntry } from '../audit/audit.js';
import { PERMISSIONS, type Permission } from './permissions.js';
import {
  countRoleManagers,
  diffPermissions,
  ensureNotSelf,
  ensureRoleRemovable,
  parseRolePermissions,
} from './roles.js';

const err = (code: string) => expect.objectContaining({ code });

describe('role', () => {
  it('nie usuwa roli systemowej ani przypisanej operatorom', () => {
    expect(() => ensureRoleRemovable({ isSystem: false, staffCount: 0 })).not.toThrow();
    expect(() => ensureRoleRemovable({ isSystem: true, staffCount: 0 })).toThrow(err('ROLE_SYSTEM'));
    expect(() => ensureRoleRemovable({ isSystem: false, staffCount: 2 })).toThrow(err('ROLE_IN_USE'));
  });

  it('przyjmuje tylko uprawnienia z katalogu, bez powtórzeń', () => {
    expect(parseRolePermissions(['zones.write', 'zones.read', 'zones.read'])).toEqual(['zones.read', 'zones.write']);
    expect(() => parseRolePermissions(['zones.read', 'zones.delete'])).toThrow(
      expect.objectContaining({ code: 'UNKNOWN_PERMISSION', details: { codes: ['zones.delete'] } }),
    );
  });

  it('liczy różnicę uprawnień do podsumowania i dziennika', () => {
    expect(diffPermissions(['zones.read', 'service.manage'], ['zones.read', 'zones.write'])).toEqual({
      added: ['zones.write'],
      removed: ['service.manage'],
    });
  });

  it('operator nie zmienia własnych ról i nie dezaktywuje siebie', () => {
    expect(() => ensureNotSelf('a', 'b', 'ROLES')).not.toThrow();
    expect(() => ensureNotSelf('a', 'a', 'ROLES')).toThrow(err('CANNOT_CHANGE_OWN_ROLES'));
    expect(() => ensureNotSelf('a', 'a', 'DEACTIVATE')).toThrow(err('CANNOT_DEACTIVATE_SELF'));
  });

  it('liczy aktywnych operatorów z roles.manage po planowanej zmianie', () => {
    const roles = new Map<string, readonly Permission[]>([
      ['admin', [...PERMISSIONS]],
      ['dispatcher', ['scooters.read', 'rentals.manage']],
    ]);
    const staff = [
      { id: '1', active: true, roleIds: ['admin'] },
      { id: '2', active: false, roleIds: ['admin'] },
      { id: '3', active: true, roleIds: ['dispatcher'] },
    ];
    expect(countRoleManagers(staff, roles)).toBe(1);
    // Odebranie roles.manage roli Administrator zostawia panel bez zarządzającego.
    expect(countRoleManagers(staff, new Map([...roles, ['admin', ['scooters.read']]]))).toBe(0);
  });
});

describe('dziennik audytu', () => {
  it('zapisuje tylko zmienione pola, daty jako tekst, bez wersji', () => {
    const before = { variant: 'GRAFIT', firmware: 'v2.4.1', version: 3, seenAt: new Date('2026-11-16T10:00:00Z') };
    const after = { variant: 'KOBALT', firmware: 'v2.4.1', version: 4, seenAt: new Date('2026-11-16T10:00:00Z') };
    expect(diffForAudit(before, after)).toEqual({ variant: ['GRAFIT', 'KOBALT'] });
    expect(diffForAudit({ roles: ['a'] }, { roles: ['a', 'b'] })).toEqual({ roles: [['a'], ['a', 'b']] });
    expect(diffForAudit({ email: null }, { email: undefined })).toEqual({});
  });

  it('nie zapisuje wartości haseł, sekretów i tokenów', () => {
    expect(diffForAudit({ passwordHash: 'old' }, { passwordHash: 'new' })).toEqual({
      passwordHash: [REDACTED, REDACTED],
    });
    const entry = auditEntry({
      staffId: 's',
      action: 'staff.invited',
      entityType: 'staff',
      entityId: 'x',
      data: { roles: ['Dyspozytor'], invitationToken: 'abc' },
    });
    expect(entry.data).toEqual({ roles: ['Dyspozytor'], invitationToken: REDACTED });
    expect(() => auditEntry({ ...entry, action: 'Staff Invited' })).toThrow();
  });

  it('wpis systemu bez operatora z tą samą walidacją akcji i filtrem sekretów (ADR 0055)', () => {
    const entry = systemAuditEntry({
      action: 'scooter.sent_to_service',
      entityType: 'scooter',
      entityId: 'x',
      data: { reason: 'URGENT_TICKET', token: 'abc' },
    });
    expect(entry).toEqual({
      action: 'scooter.sent_to_service',
      entityType: 'scooter',
      entityId: 'x',
      data: { reason: 'URGENT_TICKET', token: REDACTED },
    });
    expect(() => systemAuditEntry({ ...entry, action: 'Auto Close' })).toThrow();
  });
});
