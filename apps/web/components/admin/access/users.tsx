'use client';

/** Klienci aplikacji (makiety 13-panel/admin-uzytkownicy, dostep-klient, dostep-klient-blokada; ADR 0028). */
import {
  BLOCK_REASONS,
  formatPln,
  usersResource,
  type BlockReason,
  type ConsentView,
  type UserDetails,
  type UserListItem,
} from '@hulajnogi/shared';
import Link from 'next/link';
import { useEffect, useState, type FormEvent } from 'react';
import { usePathname } from 'next/navigation';
import { api, errorMessage } from '../../../lib/api';
import { formatDate, formatDateTime, formatRelative, t } from '../../../lib/i18n';
import { useSession } from '../../../lib/session';
import { ConfirmDialog } from '../confirm-dialog';
import type { FilterSpec } from '../filter-drawer';
import { HistoryCard } from '../history-card';
import { AlertIcon, CardIcon, LockIcon, LogoutIcon } from '../icons';
import { CustomerDataExports } from '../prints/data-exports';
import { valueLabel } from '../labels';
import {
  AdjustmentDialog,
  CustomerWalletTab,
  overdueTotal,
  PayoutDialog,
  useCustomerWallet,
} from '../payments/customer-wallet';
import { ResourceList, type Column } from '../resource-list';
import { UserTabs as UsersAreaTabs } from '../areas';
import { Banner, Person } from './common';
import { SavedPlacesCard } from './saved-places';

const BASE = '/admin/klienci';
const displayName = (u: Pick<UserListItem, 'name'>) => u.name ?? t('access.users.noName');
const STATUS_PILL: Record<string, string> = { ACTIVE: 'pill accent', BLOCKED: 'pill danger', DELETED: 'pill muted' };

const columns: Column<UserListItem>[] = [
  {
    field: 'name',
    width: 'minmax(0,2fr)',
    render: (u) => <Person name={displayName(u)} detail={u.phone ?? u.email} />,
  },
  { field: 'createdAt', width: '140px', render: (u) => formatDate(u.createdAt) },
  { field: 'rides', width: '100px', render: (u) => <span className="num">{u.rides}</span> },
  {
    field: 'walletBalance',
    width: '150px',
    render: (u) => (
      <span className="pill-row nowrap">
        <span className="num">{formatPln(u.walletBalance)}</span>
        {u.unpaidRentals > 0 && (
          <span className="pill warn" title={t('access.users.unpaid', { count: u.unpaidRentals })}>
            {t('access.users.unpaidShort')}
          </span>
        )}
      </span>
    ),
  },
  {
    field: 'status',
    width: '170px',
    render: (u) => (
      <span className={STATUS_PILL[u.status]}>
        {u.status === 'BLOCKED' && u.blockedReason
          ? valueLabel(usersResource, 'blockedReason', u.blockedReason)
          : valueLabel(usersResource, 'status', u.status)}
      </span>
    ),
  },
  {
    field: 'lastSeenAt',
    width: '150px',
    render: (u) =>
      u.lastSeenAt ? formatRelative(u.lastSeenAt) : <span className="muted">{t('common.relative.never')}</span>,
  },
];

const filters: FilterSpec[] = [
  { field: 'status', kind: 'checklist' },
  { field: 'blockedReason', kind: 'checklist' },
  { field: 'rides', kind: 'range' },
  { field: 'createdAt', kind: 'dateRange' },
  { field: 'lastSeenAt', kind: 'dateRange' },
];

export function UserList() {
  return (
    <ResourceList<UserListItem>
      resource={usersResource}
      basePath={BASE}
      columns={columns}
      quick={{ field: 'status', values: ['ACTIVE', 'BLOCKED'] }}
      filters={filters}
      rowLabel={displayName}
      summary={() => t('areas.users.subtitle')}
      emptyIcon={<LockIcon size={22} />}
      createLabel={null}
      tabs={<UsersAreaTabs />}
    />
  );
}

function consentStatus(c: ConsentView): { label: string; pill: string } {
  if (c.revokedAt) return { label: t('access.users.consentRevoked'), pill: 'pill muted' };
  if (c.type === 'AGE' || c.type === 'MARKETING') return { label: t('access.users.consentConfirmed'), pill: 'pill' };
  if (c.isCurrent) return { label: t('access.users.consentCurrent'), pill: 'pill accent' };
  return { label: t('access.users.consentOutdated', { version: c.currentVersionNo ?? '?' }), pill: 'pill warn' };
}

