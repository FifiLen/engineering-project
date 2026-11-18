'use client';

/**
 * Zdalne zakończenie przejazdu (makiety przejazd-zakoncz-zdalnie i 27-panel-serwis/przejazd-zakoncz-odholowanie,
 * decyzja D7, ADR 0036, ADR 0060): powód z listy, notatka do dziennika audytu (wymagana przy „Inny powód”), opłata
 * za odholowanie, gdy ostatnia pozycja jest poza strefą parkowania, i skutki zakończenia przed potwierdzeniem.
 */
import { formatPln, REMOTE_END_REASONS, type RemoteEndReason, type RentalAdminDetails } from '@hulajnogi/shared';
import { useEffect, useRef, useState } from 'react';
import { api, ApiRequestError, errorMessage } from '../../../lib/api';
import { formatClock, formatTime, t } from '../../../lib/i18n';
import { rentalNumber, scooterNumber } from '../fleet/fleet-format';
import {
  AlertIcon,
  CheckIcon,
  ClockIcon,
  DocumentIcon,
  LockIcon,
  ParkingIcon,
  ReceiptIcon,
  StopIcon,
  TruckIcon,
  WarningIcon,
} from '../icons';
import { customerName } from './rental-parts';

interface RemoteEndDialogProps {
  rental: RentalAdminDetails;
  onClose: () => void;
  /** Szczegóły po zakończeniu (odpowiedź API). */
  onEnded: (rental: RentalAdminDetails) => void;
}

export function RemoteEndDialog({ rental, onClose, onEnded }: RemoteEndDialogProps) {
  const ref = useRef<HTMLDialogElement>(null);
  const [reason, setReason] = useState<RemoteEndReason>('SCOOTER_NOT_RESPONDING');
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const noteRequired = reason === 'OTHER';
  // Pole opłaty tylko, gdy ostatnia pozycja jest poza strefą parkowania; domyślnie zaznaczone (pytanie 7).
  const towing = rental.towing?.outsideParking ? rental.towing : null;
  const [collectTowingFee, setCollectTowingFee] = useState(true);
  const fee = towing && collectTowingFee ? towing.outOfZoneFee : 0;

  useEffect(() => {
    ref.current?.showModal();
  }, []);

  const submit = async () => {
    setBusy(true);
    setError(null);
    try {
      onEnded(
        await api<RentalAdminDetails>(`/admin/rentals/${rental.id}/end`, {
          method: 'POST',
          json: { reason, note: note.trim() || null, collectTowingFee: fee > 0 },
        }),
      );
    } catch (e) {
      // Brak notatki przy „Inny powód” API zgłasza jako VALIDATION_FAILED z polem `note`.
      const noteMissing =
        e instanceof ApiRequestError &&
        e.code === 'VALIDATION_FAILED' &&
        JSON.stringify(e.details ?? '').includes('note');
      setError(noteMissing ? t('error.RENTAL_NOTE_REQUIRED') : errorMessage(e));
    } finally {
      setBusy(false);
    }
  };

  const scooter = scooterNumber(rental.scooterNumber);
  return (
    <dialog ref={ref} className="end-dialog towing-dialog" onClose={onClose} aria-labelledby="end-title">
      <div className="end-head">
        <span className="end-icon" aria-hidden="true">
          <StopIcon size={20} />
        </span>
        <div>
          <h2 id="end-title">{t('rentals.end.title', { number: rentalNumber(rental.number) })}</h2>
          <p>
            {t('rentals.end.body', {
              name: customerName(rental),
              scooter,
              time: rental.startedAt ? formatClock(rental.startedAt) : t('common.none'),
            })}
          </p>
        </div>
      </div>

      {towing && (
        <div className="notice warn" role="status">
          <span className="ic">
            <WarningIcon size={15} />
          </span>
          <span>
            {towing.positionAt
              ? t('rentals.end.towing.outside', { time: formatTime(towing.positionAt) })
              : t('rentals.end.towing.outsideNoTime')}
          </span>
        </div>
      )}

      <div role="radiogroup" aria-label={t('rentals.end.reasonGroup')} className="end-reasons">
        <span className="label">{t('rentals.end.reason')}</span>
        <div className="end-reasons-grid">
          {REMOTE_END_REASONS.map((r) => (
            <label key={r} className="radio-option">
              <input type="radio" name="end-reason" checked={reason === r} onChange={() => setReason(r)} />
              <span>
                {t.dynamic(`rentals.end.reasons.${r}`)}
                <small>{t.dynamic(`rentals.end.reasonHints.${r}`)}</small>
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
          aria-invalid={error !== null && noteRequired && !note.trim()}
          onChange={(e) => setNote(e.target.value)}
        />
      </label>

      {towing && (
        <label className={collectTowingFee ? 'towing-fee on' : 'towing-fee'}>
          <input
            type="checkbox"
            className="visually-hidden"
            checked={collectTowingFee}
            onChange={(e) => setCollectTowingFee(e.target.checked)}
          />
          <span className="cbx" aria-hidden="true">
            {collectTowingFee && <CheckIcon size={14} />}
          </span>
          <span className="stack grow">
            <span className="strong">{t('rentals.end.towing.collect')}</span>
            <small className="muted">{t('rentals.end.towing.fromTariff', { version: rental.tariff.version })}</small>
          </span>
          <span className="num fee">{formatPln(towing.outOfZoneFee)}</span>
        </label>
      )}

      <div className="end-conseq">
        <span className="label">{t('rentals.end.consequences')}</span>
        <div>
          <span className="ci">
            <ClockIcon />
          </span>
          <span>
            {t('rentals.end.charge', {
              ride: rental.price.rideMinutes,
              pause: rental.price.pauseMinutes,
              total: formatPln(rental.price.total),
              version: rental.tariff.version,
            })}
            {fee > 0 && ` ${t('rentals.end.towing.charge', { fee: formatPln(fee) })}`}
          </span>
        </div>
        {fee > 0 && (
          <div>
            <span className="ci">
              <ReceiptIcon />
            </span>
            <span>{t('rentals.end.towing.receipt', { fee: formatPln(fee) })}</span>
          </div>
        )}
        {towing ? (
          <div>
            <span className="ci">
              <TruckIcon size={15} />
            </span>
            <span>{t('rentals.end.towing.relocation', { scooter })}</span>
          </div>
        ) : (
          <div>
            <span className="ci">
              <ParkingIcon />
            </span>
            <span>{t(rental.towing ? 'rentals.end.towing.inParking' : 'rentals.end.towing.none')}</span>
          </div>
        )}
        <div>
          <span className="ci">
            <LockIcon size={15} />
          </span>
          <span>{t('rentals.end.lock', { scooter })}</span>
        </div>
        <div>
          <span className="ci">
            <DocumentIcon size={15} />
          </span>
          <span>{t('rentals.end.audit')}</span>
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
        <button
          type="button"
          className="btn solid-danger"
          disabled={busy || (noteRequired && !note.trim())}
          onClick={() => void submit()}
        >
          <StopIcon size={16} />
          {fee > 0 ? t('rentals.end.towing.submit', { fee: formatPln(fee) }) : t('rentals.end.submit')}
        </button>
      </div>
    </dialog>
  );
}
