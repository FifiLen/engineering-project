'use client';

/**
 * Zakładka „Portfel” na karcie klienta (makiety klient-portfel, korekta-salda; ADR 0054): saldo ze zgodnością
 * z księgą, ostrzeżenie poniżej minimum, zaległości, karty tylko do odczytu i księga klienta. Korekta salda
 * i zwrot salda na kartę to polecenia z dziennikiem audytu, tylko z uprawnieniem `wallet.adjust`.
 */
import {
  ADJUSTMENT_REASONS,
  formatPln,
  walletLedgerResource,
  LEDGER_ENTRY_TYPES,
  type AdjustmentReason,
  type CustomerWalletAdmin,
  type LedgerEntryType,
  type ListResponse,
  type WalletLedgerItem,
  type WalletPayoutResult,
} from '@hulajnogi/shared';
import Link from 'next/link';
import { useEffect, useRef, useState } from 'react';
import { api, errorMessage } from '../../../lib/api';
import { formatDateTime, formatRelative, t } from '../../../lib/i18n';
import { useSession } from '../../../lib/session';
import { Banner } from '../access/common';
import { rentalNumber } from '../fleet/fleet-format';
import { AlertIcon, CardIcon, CheckIcon, DocumentIcon, MinusIcon, PhoneIcon, PlusIcon, WarningIcon } from '../icons';
import { PrintButton } from '../prints/print-dialog';
import { valueLabel } from '../labels';
import { CardStatePill, expiry, LedgerDetails, LedgerType } from './payment-lists';
import { cardLabel, CardMark, parseZloty, PAYMENTS_BASE, signedPln, useApiRecord } from './payment-format';

const PERIODS = ['30', '90', 'all'] as const;
type Period = (typeof PERIODS)[number];

/** Portfel klienta (`GET /admin/users/{id}/wallet`); `null` bez uprawnienia `payments.read`. */
export function useCustomerWallet(userId: string, enabled: boolean, revision: number) {
  return useApiRecord<CustomerWalletAdmin>(enabled ? `/admin/users/${userId}/wallet` : null, revision);
}

export const overdueTotal = (wallet: CustomerWalletAdmin) => wallet.overdue.reduce((sum, o) => sum + o.amount, 0);