/** Zakładki karty klienta (makieta klient-portfel); przejazdy i płatności to listy z filtrem klienta. */
function UserTabs({ id, rides }: { id: string; rides: number }) {
  const { can } = useSession();
  const pathname = usePathname();
  const base = `${BASE}/${id}`;
  const tabs = [
    { href: base, label: t('access.users.tabs.profile'), show: true, current: pathname === base },
    {
      href: `${base}/portfel`,
      label: t('access.users.tabs.wallet'),
      show: can('payments.read'),
      current: pathname === `${base}/portfel`,
    },
    {
      href: `/admin/przejazdy?userId=${id}`,
      label: t('access.users.tabs.rentals'),
      count: rides,
      show: can('rentals.read'),
      current: false,
    },
    {
      href: `/admin/platnosci?userId=${id}`,
      label: t('access.users.tabs.payments'),
      show: can('payments.read'),
      current: false,
    },
  ].filter((tab) => tab.show);
  return (
    <nav className="tabs" aria-label={t('access.users.tabs.label')}>
      {tabs.map((tab) => (
        <Link key={tab.href} href={tab.href} className="tab" aria-current={tab.current ? 'page' : undefined}>
          {tab.label}
          {tab.count !== undefined && <span className="n num">{tab.count}</span>}
        </Link>
      ))}
    </nav>
  );
}

