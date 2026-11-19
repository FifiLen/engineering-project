'use client';

/**
 * Operatorzy i role → Uprawnienia (ADR 0076, makieta role-uprawnienia): kody pochodzą z katalogu w packages/core,
 * a panel zmienia tylko opis (do 160 znaków, blokada optymistyczna, `permission.updated`) w panelu bocznym z rolami,
 * które mają uprawnienie. Opis widać w macierzy roli po najechaniu na krótką etykietę.
 */
import {
  permissionsResource,
  type ListResponse,
  type PermissionListItem,
  type RoleListItem,
} from '@hulajnogi/shared';
import Link from 'next/link';
import { useEffect, useMemo, useState } from 'react';
import { api, errorMessage } from '../../../lib/api';
import { t } from '../../../lib/i18n';
import { useSession } from '../../../lib/session';
import { AccessAreaTabs } from '../areas';
import type { FilterSpec } from '../filter-drawer';
import { CloseIcon, InfoIcon, LockIcon, ShieldIcon } from '../icons';
import { ListNote } from '../list-format';
import { ResourceList, type Column, type QuickPreset } from '../resource-list';
import { Banner } from './common';

export const DESCRIPTION_MAX = 160;

/** Krótka etykieta uprawnienia z `pl.json` (macierz roli); bez klucza zostaje opis z bazy. */
export function permissionLabel(code: string, fallback: string): string {
  const key = `permissionLabel.${code}`;
  return t.has(key) ? t.dynamic(key) : fallback;
}

export const moduleLabel = (module: string) =>
  t.has(`access.permissionModules.${module}`) ? t.dynamic(`access.permissionModules.${module}`) : module;

type Row = PermissionListItem & { id: string };

const filters: FilterSpec[] = [
  { field: 'module', kind: 'checklist' },
  { field: 'inAdministrator', kind: 'boolean' },
  { field: 'rolesCount', kind: 'range' },
  { field: 'updatedAt', kind: 'dateRange' },
];

const columns: Column<Row>[] = [
  { field: 'code', width: 'minmax(0,1.2fr)', render: (p) => <span className="code strong-code">{p.code}</span> },
  { field: 'module', width: '150px', render: (p) => moduleLabel(p.module) },
  { field: 'description', width: 'minmax(0,1.8fr)', render: (p) => p.description },
  {
    field: 'rolesCount',
    width: 'minmax(0,1.1fr)',
    render: (p) => (
      <span className="stack">
        <span className="num">{p.rolesCount}</span>
        {p.roleNames.length > 0 && <small>{p.roleNames.join(', ')}</small>}
      </span>
    ),
  },
];

/** Liczniki szybkich filtrów spoza `facets` (liczba ról nie ma liczników): osobne zapytania o `total`. */
function usePresetCounts(revision: number) {
  const [counts, setCounts] = useState<{ total: number; onlyAdmin: number; none: number } | null>(null);
  useEffect(() => {
    const total = (q: string) => api<ListResponse<unknown>>(`/admin/permissions?pageSize=10${q}`).then((r) => r.total);
    Promise.all([total(''), total('&inAdministrator=true&rolesCount=1'), total('&rolesCount=0')])
      .then(([all, onlyAdmin, none]) => setCounts({ total: all, onlyAdmin, none }))
      .catch(() => setCounts(null));
  }, [revision]);
  return counts;
}

export function PermissionList() {
  const { can } = useSession();
  const [open, setOpen] = useState<PermissionListItem | null>(null);
  const [revision, setRevision] = useState(0);
  const [notice, setNotice] = useState<string | null>(null);
  const counts = usePresetCounts(revision);
  // Grupy do panelu filtrów z liczników listy (pole tekstowe bez wartości w definicji).
  const [modules, setModules] = useState<string[]>([]);
  useEffect(() => {
    api<ListResponse<unknown>>('/admin/permissions?pageSize=10&facets=module')
      .then((r) => setModules(Object.keys(r.facets.module ?? {}).sort()))
      .catch(() => setModules([]));
  }, []);
  const filterSpecs = filters.map((f) =>
    f.field === 'module' ? { ...f, options: modules.map((m) => ({ value: m, label: moduleLabel(m) })) } : f,
  );

  const presets = useMemo(() => {
    const items: QuickPreset[] = [
      {
        key: 'onlyAdmin',
        label: t('permissionsList.quick.onlyAdmin'),
        filters: [
          { field: 'inAdministrator', op: 'eq', values: [true] },
          { field: 'rolesCount', op: 'eq', values: [1] },
        ],
        count: () => counts?.onlyAdmin ?? 0,
      },
      {
        key: 'none',
        label: t('permissionsList.quick.none'),
        filters: [{ field: 'rolesCount', op: 'eq', values: [0] }],
        count: () => counts?.none ?? 0,
      },
    ];
    return { items, facets: ['inAdministrator'], total: () => counts?.total ?? 0 };
  }, [counts]);

  if (!can('roles.manage')) return <Banner kind="danger">{t('error.FORBIDDEN')}</Banner>;

  return (
    <>
      {notice && <Banner kind="ok">{notice}</Banner>}
      <ResourceList<Row>
        resource={permissionsResource}
        basePath="/admin/uprawnienia"
        title={t('resource.staff.title')}
        columns={columns}
        rowKey={(p) => p.code}
        onOpen={(p) => setOpen(p)}
        activeId={open?.code ?? null}
        presets={presets}
        filters={filterSpecs}
        rowLabel={(p) => p.code}
        summary={() => t('permissionsList.subtitle')}
        emptyIcon={<ShieldIcon size={22} />}
        createLabel={null}
        selectable={false}
        tabs={<AccessAreaTabs />}
        revision={revision}
        exportColumns={['code', 'module', 'description', 'rolesCount', 'roleNames', 'updatedAt', 'updatedByName']}
        footer={<ListNote>{t('permissionsList.note')}</ListNote>}
      />
      {open && (
        <PermissionDrawer
          permission={open}
          onClose={() => setOpen(null)}
          onSaved={(saved) => {
            setOpen(null);
            setNotice(t('permissionsList.saved', { code: saved.code }));
            setRevision((n) => n + 1);
          }}
        />
      )}
    </>
  );
}

