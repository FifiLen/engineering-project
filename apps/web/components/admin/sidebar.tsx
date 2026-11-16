'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import type { ComponentType } from 'react';
import { t } from '../../lib/i18n';
import { useSession } from '../../lib/session';
import { BrandMark, ListIcon, LogoutIcon, MapIcon, ScooterIcon } from './icons';

interface NavItem {
  href: string;
  label: string;
  Icon: ComponentType;
  /** Uprawnienie do odczytu ekranu; pozycje bez niego są ukryte (ADR 0028). */
  permission: string;
}

/** Nawigacja boczna pogrupowana jak w makiecie wzorca widoku tabeli; tylko gotowe ekrany. */
const groups: Array<{ label?: string; items: NavItem[] }> = [
  { items: [{ href: '/admin/mapa', label: t('admin.nav.map'), Icon: MapIcon, permission: 'scooters.read' }] },
  {
    label: t('admin.nav.operations'),
    items: [{ href: '/admin/flota', label: t('admin.nav.fleet'), Icon: ListIcon, permission: 'scooters.read' }],
  },
  {
    label: t('admin.nav.configuration'),
    items: [{ href: '/admin/modele', label: t('admin.nav.models'), Icon: ScooterIcon, permission: 'scooters.read' }],
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
          {group.items.map(({ href, label, Icon }) => (
            <Link
              key={href}
              href={href}
              className="nav-item"
              aria-current={pathname.startsWith(href) ? 'page' : undefined}
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
