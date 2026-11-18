'use client';

/**
 * Zwrot za przejazd (makieta przejazd-zwrot, ADR 0054, pytanie 11): całość albo część kwoty, powód z listy
 * i notatka do dziennika audytu. Cel zwrotu wynika ze źródła płatności przejazdu (karta albo portfel)
 * i nie da się go wybrać. Otwarte ze zgłoszenia (reklamacja) wiąże zwrot ze zgłoszeniem (`ticketId`, ADR 0055),
 * więc zwrot pojawia się na osi czasu zgłoszenia.
 */
import { formatPln, REFUND_REASONS, type RefundReason, type RentalAdminDetails } from '@hulajnogi/shared';
import { useEffect, useRef, useState } from 'react';
import { api, ApiRequestError, errorMessage } from '../../../lib/api';
import { t } from '../../../lib/i18n';
import { rentalNumber } from '../fleet/fleet-format';
import { AlertIcon, CardIcon, DocumentIcon, ReceiptIcon, UndoIcon } from '../icons';
import { cardLabel, CardMark, parseZloty } from '../payments/payment-format';
import { customerName } from './rental-parts';

interface RefundDialogProps {
  rental: RentalAdminDetails;
  /** Zgłoszenie, z którego otwarto okno (reklamacja); zwrot trafia na jego oś czasu. */
  ticketId?: string | null;
  onClose: () => void;
  /** Szczegóły po zwrocie (odpowiedź API). */
  onRefunded: (rental: RentalAdminDetails, amount: number) => void;
}

