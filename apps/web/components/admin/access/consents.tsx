'use client';

/**
 * Użytkownicy → Zgody (ADR 0076, makieta klienci-zgody): zgody klientów z wersją dokumentu, stanem liczonym w widoku
 * i źródłem. Operator z `users.manage` wycofuje tylko zgodę marketingową, z powodem zapisanym w dzienniku audytu
 * (`consent.revoked`); regulamin, polityka prywatności i wiek są warunkami konta.
 */
import {
  CONSENT_STATES,
  consentsResource,
  type ConsentListItem,
} from '@hulajnogi/shared';
import Link from 'next/link';
import { useEffect, useRef, useState } from 'react';
import { api, errorMessage } from '../../../lib/api';
import { t } from '../../../lib/i18n';
import { useSession } from '../../../lib/session';
import { UserTabs } from '../areas';
import type { FilterSpec } from '../filter-drawer';
import { CloseIcon, InfoIcon, LockIcon, MailIcon, PhoneIcon, ShieldIcon } from '../icons';
import { valueLabel } from '../labels';
import { When } from '../list-format';
import { ResourceList, type Column } from '../resource-list';

const STATE_PILL: Record<string, string> = {
  CURRENT: 'pill accent',
  OUTDATED: 'pill warn',
  SUPERSEDED: 'pill muted',
  CONFIRMED: 'pill',
  REVOKED: 'pill muted',
};

const typeLabel = (c: ConsentListItem) =>
  c.type === 'AGE' ? t('consentType.AGEPlain') : t.dynamic(`consentType.${c.type}`);

function StateCell({ c }: { c: ConsentListItem }) {
  const text =
    c.state === 'OUTDATED' && c.currentVersionNo
      ? t('consents.waitsFor', { version: c.currentVersionNo })
      : valueLabel(consentsResource, 'state', c.state);
  return <span className={STATE_PILL[c.state]}>{text}</span>;
}

function SourceCell({ c }: { c: ConsentListItem }) {
  const detail = c.revokedAt ? (c.revokedByName ?? t('consents.revokedByCustomer')) : null;
  return (
    <span className="stack">
      <span>{c.source ? valueLabel(consentsResource, 'source', c.source) : t('consents.noSource')}</span>
      {detail && <small>{detail}</small>}
    </span>
  );
}

const filters: FilterSpec[] = [
  { field: 'type', kind: 'checklist' },
  { field: 'state', kind: 'checklist' },
  { field: 'source', kind: 'checklist' },
  { field: 'userStatus', kind: 'checklist' },
  { field: 'acceptedAt', kind: 'dateRange' },
  { field: 'stateAt', kind: 'dateRange' },
];

export function ConsentList() {
  const { can } = useSession();
  const [revoking, setRevoking] = useState<ConsentListItem | null>(null);
  const [revision, setRevision] = useState(0);
  const [notice, setNotice] = useState<string | null>(null);
  const canManage = can('users.manage');

  const columns: Column<ConsentListItem>[] = [
    {
      field: 'userName',
      width: 'minmax(0,1.3fr)',
      render: (c) => (
        <Link href={`/admin/klienci/${c.userId}`} className="link">
          {c.userName ?? t('access.users.noName')}
        </Link>
      ),
    },
    {
      field: 'type',
      width: 'minmax(0,1.2fr)',
      render: (c) => (
        <span className="stack">
          <span>{typeLabel(c)}</span>
          <small>
            {c.versionNo
              ? t('access.users.consentVersion', { version: c.versionNo })
              : c.type === 'AGE'
                ? t('access.users.consentStatement')
                : t('access.users.consentVoluntary')}
          </small>
        </span>
      ),
    },
    { field: 'state', width: '170px', render: (c) => <StateCell c={c} /> },
    {
      field: 'stateAt',
      width: '140px',
      render: (c) => <When at={c.stateAt} sub={t.dynamic(`consents.stateAt.${c.state}`)} />,
    },
    { field: 'source', width: '150px', render: (c) => <SourceCell c={c} /> },
    {
      field: 'id',
      header: null,
      width: '90px',
      render: (c) =>
        canManage && c.type === 'MARKETING' && !c.revokedAt ? (
          <button type="button" className="link danger-link" onClick={() => setRevoking(c)}>
            {t('consents.revoke')}
          </button>
        ) : null,
    },
  ];

  return (
    <>
      {notice && (
        <div className="banner ok" role="status">
          <span>{notice}</span>
          <div className="actions">
            <button type="button" className="icon-btn" aria-label={t('common.close')} onClick={() => setNotice(null)}>
              <CloseIcon />
            </button>
          </div>
        </div>
      )}
      <ResourceList<ConsentListItem>
        resource={consentsResource}
        basePath="/admin/klienci/zgody"
        title={t('resource.users.title')}
        columns={columns}
        itemHref={() => null}
        activeId={revoking?.id ?? null}
        quick={{
          field: 'state',
          values: CONSENT_STATES.filter((s) => s === 'CURRENT' || s === 'OUTDATED' || s === 'REVOKED'),
          pluralKey: 'consents.quick',
        }}
        filters={filters}
        rowLabel={(c) => `${c.userName ?? ''} ${typeLabel(c)}`}
        summary={() => t('areas.users.subtitle')}
        emptyIcon={<ShieldIcon size={22} />}
        createLabel={null}
        selectable={false}
        tabs={<UserTabs />}
        revision={revision}
        exportColumns={[
          'userName',
          'userPhone',
          'type',
          'documentTitle',
          'versionNo',
          'state',
          'acceptedAt',
          'revokedAt',
          'revokedByName',
          'source',
        ]}
      />
      {revoking && (
        <RevokeConsentDrawer
          consent={revoking}
          onClose={() => setRevoking(null)}
          onDone={() => {
            setNotice(t('consents.revoked', { name: revoking.userName ?? t('access.users.noName') }));
            setRevoking(null);
            setRevision((n) => n + 1);
          }}
        />
      )}
    </>
  );
}

