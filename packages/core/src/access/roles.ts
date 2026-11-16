import { DomainError } from '../errors.js';
import { isPermission, ROLE_MANAGEMENT, type Permission } from './permissions.js';

/** Zarządzanie rolami i operatorami w panelu (ADR 0028). */

export interface RoleState {
  isSystem: boolean;
  /** Liczba operatorów (także nieaktywnych) z tą rolą; przypisanej roli baza nie pozwala usunąć. */
  staffCount: number;
}

/** Roli systemowej nie usuwamy wcale, a przypisanej dopiero po odebraniu jej operatorom. */
export function ensureRoleRemovable(role: RoleState): void {
  if (role.isSystem) throw new DomainError('ROLE_SYSTEM');
  if (role.staffCount > 0) throw new DomainError('ROLE_IN_USE', { staffCount: role.staffCount });
}

/** Lista uprawnień roli z formularza: tylko kody z katalogu, bez powtórzeń. */
export function parseRolePermissions(codes: readonly string[]): Permission[] {
  const unknown = codes.filter((c) => !isPermission(c));
  if (unknown.length > 0) throw new DomainError('UNKNOWN_PERMISSION', { codes: unknown });
  return [...new Set(codes as Permission[])].sort();
}

export interface PermissionDiff {
  added: Permission[];
  removed: Permission[];
}

/** Różnica uprawnień (podsumowanie przy zapisie roli i wpis w dzienniku audytu). */
export function diffPermissions(before: readonly Permission[], after: readonly Permission[]): PermissionDiff {
  const b = new Set(before);
  const a = new Set(after);
  return {
    added: [...a].filter((p) => !b.has(p)).sort(),
    removed: [...b].filter((p) => !a.has(p)).sort(),
  };
}

/**
 * Operator nie zmienia własnych ról ani nie dezaktywuje własnego konta: takie zmiany robi drugi
 * administrator, a dziennik audytu pokazuje dwie osoby.
 */
export function ensureNotSelf(actorStaffId: string, targetStaffId: string, change: 'ROLES' | 'DEACTIVATE'): void {
  if (actorStaffId === targetStaffId) {
    throw new DomainError(change === 'ROLES' ? 'CANNOT_CHANGE_OWN_ROLES' : 'CANNOT_DEACTIVATE_SELF');
  }
}

export interface StaffAccess {
  id: string;
  active: boolean;
  roleIds: readonly string[];
}

/**
 * Liczba aktywnych operatorów z `roles.manage` po planowanej zmianie. Serwis podaje stan po zmianie
 * (nowe role operatora albo nowe uprawnienia roli), a wynik sprawdza `ensureRoleManagerRemains`.
 */
export function countRoleManagers(
  staff: readonly StaffAccess[],
  rolePermissions: ReadonlyMap<string, readonly Permission[]>,
): number {
  return staff.filter((s) => s.active && s.roleIds.some((r) => rolePermissions.get(r)?.includes(ROLE_MANAGEMENT))).length;
}