export function CustomerWalletTab({
  userId,
  wallet,
  error,
  revision,
}: {
  userId: string;
  wallet: CustomerWalletAdmin | null;
  error: string | null;
  revision: number;
}) {
  const [type, setType] = useState<LedgerEntryType | ''>('');
  const [period, setPeriod] = useState<Period>('30');
  const [since] = useState(() => Date.now());
  const params = new URLSearchParams({ userId, pageSize: '100', sort: '-id' });
  if (type) params.set('type', type);
  if (period !== 'all') params.set('createdAt.gte', new Date(since - Number(period) * 86_400_000).toISOString());
  const { data: ledger, error: ledgerError } = useApiRecord<ListResponse<WalletLedgerItem>>(
    `/admin/wallet-ledger?${params}`,
    revision,
  );
  // Ostatnia zmiana salda: najnowszy wpis bez filtrów.
  const { data: latest } = useApiRecord<ListResponse<WalletLedgerItem>>(
    `/admin/wallet-ledger?userId=${userId}&pageSize=1&sort=-id`,
    revision,
  );
  const lastEntry = latest?.items[0] ?? null;

  return (
    <div className="two-col wallet-layout">
      <section className="card section-card ledger-card">
        <div className="section-head">
          <div className="stack wrap">
            <h2>{t('wallet.ledger.title')}</h2>
            <span className="small">{t('wallet.ledger.hint')}</span>
          </div>
          <div className="actions">
            <select
              className="select"
              value={type}
              aria-label={t('wallet.ledger.type')}
              onChange={(e) => setType(e.target.value as LedgerEntryType | '')}
            >
              <option value="">{t('wallet.ledger.allTypes')}</option>
              {LEDGER_ENTRY_TYPES.map((v) => (
                <option key={v} value={v}>
                  {valueLabel(walletLedgerResource, 'type', v)}
                </option>
              ))}
            </select>
            <select
              className="select"
              value={period}
              aria-label={t('wallet.ledger.period')}
              onChange={(e) => setPeriod(e.target.value as Period)}
            >
              {PERIODS.map((p) => (
                <option key={p} value={p}>
                  {t.dynamic(`wallet.ledger.periods.${p}`)}
                </option>
              ))}
            </select>
          </div>
        </div>
        {ledgerError && <Banner kind="danger">{ledgerError}</Banner>}
        <div className="table ledger-table" role="table">
          <div className="lg head" role="row">
            <span role="columnheader">{t('wallet.ledger.date')}</span>
            <span role="columnheader">{t('wallet.ledger.type')}</span>
            <span role="columnheader">{t('wallet.ledger.details')}</span>
            <span role="columnheader" className="right">
              {t('wallet.ledger.amount')}
            </span>
            <span role="columnheader" className="right">
              {t('wallet.ledger.balanceAfter')}
            </span>
          </div>
          {!ledger && !ledgerError && <div className="lg" aria-busy="true" />}
          {ledger?.items.length === 0 && <p className="muted empty-line">{t('wallet.ledger.empty')}</p>}
          {ledger?.items.map((entry) => (
            <div key={entry.id} className="lg" role="row">
              <span role="cell" className="num">
                {formatDateTime(entry.createdAt)}
              </span>
              <span role="cell">
                <LedgerType entry={entry} />
              </span>
              <span role="cell" className="pr-ledger-details">
                <LedgerDetails entry={entry} />
                {(entry.type === 'ADJUSTMENT' || entry.type === 'REFUND') && (
                  <PrintButton
                    documentType="WALLET_ADJUSTMENT"
                    entityId={String(entry.id)}
                    entityLabel={t('prints.types.WALLET_ADJUSTMENT.entry', { id: entry.id })}
                    compact
                  />
                )}
              </span>
              <span role="cell" className="num right">
                {signedPln(entry.amount)}
              </span>
              <span role="cell" className="num right">
                {formatPln(entry.balanceAfter)}
              </span>
            </div>
          ))}
        </div>
        {ledger && (
          <div className="ledger-foot small">
            <span>
              {t.dynamic(`wallet.ledger.count.${period}`, { count: ledger.total })}
              {' · '}
              {t('wallet.ledger.cardRides')}
            </span>
            <Link className="link small-link" href={`${PAYMENTS_BASE}/ksiega?userId=${userId}`}>
              {t('wallet.ledger.full')}
            </Link>
          </div>
        )}
      </section>

      <div className="col">
        <section className="card section-card wallet-card">
          <div className="section-head">
            <h2>{t('wallet.title')}</h2>
            {wallet &&
              (wallet.outOfSync ? (
                <span className="sync bad">
                  <AlertIcon size={14} />
                  {t('wallet.outOfSync', { cached: formatPln(wallet.cachedBalance) })}
                </span>
              ) : (
                <span className="sync">
                  <CheckIcon size={14} />
                  {t('wallet.inSync')}
                </span>
              ))}
          </div>
          {error && <Banner kind="danger">{error}</Banner>}
          {wallet && (
            <>
              <div className="stack">
                <span className={wallet.balance < 0 ? 'balance-big num negative' : 'balance-big num'}>
                  {formatPln(wallet.balance)}
                </span>
                <span className="small">
                  {lastEntry
                    ? t('wallet.lastChange', { date: formatDateTime(lastEntry.createdAt) })
                    : t('wallet.noEntries')}
                </span>
              </div>
              {wallet.balance < 0 ? (
                <div className="notice warn" role="status">
                  <span className="ic">
                    <WarningIcon size={15} />
                  </span>
                  <span>{t('wallet.negative')}</span>
                </div>
              ) : (
                wallet.balance < wallet.minWalletBalance && (
                  <div className="notice warn" role="status">
                    <span className="ic">
                      <WarningIcon size={15} />
                    </span>
                    <span>{t('wallet.belowMinimum', { minimum: formatPln(wallet.minWalletBalance) })}</span>
                  </div>
                )
              )}
            </>
          )}
        </section>

        {wallet && wallet.overdue.length > 0 && <OverdueCard wallet={wallet} />}

        {wallet && (
          <section className="card section-card methods-card">
            <div className="section-head">
              <h2>{t('wallet.methods.title')}</h2>
              <span className="small">{t('wallet.methods.hint')}</span>
            </div>
            <ul className="pm-list">
              {wallet.paymentMethods.map((m) => (
                <li key={m.id} className="pm">
                  <CardMark brand={m.brand} />
                  <span className="stack grow">
                    <span className="strong-500">{cardLabel(m)}</span>
                    <span className="small">
                      {m.state === 'REMOVED' && m.removedAt
                        ? t('wallet.methods.removed', { date: formatDateTime(m.removedAt) })
                        : t('wallet.methods.expires', { expiry: expiry(m) })}
                    </span>
                  </span>
                  {m.isDefault && m.state !== 'REMOVED' ? (
                    <span className="pill accent">{t('payments.methods.default')}</span>
                  ) : (
                    m.state !== 'ACTIVE' && <CardStatePill state={m.state} />
                  )}
                </li>
              ))}
              <li className="pm">
                <span className="cardmark light" aria-hidden="true">
                  {t('payments.brandMarks.blik')}
                </span>
                <span className="stack grow">
                  <span className="strong-500">{t('payments.blik')}</span>
                  <span className="small">{t('wallet.methods.blik')}</span>
                </span>
              </li>
            </ul>
          </section>
        )}
      </div>
    </div>
  );
}

