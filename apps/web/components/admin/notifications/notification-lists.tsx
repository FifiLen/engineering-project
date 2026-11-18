'use client';

/**
 * Pozycja „Powiadomienia” (iteracja 6, ADR 0058, makieta szablony-powiadomien): zakładki Szablony, Wysłane i Tokeny
 * push oraz dwie listy tylko do odczytu na wzorcu (ADR 0031). Dane klienta tylko z `users.read`; bez niego API
 * podaje `null`, a panel pokazuje „Klient”.
 */
import {
  notificationsResource,
  pushTokensResource,
  type ListResponse,
  type NotificationListItem,
  type NotificationStatus,
  type PushTokenListItem,
} from '@hulajnogi/shared';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useEffect, useState } from 'react';
import { api } from '../../../lib/api';
import { formatClock, formatDate, formatDateTime, formatRelative, isToday, t } from '../../../lib/i18n';
import { useSession } from '../../../lib/session';
import type { FilterSpec } from '../filter-drawer';
import { rentalNumber } from '../fleet/fleet-format';
import { NotificationIcon, PhoneIcon } from '../icons';
import { valueLabel } from '../labels';
import { ResourceList, type Column } from '../resource-list';
import { NOTIFICATIONS_BASE, ticketNumber, TICKETS_BASE } from '../service/service-format';

const SENT_PATH = `${NOTIFICATIONS_BASE}/wyslane`;
const TOKENS_PATH = `${NOTIFICATIONS_BASE}/tokeny`;

const total = (path: string) =>
  api<ListResponse<unknown>>(path)
    .then((r) => r.total)
    .catch(() => null);

/** Zakładki z liczbami (makieta): szablony, wysłane, tokeny push (te ostatnie tylko z `users.read`). */
export function NotificationsTabs() {
  const pathname = usePathname();
  const { can } = useSession();
  const tokens = can('users.read');
  const [counts, setCounts] = useState<{ templates: number | null; sent: number | null; tokens: number | null }>({
    templates: null,
    sent: null,
    tokens: null,
  });
  useEffect(() => {
    void Promise.all([
      total('/admin/notification-templates?pageSize=10'),
      total('/admin/notifications?pageSize=10'),
      tokens ? total('/admin/push-tokens?pageSize=10') : Promise.resolve(null),
    ]).then(([templates, sent, tokenCount]) => setCounts({ templates, sent, tokens: tokenCount }));
  }, [tokens]);
  const tabs = [
    { href: NOTIFICATIONS_BASE, label: t('notifications.tabs.templates'), count: counts.templates },
    { href: SENT_PATH, label: t('notifications.tabs.sent'), count: counts.sent },
    ...(tokens ? [{ href: TOKENS_PATH, label: t('notifications.tabs.tokens'), count: counts.tokens }] : []),
  ];
  const active = tabs.slice(1).find((tab) => pathname.startsWith(tab.href))?.href ?? NOTIFICATIONS_BASE;
  return (
    <nav className="tabs" aria-label={t('admin.nav.notifications')}>
      {tabs.map((tab) => (
        <Link key={tab.href} href={tab.href} className="tab" aria-current={tab.href === active ? 'page' : undefined}>
          {tab.label}
          {tab.count !== null && <span className="n num">{t('notifications.tabs.count', { count: tab.count })}</span>}
        </Link>
      ))}
    </nav>
  );
}

function When({ at }: { at: string }) {
  return (
    <span className="num" title={formatDateTime(at)}>
      {isToday(at) ? formatClock(at) : formatDate(at)}
    </span>
  );
}

// ---------------------------------------------------------------------------------------------
// Wysłane
// ---------------------------------------------------------------------------------------------

const STATUS_PILL: Record<NotificationStatus, string> = {
  QUEUED: 'pill accent',
  SENT: 'pill',
  FAILED: 'pill danger',
  SKIPPED: 'pill muted',
};

/** Rekord, którego dotyczy powiadomienie: przejazd albo zgłoszenie. */
function Subject({ n }: { n: NotificationListItem }) {
  const { can } = useSession();
  if (n.rentalId && n.rentalNumber !== null)
    return can('rentals.read') ? (
      <Link className="link" href={`/admin/przejazdy/${n.rentalId}`}>
        {rentalNumber(n.rentalNumber)}
      </Link>
    ) : (
      <span>{rentalNumber(n.rentalNumber)}</span>
    );
  if (n.ticketId && n.ticketNumber !== null)
    return can('tickets.read') ? (
      <Link className="link" href={`${TICKETS_BASE}/${n.ticketId}`}>
        {ticketNumber(n.ticketNumber)}
      </Link>
    ) : (
      <span>{ticketNumber(n.ticketNumber)}</span>
    );
  return <span className="muted">{t('common.none')}</span>;
}

