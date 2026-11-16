import { describe, expect, it } from 'vitest';
import { ensureRoleManagerRemains, PERMISSIONS, StaffPermissions } from './permissions.js';

describe('uprawnienia operatora', () => {
  it('kody mają postać obszar.akcja i nie powtarzają się', () => {
    expect(PERMISSIONS.every((p) => /^[a-z_]+\.[a-z_]+$/.test(p))).toBe(true);
    expect(new Set(PERMISSIONS).size).toBe(PERMISSIONS.length);
  });

  it('sprawdza uprawnienia i pomija kody spoza katalogu', () => {
    const staff = new StaffPermissions(['zones.read', 'nieznane.uprawnienie']);
    expect(staff.has('zones.read')).toBe(true);
    expect(staff.has('zones.write')).toBe(false);
    expect(() => staff.require('zones.write')).toThrow(expect.objectContaining({ code: 'FORBIDDEN', details: { permission: 'zones.write' } }));
  });

  it('nie pozwala zostawić panelu bez operatora zarządzającego rolami', () => {
    expect(() => ensureRoleManagerRemains(0)).toThrow(expect.objectContaining({ code: 'LAST_ROLE_MANAGER' }));
    expect(() => ensureRoleManagerRemains(1)).not.toThrow();
  });
});