function OverdueCard({ wallet }: { wallet: CustomerWalletAdmin }) {
  const { can } = useSession();
  return (
    <section className="card section-card overdue-card">
      <div className="section-head">
        <h2>{t('wallet.overdue.title')}</h2>
        <span className="num bad">{formatPln(overdueTotal(wallet))}</span>
      </div>
      <ul className="list-plain">
        {wallet.overdue.map((o) => (
          <li key={o.rentalId}>
            <span className="grow">
              {can('rentals.read') ? (
                <Link className="link" href={`/admin/przejazdy/${o.rentalId}`}>
                  {rentalNumber(o.number)}
                </Link>
              ) : (
                rentalNumber(o.number)
              )}
              <small>
                {[
                  o.card && cardLabel(o.card),
                  o.failureReason ?? o.failureCode,
                  o.paymentPending
                    ? t('wallet.overdue.pending')
                    : o.retryAt
                      ? t('wallet.overdue.retry', { relative: formatRelative(o.retryAt) })
                      : t('wallet.overdue.attempts', { count: o.failedAttempts }),
                ]
                  .filter(Boolean)
                  .join(' · ')}
              </small>
            </span>
            <span className="num">{formatPln(o.amount)}</span>
          </li>
        ))}
      </ul>
    </section>
  );
}

// ---------------------------------------------------------------------------------------------
// Korekta salda
// ---------------------------------------------------------------------------------------------

function useModal() {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    ref.current?.showModal();
  }, []);
  return ref;
}

