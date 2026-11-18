'use client';

/** Dziennik audytu: tylko odczyt (makieta dostep-audyt; tabela tylko do dopisywania). */
import { auditLogResource, type AuditLogDetails, type AuditLogListItem } from '@hulajnogi/shared';
import Link from 'next/link';
import { useEffect, useState } from 'react';
import { api, errorMessage } from '../../../lib/api';
import { formatDateTime, formatTime, t } from '../../../lib/i18n';
import type { FilterSpec } from '../filter-drawer';
import { actionLabel } from '../history-card';
import { ListIcon } from '../icons';
import { valueLabel } from '../labels';
import { ResourceList, type Column } from '../resource-list';
import { AccessTabs, Banner, Person } from './common';

const BASE = '/admin/dziennik';

const columns: Column<AuditLogListItem>[] = [
  {
    field: 'createdAt',
    width: '150px',
    render: (e) => (
      <span className="who" style={{ display: 'flex', flexDirection: 'column' }}>
        <span className="num">{formatTime(e.createdAt)}</span>
        <small className="muted">{formatDateTime(e.createdAt)}</small>
      </span>
    ),
  },
  {
    field: 'staffName',
    width: 'minmax(0,1.3fr)',
    render: (e) => <Person name={e.staffName ?? t('audit.system')} detail={e.staffEmail} />,
  },
  {
    field: 'action',
    width: 'minmax(0,1.6fr)',
    render: (e) => (
      <span className="who" style={{ display: 'flex', flexDirection: 'column' }}>
        <span>{actionLabel(e.action)}</span>
        <span className="code">{e.action}</span>
      </span>
    ),
  },
  { field: 'entityType', width: '140px', render: (e) => valueLabel(auditLogResource, 'entityType', e.entityType) },
];

const filters: FilterSpec[] = [
  { field: 'entityType', kind: 'checklist' },
  // Wpisy systemu bez operatora (zgłoszenia automatyczne, zadania pg-boss; ADR 0055).
  { field: 'actor', kind: 'chips' },
  { field: 'createdAt', kind: 'dateRange' },
];

export function AuditList() {
  return (
    <ResourceList<AuditLogListItem>
      resource={auditLogResource}
      basePath={BASE}
      columns={columns}
      quick={{ field: 'entityType', values: ['scooter', 'staff', 'role', 'user', 'legal_document'] }}
      filters={filters}
      rowLabel={(e) => actionLabel(e.action)}
      summary={() => t('resource.audit-log.summary')}
      emptyIcon={<ListIcon size={22} />}
      tabs={<AccessTabs />}
      createLabel={null}
    />
  );
}

/** Ścieżka karty obiektu w panelu, jeśli taki ekran istnieje. */
function entityHref(entry: AuditLogListItem): string | null {
  if (!entry.entityId) return null;
  const paths: Record<string, string> = {
    scooter: '/admin/flota',
    scooter_model: '/admin/modele',
    staff: '/admin/operatorzy',
    role: '/admin/role',
    user: '/admin/klienci',
    rental: '/admin/przejazdy',
    ticket: '/admin/zgloszenia',
    service_task: '/admin/zadania',
    spare_part: '/admin/czesci',
  };
  return paths[entry.entityType] ? `${paths[entry.entityType]}/${entry.entityId}` : null;
}

/** Wpis dziennika: autor, akcja, obiekt i pola przed i po zmianie. */
export function AuditEntry({ id }: { id: string }) {
  const [entry, setEntry] = useState<AuditLogDetails | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    api<AuditLogDetails>(`/admin/audit-log/${id}`)
      .then(setEntry)
      .catch((e: unknown) => setError(errorMessage(e)));
  }, [id]);
  if (!entry) return error ? <Banner kind="danger">{error}</Banner> : <div className="card" aria-busy="true" />;

  const changes = (entry.data.changes ?? {}) as Record<string, [unknown, unknown]>;
  const rest = Object.fromEntries(Object.entries(entry.data).filter(([k]) => k !== 'changes'));
  const href = entityHref(entry);
  const show = (v: unknown) =>
    v === null || v === undefined || v === ''
      ? t('common.none')
      : typeof v === 'object'
        ? JSON.stringify(v)
        : String(v);

  return (
    <>
      <div className="page-head">
        <div>
          <nav className="crumbs" aria-label={t('form.backToList')}>
            <Link href={BASE}>{t('access.tabs.audit')}</Link>
            <span aria-hidden="true">/</span>
            <span>{t('audit.detailsTitle', { id: entry.id })}</span>
          </nav>
          <h1>{actionLabel(entry.action)}</h1>
          <div className="sub">{formatDateTime(entry.createdAt)}</div>
        </div>
      </div>
      <div className="two-col">
        <section className="card section-card">
          <h2>{t('audit.changed')}</h2>
          {Object.keys(changes).length === 0 ? (
            <p className="muted">{t('audit.noChanges')}</p>
          ) : (
            <div>
              {Object.entries(changes).map(([field, [before, after]]) => (
                <div key={field} className="consent-row" style={{ gridTemplateColumns: '160px 1fr' }}>
                  <span className="muted">{field}</span>
                  <span className="pill-row" style={{ alignItems: 'center' }}>
                    <span className="pill danger" style={{ textDecoration: 'line-through' }}>
                      {show(before)}
                    </span>
                    <span className="pill accent">{show(after)}</span>
                  </span>
                </div>
              ))}
            </div>
          )}
          {Object.keys(rest).length > 0 && (
            <>
              <h2>{t('audit.data')}</h2>
              <pre className="code" style={{ whiteSpace: 'pre-wrap', margin: 0 }}>
                {JSON.stringify(rest, null, 2)}
              </pre>
            </>
          )}
        </section>
        <div className="col">
          <section className="card side-card">
            <dl
              style={{ display: 'grid', gridTemplateColumns: '110px 1fr', gap: '10px 12px', margin: 0, fontSize: 13 }}
            >
              <dt className="muted">{t('audit.staff')}</dt>
              <dd style={{ margin: 0 }}>{entry.staffName ?? t('audit.system')}</dd>
              <dt className="muted">{t('audit.action')}</dt>
              <dd style={{ margin: 0 }} className="code">
                {entry.action}
              </dd>
              <dt className="muted">{t('audit.entity')}</dt>
              <dd style={{ margin: 0 }}>
                {href ? (
                  <Link className="link" href={href}>
                    {valueLabel(auditLogResource, 'entityType', entry.entityType)}
                  </Link>
                ) : (
                  valueLabel(auditLogResource, 'entityType', entry.entityType)
                )}
              </dd>
            </dl>
          </section>
          <div className="banner">
            <div>{t('audit.readOnly')}</div>
          </div>
        </div>
      </div>
    </>
  );
}
