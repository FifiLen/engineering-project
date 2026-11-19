'use client';

/**
 * Operatorzy i role → Zaproszenia i Sesje (ADR 0076, makieta operatorzy-sesje-zaproszenia): listy z `staff.read`,
 * polecenia z `staff.manage`. Ponowne wysłanie tworzy nowe zaproszenie, które zastępuje otwarte (`replaced_by`), a link
 * aktywacji pokazujemy raz; unieważnienie dotyczy tylko oczekującego zaproszenia (`409 INVITATION_NOT_PENDING`).
 * Sesja operatora to rodzina tokenów jednego logowania; unieważnienie działa jak przy klientach.
 */
import {
  staffInvitationsResource,
  staffSessionsResource,
  type StaffInvitationListItem,
  type StaffInvitationResult,
  type StaffSessionListItem,
} from '@hulajnogi/shared';
import { useEffect, useRef, useState } from 'react';
import { api, errorMessage } from '../../../lib/api';
import { formatDate, formatRelative, t } from '../../../lib/i18n';
import { useSession } from '../../../lib/session';
import { AccessAreaTabs } from '../areas';
import { ConfirmDialog } from '../confirm-dialog';
import type { FilterSpec } from '../filter-drawer';
import { ClockIcon, CloseIcon, InfoIcon, LogoutIcon, MailIcon, ShieldIcon } from '../icons';
import { valueLabel } from '../labels';
import { untilText, When } from '../list-format';
import { ResourceList, type Column, type QuickPreset } from '../resource-list';
import { Banner, Person } from './common';
import { expiryDetail, RevokeSessionDialog, SESSION_PILL } from './sessions';
import { InvitationLink } from './staff';

// --- Zaproszenia ---------------------------------------------------------------------------------------------

const INVITATION_PILL: Record<string, string> = {
  PENDING: 'pill warn',
  ACCEPTED: 'pill accent',
  EXPIRED: 'pill',
  REVOKED: 'pill muted',
  REPLACED: 'pill muted',
};

/** Druga linia kolumny „Wygasa”: za ile, przyjęte, zastąpione albo nieprzyjęte. */
function invitationDetail(i: StaffInvitationListItem): string {
  switch (i.state) {
    case 'PENDING':
      return untilText(i.expiresAt);
    case 'ACCEPTED':
      return i.acceptedAt ? t('invitations.acceptedOn', { date: formatDate(i.acceptedAt) }) : '';
    case 'REPLACED':
      return t('invitations.replacedOn', { date: formatDate(i.revokedAt ?? i.createdAt) });
    case 'REVOKED':
      return i.revokedAt ? t('invitations.revokedOn', { date: formatDate(i.revokedAt) }) : '';
    case 'EXPIRED':
      return t('invitations.notAccepted');
  }
}

const invitationFilters: FilterSpec[] = [
  { field: 'state', kind: 'checklist' },
  { field: 'isResend', kind: 'boolean' },
  { field: 'createdAt', kind: 'dateRange' },
  { field: 'expiresAt', kind: 'dateRange' },
];

const invitationPresets: { items: QuickPreset[]; facets: string[]; total: (f: Record<string, Record<string, number>>) => number } = {
  facets: ['state'],
  total: (f) => Object.values(f.state ?? {}).reduce((a, b) => a + b, 0),
  items: [
    { key: 'pending', states: ['PENDING'] },
    { key: 'accepted', states: ['ACCEPTED'] },
    { key: 'expired', states: ['EXPIRED'] },
    // Zastąpione ponownym wysłaniem są w makiecie „Unieważnione” z dopiskiem „zastąpione”.
    { key: 'revoked', states: ['REVOKED', 'REPLACED'] },
  ].map(({ key, states }) => ({
    key,
    label: t.dynamic(`invitations.quick.${key}`),
    filters: [{ field: 'state', op: 'eq', values: states }],
    count: (f) => states.reduce((sum, s) => sum + (f.state?.[s] ?? 0), 0),
  })),
};