/** Karta klienta: statystyki, zgody z wersjami dokumentów, dane, sesje, historia, blokada; zakładka Portfel. */
export function UserCard({ id, tab = 'profile' }: { id: string; tab?: 'profile' | 'wallet' }) {
  const { can } = useSession();
  const canManage = can('users.manage');
  const canAdjust = can('wallet.adjust');
  const [walletRevision, setWalletRevision] = useState(0);
  const {
    data: wallet,
    error: walletError,
    setData: setWallet,
  } = useCustomerWallet(id, can('payments.read'), walletRevision);
  const [moneyDialog, setMoneyDialog] = useState<'adjust' | 'payout' | null>(null);
  const [record, setRecord] = useState<UserDetails | null>(null);
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [dialog, setDialog] = useState<'block' | 'unblock' | 'sessions' | null>(null);
  const [reason, setReason] = useState<BlockReason | null>(null);
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);

  const apply = (u: UserDetails) => {
    setRecord(u);
    setName(u.name ?? '');
    setEmail(u.email ?? '');
  };
  useEffect(() => {
    api<UserDetails>(`/admin/users/${id}`)
      .then(apply)
      .catch((e: unknown) => setError(errorMessage(e)));
  }, [id]);

  if (!record) return error ? <Banner kind="danger">{error}</Banner> : <div className="card" aria-busy="true" />;

  const changes = {
    ...(name.trim() !== (record.name ?? '') ? { name: name.trim() } : {}),
    ...(email.trim() !== (record.email ?? '') ? { email: email.trim() || null } : {}),
  };

  async function run(action: () => Promise<UserDetails>, done?: string) {
    setBusy(true);
    setError(null);
    setNotice(null);
    setDialog(null);
    try {
      apply(await action());
      if (done) setNotice(done);
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  const save = (e: FormEvent) => {
    e.preventDefault();
    void run(
      () => api<UserDetails>(`/admin/users/${id}`, { method: 'PATCH', json: { version: record.version, ...changes } }),
      t('form.saved'),
    );
  };
  const title = displayName(record);
  const blocked = record.status === 'BLOCKED';
  const onWallet = tab === 'wallet';

  return (
    <>
      <form onSubmit={save}>
        <div className="page-head">
          <div>
            <nav className="crumbs" aria-label={t('form.backToList')}>
              <Link href={BASE}>{t('resource.users.title')}</Link>
              <span aria-hidden="true">/</span>
              <span>{title}</span>
            </nav>
            <h1 style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
              {title}
              <span className={STATUS_PILL[record.status]}>{valueLabel(usersResource, 'status', record.status)}</span>
            </h1>
            <div className="sub">
              {[record.phone, record.email].filter(Boolean).join(' · ')}
              {' · '}
              {t('access.users.since', { date: formatDate(record.createdAt), version: record.version })}
            </div>
          </div>
          <div className="actions">
            {onWallet && canAdjust && wallet && wallet.balance > 0 && (
              <button type="button" className="btn" onClick={() => setMoneyDialog('payout')}>
                <CardIcon size={16} />
                {t('wallet.payout.open')}
              </button>
            )}
            {onWallet && canAdjust && wallet && (
              <button type="button" className="btn" onClick={() => setMoneyDialog('adjust')}>
                <CardIcon size={16} />
                {t('wallet.adjust.open')}
              </button>
            )}
            {!onWallet && canManage && Object.keys(changes).length > 0 && (
              <button type="submit" className="btn primary" disabled={busy}>
                {t('common.save')}
              </button>
            )}
            {canManage && record.status !== 'DELETED' && (
              <button
                type="button"
                className={blocked ? 'btn' : 'btn danger'}
                onClick={() => {
                  setReason(null);
                  setNote('');
                  setDialog(blocked ? 'unblock' : 'block');
                }}
              >
                <LockIcon size={16} />
                {blocked ? t('access.users.unblock') : t('access.users.block')}
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
        {blocked && record.blockedAt && record.blockedReason && (
          <Banner kind="warn">
            {t('access.users.blockedBanner', {
              date: formatDateTime(record.blockedAt),
              reason: valueLabel(usersResource, 'blockedReason', record.blockedReason),
            })}
          </Banner>
        )}

        <div className="card client-stats" style={{ margin: '16px 0' }}>
          <div>
            <b>{record.rides}</b>
            <span>{t('access.users.stats.rides')}</span>
          </div>
          <div>
            <b>{formatPln(wallet?.balance ?? record.walletBalance)}</b>
            <span>{t('access.users.stats.balance')}</span>
          </div>
          {wallet && (
            <div>
              <b className={wallet.overdue.length > 0 ? 'bad' : undefined}>{formatPln(overdueTotal(wallet))}</b>
              <span>{t('access.users.stats.overdue')}</span>
            </div>
          )}
          <div>
            <b>{record.ticketsReported}</b>
            <span>{t('access.users.stats.tickets')}</span>
          </div>
          <div>
            <b>{record.sessions.length}</b>
            <span>{t('access.users.stats.sessions')}</span>
          </div>
          <div>
            <b>{record.lastSeenAt ? formatRelative(record.lastSeenAt) : t('common.relative.never')}</b>
            <span>{t('access.users.stats.lastSeen')}</span>
          </div>
        </div>

        <UserTabs id={id} rides={record.rides} />

        {onWallet ? (
          <CustomerWalletTab userId={id} wallet={wallet} error={walletError} revision={walletRevision} />
        ) : (
          <div className="two-col">
            <div className="col">
              <section className="card section-card" style={{ gap: 4 }}>
                <div className="section-head">
                  <h2>{t('access.users.consents')}</h2>
                  <span className="hint">{t('access.users.consentsHint')}</span>
                </div>
                <div style={{ marginTop: 8 }}>
                  {record.consents.length === 0 && <p className="muted">{t('access.users.noConsents')}</p>}
                  {record.consents.map((c) => {
                    const status = consentStatus(c);
                    return (
                      <div key={c.type} className="consent-row">
                        <span>
                          <span className="strong">
                            {c.type === 'AGE' ? t('consentType.AGEPlain') : t.dynamic(`consentType.${c.type}`)}
                          </span>
                          <small>
                            {c.versionNo
                              ? t('access.users.consentVersion', { version: c.versionNo })
                              : c.type === 'AGE'
                                ? t('access.users.consentStatement')
                                : t('access.users.consentVoluntary')}
                          </small>
                        </span>
                        <span className="muted" style={{ fontSize: 13 }}>
                          {c.revokedAt
                            ? t('access.users.revokedAt', { date: formatDateTime(c.revokedAt) })
                            : t('access.users.acceptedAt', { date: formatDateTime(c.acceptedAt) })}
                        </span>
                        <span className={status.pill}>{status.label}</span>
                      </div>
                    );
                  })}
                </div>
              </section>
              <section className="card section-card">
                <h2>{t('access.users.data')}</h2>
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 16 }}>
                  <label className="field">
                    <span className="label">{t('admin.auth.name')}</span>
                    <input
                      className="input"
                      value={name}
                      disabled={!canManage}
                      onChange={(e) => setName(e.target.value)}
                    />
                  </label>
                  <label className="field">
                    <span className="label">
                      {t('resource.users.fields.email')} <span className="opt">{t('common.optional')}</span>
                    </span>
                    <input
                      className="input"
                      type="email"
                      value={email}
                      disabled={!canManage}
                      onChange={(e) => setEmail(e.target.value)}
                    />
                  </label>
                  <label className="field">
                    <span className="label">{t('resource.users.fields.phone')}</span>
                    <input className="input" value={record.phone ?? ''} disabled />
                    <span className="hint">{t('access.users.phoneHint')}</span>
                  </label>
                </div>
              </section>
              {can('users.read') && <SavedPlacesCard userId={id} />}
            </div>

            <div className="col">
              <section className="card side-card">
                <div className="section-head">
                  <h2>{t('access.users.sessions')}</h2>
                  {canManage && record.sessions.length > 0 && (
                    <button type="button" className="btn" onClick={() => setDialog('sessions')}>
                      <LogoutIcon size={16} />
                      {t('access.users.revokeAll')}
                    </button>
                  )}
                </div>
                <ul className="list-plain" style={{ marginTop: 8 }}>
                  {record.sessions.length === 0 && <li className="muted">{t('access.users.noSessions')}</li>}
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
              </section>
              <CustomerDataExports userId={id} />
              <HistoryCard path={`/admin/users/${id}/history`} resourceName="users" revision={record.version} />
            </div>
          </div>
        )}

        <ConfirmDialog
          open={dialog !== null}
          danger={dialog === 'block'}
          title={
            dialog === 'block'
              ? t('access.users.blockTitle', { name: title })
              : dialog === 'unblock'
                ? t('access.users.unblockTitle')
                : t('access.staff.revokeTitle')
          }
          body={
            dialog === 'block'
              ? t('access.users.blockBody')
              : dialog === 'unblock'
                ? t('access.users.unblockBody')
                : t('access.staff.revokeBody')
          }
          action={
            dialog === 'block'
              ? t('access.users.blockSubmit')
              : dialog === 'unblock'
                ? t('access.users.unblock')
                : t('access.users.revokeAll')
          }
          disabled={dialog === 'block' && !reason}
          onClose={() => setDialog(null)}
          onConfirm={() => {
            if (dialog === 'block' && reason) {
              void run(() =>
                api<UserDetails>(`/admin/users/${id}/block`, {
                  method: 'POST',
                  json: { version: record.version, reason, note: note.trim() || null },
                }),
              );
            } else if (dialog === 'unblock') {
              void run(() =>
                api<UserDetails>(`/admin/users/${id}/unblock`, { method: 'POST', json: { version: record.version } }),
              );
            } else if (dialog === 'sessions') {
              void run(() => api<UserDetails>(`/admin/users/${id}/sessions/revoke`, { method: 'POST' }));
            }
          }}
        >
          {dialog === 'block' && (
            <div className="dialog-fields">
              <span className="label">{t('access.users.blockReason')}</span>
              <div role="radiogroup" aria-label={t('access.users.blockReason')}>
                {BLOCK_REASONS.map((r) => (
                  <label key={r} className="radio-option">
                    <input type="radio" name="reason" checked={reason === r} onChange={() => setReason(r)} />
                    <span>
                      {valueLabel(usersResource, 'blockedReason', r)}
                      <small>{t.dynamic(`access.users.reasonHints.${r}`)}</small>
                    </span>
                  </label>
                ))}
              </div>
              <label className="field">
                <span className="label">{t('access.users.blockNote')}</span>
                <textarea className="input" value={note} maxLength={500} onChange={(e) => setNote(e.target.value)} />
              </label>
            </div>
          )}
        </ConfirmDialog>
      </form>
      {moneyDialog === 'adjust' && wallet && (
        <AdjustmentDialog
          userId={id}
          name={title}
          wallet={wallet}
          onClose={() => setMoneyDialog(null)}
          onDone={(next, amount) => {
            setMoneyDialog(null);
            setWallet(next);
            setWalletRevision((n) => n + 1);
            setNotice(
              t('wallet.adjust.done', {
                amount: amount > 0 ? `+${formatPln(amount)}` : formatPln(amount),
                balance: formatPln(next.balance),
              }),
            );
          }}
        />
      )}
      {moneyDialog === 'payout' && wallet && (
        <PayoutDialog
          userId={id}
          name={title}
          wallet={wallet}
          onClose={() => setMoneyDialog(null)}
          onDone={(result) => {
            setMoneyDialog(null);
            setWallet(result.wallet);
            setWalletRevision((n) => n + 1);
            setNotice(
              result.remainder > 0
                ? t('wallet.payout.doneRemainder', {
                    amount: formatPln(result.refunds.reduce((sum, r) => sum + r.amount, 0)),
                    remainder: formatPln(result.remainder),
                  })
                : t('wallet.payout.done', { amount: formatPln(result.refunds.reduce((sum, r) => sum + r.amount, 0)) }),
            );
          }}
        />
      )}
    </>
  );
}
