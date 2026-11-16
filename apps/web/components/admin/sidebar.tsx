'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import type { ComponentType } from 'react';
import { t } from '../../lib/i18n';
import { BrandMark, ListIcon, MapIcon, ScooterIcon } from './icons';

interface NavItem {
  href: string;
  label: string;
  Icon: ComponentType;
}

/**
 * Nawigacja boczna pogrupowana jak w makiecie wzorca widoku tabeli. Pokazuje tylko gotowe ekrany;
 * od iteracji 2 pozycje zależą też od uprawnień operatora (ADR 0028).
 */
const groups: Array<{ label?: string; items: NavItem[] }> = [
  { items: [{ href: '/admin/mapa', label: t('admin.nav.map'), Icon: MapIcon }] },
  { label: t('admin.nav.operations'), items: [{ href: '/admin/flota', label: t('admin.nav.fleet'), Icon: ListIcon }] },
  {
    label: t('admin.nav.configuration'),
    items: [{ href: '/admin/modele', label: t('admin.nav.models'), Icon: ScooterIcon }],
  },
];

export function Sidebar() {
  const pathname = usePathname();
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
      {groups.map((group, i) => (
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
          <ScooterIcon size={16} />
        </div>
        <div>
          {t('admin.devMode')}
          <small>{t('admin.devModeHint')}</small>
        </div>
      </div>
    </nav>
  );
}