function PermissionDrawer({
  permission,
  onClose,
  onSaved,
}: {
  permission: PermissionListItem;
  onClose: () => void;
  onSaved: (p: PermissionListItem) => void;
}) {
  const [description, setDescription] = useState(permission.description);
  const [roles, setRoles] = useState<RoleListItem[] | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    api<ListResponse<RoleListItem>>('/admin/roles?pageSize=100&sort=name')
      .then((r) => setRoles(r.items))
      .catch(() => setRoles([]));
  }, []);

  const withPermission = roles?.filter((r) => permission.roleNames.includes(r.name)) ?? [];
  const without = roles?.filter((r) => !permission.roleNames.includes(r.name)) ?? [];
  const trimmed = description.trim();
  const changed = trimmed !== permission.description;

  const save = async () => {
    setBusy(true);
    setError(null);
    try {
      const saved = await api<PermissionListItem>(`/admin/permissions/${encodeURIComponent(permission.code)}`, {
        method: 'PATCH',
        json: { version: permission.version, description: trimmed },
      });
      onSaved(saved);
    } catch (e) {
      setError(errorMessage(e));
      setBusy(false);
    }
  };

  return (
    <>
      <div className="scrim" onClick={onClose} />
      <aside className="drawer side-panel" role="dialog" aria-modal="true" aria-labelledby="perm-title">
        <div className="drawer-head">
          <div className="stack">
            <h2 id="perm-title">{t('permissionsList.drawerTitle')}</h2>
            <span className="code">{permission.code}</span>
          </div>
          <button type="button" className="icon-btn" aria-label={t('common.close')} onClick={onClose}>
            <CloseIcon />
          </button>
        </div>
        <div className="drawer-body">
          <div className="perm-ro">
            <label className="field">
              <span className="label">{t('resource.permissions.fields.code')}</span>
              <span className="input ro code">
                {permission.code}
                <LockIcon size={14} />
              </span>
            </label>
            <label className="field">
              <span className="label">{t('resource.permissions.fields.module')}</span>
              <span className="input ro">
                {moduleLabel(permission.module)}
                <LockIcon size={14} />
              </span>
            </label>
          </div>
          <label className="field">
            <span className="label">{t('resource.permissions.fields.description')}</span>
            <textarea
              className="input"
              value={description}
              maxLength={DESCRIPTION_MAX}
              rows={3}
              onChange={(e) => setDescription(e.target.value)}
            />
            <span className="hint perm-count">
              <span>{t('permissionsList.descriptionHint')}</span>
              <span className="num">{t('permissionsList.counter', { count: description.length, max: DESCRIPTION_MAX })}</span>
            </span>
          </label>
          <section className="perm-roles">
            <h3>
              {t('permissionsList.rolesWith')} <span className="num muted">{permission.rolesCount}</span>
            </h3>
            {withPermission.map((role) => (
              <div key={role.id} className="perm-role">
                <span className="av dark" aria-hidden="true">
                  <ShieldIcon size={14} />
                </span>
                <span className="stack grow">
                  <span>
                    {role.name}
                    {role.isSystem && <span className="pill sm">{t('access.roles.system')}</span>}
                  </span>
                  <small>{t('permissionsList.staffCount', { count: role.staffCount })}</small>
                </span>
                <Link className="link" href={`/admin/role/${role.id}`}>
                  {t('permissionsList.openRole')}
                </Link>
              </div>
            ))}
            {without.length > 0 && (
              <p className="small">{t('permissionsList.without', { roles: without.map((r) => r.name).join(', ') })}</p>
            )}
          </section>
          <div className="notice info">
            <span className="ic" aria-hidden="true">
              <InfoIcon size={14} />
            </span>
            <span>{t('permissionsList.versionNote', { version: permission.version })}</span>
          </div>
          {error && (
            <span className="err" role="alert">
              {error}
            </span>
          )}
        </div>
        <div className="drawer-foot">
          <button type="button" className="btn" onClick={onClose}>
            {t('common.cancel')}
          </button>
          <button
            type="button"
            className="btn primary"
            disabled={busy || !changed || trimmed.length === 0}
            onClick={() => void save()}
          >
            {t('permissionsList.save')}
          </button>
        </div>
      </aside>
    </>
  );
}
