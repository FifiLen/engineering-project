'use client';

import type { ListResponse, SimulatorOverview, TicketListItem } from '@hulajnogi/shared';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useEffect, useRef, useState, type ComponentType } from 'react';
import { api } from '../../lib/api';
import { t } from '../../lib/i18n';
import { useStaffFeed } from '../../lib/realtime';
import { useSession } from '../../lib/session';
import {
  BoxIcon,
  BrandMark,
  BriefcaseIcon,
  CardIcon,
  ChipIcon,
  DocumentIcon,
  GridIcon,
  ListIcon,
  LogoutIcon,
  MapIcon,
  NotificationIcon,
  ParkingIcon,
  PrinterIcon,
  RouteIcon,
  ScooterIcon,
  ServiceIcon,
  ShieldIcon,
  TagIcon,
  UsersIcon,
} from './icons';
import { ChartBarsIcon } from './reports/report-icons';
import { REPORTS_NAV_PERMISSIONS } from './reports/reports-common';

const ZonesIcon = () => <ParkingIcon size={18} strokeWidth={1.9} />;

interface NavItem {
  href: string;
  label: string;
  Icon: ComponentType;
  /** Uprawnienie do odczytu ekranu; pozycje bez niego są ukryte (ADR 0028). Lista: wystarczy jedno z nich. */
  permission: string | string[];
  /** Adres zależny od uprawnień (Wydruki bez `templates.read` otwierają zakładkę Wygenerowane). */
  hrefFor?: (can: (permission: string) => boolean) => string;
  /** Inne ścieżki tej samej pozycji (zakładki). */
  also?: string[];
  /** Pozycja aktywna tylko pod dokładnie tym adresem (pulpit pod `/admin`). */
  exact?: boolean;
  /** Licznik przy pozycji (nowe zgłoszenia). */
  badge?: 'newTickets';
  /** Pozycja widoczna tylko, gdy API udostępnia ekran (symulator tylko w środowisku deweloperskim, ADR 0059). */
  feature?: 'simulator';
}

/**
 * Nawigacja boczna pogrupowana jak w makietach 27-panel-serwis, 29-panel-wydruki i 32-panel-raporty (Raporty
 * w Analizie przed Wydrukami).
 */