export function AdjustmentDialog({
  userId,
  name,
  wallet,
  onClose,
  onDone,
}: {
  userId: string;
  name: string;
  wallet: CustomerWalletAdmin;
  onClose: () => void;
  onDone: (wallet: CustomerWalletAdmin, amount: number) => void;
}) {
  const ref = useModal();
  const [sign, setSign] = useState<1 | -1>(1);
  const [raw, setRaw] = useState('');
  const [reason, setReason] = useState<AdjustmentReason | null>(null);
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const grosze = parseZloty(raw);
  const valid = grosze !== null && grosze > 0 && grosze <= 1_000_000;
  const amount = valid ? sign * grosze : 0;
  const noteRequired = reason === 'OTHER';
  const ready = valid && reason !== null && (!noteRequired || note.trim().length > 0);
  const after = wallet.balance + amount;
  const reasonLabel = reason ? valueLabel(walletLedgerResource, 'reason', reason) : '';

  const submit = async () => {
    if (!ready || !reason) return;
    setBusy(true);
    setError(null);
    try {
      const next = await api<CustomerWalletAdmin>(`/admin/users/${userId}/wallet/adjustments`, {
        method: 'POST',
        json: { amount, reason, note: note.trim() || null },
      });
      onDone(next, amount);
    } catch (e) {
      setError(errorMessage(e));
      setBusy(false);
    }
  };

  return (
    <dialog ref={ref} className="end-dialog money-dialog" onClose={onClose} aria-labelledby="adjust-title">
      <div className="end-head">
        <span className="end-icon accent" aria-hidden="true">
          <CardIcon size={20} />
        </span>
        <div>
          <h2 id="adjust-title">{t('wallet.adjust.title', { name })}</h2>
          <p>{t('wallet.adjust.body')}</p>
        </div>
      </div>

      <div className="money-row">
        <div className="field">
          <span className="label" id="adjust-amount-label">
            {t('wallet.adjust.amount')}
          </span>
          <div className="zc-seg" role="radiogroup" aria-labelledby="adjust-amount-label">
            <button type="button" role="radio" aria-checked={sign === 1} onClick={() => setSign(1)}>
              <PlusIcon size={14} />
              {t('wallet.adjust.add')}
            </button>
            <button type="button" role="radio" aria-checked={sign === -1} onClick={() => setSign(-1)}>
              <MinusIcon size={14} />
              {t('wallet.adjust.subtract')}
            </button>
          </div>
          <span className="affix">
            <input
              className="input money-input"
              inputMode="decimal"
              value={raw}
              placeholder={t('wallet.adjust.placeholder')}
              aria-label={t('wallet.adjust.amount')}
              aria-invalid={raw !== '' && !valid}
              autoFocus
              onChange={(e) => setRaw(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && e.preventDefault()}
            />
            <span className="suf">{t('tariffs.suffix.money')}</span>
          </span>
          {raw !== '' && !valid && <span className="err">{t('wallet.adjust.invalidAmount')}</span>}
        </div>
        <div className="prev">
          <span className="r">
            <span className="muted">{t('wallet.adjust.balanceNow')}</span>
            <span className="num">{formatPln(wallet.balance)}</span>
          </span>
          <span className="r">
            <span className="muted">{t('wallet.adjust.correction')}</span>
            <span className="num">{valid ? signedPln(amount) : t('common.none')}</span>
          </span>
          <span className="r total">
            <span className="strong">{t('wallet.adjust.balanceAfter')}</span>
            <span className={after < 0 ? 'num big negative' : 'num big'}>{formatPln(after)}</span>
          </span>
        </div>
      </div>

      <div role="radiogroup" aria-label={t('wallet.adjust.reason')} className="reason-grid-wrap">
        <span className="label">
          {t('wallet.adjust.reason')} <span className="opt">{t('wallet.adjust.reasonHint')}</span>
        </span>
        <div className="reason-grid">
          {ADJUSTMENT_REASONS.map((r) => (
            <label key={r} className="radio-option">
              <input type="radio" name="adjust-reason" checked={reason === r} onChange={() => setReason(r)} />
              <span>
                {valueLabel(walletLedgerResource, 'reason', r)}
                <small>{t.dynamic(`wallet.adjust.reasonHints.${r}`)}</small>
              </span>
            </label>
          ))}
        </div>
      </div>

      <label className="field">
        <span className="label">
          {t('wallet.adjust.note')}{' '}
          <span className="opt">{noteRequired ? t('wallet.adjust.noteRequired') : t('wallet.adjust.noteHint')}</span>
        </span>
        <textarea
          className="input"
          value={note}
          maxLength={500}
          required={noteRequired}
          onChange={(e) => setNote(e.target.value)}
        />
      </label>

      <div className="end-conseq">
        <span className="label">{t('rentals.end.consequences')}</span>
        <div>
          <span className="ci">
            <CardIcon size={15} />
          </span>
          <span>
            {valid
              ? t('wallet.adjust.conseqLedger', { amount: signedPln(amount), after: formatPln(after) })
              : t('wallet.adjust.conseqLedgerEmpty')}
          </span>
        </div>
        <div>
          <span className="ci">
            <PhoneIcon />
          </span>
          <span>
            {reason
              ? t('wallet.adjust.conseqApp', { reason: reasonLabel.toLowerCase() })
              : t('wallet.adjust.conseqAppEmpty')}
          </span>
        </div>
        <div>
          <span className="ci">
            <DocumentIcon size={15} />
          </span>
          <span>{t('wallet.adjust.conseqAudit')}</span>
        </div>
      </div>

      {error && (
        <div className="banner danger" role="alert">
          <AlertIcon size={16} />
          <span>{error}</span>
        </div>
      )}

      <div className="actions">
        <button type="button" className="btn" onClick={onClose}>
          {t('common.cancel')}
        </button>
        <button type="button" className="btn primary" disabled={busy || !ready} onClick={() => void submit()}>
          {sign === 1 ? <PlusIcon size={16} /> : <MinusIcon size={16} />}
          {valid
            ? t(sign === 1 ? 'wallet.adjust.submitAdd' : 'wallet.adjust.submitSubtract', { amount: formatPln(grosze) })
            : t('wallet.adjust.submit')}
        </button>
      </div>
    </dialog>
  );
}

// ---------------------------------------------------------------------------------------------
// Zwrot salda na kartę
// ---------------------------------------------------------------------------------------------

export function PayoutDialog({
  userId,
  name,
  wallet,
  onClose,
  onDone,
}: {
  userId: string;
  name: string;
  wallet: CustomerWalletAdmin;
  onClose: () => void;
  onDone: (result: WalletPayoutResult) => void;
}) {
  const ref = useModal();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = async () => {
    setBusy(true);
    setError(null);
    try {
      onDone(await api<WalletPayoutResult>(`/admin/users/${userId}/wallet/payout`, { method: 'POST' }));
    } catch (e) {
      setError(errorMessage(e));
      setBusy(false);
    }
  };

  return (
    <dialog ref={ref} className="end-dialog money-dialog" onClose={onClose} aria-labelledby="payout-title">
      <div className="end-head">
        <span className="end-icon accent" aria-hidden="true">
          <CardIcon size={20} />
        </span>
        <div>
          <h2 id="payout-title">{t('wallet.payout.title', { name })}</h2>
          <p>{t('wallet.payout.body', { amount: formatPln(wallet.balance) })}</p>
        </div>
      </div>
      <div className="end-conseq">
        <span className="label">{t('rentals.end.consequences')}</span>
        <div>
          <span className="ci">
            <CardIcon size={15} />
          </span>
          <span>{t('wallet.payout.conseqRefunds')}</span>
        </div>
        <div>
          <span className="ci">
            <MinusIcon size={15} />
          </span>
          <span>{t('wallet.payout.conseqLedger')}</span>
        </div>
        <div>
          <span className="ci">
            <WarningIcon size={15} />
          </span>
          <span>{t('wallet.payout.conseqRemainder')}</span>
        </div>
        <div>
          <span className="ci">
            <DocumentIcon size={15} />
          </span>
          <span>{t('wallet.payout.conseqAudit')}</span>
        </div>
      </div>
      {error && (
        <div className="banner danger" role="alert">
          <AlertIcon size={16} />
          <span>{error}</span>
        </div>
      )}
      <div className="actions">
        <button type="button" className="btn" onClick={onClose} autoFocus>
          {t('common.cancel')}
        </button>
        <button type="button" className="btn primary" disabled={busy} onClick={() => void submit()}>
          <CardIcon size={16} />
          {t('wallet.payout.submit', { amount: formatPln(wallet.balance) })}
        </button>
      </div>
    </dialog>
  );
}
