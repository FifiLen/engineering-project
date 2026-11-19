'use client';

/**
 * Użytkownicy → Sesje (ADR 0076, makieta klienci-sesje): jedna sesja to rodzina odświeżanych tokenów jednego
 * logowania (bez tokenu i jego skrótu). Unieważnienie pojedynczej sesji z `users.manage` (`session.revoked`); token
 * dostępu działa jeszcze do 15 min (ADR 0035), co okno mówi wprost. Okno unieważnienia wspólne z sesjami operatorów.
 */
import {
  SESSION_STATES,
  sessionsResource,
  type SessionListItem,
} from '@hulajnogi/shared';
import Link from 'next/link';
import { useEffect, useRef, useState, type ReactNode } from 'react';
import { api, errorMessage } from '../../../lib/api';
import { formatDate, formatRelative, t } from '../../../lib/i18n';
import { useSession } from '../../../lib/session';
import { UserTabs } from '../areas';
import type { FilterSpec } from '../filter-drawer';
import { ClockIcon, InfoIcon, LogoutIcon, PhoneIcon } from '../icons';
import { valueLabel } from '../labels';
import { ListNote, untilText, When } from '../list-format';
import { ResourceList, type Column } from '../resource-list';

export const SESSION_PILL: Record<string, string> = {
  ACTIVE: 'pill accent',
  EXPIRED: 'pill',
  REVOKED: 'pill muted',
};

/** „iPhone 15”, „Android · aplikacja 1.4.0”. */
export function deviceText(s: Pick<SessionListItem, 'deviceName' | 'platform' | 'appVersion'>): {
  name: string;
  detail: string;
} {
  const platform = s.platform ? valueLabel(sessionsResource, 'platform', s.platform) : null;
  const app = s.appVersion ? t('sessionsList.app', { version: s.appVersion }) : null;
  return {
    name: s.deviceName ?? platform ?? t('sessionsList.unknownDevice'),
    detail: [s.deviceName ? platform : null, app].filter(Boolean).join(' · ') || t('sessionsList.noDeviceData'),
  };
}

/** Druga linia kolumny „Wygasa”: za ile, wygasła albo unieważniona. */
export function expiryDetail(s: { state: string; expiresAt: string; revokedAt: string | null }): string {
  if (s.state === 'REVOKED' && s.revokedAt) return t('sessionsList.revokedOn', { date: formatDate(s.revokedAt) });
  if (s.state === 'EXPIRED') return t('sessionsList.expired');
  return untilText(s.expiresAt);
}

const filters: FilterSpec[] = [
  { field: 'state', kind: 'checklist' },
  { field: 'platform', kind: 'checklist' },
  { field: 'userStatus', kind: 'checklist' },
  { field: 'lastUsedAt', kind: 'dateRange' },
  { field: 'createdAt', kind: 'dateRange' },
  { field: 'rotations', kind: 'range' },
];

