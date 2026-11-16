'use client';

/** Operatorzy panelu (makiety dostep-operatorzy, dostep-operator-formularz; ADR 0028). */
import {
  staffResource,
  type ListResponse,
  type RoleListItem,
  type StaffDetails,
  type StaffInvitationResult,
  type StaffListItem,
} from '@hulajnogi/shared';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useEffect, useState, type FormEvent } from 'react';
import { api, ApiRequestError, errorMessage } from '../../../lib/api';
import { formatDate, formatDateTime, formatRelative, t } from '../../../lib/i18n';
import { useSession } from '../../../lib/session';
import { ConfirmDialog } from '../confirm-dialog';
import type { FilterSpec } from '../filter-drawer';
import { HistoryCard } from '../history-card';
import { AlertIcon, CopyIcon, LockIcon, LogoutIcon } from '../icons';
import { valueLabel } from '../labels';
import { ResourceList, type Column } from '../resource-list';
import { AccessTabs, Banner, Person } from './common';

const BASE = '/admin/operatorzy';
const STATUS_PILL: Record<string, string> = { ACTIVE: 'pill accent', INVITED: 'pill warn', DEACTIVATED: 'pill muted' };

/** Role do filtrów i formularzy (kilka do kilkunastu, jedna strona wystarcza). */
function useRoles(): RoleListItem[] {
  const [roles, setRoles] = useState<RoleListItem[]>([]);
  useEffect(() => {
    api<ListResponse<RoleListItem>>('/admin/roles?pageSize=100&sort=name')
      .then((r) => setRoles(r.items))
      .catch(() => setRoles([]));
  }, []);
  return roles;
}

const columns: Column<StaffListItem>[] = [
  { field: 'name', width: 'minmax(0,2.2fr)', render: (s) => <Person name={s.name} detail={s.email} /> },
  {
    field: 'roles',
    width: 'minmax(0,1.6fr)',
    render: (s) => (
      <span className="pill-row">
        {s.roles.map((r) => (
          <span key={r} className="pill">
            {r}
          </span>
        ))}
      </span>
    ),
  },
  {
    field: 'totpEnabled',
    width: '150px',
    render: (s) =>
      s.status === 'INVITED' ? (
        <span className="muted">{t('common.none')}</span>
      ) : s.totpEnabled ? (
        t('access.staff.totpOn')
      ) : (
        <span style={{ color: 'var(--warning)' }}>{t('access.staff.totpOff')}</span>
      ),
  },
  {
    field: 'lastLoginAt',
    width: '170px',
    render: (s) =>
      s.status === 'INVITED' && s.invitationExpiresAt ? (
        <span className="muted">{t('access.staff.invitationUntil', { date: formatDate(s.invitationExpiresAt) })}</span>
      ) : s.lastLoginAt ? (
        formatRelative(s.lastLoginAt)
      ) : (
        <span className="muted">{t('access.staff.neverLoggedIn')}</span>
      ),
  },
  {
    field: 'status',
    width: '130px',
    render: (s) => <span className={STATUS_PILL[s.status]}>{valueLabel(staffResource, 'status', s.status)}</span>,
  },
];

export function StaffList() {
  const roles = useRoles();
  const filters: FilterSpec[] = [
    { field: 'status', kind: 'checklist' },
    {
      field: 'totpEnabled',
      kind: 'checklist',
      options: ['true', 'false'].map((v) => ({ value: v, label: valueLabel(staffResource, 'totpEnabled', v) })),
    },
    { field: 'roleIds', kind: 'chips', options: roles.map((r) => ({ value: r.id, label: r.name })) },
    { field: 'lastLoginAt', kind: 'dateRange' },
  ];
  return (
    <ResourceList<StaffListItem>
      resource={staffResource}
      basePath={BASE}
      columns={columns}
      quick={{ field: 'status', values: ['ACTIVE', 'INVITED', 'DEACTIVATED'] }}
      filters={filters}
      rowLabel={(s) => s.name}
      summary={() => t('resource.staff.summary')}
      emptyIcon={<LockIcon size={22} />}
      tabs={<AccessTabs />}
    />
  );
}

