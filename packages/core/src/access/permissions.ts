import { DomainError } from '../errors.js';

/**
 * Katalog uprawnień operatorów (ADR 0028). Kod sprawdza uprawnienia po tych nazwach, więc katalog
 * jest częścią kodu; tabela `permissions` musi mieć te same kody (pilnuje tego test bazy).
 * Nowe uprawnienie to wpis tutaj i migracja z jego opisem.
 */
export const PERMISSIONS = [
  'dashboard.read',
  'scooters.read',
  'scooters.write',
  'scooters.command',
  'telemetry.read',
  'zones.read',
  'zones.write',
  'rentals.read',
  'rentals.manage',
  'tariffs.read',
  'tariffs.write',
  'payments.read',
  'wallet.adjust',
  'users.read',
  'users.manage',
  'tickets.read',
  'tickets.manage',
  'service.read',
  'service.manage',
  'staff.read',
  'staff.manage',
  'roles.manage',
  'audit.read',
  'content.read',
  'content.write',
  // Dane firmy trafiają na dokumenty sprzedaży, więc zapis ma tylko Administrator (ADR 0062, migracja 0011).
  'company.write',
  'reports.revenue',
  'reports.fleet_usage',
  'reports.rides_by_zone',
  'reports.reliability',
  'reports.users',
  'reports.wallet',
  // Nazwy, opisy, aktywność i kolejność definicji raportów: tylko Administrator (ADR 0071, migracja 0013).
  'reports.manage',
  'templates.read',
  'templates.write',
  'documents.generate',
  'simulator.manage',
] as const;
export type Permission = (typeof PERMISSIONS)[number];

/** Uprawnienie, bez którego panelem nie dałoby się już zarządzać. */
export const ROLE_MANAGEMENT: Permission = 'roles.manage';

export function isPermission(code: string): code is Permission {
  return (PERMISSIONS as readonly string[]).includes(code);
}

/** Uprawnienia operatora to suma uprawnień jego ról. */
export class StaffPermissions {
  private readonly granted: ReadonlySet<Permission>;

  constructor(codes: Iterable<string>) {
    this.granted = new Set([...codes].filter(isPermission));
  }

  has(permission: Permission): boolean {
    return this.granted.has(permission);
  }

  /** Brak uprawnienia kończy się błędem `FORBIDDEN` z nazwą brakującego uprawnienia. */
  require(permission: Permission): void {
    if (!this.has(permission)) throw new DomainError('FORBIDDEN', { permission });
  }
}

/**
 * Zmiana ról, przypisań albo dezaktywacja operatora nie może zostawić panelu bez aktywnego
 * operatora z uprawnieniem do zarządzania rolami (ADR 0028).
 */
export function ensureRoleManagerRemains(activeRoleManagersAfterChange: number): void {
  if (activeRoleManagersAfterChange < 1) throw new DomainError('LAST_ROLE_MANAGER');
}