export function SessionList() {
  const { can } = useSession();
  const canManage = can('users.manage');
  const [revoking, setRevoking] = useState<SessionListItem | null>(null);
  const [revision, setRevision] = useState(0);
  const [notice, setNotice] = useState<string | null>(null);

  const columns: Column<SessionListItem>[] = [
    {
      field: 'userName',
      width: 'minmax(0,1.3fr)',
      render: (s) => (
        <span className="stack">
          <Link href={`/admin/klienci/${s.userId}`} className="link">
            {s.userName ?? t('access.users.noName')}
          </Link>
          <small className="num">{t('sessionsList.sessionId', { id: s.shortId })}</small>
        </span>
      ),
    },
    {
      field: 'deviceName',
      width: 'minmax(0,1.3fr)',
      render: (s) => {
        const d = deviceText(s);
        return (
          <span className="stack">
            <span>{d.name}</span>
            <small>{d.detail}</small>
          </span>
        );
      },
    },
    { field: 'createdAt', width: '130px', render: (s) => <When at={s.createdAt} sub={t('sessionsList.bySms')} /> },
    { field: 'lastUsedAt', width: '130px', render: (s) => <When at={s.lastUsedAt} /> },
    { field: 'expiresAt', width: '130px', render: (s) => <When at={s.expiresAt} sub={expiryDetail(s)} /> },
    {
      field: 'state',
      width: '120px',
      render: (s) => <span className={SESSION_PILL[s.state]}>{valueLabel(sessionsResource, 'state', s.state)}</span>,
    },
    {
      field: 'id',
      header: null,
      width: '100px',
      render: (s) =>
        canManage && s.state === 'ACTIVE' ? (
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
      {notice && (
        <div className="banner ok" role="status">
          <span>{notice}</span>
        </div>
      )}
      <ResourceList<SessionListItem>
        resource={sessionsResource}
        basePath="/admin/klienci/sesje"
        title={t('resource.users.title')}
        columns={columns}
        itemHref={() => null}
        activeId={revoking?.id ?? null}
        quick={{ field: 'state', values: SESSION_STATES, pluralKey: 'sessionsList.quick' }}
        filters={filters}
        rowLabel={(s) => `${s.userName ?? ''} ${s.shortId}`}
        summary={() => t('areas.users.subtitle')}
        emptyIcon={<LogoutIcon size={22} />}
        createLabel={null}
        selectable={false}
        tabs={<UserTabs />}
        revision={revision}
        exportColumns={[
          'userName',
          'userPhone',
          'shortId',
          'deviceName',
          'platform',
          'appVersion',
          'createdAt',
          'lastUsedAt',
          'expiresAt',
          'revokedAt',
          'rotations',
          'state',
        ]}
        footer={<ListNote>{t('sessionsList.note')}</ListNote>}
      />
      {revoking && (
        <RevokeSessionDialog
          title={t('sessionsList.revokeTitle', { device: deviceText(revoking).name })}
          sub={t('sessionsList.revokeSub', {
            name: revoking.userName ?? t('access.users.noName'),
            id: revoking.shortId,
            last: formatRelative(revoking.lastUsedAt),
          })}
          path={`/admin/sessions/${revoking.id}/revoke`}
          effects={[
            { icon: <ClockIcon size={14} />, text: t('sessionsList.effectToken') },
            { icon: <PhoneIcon size={14} />, text: t('sessionsList.effectOthers') },
            { icon: <InfoIcon size={14} />, text: t('sessionsList.effectRental') },
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

/** Okno „Unieważnić sesję?” (klientów i operatorów): skutki, powód opcjonalny do dziennika audytu. */
export function RevokeSessionDialog(props: {
  title: string;
  sub: string;
  path: string;
  effects: Array<{ icon: ReactNode; text: string }>;
  onClose: () => void;
  onDone: () => void;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    if (!ref.current?.open) ref.current?.showModal();
  }, []);
  const submit = async () => {
    setBusy(true);
    setError(null);
    try {
      await api(props.path, { method: 'POST', json: reason.trim() ? { reason: reason.trim() } : {} });
      props.onDone();
    } catch (e) {
      setError(errorMessage(e));
      setBusy(false);
    }
  };
  return (
    <dialog ref={ref} className="end-dialog" onClose={props.onClose} aria-labelledby="session-revoke-title">
      <div className="end-head">
        <span className="end-icon" aria-hidden="true">
          <LogoutIcon size={20} />
        </span>
        <div>
          <h2 id="session-revoke-title">{props.title}</h2>
          <p>{props.sub}</p>
        </div>
      </div>
      <div className="end-conseq">
        {props.effects.map((effect) => (
          <div key={effect.text}>
            <span className="ci">{effect.icon}</span>
            <span>{effect.text}</span>
          </div>
        ))}
      </div>
      <label className="field">
        <span className="label">
          {t('sessionsList.reason')} <span className="opt">{t('sessionsList.reasonHint')}</span>
        </span>
        <input className="input" value={reason} maxLength={300} onChange={(e) => setReason(e.target.value)} />
      </label>
      {error && (
        <span className="err" role="alert">
          {error}
        </span>
      )}
      <div className="actions">
        <span className="hint lx-left">{t('sessionsList.auditHint')}</span>
        <button type="button" className="btn" onClick={props.onClose}>
          {t('common.cancel')}
        </button>
        <button type="button" className="btn solid-danger" disabled={busy} onClick={() => void submit()}>
          {t('sessionsList.revokeSubmit')}
        </button>
      </div>
    </dialog>
  );
}