export function InvitationList() {
  const { can } = useSession();
  const canManage = can('staff.manage');
  const [revoking, setRevoking] = useState<StaffInvitationListItem | null>(null);
  const [resent, setResent] = useState<StaffInvitationResult | null>(null);
  const [revision, setRevision] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);

  const resend = async (i: StaffInvitationListItem) => {
    setBusy(i.id);
    setError(null);
    try {
      setResent(await api<StaffInvitationResult>(`/admin/staff-invitations/${i.id}/resend`, { method: 'POST' }));
      setRevision((n) => n + 1);
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy(null);
    }
  };

  const columns: Column<StaffInvitationListItem>[] = [
    { field: 'staffName', width: 'minmax(0,1.6fr)', render: (i) => <Person name={i.staffName} detail={i.staffEmail} /> },
    {
      field: 'staffRoles',
      width: 'minmax(0,0.9fr)',
      render: (i) => (
        <span className="pill-row">
          {i.staffRoles.map((role) => (
            <span key={role} className="pill">
              {role}
            </span>
          ))}
        </span>
      ),
    },
    {
      field: 'invitedByName',
      width: 'minmax(0,1fr)',
      render: (i) =>
        i.invitedByName ?? (
          <span className="stack">
            <span>{t('invitations.terminal')}</span>
            <small className="code">{t('invitations.terminalCommand')}</small>
          </span>
        ),
    },
    {
      field: 'createdAt',
      width: '120px',
      render: (i) => <When at={i.createdAt} sub={i.isResend ? t('invitations.resent') : t('invitations.first')} />,
    },
    { field: 'expiresAt', width: '140px', render: (i) => <When at={i.expiresAt} sub={invitationDetail(i)} /> },
    {
      field: 'state',
      width: '130px',
      render: (i) => (
        <span className={INVITATION_PILL[i.state]}>
          {valueLabel(staffInvitationsResource, 'state', i.state === 'REPLACED' ? 'REVOKED' : i.state)}
        </span>
      ),
    },
    {
      field: 'id',
      header: null,
      width: '210px',
      render: (i) =>
        canManage && (i.state === 'PENDING' || i.state === 'EXPIRED') && i.staffActive ? (
          <span className="row-actions">
            <button type="button" className="link" disabled={busy === i.id} onClick={() => void resend(i)}>
              {t('invitations.resend')}
            </button>
            {i.state === 'PENDING' && (
              <button type="button" className="link danger-link" onClick={() => setRevoking(i)}>
                {t('invitations.revoke')}
              </button>
            )}
          </span>
        ) : (
          <span className="muted">{t('common.none')}</span>
        ),
    },
  ];

  return (
    <>
      {error && <Banner kind="danger">{error}</Banner>}
      {notice && <Banner kind="ok">{notice}</Banner>}
      <ResourceList<StaffInvitationListItem>
        resource={staffInvitationsResource}
        basePath="/admin/operatorzy/zaproszenia"
        title={t('resource.staff.title')}
        columns={columns}
        itemHref={(i) => `/admin/operatorzy/${i.staffId}`}
        activeId={revoking?.id ?? null}
        presets={invitationPresets}
        filters={invitationFilters}
        rowLabel={(i) => i.staffEmail}
        summary={() => t('resource.staff.summary')}
        emptyIcon={<MailIcon size={22} />}
        createLabel={null}
        selectable={false}
        tabs={<AccessAreaTabs />}
        revision={revision}
        exportColumns={[
          'staffName',
          'staffEmail',
          'staffRoles',
          'invitedByName',
          'createdAt',
          'isResend',
          'expiresAt',
          'acceptedAt',
          'revokedAt',
          'state',
        ]}
      />
      <ConfirmDialog
        open={revoking !== null}
        danger
        title={t('invitations.revokeTitle', { email: revoking?.staffEmail ?? '' })}
        body={t('invitations.revokeBody')}
        action={t('invitations.revoke')}
        onClose={() => setRevoking(null)}
        onConfirm={() => {
          const target = revoking;
          setRevoking(null);
          if (!target) return;
          setError(null);
          api(`/admin/staff-invitations/${target.id}/revoke`, { method: 'POST' })
            .then(() => {
              setNotice(t('invitations.revoked', { email: target.staffEmail }));
              setRevision((n) => n + 1);
            })
            .catch((e: unknown) => setError(errorMessage(e)));
        }}
      />
      {resent && <ResentDialog result={resent} onClose={() => setResent(null)} />}
    </>
  );
}

function ResentDialog({ result, onClose }: { result: StaffInvitationResult; onClose: () => void }) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    if (!ref.current?.open) ref.current?.showModal();
  }, []);
  return (
    <dialog ref={ref} className="end-dialog" onClose={onClose} aria-label={t('access.staff.invitedTitle')}>
      <InvitationLink result={result} />
      <div className="actions">
        <button type="button" className="btn" onClick={onClose}>
          <CloseIcon size={16} />
          {t('common.close')}
        </button>
      </div>
    </dialog>
  );
}

// --- Sesje operatorów ------------------------------------------------------------------------------------------