/** Panel boczny „Wycofaj zgodę marketingową”: skutki, powód (do dziennika audytu) i potwierdzenie prośby klienta. */
function RevokeConsentDrawer({
  consent,
  onClose,
  onDone,
}: {
  consent: ConsentListItem;
  onClose: () => void;
  onDone: () => void;
}) {
  const [reason, setReason] = useState('');
  const [confirmed, setConfirmed] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const input = useRef<HTMLInputElement>(null);
  useEffect(() => input.current?.focus(), []);

  const submit = async () => {
    setBusy(true);
    setError(null);
    try {
      await api(`/admin/consents/${consent.id}/revoke`, { method: 'POST', json: { reason: reason.trim() } });
      onDone();
    } catch (e) {
      setError(errorMessage(e));
      setBusy(false);
    }
  };

  return (
    <>
      <div className="scrim" onClick={onClose} />
      <aside className="drawer side-panel" role="dialog" aria-modal="true" aria-labelledby="consent-revoke-title">
        <div className="drawer-head">
          <div className="stack">
            <h2 id="consent-revoke-title">{t('consents.revokeTitle')}</h2>
            <small>
              {t('consents.revokeSub', { name: consent.userName ?? t('access.users.noName'), id: consent.id.slice(0, 8) })}
            </small>
          </div>
          <button type="button" className="icon-btn" aria-label={t('common.close')} onClick={onClose}>
            <CloseIcon />
          </button>
        </div>
        <div className="drawer-body">
          <dl className="kv-grid">
            <dt>{t('consents.document')}</dt>
            <dd>
              {consent.documentTitle ?? typeLabel(consent)}
              {consent.versionNo ? `, ${t('consents.versionShort', { version: consent.versionNo })}` : ''}
            </dd>
            <dt>{t('consents.accepted')}</dt>
            <dd>
              <When at={consent.acceptedAt} />
            </dd>
            <dt>{t('resource.consents.fields.source')}</dt>
            <dd>{consent.source ? valueLabel(consentsResource, 'source', consent.source) : t('consents.noSource')}</dd>
          </dl>
          <div className="end-conseq">
            <div>
              <span className="ci">
                <MailIcon size={14} />
              </span>
              <span>{t('consents.effectStop')}</span>
            </div>
            <div>
              <span className="ci">
                <PhoneIcon size={14} />
              </span>
              <span>{t('consents.effectApp')}</span>
            </div>
            <div>
              <span className="ci">
                <ShieldIcon size={14} />
              </span>
              <span>{t('consents.effectAudit')}</span>
            </div>
          </div>
          <label className="field">
            <span className="label">
              {t('consents.reason')} <span className="opt">{t('consents.reasonHint')}</span>
            </span>
            <input
              ref={input}
              className="input"
              value={reason}
              maxLength={300}
              placeholder={t('consents.reasonPlaceholder')}
              onChange={(e) => setReason(e.target.value)}
            />
          </label>
          <label className="check-row">
            <input
              type="checkbox"
              className="cb"
              checked={confirmed}
              onChange={(e) => setConfirmed(e.target.checked)}
            />
            {t('consents.confirm')}
          </label>
          <div className="notice info">
            <span className="ic" aria-hidden="true">
              <InfoIcon size={14} />
            </span>
            <span>{t('consents.onlyMarketing')}</span>
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
            className="btn solid-danger"
            disabled={busy || reason.trim().length < 3 || !confirmed}
            onClick={() => void submit()}
          >
            <LockIcon size={16} />
            {t('consents.revokeSubmit')}
          </button>
        </div>
      </aside>
    </>
  );
}
