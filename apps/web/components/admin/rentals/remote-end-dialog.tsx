'use client';

/**
 * Zdalne zakończenie przejazdu (makieta przejazd-zakoncz-zdalnie, decyzja D7, ADR 0036): powód z listy,
 * notatka do dziennika audytu (wymagana przy „Inny powód”) i skutki zakończenia przed potwierdzeniem.
 */
import { formatPln, REMOTE_END_REASONS, type RemoteEndReason, type RentalAdminDetails } from '@hulajnogi/shared';
import { useEffect, useRef, useState } from 'react';
import { api, ApiRequestError, errorMessage } from '../../../lib/api';
import { formatClock, t } from '../../../lib/i18n';
import { rentalNumber, scooterNumber } from '../fleet/fleet-format';
import { AlertIcon, ClockIcon, DocumentIcon, LockIcon, ParkingIcon, StopIcon } from '../icons';
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
          json: { reason, note: note.trim() || null },
        }),
      );
    } catch (e) {
      // Brak notatki przy „Inny powód” API zgłasza jako VALIDATION_FAILED z polem `note`.
      const noteMissing =
        e instanceof ApiRequestError && e.code === 'VALIDATION_FAILED' && JSON.stringify(e.details ?? '').includes('note');
      setError(noteMissing ? t('error.RENTAL_NOTE_REQUIRED') : errorMessage(e));
    } finally {
      setBusy(false);
    }
  };

  const scooter = scooterNumber(rental.scooterNumber);
  return (
    <dialog ref={ref} className="end-dialog" onClose={onClose} aria-labelledby="end-title">
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

      <div role="radiogroup" aria-label={t('rentals.end.reasonGroup')} className="end-reasons">
        <span className="label">{t('rentals.end.reason')}</span>
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
          </span>
        </div>
        <div>
          <span className="ci">
            <ParkingIcon />
          </span>
          <span>{t('rentals.end.noParkingFee')}</span>
        </div>
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
          {t('rentals.end.submit')}
        </button>
      </div>
    </dialog>
  );
}