export function RefundDialog({ rental, ticketId = null, onClose, onRefunded }: RefundDialogProps) {
  const ref = useRef<HTMLDialogElement>(null);
  const { settlement, refundable } = rental;
  const [whole, setWhole] = useState(true);
  const [raw, setRaw] = useState('');
  const [reason, setReason] = useState<RefundReason>('SCOOTER_FAILURE');
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    ref.current?.showModal();
  }, []);

  const part = parseZloty(raw);
  const amount = whole ? refundable : (part ?? 0);
  const valid = amount > 0 && amount <= refundable;
  const noteRequired = reason === 'OTHER';
  const card = settlement.source === 'CARD' ? settlement.card : null;
  const target = settlement.source === 'CARD' ? (card ? cardLabel(card) : t('payments.source.CARD')) : null;

  const submit = async () => {
    if (!valid) return;
    setBusy(true);
    setError(null);
    try {
      const next = await api<RentalAdminDetails>(`/admin/rentals/${rental.id}/refund`, {
        method: 'POST',
        json: { amount, reason, note: note.trim() || null, ticketId },
      });
      onRefunded(next, amount);
    } catch (e) {
      if (e instanceof ApiRequestError && e.code === 'REFUND_EXCEEDS_PAYMENT') {
        const remaining = (e.details as { remaining?: number } | undefined)?.remaining;
        setError(
          typeof remaining === 'number'
            ? t('rentals.refund.exceeds', { remaining: formatPln(remaining) })
            : errorMessage(e),
        );
      } else if (e instanceof ApiRequestError && e.code === 'VALIDATION_FAILED' && noteRequired && !note.trim()) {
        setError(t('error.RENTAL_NOTE_REQUIRED'));
      } else {
        setError(errorMessage(e));
      }
      setBusy(false);
    }
  };

  const number = rentalNumber(rental.number);
  return (
    <dialog ref={ref} className="end-dialog money-dialog wide" onClose={onClose} aria-labelledby="refund-title">
      <div className="end-head">
        <span className="end-icon accent" aria-hidden="true">
          <UndoIcon size={20} />
        </span>
        <div>
          <h2 id="refund-title">{t('rentals.refund.title', { number })}</h2>
          <p>
            {t('rentals.refund.body', {
              name: customerName(rental),
              amount: formatPln(settlement.paidAmount),
              source: target ? t('rentals.refund.byCard', { card: target }) : t('rentals.refund.byWallet'),
            })}
          </p>
        </div>
      </div>

      <div className="money-row">
        <div className="field">
          <span className="label" id="refund-amount-label">
            {t('rentals.refund.amount')}
          </span>
          <div className="zc-seg" role="radiogroup" aria-labelledby="refund-amount-label">
            <button type="button" role="radio" aria-checked={whole} onClick={() => setWhole(true)}>
              {t('rentals.refund.whole', { amount: formatPln(refundable) })}
            </button>
            <button type="button" role="radio" aria-checked={!whole} onClick={() => setWhole(false)}>
              {t('rentals.refund.part')}
            </button>
          </div>
          {!whole && (
            <span className="affix">
              <input
                className="input money-input"
                inputMode="decimal"
                value={raw}
                placeholder={t('wallet.adjust.placeholder')}
                aria-label={t('rentals.refund.amount')}
                aria-invalid={raw !== '' && !valid}
                autoFocus
                onChange={(e) => setRaw(e.target.value)}
              />
              <span className="suf">{t('tariffs.suffix.money')}</span>
            </span>
          )}
          <span className={!whole && raw !== '' && !valid ? 'err' : 'hint'}>
            {t('rentals.refund.max', {
              max: formatPln(refundable),
              paid: formatPln(settlement.paidAmount),
              refunded: formatPln(settlement.refundedAmount),
            })}
          </span>
        </div>
        <div className="prev">
          <span className="label">{t('rentals.refund.target')}</span>
          <span className="target">
            {card ? (
              <CardMark brand={card.brand} small />
            ) : (
              <span className="cardmark light sm">{t('payments.walletMark')}</span>
            )}
            <span className="stack">
              <span className="strong-500">
                {target ? t('rentals.refund.toCard', { card: target }) : t('rentals.refund.toWallet')}
              </span>
              <span className="small">
                {target ? t('rentals.refund.toCardHint') : t('rentals.refund.toWalletHint')}
              </span>
            </span>
          </span>
          <span className="small wrap">{target ? t('rentals.refund.cardNote') : t('rentals.refund.walletNote')}</span>
        </div>
      </div>

      <div role="radiogroup" aria-label={t('rentals.refund.reason')} className="reason-grid-wrap">
        <span className="label">{t('rentals.refund.reason')}</span>
        <div className="reason-grid">
          {REFUND_REASONS.map((r) => (
            <label key={r} className="radio-option">
              <input type="radio" name="refund-reason" checked={reason === r} onChange={() => setReason(r)} />
              <span>
                {t.dynamic(`payments.refundReason.${r}`)}
                <small>{t.dynamic(`rentals.refund.reasonHints.${r}`)}</small>
              </span>
            </label>
          ))}
        </div>
      </div>

      <label className="field">
        <span className="label">
          {t('rentals.end.note')}{' '}
          <span className="opt">{noteRequired ? t('rentals.end.noteRequired') : t('rentals.end.noteOptional')}</span>
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
            {target
              ? t('rentals.refund.conseqCard', { amount: formatPln(amount), card: target })
              : t('rentals.refund.conseqWallet', { amount: formatPln(amount) })}
          </span>
        </div>
        {settlement.receiptNumber && (
          <div>
            <span className="ci">
              <ReceiptIcon />
            </span>
            <span>
              {t('rentals.refund.conseqReceipt', { receipt: settlement.receiptNumber, amount: formatPln(amount) })}
            </span>
          </div>
        )}
        <div>
          <span className="ci">
            <DocumentIcon size={15} />
          </span>
          <span>{t('rentals.refund.conseqAudit')}</span>
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
        <button
          type="button"
          className="btn primary"
          disabled={busy || !valid || (noteRequired && !note.trim())}
          onClick={() => void submit()}
        >
          <UndoIcon size={16} />
          {target
            ? t('rentals.refund.submitCard', { amount: formatPln(amount) })
            : t('rentals.refund.submitWallet', { amount: formatPln(amount) })}
        </button>
      </div>
    </dialog>
  );
}