/** Zaproszenie operatora: dane, role, a po zapisie link aktywacji pokazany raz. */
export function StaffInvite() {
  const roles = useRoles();
  const [email, setEmail] = useState('');
  const [name, setName] = useState('');
  const [roleIds, setRoleIds] = useState<string[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<StaffInvitationResult | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      setResult(await api<StaffInvitationResult>('/admin/staff', { method: 'POST', json: { email, name, roleIds } }));
    } catch (err) {
      setError(err instanceof ApiRequestError && err.code === 'ALREADY_EXISTS' ? t('error.ALREADY_EXISTS') : errorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <form onSubmit={(e) => void submit(e)}>
      <div className="page-head">
        <div>
          <nav className="crumbs" aria-label={t('form.backToList')}>
            <Link href={BASE}>{t('access.tabs.staff')}</Link>
            <span aria-hidden="true">/</span>
            <span>{t('access.staff.inviteTitle')}</span>
          </nav>
          <h1>{t('access.staff.inviteTitle')}</h1>
          <div className="sub">{t('access.staff.inviteLead')}</div>
        </div>
        <div className="actions">
          <Link className="btn" href={BASE}>
            {t('common.cancel')}
          </Link>
          {!result && (
            <button type="submit" className="btn primary" disabled={busy || !email || name.trim().length < 2 || roleIds.length === 0}>
              {t('access.staff.inviteSubmit')}
            </button>
          )}
        </div>
      </div>
      {error && <Banner kind="danger">{error}</Banner>}
      {result ? (
        <InvitationLink result={result} />
      ) : (
        <div className="two-col">
          <div className="col">
            <section className="card section-card">
              <h2>{t('access.staff.dataSection')}</h2>
              <div className="grid-2" style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16 }}>
                <label className="field">
                  <span className="label">{t('admin.auth.name')}</span>
                  <input className="input" value={name} onChange={(e) => setName(e.target.value)} autoComplete="off" />
                </label>
                <label className="field">
                  <span className="label">{t('resource.staff.fields.email')}</span>
                  <input className="input" type="email" value={email} onChange={(e) => setEmail(e.target.value)} autoComplete="off" />
                </label>
              </div>
            </section>
            <RoleChecklist roles={roles} value={roleIds} onChange={setRoleIds} />
          </div>
        </div>
      )}
    </form>
  );
}

function InvitationLink({ result }: { result: StaffInvitationResult }) {
  const [copied, setCopied] = useState(false);
  return (
    <section className="card section-card" style={{ maxWidth: 720 }}>
      <h2>{t('access.staff.invitedTitle')}</h2>
      <p className="muted" style={{ margin: 0 }}>
        {t('access.staff.invitedBody', { name: result.staff.name })}
      </p>
      {result.invitationUrl && (
        <>
          <span className="label">{t('access.staff.invitationLink')}</span>
          <div className="link-box">
            <span style={{ flex: 1 }}>{result.invitationUrl}</span>
            <button
              type="button"
              className="icon-btn"
              aria-label={copied ? t('access.staff.copied') : t('access.staff.copyLink')}
              onClick={() => void navigator.clipboard.writeText(result.invitationUrl!).then(() => setCopied(true))}
            >
              <CopyIcon size={16} />
            </button>
          </div>
        </>
      )}
      <Link className="btn" href={`${BASE}/${result.staff.id}`} style={{ alignSelf: 'flex-start' }}>
        {t('access.staff.goToOperator')}
      </Link>
    </section>
  );
}

function RoleChecklist({
  roles,
  value,
  onChange,
  disabled,
}: {
  roles: RoleListItem[];
  value: string[];
  onChange: (ids: string[]) => void;
  disabled?: boolean;
}) {
  return (
    <section className="card section-card" style={{ gap: 4 }}>
      <div className="section-head">
        <h2>{t('access.staff.rolesSection')}</h2>
        <span className="hint">{disabled ? t('access.staff.ownRoles') : t('access.staff.rolesHint')}</span>
      </div>
      <div style={{ marginTop: 8 }}>
        {roles.map((role) => (
          <label key={role.id} className="option-row">
            <input
              type="checkbox"
              checked={value.includes(role.id)}
              disabled={disabled}
              onChange={(e) => onChange(e.target.checked ? [...value, role.id] : value.filter((id) => id !== role.id))}
            />
            <span className="grow">
              <span className="strong">{role.name}</span>
              {role.isSystem && <span className="pill muted" style={{ marginLeft: 8 }}>{t('access.roles.system')}</span>}
              {role.description && <small>{role.description}</small>}
            </span>
            <small>{t('access.staff.roleMeta', { permissions: role.permissionsCount, staff: role.staffCount })}</small>
          </label>
        ))}
      </div>
    </section>
  );
}

