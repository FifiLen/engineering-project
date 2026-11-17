'use client';

/**
 * Okna edytora stref: dezaktywacja i usunięcie (makieta strefa-dezaktywacja) oraz ostrzeżenie o przejazdach
 * w trakcie przed zapisem (makieta strefa-zmiana-w-trakcie). Układ jak zdalne zakończenie przejazdu.
 */
import type { ZoneDetails, ZoneImpactRental } from '@hulajnogi/shared';
import Link from 'next/link';
import { useEffect, useRef, useState, type ReactNode } from 'react';
import { formatClock, t } from '../../../lib/i18n';
import { rentalNumber, scooterNumber } from '../fleet/fleet-format';
import {
  DocumentIcon,
  EyeOffIcon,
  FlagIcon,
  RestoreIcon,
  RouteIcon,
  ScooterIcon,
  SlowZoneIcon,
  TrashIcon,
  WarningIcon,
} from '../icons';

function Dialog({
  labelledBy,
  wide,
  onClose,
  children,
}: {
  labelledBy: string;
  wide?: boolean;
  onClose: () => void;
  children: ReactNode;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    if (!ref.current?.open) ref.current?.showModal();
  }, []);
  return (
    <dialog
      ref={ref}
      className="end-dialog zone-dialog"
      style={wide ? { width: 580 } : undefined}
      onClose={onClose}
      aria-labelledby={labelledBy}
    >
      {children}
    </dialog>
  );
}

function Consequence({ icon, children }: { icon: ReactNode; children: ReactNode }) {
  return (
    <div>
      <span className="ci">{icon}</span>
      <span>{children}</span>
    </div>
  );
}

const zoneTitle = (z: Pick<ZoneDetails, 'code' | 'name'>) => `${z.code} ${z.name}`;

/** Dezaktywacja strefy użytej w przejazdach albo usunięcie nieużytej: pytanie, skutki, przycisk w kolorze błędu. */
export function ZoneRemovalDialog({
  zone,
  mode,
  onConfirm,
  onClose,
}: {
  zone: ZoneDetails;
  mode: 'deactivate' | 'delete';
  onConfirm: () => Promise<void>;
  onClose: () => void;
}) {
  const [busy, setBusy] = useState(false);
  const name = zoneTitle(zone);
  const confirm = async () => {
    setBusy(true);
    try {
      await onConfirm();
    } finally {
      setBusy(false);
    }
  };
  return (
    <Dialog labelledBy="zone-dialog-title" onClose={onClose}>
      <div className="end-head">
        <span className="end-icon" aria-hidden="true">
          {mode === 'deactivate' ? <FlagIcon size={20} /> : <TrashIcon size={20} />}
        </span>
        <div>
          <h2 id="zone-dialog-title">
            {mode === 'deactivate'
              ? t('zones.remove.deactivateTitle', { zone: name })
              : t('zones.remove.deleteTitle', { zone: name })}
          </h2>
          <p>
            {mode === 'deactivate'
              ? zone.endedRentals > 0
                ? t('zones.remove.deactivateBodyRides', { count: zone.endedRentals })
                : t('zones.remove.deactivateBody')
              : t('zones.remove.deleteBody')}
          </p>
        </div>
      </div>

      <div className="end-conseq">
        <span className="label">{t('zones.remove.consequences')}</span>
        <Consequence icon={<EyeOffIcon />}>{t.dynamic(`zones.remove.effect.${zone.type}`)}</Consequence>
        {zone.scootersInside > 0 && (
          <Consequence icon={<ScooterIcon size={15} />}>
            {t(zone.type === 'PARKING' ? 'zones.remove.scootersParking' : 'zones.remove.scooters', {
              count: zone.scootersInside,
            })}
          </Consequence>
        )}
        {zone.ridesInside > 0 && (
          <Consequence icon={<RouteIcon size={15} />}>
            {t('zones.remove.rides', { count: zone.ridesInside })}
          </Consequence>
        )}
        {mode === 'deactivate' ? (
          <>
            <Consequence icon={<FlagIcon />}>{t('zones.remove.history', { zone: name })}</Consequence>
            <Consequence icon={<RestoreIcon />}>{t('zones.remove.restore')}</Consequence>
          </>
        ) : (
          <Consequence icon={<TrashIcon />}>{t('zones.remove.permanent')}</Consequence>
        )}
      </div>

      <span className="small" style={{ lineHeight: 1.45 }}>
        {t('zones.remove.audit')}
      </span>

      <div className="actions">
        <button type="button" className="btn" onClick={onClose} autoFocus>
          {t('common.cancel')}
        </button>
        <button type="button" className="btn solid-danger" disabled={busy} onClick={() => void confirm()}>
          {mode === 'deactivate' ? <FlagIcon /> : <TrashIcon />}
          {mode === 'deactivate' ? t('zones.remove.deactivateAction') : t('zones.remove.deleteAction')}
        </button>
      </div>
    </Dialog>
  );
}

