'use client';

/**
 * Użytkownicy → Kody SMS (ADR 0076, makieta klienci-kody-sms): kody logowania bez kodu i skrótu, numer z trzema
 * ostatnimi cyframi. „Usuń wygasłe kody” (`users.manage`) pokazuje najpierw liczbę z warunku procedury
 * `sp_purge_expired_otp` (`GET /admin/otp-codes/purge`) z podziałem według stanu, a po wykonaniu faktyczną liczbę.
 */
import {
  OTP_STATES,
  otpCodesResource,
  type ListResponse,
  type OtpCodeListItem,
  type OtpPurgePreview,
  type OtpPurgeResult,
} from '@hulajnogi/shared';
import Link from 'next/link';
import { useEffect, useRef, useState } from 'react';
import { api, errorMessage } from '../../../lib/api';
import { formatClock, formatDate, t } from '../../../lib/i18n';
import { useSession } from '../../../lib/session';
import { UserTabs } from '../areas';
import type { FilterSpec } from '../filter-drawer';
import { PhoneIcon, TrashIcon, WarningIcon } from '../icons';
import { valueLabel } from '../labels';
import { ListNote, When } from '../list-format';
import { ResourceList, type Column } from '../resource-list';

const STATE_PILL: Record<string, string> = {
  ACTIVE: 'pill accent',
  CONSUMED: 'pill',
  BLOCKED: 'pill danger',
  EXPIRED: 'pill muted',
};

/** Liczba prób w kodzie (limit z core: 5 błędnych prób blokuje kod). */
const MAX_ATTEMPTS = 5;

const columns: Column<OtpCodeListItem>[] = [
  { field: 'phoneMasked', width: '150px', render: (c) => <span className="num strong">{c.phoneMasked}</span> },
  {
    field: 'userName',
    width: 'minmax(0,1.3fr)',
    render: (c) =>
      c.userId ? (
        <Link href={`/admin/klienci/${c.userId}`} className="link">
          {c.userName ?? t('access.users.noName')}
        </Link>
      ) : (
        <span className="muted">{t('otpCodes.noAccount')}</span>
      ),
  },
  { field: 'purpose', width: '120px', render: (c) => valueLabel(otpCodesResource, 'purpose', c.purpose) },
  { field: 'createdAt', width: '130px', render: (c) => <When at={c.createdAt} seconds /> },
  { field: 'expiresAt', width: '130px', render: (c) => <When at={c.expiresAt} seconds /> },
  {
    field: 'attempts',
    width: '80px',
    render: (c) => <span className="num">{t('otpCodes.attempts', { count: c.attempts, max: MAX_ATTEMPTS })}</span>,
  },
  { field: 'consumedAt', width: '110px', render: (c) => <When at={c.consumedAt} seconds /> },
  {
    field: 'state',
    width: '130px',
    render: (c) => <span className={STATE_PILL[c.state]}>{valueLabel(otpCodesResource, 'state', c.state)}</span>,
  },
];

const filters: FilterSpec[] = [
  { field: 'state', kind: 'checklist' },
  { field: 'purpose', kind: 'checklist' },
  { field: 'purgeable', kind: 'boolean' },
  { field: 'createdAt', kind: 'dateRange' },
  { field: 'attempts', kind: 'range' },
];

export function OtpCodeList() {
  const { can } = useSession();
  const [purging, setPurging] = useState(false);
  const [revision, setRevision] = useState(0);
  const [notice, setNotice] = useState<string | null>(null);
  return (
    <>
      {notice && (
        <div className="banner ok" role="status">
          <span>{notice}</span>
        </div>
      )}
      <ResourceList<OtpCodeListItem>
        resource={otpCodesResource}
        basePath="/admin/klienci/kody-sms"
        title={t('resource.users.title')}
        columns={columns}
        itemHref={() => null}
        quick={{ field: 'state', values: OTP_STATES, pluralKey: 'otpCodes.quick' }}
        filters={filters}
        rowLabel={(c) => c.phoneMasked}
        summary={() => t('areas.users.subtitle')}
        emptyIcon={<PhoneIcon size={22} />}
        createLabel={null}
        selectable={false}
        tabs={<UserTabs />}
        revision={revision}
        headActions={
          can('users.manage') ? (
            <button type="button" className="btn" onClick={() => setPurging(true)}>
              <TrashIcon size={16} />
              {t('otpCodes.purge')}
            </button>
          ) : null
        }
        exportColumns={[
          'phoneMasked',
          'userName',
          'purpose',
          'createdAt',
          'expiresAt',
          'attempts',
          'consumedAt',
          'state',
        ]}
        footer={<ListNote>{t('otpCodes.note', { max: MAX_ATTEMPTS })}</ListNote>}
      />
      {purging && (
        <PurgeDialog
          onClose={() => setPurging(false)}
          onDone={(deleted) => {
            setPurging(false);
            setNotice(t('otpCodes.purged', { count: deleted }));
            setRevision((n) => n + 1);
          }}
        />
      )}
    </>
  );
}

