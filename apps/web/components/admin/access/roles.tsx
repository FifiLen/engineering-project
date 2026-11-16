'use client';

/** Role i macierz uprawnień (makiety dostep-role, dostep-rola-uprawnienia; ADR 0028). */
import { rolesResource, type PermissionView, type RoleDetails, type RoleListItem } from '@hulajnogi/shared';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useEffect, useMemo, useState, type FormEvent } from 'react';
import { api, errorMessage } from '../../../lib/api';
import { formatDate, t } from '../../../lib/i18n';
import { useSession } from '../../../lib/session';
import { ConfirmDialog } from '../confirm-dialog';
import type { FilterSpec } from '../filter-drawer';
import { HistoryCard } from '../history-card';
import { AlertIcon, LockIcon } from '../icons';
import { valueLabel } from '../labels';
import { ResourceList, type Column } from '../resource-list';
import { AccessTabs, Banner, Person } from './common';

const BASE = '/admin/role';
const MODULE_ORDER = [
  'dashboard', 'fleet', 'zones', 'rentals', 'payments', 'accounts', 'operations', 'service',
  'access', 'content', 'documents', 'reports', 'simulator',
];

function usePermissionCatalog(): PermissionView[] {
  const [catalog, setCatalog] = useState<PermissionView[]>([]);
  useEffect(() => {
    api<PermissionView[]>('/admin/permissions')
      .then(setCatalog)
      .catch(() => setCatalog([]));
  }, []);
  return catalog;
}

export function RoleList() {
  const catalog = usePermissionCatalog();
  const total = catalog.length || 1;
  const columns: Column<RoleListItem>[] = [
    {
      field: 'name',
      width: 'minmax(0,1.3fr)',
      render: (r) => (
        <span className="person">
          <span className="strong">{r.name}</span>
          {r.isSystem && <span className="pill muted">{t('access.roles.system')}</span>}
        </span>
      ),
    },
    { field: 'description', width: 'minmax(0,2.4fr)', render: (r) => <span className="muted">{r.description ?? ''}</span> },
    {
      field: 'permissionsCount',
      width: '150px',
      render: (r) => (
        <span className="perm-bar">
          <span className="bar">
            <i style={{ width: `${Math.round((r.permissionsCount / total) * 100)}%` }} />
          </span>
          <span className="num">{t('access.roles.permissionsOf', { count: r.permissionsCount, total: catalog.length })}</span>
        </span>
      ),
    },
    { field: 'staffCount', width: '110px', render: (r) => <span className="num">{r.staffCount}</span> },
    { field: 'updatedAt', width: '120px', render: (r) => formatDate(r.updatedAt) },
  ];
  const filters: FilterSpec[] = [
    {
      field: 'isSystem',
      kind: 'checklist',
      options: ['true', 'false'].map((v) => ({ value: v, label: valueLabel(rolesResource, 'isSystem', v) })),
    },
    { field: 'permissionsCount', kind: 'range' },
    { field: 'staffCount', kind: 'range' },
  ];
  return (
    <>
      <ResourceList<RoleListItem>
        resource={rolesResource}
        basePath={BASE}
        columns={columns}
        filters={filters}
        rowLabel={(r) => r.name}
        summary={() => t('resource.roles.summary')}
        emptyIcon={<LockIcon size={22} />}
        tabs={<AccessTabs />}
      />
      <div className="banner" style={{ marginTop: 16 }}>
        <div>{t('access.roles.listNotice')}</div>
      </div>
    </>
  );
}