const errorLabel = (error: string) => valueLabel(notificationsResource, 'error', error);

const sentColumns: Column<NotificationListItem>[] = [
  { field: 'createdAt', width: '64px', render: (n) => <When at={n.createdAt} /> },
  { field: 'templateCode', width: '170px', render: (n) => <span className="code ink">{n.templateCode}</span> },
  {
    field: 'body',
    width: 'minmax(0,2fr)',
    render: (n) => (
      <span className="stack">
        <span className="strong-500">{n.title ?? valueLabel(notificationsResource, 'channel', n.channel)}</span>
        <span className="small">{n.body ?? t('common.none')}</span>
      </span>
    ),
  },
  {
    field: 'userName',
    width: 'minmax(0,1fr)',
    render: (n) => (
      <span className="stack">
        <span>{n.userName ?? t('service.customer')}</span>
        {n.userPhone && <span className="small">{n.userPhone}</span>}
      </span>
    ),
  },
  { field: 'rentalNumber', width: '84px', render: (n) => <Subject n={n} /> },
  {
    field: 'status',
    width: '150px',
    render: (n) => (
      <span className="stack">
        <span>
          <span className={`${STATUS_PILL[n.status]} sm`}>{valueLabel(notificationsResource, 'status', n.status)}</span>
        </span>
        {n.error && <span className="small">{errorLabel(n.error)}</span>}
      </span>
    ),
  },
];

const sentFilters: FilterSpec[] = [
  { field: 'status', kind: 'checklist' },
  { field: 'templateCode', kind: 'checklist' },
  { field: 'channel', kind: 'chips' },
  { field: 'createdAt', kind: 'dateRange' },
];

export function SentNotificationList() {
  const { can } = useSession();
  return (
    <ResourceList<NotificationListItem>
      resource={notificationsResource}
      basePath={SENT_PATH}
      columns={sentColumns}
      quick={{ field: 'status', values: ['SENT', 'QUEUED', 'FAILED', 'SKIPPED'] }}
      filters={sentFilters}
      rowLabel={(n) => `${n.templateCode} ${n.id}`}
      itemHref={(n) => (can('users.read') ? `/admin/klienci/${n.userId}` : null)}
      summary={(data) => t('resource.notifications.summary', { count: data.total })}
      emptyIcon={<NotificationIcon size={22} />}
      tabs={<NotificationsTabs />}
      createLabel={null}
      selectable={false}
    />
  );
}

// ---------------------------------------------------------------------------------------------
// Tokeny push
// ---------------------------------------------------------------------------------------------

const tokenColumns: Column<PushTokenListItem>[] = [
  {
    field: 'userName',
    width: 'minmax(0,1fr)',
    render: (p) => (
      <span className="stack">
        <span>{p.userName ?? t('service.customer')}</span>
        {p.userPhone && <span className="small">{p.userPhone}</span>}
      </span>
    ),
  },
  { field: 'platform', width: '96px', render: (p) => valueLabel(pushTokensResource, 'platform', p.platform) },
  { field: 'expoToken', width: 'minmax(0,1.6fr)', render: (p) => <span className="code">{p.expoToken}</span> },
  {
    field: 'sessionActive',
    width: '110px',
    render: (p) => (
      <span className={p.sessionActive ? 'pill sm' : 'pill muted sm'}>
        {valueLabel(pushTokensResource, 'sessionActive', p.sessionActive)}
      </span>
    ),
  },
  { field: 'createdAt', width: '80px', render: (p) => <When at={p.createdAt} /> },
  {
    field: 'lastSeenAt',
    width: '110px',
    render: (p) => <span title={formatDateTime(p.lastSeenAt)}>{formatRelative(p.lastSeenAt)}</span>,
  },
];

const tokenFilters: FilterSpec[] = [
  { field: 'platform', kind: 'chips' },
  { field: 'sessionActive', kind: 'boolean' },
  { field: 'lastSeenAt', kind: 'dateRange' },
];

export function PushTokenList() {
  return (
    <ResourceList<PushTokenListItem>
      resource={pushTokensResource}
      basePath={TOKENS_PATH}
      columns={tokenColumns}
      quick={{ field: 'platform', values: ['IOS', 'ANDROID'] }}
      filters={tokenFilters}
      rowLabel={(p) => p.expoToken}
      itemHref={(p) => `/admin/klienci/${p.userId}`}
      summary={(data) => t('resource.push-tokens.summary', { count: data.total })}
      emptyIcon={<PhoneIcon size={22} />}
      tabs={<NotificationsTabs />}
      createLabel={null}
      selectable={false}
    />
  );
}
