'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import type { ComponentType } from 'react';
import { t } from '../../lib/i18n';
import { useSession } from '../../lib/session';
import {
  BrandMark,
  DocumentIcon,
  ListIcon,
  LogoutIcon,
  MapIcon,
  ParkingIcon,
  RouteIcon,
  ScooterIcon,
  ShieldIcon,
  UsersIcon,
} from './icons';

const ZonesIcon = () => <ParkingIcon size={18} strokeWidth={1.9} />;

interface NavItem {
  href: string;
  label: string;
  Icon: ComponentType;
  /** Uprawnienie do odczytu ekranu; pozycje bez niego są ukryte (ADR 0028). */
  permission: string;
  /** Inne ścieżki tej samej pozycji (zakładki). */
  also?: string[];
}

/** Nawigacja boczna pogrupowana jak w makiecie wzorca widoku tabeli; tylko gotowe ekrany. */
const groups: Array<{ label?: string; items: NavItem[] }> = [
  { items: [{ href: '/admin/mapa', label: t('admin.nav.map'), Icon: MapIcon, permission: 'scooters.read' }] },
  {
    label: t('admin.nav.operations'),
    items: [
      { href: '/admin/flota', label: t('admin.nav.fleet'), Icon: ListIcon, permission: 'scooters.read' },
      { href: '/admin/przejazdy', label: t('admin.nav.rentals'), Icon: RouteIcon, permission: 'rentals.read' },
    ],
  },
  {
    label: t('admin.nav.configuration'),
    items: [
      { href: '/admin/strefy', label: t('admin.nav.zones'), Icon: ZonesIcon, permission: 'zones.read' },
      { href: '/admin/modele', label: t('admin.nav.models'), Icon: ScooterIcon, permission: 'scooters.read' },
      { href: '/admin/tresci', label: t('admin.nav.content'), Icon: DocumentIcon, permission: 'content.read' },
    ],
  },
  {
    label: t('admin.nav.access'),
    items: [
      { href: '/admin/klienci', label: t('admin.nav.users'), Icon: UsersIcon, permission: 'users.read' },
      // Operatorzy, role i dziennik audytu to jedna pozycja z zakładkami (makiety 18-panel-dostep).
      {
        href: '/admin/operatorzy',
        label: t('admin.nav.staff'),
        Icon: ShieldIcon,
        permission: 'staff.read',
        also: ['/admin/role', '/admin/dziennik'],
      },
    ],
  },
];

export function Sidebar() {
  const pathname = usePathname();
  const { staff, can, logout } = useSession();
  const visible = groups
    .map((group) => ({ ...group, items: group.items.filter((item) => can(item.permission)) }))
    .filter((group) => group.items.length > 0);
  const initials = staff.name
    .split(/\s+/)
    .map((part) => part[0] ?? '')
    .join('')
    .slice(0, 2)
    .toUpperCase();

  return (
    <nav className="side" aria-label={t('admin.navLabel')}>
      <div className="brand">
        <div className="brand-mark">
          <BrandMark />
        </div>
        <div className="brand-text">
          <span className="brand-name">{t('admin.brand')}</span>
          <span className="brand-sub">{t('admin.brandSub')}</span>
        </div>
      </div>
      {visible.map((group, i) => (
        <div key={group.label ?? i}>
          {group.label && <div className="nav-group">{group.label}</div>}
          {group.items.map(({ href, label, Icon, also }) => (
            <Link
              key={href}
              href={href}
              className="nav-item"
              aria-current={[href, ...(also ?? [])].some((p) => pathname.startsWith(p)) ? 'page' : undefined}
            >
              <Icon />
              {label}
            </Link>
          ))}
        </div>
      ))}
      <div className="me">
        <div className="avatar" aria-hidden="true">
          {initials}
        </div>
        <div className="me-text">
          {staff.name}
          <small>{staff.roles.join(', ') || t('admin.auth.noRoles')}</small>
        </div>
        <button
          type="button"
          className="icon-btn"
          onClick={() => void logout()}
          aria-label={t('admin.auth.logout')}
          title={t('admin.auth.logout')}
        >
          <LogoutIcon size={17} />
        </button>
      </div>
    </nav>
  );
}
