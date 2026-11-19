'use client';

/**
 * Zakładki obszarów domenowych według ADR 0076 („Miejsca w panelu”, D7): nowe listy iteracji 8 są zakładkami obok
 * dotychczasowych list, a nie osobnymi pozycjami nawigacji. Każda zakładka ma uprawnienie odczytu swojej listy.
 */
import type { ListResponse, ScooterListItem } from '@hulajnogi/shared';
import { useEffect, useState } from 'react';
import { api } from '../../lib/api';
import { t } from '../../lib/i18n';
import { AreaTabs, type AreaTab } from './area-tabs';

export const AREA_PATHS = {
  fleet: '/admin/flota',
  telemetry: '/admin/flota/telemetria',
  commands: '/admin/flota/komendy',
  rentals: '/admin/przejazdy',
  rentalEvents: '/admin/przejazdy/zdarzenia',
  zones: '/admin/strefy',
  zonePresence: '/admin/strefy/obecnosc',
  zoneControl: '/admin/strefy/sterowanie',
  users: '/admin/klienci',
  consents: '/admin/klienci/zgody',
  sessions: '/admin/klienci/sesje',
  otpCodes: '/admin/klienci/kody-sms',
  staff: '/admin/operatorzy',
  invitations: '/admin/operatorzy/zaproszenia',
  staffSessions: '/admin/operatorzy/sesje',
  roles: '/admin/role',
  permissions: '/admin/uprawnienia',
  audit: '/admin/dziennik',
} as const;

const fleetTabs: AreaTab[] = [
  { href: AREA_PATHS.fleet, label: t('areas.fleet.scooters'), permission: 'scooters.read', countPath: '/admin/scooters' },
  { href: AREA_PATHS.telemetry, label: t('areas.fleet.telemetry'), permission: 'telemetry.read' },
  {
    href: AREA_PATHS.commands,
    label: t('areas.fleet.commands'),
    permission: 'scooters.read',
    countPath: '/admin/scooter-commands',
  },
];

export const FleetTabs = () => <AreaTabs tabs={fleetTabs} label={t('admin.nav.fleet')} />;

const rentalTabs: AreaTab[] = [
  { href: AREA_PATHS.rentals, label: t('areas.rentals.rentals'), permission: 'rentals.read' },
  { href: AREA_PATHS.rentalEvents, label: t('areas.rentals.events'), permission: 'rentals.read' },
];

export const RentalTabs = () => <AreaTabs tabs={rentalTabs} label={t('admin.nav.rentals')} />;

const zoneTabs: AreaTab[] = [
  { href: AREA_PATHS.zones, label: t('areas.zones.zones'), permission: 'zones.read' },
  { href: AREA_PATHS.zonePresence, label: t('areas.zones.presence'), permission: 'zones.read' },
  { href: AREA_PATHS.zoneControl, label: t('areas.zones.control'), permission: 'zones.read' },
];

export const ZoneTabs = () => <AreaTabs tabs={zoneTabs} label={t('admin.nav.zones')} />;

const userTabs: AreaTab[] = [
  { href: AREA_PATHS.users, label: t('areas.users.customers'), permission: 'users.read', countPath: '/admin/users' },
  { href: AREA_PATHS.consents, label: t('areas.users.consents'), permission: 'users.read', countPath: '/admin/consents' },
  { href: AREA_PATHS.sessions, label: t('areas.users.sessions'), permission: 'users.read', countPath: '/admin/sessions' },
  { href: AREA_PATHS.otpCodes, label: t('areas.users.otpCodes'), permission: 'users.read', countPath: '/admin/otp-codes' },
];

export const UserTabs = () => <AreaTabs tabs={userTabs} label={t('admin.nav.users')} />;

const accessTabs: AreaTab[] = [
  { href: AREA_PATHS.staff, label: t('access.tabs.staff'), permission: 'staff.read', countPath: '/admin/staff' },
  {
    href: AREA_PATHS.invitations,
    label: t('areas.access.invitations'),
    permission: 'staff.read',
    countPath: '/admin/staff-invitations',
  },
  {
    href: AREA_PATHS.staffSessions,
    label: t('areas.access.sessions'),
    permission: 'staff.read',
    countPath: '/admin/staff-sessions',
  },
  { href: AREA_PATHS.roles, label: t('access.tabs.roles'), permission: 'staff.read', countPath: '/admin/roles' },
  {
    href: AREA_PATHS.permissions,
    label: t('areas.access.permissions'),
    permission: 'roles.manage',
    countPath: '/admin/permissions',
  },
  { href: AREA_PATHS.audit, label: t('access.tabs.audit'), permission: 'audit.read' },
];

/** Zakładki „Operatorzy i role” (ADR 0076): Operatorzy, Zaproszenia, Sesje, Role, Uprawnienia, Dziennik audytu. */
export const AccessAreaTabs = () => <AreaTabs tabs={accessTabs} label={t('admin.nav.staff')} />;

/** Podtytuł obszaru Flota z makiet: liczba hulajnóg i liczba bez łączności (bez filtrów listy). */
export function useFleetSubtitle(): string | null {
  const [text, setText] = useState<string | null>(null);
  useEffect(() => {
    const controller = new AbortController();
    api<ListResponse<ScooterListItem>>('/admin/scooters?pageSize=10&facets=fleetStatus', { signal: controller.signal })
      .then((r) =>
        setText(
          t('areas.fleet.subtitle', {
            count: r.total,
            offline: r.facets.fleetStatus?.OFFLINE ?? 0,
          }),
        ),
      )
      .catch(() => setText(null));
    return () => controller.abort();
  }, []);
  return text;
}
