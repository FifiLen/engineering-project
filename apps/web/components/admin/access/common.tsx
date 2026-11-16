'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { t } from '../../../lib/i18n';
import { useSession } from '../../../lib/session';

/** Zakładki „Operatorzy i role” (makiety dostep-operatorzy, dostep-role, dostep-audyt); ukryte bez uprawnień. */
export function AccessTabs() {
  const pathname = usePathname();
  const { can } = useSession();
  const tabs = [
    { href: '/admin/operatorzy', label: t('access.tabs.staff'), permission: 'staff.read' },
    { href: '/admin/role', label: t('access.tabs.roles'), permission: 'staff.read' },
    { href: '/admin/dziennik', label: t('access.tabs.audit'), permission: 'audit.read' },
  ].filter((tab) => can(tab.permission));
  return (
    <nav className="tabs" aria-label={t('admin.nav.staff')}>
      {tabs.map((tab) => (
        <Link key={tab.href} href={tab.href} className="tab" aria-current={pathname.startsWith(tab.href) ? 'page' : undefined}>
          {tab.label}
        </Link>
      ))}
    </nav>
  );
}

export function initials(name: string | null): string {
  return (name ?? '?')
    .split(/\s+/)
    .map((part) => part[0] ?? '')
    .join('')
    .slice(0, 2)
    .toUpperCase();
}

/** Osoba w wierszu tabeli: inicjały, imię i druga linia (e-mail albo telefon). */
export function Person({ name, detail }: { name: string; detail?: string | null }) {
  return (
    <span className="person">
      <span className="av" aria-hidden="true">
        {initials(name)}
      </span>
      <span className="who">
        <span className="strong">{name}</span>
        {detail && <small>{detail}</small>}
      </span>
    </span>
  );
}

/** Podsumowanie i błąd formularza ekranów dostępu; ten sam wygląd co w ResourceForm. */
export function Banner({ kind, children }: { kind: 'ok' | 'danger' | 'warn'; children: React.ReactNode }) {
  return (
    <div className={kind === 'warn' ? 'banner' : `banner ${kind}`} role={kind === 'ok' ? 'status' : 'alert'}>
      <div>{children}</div>
    </div>
  );
}