const groups: Array<{ label?: string; items: NavItem[] }> = [
  {
    items: [
      { href: '/admin', label: t('admin.nav.dashboard'), Icon: GridIcon, permission: 'dashboard.read', exact: true },
      { href: '/admin/mapa', label: t('admin.nav.map'), Icon: MapIcon, permission: 'scooters.read' },
    ],
  },
  {
    label: t('admin.nav.operations'),
    items: [
      { href: '/admin/flota', label: t('admin.nav.fleet'), Icon: ListIcon, permission: 'scooters.read' },
      { href: '/admin/przejazdy', label: t('admin.nav.rentals'), Icon: RouteIcon, permission: 'rentals.read' },
      // Płatności, księga, portfele, paragony, metody płatności, webhooki i zwroty to zakładki jednej pozycji (D5).
      { href: '/admin/platnosci', label: t('admin.nav.payments'), Icon: CardIcon, permission: 'payments.read' },
    ],
  },
  {
    label: t('admin.nav.service'),
    items: [
      {
        href: '/admin/zgloszenia',
        label: t('admin.nav.tickets'),
        Icon: ServiceIcon,
        permission: 'tickets.read',
        badge: 'newTickets',
      },
      { href: '/admin/zadania', label: t('admin.nav.tasks'), Icon: BriefcaseIcon, permission: 'service.read' },
      { href: '/admin/czesci', label: t('admin.nav.parts'), Icon: BoxIcon, permission: 'service.read' },
    ],
  },
  {
    label: t('admin.nav.configuration'),
    items: [
      { href: '/admin/strefy', label: t('admin.nav.zones'), Icon: ZonesIcon, permission: 'zones.read' },
      { href: '/admin/cennik', label: t('admin.nav.tariffs'), Icon: TagIcon, permission: 'tariffs.read' },
      { href: '/admin/modele', label: t('admin.nav.models'), Icon: ScooterIcon, permission: 'scooters.read' },
      { href: '/admin/tresci', label: t('admin.nav.content'), Icon: DocumentIcon, permission: 'content.read' },
      // Szablony, wysłane powiadomienia i tokeny push to zakładki jednej pozycji (makieta szablony-powiadomien).
      {
        href: '/admin/powiadomienia',
        label: t('admin.nav.notifications'),
        Icon: NotificationIcon,
        permission: 'content.read',
      },
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
  {
    label: t('admin.nav.analysis'),
    items: [
      // Raporty, Historia i Definicje to zakładki jednej pozycji (ADR 0071); widoczna przy dowolnym `reports.<kod>`.
      {
        href: '/admin/raporty',
        label: t('admin.nav.reports'),
        Icon: ChartBarsIcon,
        permission: REPORTS_NAV_PERMISSIONS,
      },
      // Szablony (`templates.read`) i Wygenerowane (`documents.generate`) to zakładki jednej pozycji (ADR 0068).
      {
        href: '/admin/wydruki',
        label: t('admin.nav.prints'),
        Icon: PrinterIcon,
        permission: ['templates.read', 'documents.generate'],
        also: ['/admin/wydruki'],
        hrefFor: (can) => (can('templates.read') ? '/admin/wydruki' : '/admin/wydruki/wygenerowane'),
      },
      {
        href: '/admin/symulator',
        label: t('admin.nav.simulator'),
        Icon: ChipIcon,
        permission: 'simulator.manage',
        feature: 'simulator',
      },
    ],
  },
];

/** Czy API udostępnia symulator (`GET /admin/simulator/status` zwraca 404 poza środowiskiem deweloperskim). */
let simulatorAvailable: Promise<boolean> | null = null;

function useSimulatorAvailable(allowed: boolean): boolean {
  const [available, setAvailable] = useState(false);
  useEffect(() => {
    if (!allowed) return;
    simulatorAvailable ??= api<SimulatorOverview>('/admin/simulator/status')
      .then((s) => s.enabled)
      .catch(() => {
        simulatorAvailable = null;
        return false;
      });
    let current = true;
    void simulatorAvailable.then((value) => current && setAvailable(value));
    return () => {
      current = false;
    };
  }, [allowed]);
  return allowed && available;
}

/** Liczba nowych zgłoszeń przy pozycji „Zgłoszenia”, odświeżana po zdarzeniu `ticket.updated` (ADR 0055). */
function useNewTickets(allowed: boolean): number {
  const [count, setCount] = useState(0);
  const [revision, setRevision] = useState(0);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const bump = () => {
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => setRevision((n) => n + 1), 1000);
  };
  useStaffFeed(allowed ? { tickets: bump, reconnected: bump } : {});
  useEffect(() => {
    if (!allowed) return;
    const controller = new AbortController();
    api<ListResponse<TicketListItem>>('/admin/tickets?status=NEW&pageSize=1', { signal: controller.signal })
      .then((r) => setCount(r.total))
      .catch(() => undefined);
    return () => controller.abort();
  }, [allowed, revision]);
  useEffect(() => () => void (timer.current && clearTimeout(timer.current)), []);
  return allowed ? count : 0;
}

export function Sidebar() {
  const pathname = usePathname();
  const { staff, can, logout } = useSession();
  const simulator = useSimulatorAvailable(can('simulator.manage'));
  const newTickets = useNewTickets(can('tickets.read'));
  const visible = groups
    .map((group) => ({
      ...group,
      items: group.items
        .filter(
          (item) =>
            (Array.isArray(item.permission) ? item.permission.some((p) => can(p)) : can(item.permission)) &&
            (item.feature !== 'simulator' || simulator),
        )
        .map((item) => (item.hrefFor ? { ...item, href: item.hrefFor(can) } : item)),
    }))
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
          {group.items.map(({ href, label, Icon, also, exact, badge }) => (
            <Link
              key={href}
              href={href}
              className="nav-item"
              aria-current={
                (exact ? pathname === href : [href, ...(also ?? [])].some((p) => pathname.startsWith(p)))
                  ? 'page'
                  : undefined
              }
            >
              <Icon />
              {label}
              {badge === 'newTickets' && newTickets > 0 && (
                <span className="nav-badge num" aria-label={t('admin.nav.newTickets', { count: newTickets })}>
                  {newTickets}
                </span>
              )}
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