/** „Usunąć N wygasłe kody?”: podgląd liczby z warunku procedury i podział według stanu z liczników listy. */
function PurgeDialog({ onClose, onDone }: { onClose: () => void; onDone: (deleted: number) => void }) {
  const ref = useRef<HTMLDialogElement>(null);
  const [count, setCount] = useState<number | null>(null);
  const [byState, setByState] = useState<Record<string, number>>({});
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [cutoff] = useState(() => new Date(Date.now() - 86_400_000).toISOString());

  useEffect(() => {
    if (!ref.current?.open) ref.current?.showModal();
    const controller = new AbortController();
    Promise.all([
      api<OtpPurgePreview>('/admin/otp-codes/purge', { signal: controller.signal }),
      api<ListResponse<OtpCodeListItem>>('/admin/otp-codes?purgeable=true&facets=state&pageSize=10', {
        signal: controller.signal,
      }).catch(() => null),
    ])
      .then(([preview, list]) => {
        setCount(preview.count);
        setByState(list?.facets.state ?? {});
      })
      .catch((e: unknown) => {
        if ((e as Error).name !== 'AbortError') setError(errorMessage(e));
      });
    return () => controller.abort();
  }, []);

  const submit = async () => {
    setBusy(true);
    setError(null);
    try {
      const result = await api<OtpPurgeResult>('/admin/otp-codes/purge', { method: 'POST' });
      onDone(result.deleted);
    } catch (e) {
      setError(errorMessage(e));
      setBusy(false);
    }
  };

  return (
    <dialog ref={ref} className="end-dialog" onClose={onClose} aria-labelledby="otp-purge-title" aria-busy={count === null}>
      <div className="end-head">
        <span className="end-icon" aria-hidden="true">
          <TrashIcon size={20} />
        </span>
        <div>
          <h2 id="otp-purge-title">
            {count === null ? t('otpCodes.purgeTitleLoading') : t('otpCodes.purgeTitle', { count })}
          </h2>
          <p>{t('otpCodes.purgeSub', { date: formatDate(cutoff), time: formatClock(cutoff) })}</p>
        </div>
      </div>
      {count !== null && count > 0 && (
        <dl className="lx-box otp-box">
          {(['CONSUMED', 'EXPIRED', 'BLOCKED'] as const).map((state) => (
            <div key={state}>
              <dt>{t.dynamic(`otpCodes.breakdown.${state}`, { max: MAX_ATTEMPTS })}</dt>
              <dd className="num">{byState[state] ?? 0}</dd>
            </div>
          ))}
          <div className="total">
            <dt>{t('otpCodes.breakdown.total')}</dt>
            <dd className="num">{count}</dd>
          </div>
        </dl>
      )}
      {count === 0 && <p className="muted">{t('otpCodes.nothing')}</p>}
      <div className="notice warn">
        <span className="ic" aria-hidden="true">
          <WarningIcon size={14} />
        </span>
        <span>{t('otpCodes.purgeWarning')}</span>
      </div>
      {error && (
        <span className="err" role="alert">
          {error}
        </span>
      )}
      <div className="actions">
        <span className="hint lx-left">
          {t('otpCodes.procedure')} <code className="code">{t('otpCodes.procedureName')}</code>
        </span>
        <button type="button" className="btn" onClick={onClose}>
          {t('common.cancel')}
        </button>
        <button
          type="button"
          className="btn solid-danger"
          disabled={busy || count === null || count === 0}
          onClick={() => void submit()}
        >
          {t('otpCodes.purgeSubmit', { count: count ?? 0 })}
        </button>
      </div>
    </dialog>
  );
}
