'use client';

/**
 * Zakładki obszaru domenowego (D7, ADR 0076 „Miejsca w panelu”): Flota, Przejazdy, Strefy, Użytkownicy, Operatorzy
 * i role. Zakładka bez uprawnienia jest ukryta (ADR 0028); aktywna jest zakładka z najdłuższym pasującym adresem,
 * więc `/admin/operatorzy/zaproszenia` nie podświetla „Operatorzy”. Liczby (np. „Zgody 13 205”) z `total` listy.
 */
import type { ListResponse } from '@hulajnogi/shared';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useEffect, useState } from 'react';
import { api } from '../../lib/api';
import { t } from '../../lib/i18n';
import { useSession } from '../../lib/session';

export interface AreaTab {
  href: string;
  label: string;
  /** Uprawnienie odczytu zakładki; bez niego zakładka znika. */
  permission?: string;
  /** Adres listy (`/admin/{zasób}`), z którego panel bierze liczbę wierszy do zakładki. */
  countPath?: string;
  /** Inne adresy tej zakładki (np. karta rekordu). */
  also?: readonly string[];
}

const matches = (pathname: string, href: string) => pathname === href || pathname.startsWith(`${href}/`);

export function AreaTabs({ tabs, label }: { tabs: readonly AreaTab[]; label: string }) {
  const pathname = usePathname();
  const { can } = useSession();
  const visible = tabs.filter((tab) => can(tab.permission));
  const countKey = visible.map((tab) => tab.countPath ?? '').join('|');
  const [counts, setCounts] = useState<Record<string, number>>({});

  useEffect(() => {
    const controller = new AbortController();
    const paths = countKey.split('|').filter(Boolean);
    void Promise.all(
      paths.map((path) =>
        api<ListResponse<unknown>>(`${path}${path.includes('?') ? '&' : '?'}pageSize=10`, { signal: controller.signal })
          .then((r) => [path, r.total] as const)
          .catch(() => null),
      ),
    ).then((entries) => {
      if (!controller.signal.aborted) setCounts(Object.fromEntries(entries.filter((e) => e !== null)));
    });
    return () => controller.abort();
  }, [countKey]);

  const active = visible
    .flatMap((tab) => [tab.href, ...(tab.also ?? [])].filter((href) => matches(pathname, href)).map((href) => ({ tab, href })))
    .sort((a, b) => b.href.length - a.href.length)[0]?.tab;

  return (
    <nav className="tabs" aria-label={label}>
      {visible.map((tab) => {
        const count = tab.countPath ? counts[tab.countPath] : undefined;
        return (
          <Link key={tab.href} href={tab.href} className="tab" aria-current={tab === active ? 'page' : undefined}>
            {tab.label}
            {count !== undefined && <span className="n num">{t('areas.count', { count })}</span>}
          </Link>
        );
      })}
    </nav>
  );
}