/** Przeglądarka i system z `user-agent`: „Chrome 142”, „macOS”. */
export function parseUserAgent(ua: string | null): { browser: string; os: string } {
  if (!ua) return { browser: t('staffSessions.unknownBrowser'), os: '' };
  const match =
    /Edg\/(\d+)/.exec(ua) ??
    /Firefox\/(\d+)/.exec(ua) ??
    /Chrome\/(\d+)/.exec(ua) ??
    (/Safari\//.test(ua) ? /Version\/(\d+)/.exec(ua) : null);
  const name = /Edg\//.test(ua)
    ? 'Edge'
    : /Firefox\//.test(ua)
      ? 'Firefox'
      : /Chrome\//.test(ua)
        ? 'Chrome'
        : /Safari\//.test(ua)
          ? 'Safari'
          : null;
  const os = /iPad/.test(ua)
    ? 'iPadOS'
    : /iPhone/.test(ua)
      ? 'iOS'
      : /Mac OS X/.test(ua)
        ? 'macOS'
        : /Windows/.test(ua)
          ? 'Windows'
          : /Android/.test(ua)
            ? 'Android'
            : /Linux/.test(ua)
              ? 'Linux'
              : '';
  return {
    browser: name ? `${name}${match?.[1] ? ` ${match[1]}` : ''}` : t('staffSessions.unknownBrowser'),
    os,
  };
}

const sessionFilters: FilterSpec[] = [
  { field: 'state', kind: 'checklist' },
  { field: 'remembered', kind: 'boolean' },
  { field: 'lastUsedAt', kind: 'dateRange' },
  { field: 'createdAt', kind: 'dateRange' },
];

export function StaffSessionList() {
  const { can, staff } = useSession();
  const canManage = can('staff.manage');
  const [revoking, setRevoking] = useState<StaffSessionListItem | null>(null);
  const [revision, setRevision] = useState(0);
  const [notice, setNotice] = useState<string | null>(null);

  const columns: Column<StaffSessionListItem>[] = [
    {
      field: 'staffName',
      width: 'minmax(0,1.5fr)',
      render: (s) => <Person name={s.staffName} detail={s.staffEmail} />,
    },
    {
      field: 'userAgent',
      width: 'minmax(0,1fr)',
      render: (s) => {
        const ua = parseUserAgent(s.userAgent);
        return (
          <span className="stack">
            <span>{ua.browser}</span>
            {ua.os && <small>{ua.os}</small>}
          </span>
        );
      },
    },
    { field: 'createdAt', width: '130px', render: (s) => <When at={s.createdAt} sub={t('staffSessions.byTotp')} /> },
    { field: 'lastUsedAt', width: '120px', render: (s) => <span className="num">{formatRelative(s.lastUsedAt)}</span> },
    {
      field: 'expiresAt',
      width: '150px',
      render: (s) => (
        <When
          at={s.expiresAt}
          sub={
            s.state === 'ACTIVE'
              ? s.remembered
                ? t('staffSessions.remembered')
                : t('staffSessions.shortSession')
              : expiryDetail(s)
          }
        />
      ),
    },
    {
      field: 'state',
      width: '120px',
      render: (s) => (
        <span className={SESSION_PILL[s.state]}>{valueLabel(staffSessionsResource, 'state', s.state)}</span>
      ),
    },
    {
      field: 'id',
      header: null,
      width: '120px',
      render: (s) =>
        s.staffId === staff.id && s.state === 'ACTIVE' ? (
          <span className="muted small">{t('staffSessions.yours')}</span>
        ) : canManage && s.state === 'ACTIVE' ? (
          <button type="button" className="link danger-link" onClick={() => setRevoking(s)}>
            {t('sessionsList.revoke')}
          </button>
        ) : (
          <span className="muted">{t('common.none')}</span>
        ),
    },
  ];

  return (
    <>
      {notice && <Banner kind="ok">{notice}</Banner>}
      <ResourceList<StaffSessionListItem>
        resource={staffSessionsResource}
        basePath="/admin/operatorzy/sesje"
        title={t('resource.staff.title')}
        columns={columns}
        itemHref={(s) => `/admin/operatorzy/${s.staffId}`}
        activeId={revoking?.id ?? null}
        quick={{ field: 'state', values: ['ACTIVE', 'EXPIRED', 'REVOKED'], pluralKey: 'sessionsList.quick' }}
        filters={sessionFilters}
        rowLabel={(s) => `${s.staffName} ${s.shortId}`}
        summary={() => t('staffSessions.subtitle')}
        emptyIcon={<ShieldIcon size={22} />}
        createLabel={null}
        selectable={false}
        tabs={<AccessAreaTabs />}
        revision={revision}
        exportColumns={[
          'staffName',
          'staffEmail',
          'shortId',
          'userAgent',
          'remembered',
          'createdAt',
          'lastUsedAt',
          'expiresAt',
          'revokedAt',
          'rotations',
          'state',
        ]}
      />
      {revoking && (
        <RevokeSessionDialog
          title={t('staffSessions.revokeTitle', { name: revoking.staffName })}
          sub={t('staffSessions.revokeSub', {
            browser: parseUserAgent(revoking.userAgent).browser,
            id: revoking.shortId,
            last: formatRelative(revoking.lastUsedAt),
          })}
          path={`/admin/staff-sessions/${revoking.id}/revoke`}
          effects={[
            { icon: <ClockIcon size={14} />, text: t('staffSessions.effectToken') },
            { icon: <LogoutIcon size={14} />, text: t('staffSessions.effectOthers') },
            { icon: <InfoIcon size={14} />, text: t('staffSessions.effectAudit') },
          ]}
          onClose={() => setRevoking(null)}
          onDone={() => {
            setNotice(t('sessionsList.revoked', { id: revoking.shortId }));
            setRevoking(null);
            setRevision((n) => n + 1);
          }}
        />
      )}
    </>
  );
}