export type ImpactChange =
  | { kind: 'limit'; from: number | null; to: number }
  | { kind: 'geometry' }
  | { kind: 'visibility'; visible: boolean }
  | { kind: 'new' };

/** Ostrzeżenie przed zapisem zmiany, która dotyczy przejazdów w trakcie (pytanie 7). */
export function ZoneImpactDialog({
  zone,
  rentals,
  change,
  nextVersion,
  onConfirm,
  onClose,
}: {
  zone: { code: string; name: string };
  rentals: ZoneImpactRental[];
  change: ImpactChange;
  nextVersion: number | null;
  onConfirm: () => void;
  onClose: () => void;
}) {
  const name = zoneTitle(zone);
  const lead =
    change.kind === 'limit'
      ? t('zones.impact.leadLimit', { zone: name, from: change.from ?? '–', to: change.to })
      : change.kind === 'geometry'
        ? t('zones.impact.leadGeometry', { zone: name })
        : change.kind === 'visibility'
          ? t(change.visible ? 'zones.impact.leadShown' : 'zones.impact.leadHidden', { zone: name })
          : t('zones.impact.leadNew', { zone: name });
  return (
    <Dialog labelledBy="zone-impact-title" wide onClose={onClose}>
      <div className="end-head">
        <span className="end-icon warn" aria-hidden="true">
          <WarningIcon size={20} />
        </span>
        <div>
          <h2 id="zone-impact-title">{t('zones.impact.title', { count: rentals.length })}</h2>
          <p>{lead}</p>
        </div>
      </div>

      <div className="impact-table" role="table">
        <div className="impact-row head" role="row">
          <span role="columnheader">{t('zones.impact.rental')}</span>
          <span role="columnheader">{t('zones.impact.scooter')}</span>
          <span role="columnheader">{t('zones.impact.customer')}</span>
          <span role="columnheader">{t('zones.impact.since')}</span>
          <span role="columnheader" className="right">
            {t('zones.impact.speed')}
          </span>
        </div>
        {rentals.map((r) => (
          <div key={r.rentalId} className="impact-row" role="row">
            <span role="cell" className="num">
              <Link className="link" href={`/admin/przejazdy/${r.rentalId}`} target="_blank">
                {rentalNumber(r.rentalNumber)}
              </Link>
            </span>
            <span role="cell" className="num">
              {scooterNumber(r.scooterNumber)}
            </span>
            <span role="cell">{r.userName ?? t('access.users.noName')}</span>
            <span role="cell" className="num">
              {r.enteredAt ? formatClock(r.enteredAt) : t('common.none')}
            </span>
            <span role="cell" className="num right">
              {r.speedKmh === null ? t('common.none') : t('common.kmh', { value: Math.round(r.speedKmh) })}
            </span>
          </div>
        ))}
      </div>

      <div className="end-conseq">
        <span className="label">{t('zones.remove.consequences')}</span>
        <Consequence icon={<SlowZoneIcon style={{ color: 'currentColor' }} />}>
          {change.kind === 'limit' ? t('zones.impact.nextReadingLimit') : t('zones.impact.nextReading')}
        </Consequence>
        {change.kind === 'limit' && (
          <Consequence icon={<ScooterIcon size={15} />}>{t('zones.impact.later', { kmh: change.to })}</Consequence>
        )}
        <Consequence icon={<DocumentIcon size={15} />}>
          {nextVersion ? t('zones.impact.audit', { version: nextVersion }) : t('zones.impact.auditNew')}
        </Consequence>
      </div>

      <div className="actions">
        <button type="button" className="btn" onClick={onClose} autoFocus>
          {t('common.cancel')}
        </button>
        <button type="button" className="btn primary" onClick={onConfirm}>
          {t('zones.impact.confirm')}
        </button>
      </div>
    </Dialog>
  );
}