/** Edycja roli: nazwa, opis i macierz uprawnień według modułów z katalogu w bazie. */
export function RoleEditor({ id }: { id?: string }) {
  const router = useRouter();
  const { can } = useSession();
  const canManage = can('roles.manage');
  const catalog = usePermissionCatalog();
  const [record, setRecord] = useState<RoleDetails | null>(null);
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [confirmRemove, setConfirmRemove] = useState(false);

  const apply = (r: RoleDetails) => {
    setRecord(r);
    setName(r.name);
    setDescription(r.description ?? '');
    setSelected(new Set(r.permissions));
  };
  useEffect(() => {
    if (id)
      api<RoleDetails>(`/admin/roles/${id}`)
        .then(apply)
        .catch((e: unknown) => setError(errorMessage(e)));
  }, [id]);

  // Kolejność modułów jak w nawigacji panelu (makieta dostep-rola-uprawnienia); nieznane na końcu.
  const modules = useMemo(() => {
    const map = new Map<string, PermissionView[]>();
    for (const p of catalog) map.set(p.module, [...(map.get(p.module) ?? []), p]);
    const rank = (m: string) => (MODULE_ORDER.indexOf(m) + MODULE_ORDER.length + 1) % (MODULE_ORDER.length + 1);
    return [...map.entries()].sort(([a], [b]) => rank(a) - rank(b));
  }, [catalog]);

  if (id && !record) return error ? <Banner kind="danger">{error}</Banner> : <div className="card" aria-busy="true" />;

  const original = new Set(record?.permissions ?? []);
  const added = [...selected].filter((p) => !original.has(p));
  const removed = [...original].filter((p) => !selected.has(p));
  const labelOf = (code: string) => catalog.find((p) => p.code === code)?.description ?? code;
  const dirty =
    added.length + removed.length > 0 || name !== (record?.name ?? '') || description !== (record?.description ?? '');

  const toggle = (codes: string[], on: boolean) =>
    setSelected((s) => {
      const next = new Set(s);
      for (const c of codes) {
        if (on) next.add(c);
        else next.delete(c);
      }
      return next;
    });

  async function save(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      const permissions = [...selected];
      if (record) {
        apply(
          await api<RoleDetails>(`/admin/roles/${record.id}`, {
            method: 'PATCH',
            json: { version: record.version, name, description: description.trim() || null, permissions },
          }),
        );
        setNotice(t('form.saved'));
      } else {
        const created = await api<RoleDetails>('/admin/roles', {
          method: 'POST',
          json: { name, description: description.trim() || null, permissions },
        });
        router.replace(`${BASE}/${created.id}`);
      }
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  async function remove() {
    setConfirmRemove(false);
    if (!record) return;
    try {
      await api(`/admin/roles/${record.id}?version=${record.version}`, { method: 'DELETE' });
      router.push(BASE);
    } catch (err) {
      setError(errorMessage(err));
    }
  }

  return (
    <form onSubmit={(e) => void save(e)}>
      <div className="page-head">
        <div>
          <nav className="crumbs" aria-label={t('form.backToList')}>
            <Link href={BASE}>{t('access.tabs.roles')}</Link>
            <span aria-hidden="true">/</span>
            <span>{record?.name ?? t('access.roles.newTitle')}</span>
          </nav>
          <h1>{record?.name ?? t('access.roles.newTitle')}</h1>
          {record && (
            <div className="sub">
              {t('access.roles.subtitle', {
                kind: record.isSystem ? t('access.roles.kindSystem') : t('access.roles.kindCustom'),
                staff: record.staffCount,
                version: record.version,
              })}
            </div>
          )}
        </div>
        <div className="actions">
          {(added.length > 0 || removed.length > 0) && (
            <span className="hint" aria-live="polite">
              {t('access.roles.pending')}{' '}
              {added.length > 0 && (
                <b style={{ color: 'var(--accent)' }}>{t('access.roles.added', { list: added.map(labelOf).join(', ') })}</b>
              )}{' '}
              {removed.length > 0 && (
                <b style={{ color: 'var(--danger)' }}>{t('access.roles.removed', { list: removed.map(labelOf).join(', ') })}</b>
              )}
            </span>
          )}
          <Link className="btn" href={BASE}>
            {canManage ? t('common.cancel') : t('form.backToList')}
          </Link>
          {canManage && (
            <button type="submit" className="btn primary" disabled={busy || !dirty || name.trim().length < 2}>
              {record ? t('common.save') : t('common.create')}
            </button>
          )}
        </div>
      </div>
      {error && (
        <Banner kind="danger">
          <AlertIcon size={16} /> {error}
        </Banner>
      )}
      {notice && <Banner kind="ok">{notice}</Banner>}

      <div className="two-col" style={{ gridTemplateColumns: 'minmax(0,1fr) 300px', marginTop: 16 }}>
        <section className="card" style={{ padding: '12px 0 6px' }}>
          <div className="section-head" style={{ padding: '0 16px 8px' }}>
            <h2 style={{ margin: 0, fontSize: 17 }}>{t('access.roles.matrix')}</h2>
            <span className="hint">{t('access.roles.matrixHint', { count: selected.size, total: catalog.length })}</span>
          </div>
          {modules.map(([module, perms]) => {
            const on = perms.filter((p) => selected.has(p.code)).length;
            const moduleName = t.has(`access.permissionModules.${module}`) ? t.dynamic(`access.permissionModules.${module}`) : module;
            return (
              <div key={module} className="matrix-row">
                <label className="matrix-module">
                  <input
                    type="checkbox"
                    className="cb"
                    aria-label={t('access.roles.selectModule', { module: moduleName })}
                    checked={on === perms.length}
                    disabled={!canManage}
                    ref={(el) => {
                      if (el) el.indeterminate = on > 0 && on < perms.length;
                    }}
                    onChange={(e) => toggle(perms.map((p) => p.code), e.target.checked)}
                  />
                  <span>
                    {moduleName}
                    <small>{t('access.roles.moduleCount', { count: on, total: perms.length })}</small>
                  </span>
                </label>
                <span className="pill-row">
                  {perms.map((p) => {
                    const isOn = selected.has(p.code);
                    const cls = `perm${isOn ? ' on' : ''}${isOn && !original.has(p.code) && record ? ' added' : ''}${!isOn && original.has(p.code) ? ' removed' : ''}`;
                    return (
                      <label key={p.code} className={cls} title={p.code}>
                        <input
                          type="checkbox"
                          checked={isOn}
                          disabled={!canManage}
                          onChange={(e) => toggle([p.code], e.target.checked)}
                        />
                        {p.description}
                      </label>
                    );
                  })}
                </span>
              </div>
            );
          })}
        </section>

        <div className="col">
          <section className="card section-card">
            <h2>{t('access.roles.roleSection')}</h2>
            <label className="field">
              <span className="label">{t('resource.roles.fields.name')}</span>
              <input className="input" value={name} disabled={!canManage} onChange={(e) => setName(e.target.value)} />
            </label>
            <label className="field">
              <span className="label">
                {t('resource.roles.fields.description')} <span className="opt">{t('common.optional')}</span>
              </span>
              <textarea className="input" value={description} disabled={!canManage} onChange={(e) => setDescription(e.target.value)} />
            </label>
          </section>
          {record && record.staffCount > 0 && dirty && (
            <div className="banner">
              <div>
                <b>{t('access.roles.liveNotice')}</b>
                {t('access.roles.liveBody', { count: record.staffCount })}
              </div>
            </div>
          )}
          {record && (
            <section className="card side-card">
              <h2>{t('access.roles.staffSection')}</h2>
              {record.staff.length === 0 ? (
                <p>{t('access.roles.noStaff')}</p>
              ) : (
                <ul className="list-plain">
                  {record.staff.map((s) => (
                    <li key={s.id}>
                      <Link href={`/admin/operatorzy/${s.id}`} style={{ color: 'inherit', textDecoration: 'none' }}>
                        <Person name={s.name} />
                      </Link>
                    </li>
                  ))}
                </ul>
              )}
            </section>
          )}
          {record && <HistoryCard path={`/admin/roles/${record.id}/history`} resourceName="roles" revision={record.version} />}
          {record && canManage && !record.isSystem && record.staffCount === 0 && (
            <section className="card side-card">
              <h2>{t('access.roles.removeSection')}</h2>
              <p>{t('access.roles.removeBody')}</p>
              <button type="button" className="btn danger" onClick={() => setConfirmRemove(true)}>
                {t('access.roles.remove')}
              </button>
            </section>
          )}
        </div>
      </div>

      <ConfirmDialog
        open={confirmRemove}
        danger
        title={t('access.roles.removeTitle')}
        body={t('access.roles.removeBody')}
        action={t('access.roles.remove')}
        onConfirm={() => void remove()}
        onClose={() => setConfirmRemove(false)}
      />
    </form>
  );
}