/** Karta operatora: dane, role, bezpieczeństwo (sesje, TOTP), zaproszenie, historia, dezaktywacja. */
export function StaffCard({ id }: { id: string }) {
  const router = useRouter();
  const { staff: me, can } = useSession();
  const roles = useRoles();
  const [record, setRecord] = useState<StaffDetails | null>(null);
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [roleIds, setRoleIds] = useState<string[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [link, setLink] = useState<StaffInvitationResult | null>(null);
  const [confirm, setConfirm] = useState<'totp' | 'sessions' | 'deactivate' | null>(null);
  const [busy, setBusy] = useState(false);
  const canManage = can('staff.manage');
  const self = me.id === id;

  const apply = (s: StaffDetails) => {
    setRecord(s);
    setName(s.name);
    setEmail(s.email);
    setRoleIds(s.roleIds);
  };
  useEffect(() => {
    api<StaffDetails>(`/admin/staff/${id}`)
      .then(apply)
      .catch((e: unknown) => setError(errorMessage(e)));
  }, [id]);

  if (!record) return error ? <Banner kind="danger">{error}</Banner> : <div className="card" aria-busy="true" />;

  const changedRoles = [...roleIds].sort().join() !== [...record.roleIds].sort().join();
  const changes = {
    ...(name !== record.name ? { name } : {}),
    ...(email !== record.email ? { email } : {}),
    ...(changedRoles ? { roleIds } : {}),
  };
  const dirty = Object.keys(changes).length > 0;

  async function run(action: () => Promise<StaffDetails | StaffInvitationResult | unknown>, done?: string) {
    setBusy(true);
    setError(null);
    setNotice(null);
    setConfirm(null);
    try {
      const result = await action();
      if (result && typeof result === 'object' && 'invitationUrl' in result) {
        setLink(result as StaffInvitationResult);
        apply((result as StaffInvitationResult).staff);
      } else if (result && typeof result === 'object' && 'roleIds' in result) apply(result as StaffDetails);
      if (done) setNotice(done);
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  const save = (e: FormEvent) => {
    e.preventDefault();
    void run(() => api<StaffDetails>(`/admin/staff/${id}`, { method: 'PATCH', json: { version: record.version, ...changes } }), t('form.saved'));
  };

  return (
    <form onSubmit={save}>
      <div className="page-head">
        <div>
          <nav className="crumbs" aria-label={t('form.backToList')}>
            <Link href={BASE}>{t('access.tabs.staff')}</Link>
            <span aria-hidden="true">/</span>
            <span>{record.name}</span>
          </nav>
          <h1>{record.name}</h1>
          <div className="sub">
            {t('access.staff.since', {
              date: formatDate(record.createdAt),
              last: record.lastLoginAt ? formatRelative(record.lastLoginAt) : t('access.staff.neverLoggedIn'),
              version: record.version,
            })}
          </div>
        </div>
        <div className="actions">
          <Link className="btn" href={BASE}>
            {canManage ? t('common.cancel') : t('form.backToList')}
          </Link>
          {canManage && record.status !== 'DEACTIVATED' && (
            <button type="submit" className="btn primary" disabled={!dirty || busy}>
              {t('common.save')}
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
      {record.status === 'DEACTIVATED' && <Banner kind="warn">{t('access.staff.inactive')}</Banner>}

      <div className="two-col" style={{ marginTop: 16 }}>
        <div className="col">
          <section className="card section-card">
            <h2>{t('access.staff.dataSection')}</h2>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16 }}>
              <label className="field">
                <span className="label">{t('admin.auth.name')}</span>
                <input className="input" value={name} disabled={!canManage} onChange={(e) => setName(e.target.value)} />
              </label>
              <label className="field">
                <span className="label">{t('resource.staff.fields.email')}</span>
                <input className="input" type="email" value={email} disabled={!canManage} onChange={(e) => setEmail(e.target.value)} />
              </label>
            </div>
          </section>
          <RoleChecklist roles={roles} value={roleIds} onChange={setRoleIds} disabled={!canManage || self} />
        </div>

        <div className="col">
          <section className="card side-card">
            <div className="section-head">
              <h2>{t('access.staff.security')}</h2>
              <span className={record.totpEnabled ? 'pill accent' : 'pill warn'}>
                {record.totpEnabled ? t('access.staff.totpPill') : t('access.staff.totpPillOff')}
              </span>
            </div>
            <ul className="list-plain" style={{ marginTop: 8 }}>
              {record.sessions.length === 0 && <li className="muted">{t('access.staff.noSessions')}</li>}
              {record.sessions.map((s) => (
                <li key={s.id}>
                  <span className="grow">
                    {s.device ?? t('common.none')}
                    <small>
                      {s.lastUsedAt
                        ? t('access.staff.sessionActive', { date: formatDateTime(s.lastUsedAt) })
                        : t('access.staff.sessionCreated', { date: formatDateTime(s.createdAt) })}
                    </small>
                  </span>
                </li>
              ))}
            </ul>
            {canManage && record.status === 'ACTIVE' && (
              <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginTop: 8 }}>
                <button type="button" className="btn" onClick={() => setConfirm('sessions')} disabled={busy}>
                  <LogoutIcon size={16} />
                  {t('access.staff.revokeAll')}
                </button>
                <button type="button" className="btn" onClick={() => setConfirm('totp')} disabled={busy || !record.totpEnabled}>
                  <LockIcon size={16} />
                  {t('access.staff.resetTotp')}
                </button>
              </div>
            )}
          </section>

          {record.status === 'INVITED' && (
            <section className="card side-card">
              <h2>{t('access.staff.invitationSection')}</h2>
              {record.invitationExpiresAt && (
                <p>{t('access.staff.invitationPending', { date: formatDateTime(record.invitationExpiresAt) })}</p>
              )}
              {link?.invitationUrl && <div className="link-box">{link.invitationUrl}</div>}
              {canManage && (
                <button
                  type="button"
                  className="btn"
                  disabled={busy}
                  onClick={() =>
                    void run(() =>
                      api<StaffInvitationResult>(`/admin/staff/${id}/invitation`, { method: 'POST', json: { version: record.version } }),
                    )
                  }
                >
                  {t('access.staff.resend')}
                </button>
              )}
            </section>
          )}

          <HistoryCard path={`/admin/staff/${id}/history`} resourceName="staff" revision={record.version} />

          {canManage && !self && record.status !== 'DEACTIVATED' && (
            <section className="card side-card">
              <h2>{t('access.staff.deactivateSection')}</h2>
              <p>{t('access.staff.deactivateBody')}</p>
              <button type="button" className="btn danger" onClick={() => setConfirm('deactivate')}>
                {t('access.staff.deactivate')}
              </button>
            </section>
          )}
        </div>
      </div>

      <ConfirmDialog
        open={confirm !== null}
        danger={confirm === 'deactivate'}
        title={
          confirm === 'totp'
            ? t('access.staff.resetTotpTitle')
            : confirm === 'sessions'
              ? t('access.staff.revokeTitle')
              : t('access.staff.deactivateTitle')
        }
        body={
          confirm === 'totp'
            ? t('access.staff.resetTotpBody')
            : confirm === 'sessions'
              ? t('access.staff.revokeBody')
              : t('access.staff.deactivateBody')
        }
        action={
          confirm === 'totp'
            ? t('access.staff.resetTotp')
            : confirm === 'sessions'
              ? t('access.staff.revokeAll')
              : t('access.staff.deactivate')
        }
        onClose={() => setConfirm(null)}
        onConfirm={() => {
          if (confirm === 'totp') {
            void run(() => api(`/admin/staff/${id}/totp-reset`, { method: 'POST', json: { version: record.version } }));
          } else if (confirm === 'sessions') {
            void run(() => api(`/admin/staff/${id}/sessions/revoke`, { method: 'POST' }));
          } else {
            void run(async () => {
              await api(`/admin/staff/${id}?version=${record.version}`, { method: 'DELETE' });
              router.push(BASE);
            });
          }
        }}
      />
    </form>
  );
}
