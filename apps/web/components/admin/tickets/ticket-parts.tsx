'use client';

/**
 * Wspólne elementy zgłoszenia w panelu (lista z panelem bocznym i szczegóły, makiety zgloszenia-lista,
 * zgloszenie-szczegoly): szczegóły z odświeżaniem po `ticket.updated`, przypisanie i zdjęcia.
 */
import { scootersResource, type FileView, type TicketAdminDetails } from '@hulajnogi/shared';
import { useCallback, useEffect, useState } from 'react';
import { api, errorMessage } from '../../../lib/api';
import { t } from '../../../lib/i18n';
import { useSession } from '../../../lib/session';
import { initials } from '../access/common';
import { PersonIcon } from '../icons';
import { valueLabel } from '../labels';
import { fileUrl } from '../service/service-format';
import { useStaffOptions } from '../service/staff-options';

export interface TicketDetailsState {
  ticket: TicketAdminDetails | null;
  error: string | null;
  apply: (ticket: TicketAdminDetails) => void;
  refresh: () => void;
}

/** Szczegóły zgłoszenia z `GET /admin/tickets/{id}`; `revision` rośnie przy zdarzeniu `ticket.updated`. */
export function useTicketDetails(id: string, revision: number): TicketDetailsState {
  const [state, setState] = useState<{ ticket: TicketAdminDetails | null; error: string | null }>({
    ticket: null,
    error: null,
  });
  const [tick, setTick] = useState(0);
  const apply = useCallback((ticket: TicketAdminDetails) => setState({ ticket, error: null }), []);
  const refresh = useCallback(() => setTick((n) => n + 1), []);
  useEffect(() => {
    const controller = new AbortController();
    api<TicketAdminDetails>(`/admin/tickets/${id}`, { signal: controller.signal })
      .then(apply)
      .catch((e: unknown) => {
        if ((e as Error).name !== 'AbortError') setState((s) => ({ ...s, error: errorMessage(e) }));
      });
    return () => controller.abort();
  }, [id, revision, tick, apply]);
  return { ...state, apply, refresh };
}

/** „Marta Wiśniewska” → „Marta W.” w wierszu listy (makieta). */
export function shortName(name: string): string {
  const [first, ...rest] = name.trim().split(/\s+/);
  const last = rest.at(-1);
  return last ? `${first} ${last[0]}.` : (first ?? name);
}

export function Assignee({ name, short }: { name: string | null; short?: boolean }) {
  if (!name) return <span className="muted">{t('service.unassigned')}</span>;
  return (
    <span className="assignee">
      <span className="av sm" aria-hidden="true">
        {initials(name)}
      </span>
      <span className="assignee-name">{short ? shortName(name) : name}</span>
    </span>
  );
}

/** Stan hulajnogi zgłoszenia: „Serwis” wyróżniony jak w makiecie. */
export function ScooterStatePill({ status }: { status: string }) {
  return (
    <span className={status === 'MAINTENANCE' ? 'pill sm accent' : 'pill sm'}>
      {valueLabel(scootersResource, 'status', status)}
    </span>
  );
}

/**
 * Przypisanie (`POST /admin/tickets/{id}/assign`): lista operatorów z `staff.read`, a bez niego tylko „Przypisz mnie”
 * i zdjęcie przypisania. Wymaga `tickets.manage`.
 */
export function AssignControl({
  ticket,
  onAssigned,
}: {
  ticket: TicketAdminDetails;
  onAssigned: (ticket: TicketAdminDetails) => void;
}) {
  const { staff, can } = useSession();
  const options = useStaffOptions(ticket.assignee);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const editable = can('tickets.manage') && ticket.status !== 'RESOLVED';

  const assign = async (assigneeId: string | null) => {
    setBusy(true);
    setError(null);
    try {
      onAssigned(
        await api<TicketAdminDetails>(`/admin/tickets/${ticket.id}/assign`, {
          method: 'POST',
          json: { version: ticket.version, assigneeId },
        }),
      );
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="field">
      <label className="label" htmlFor={`assign-${ticket.id}`}>
        {t('tickets.assignee')}
      </label>
      <div className="assign-row">
        <span className="select-wrap">
          <PersonIcon />
          <select
            id={`assign-${ticket.id}`}
            className="input"
            value={ticket.assignee?.id ?? ''}
            disabled={!editable || busy}
            onChange={(e) => void assign(e.target.value || null)}
          >
            <option value="">{t('tickets.unassignedOption')}</option>
            {options.map((o) => (
              <option key={o.id} value={o.id}>
                {o.name}
              </option>
            ))}
          </select>
        </span>
        {editable && ticket.assignee?.id !== staff.id && (
          <button type="button" className="btn" disabled={busy} onClick={() => void assign(staff.id)}>
            {t('tickets.assignMe')}
          </button>
        )}
      </div>
      {error && (
        <span className="err" role="alert">
          {error}
        </span>
      )}
    </div>
  );
}

/** Zdjęcia zgłoszenia z podpisanym adresem (10 min); usunięte po 30 dniach jako szare pole z opisem. */
export function TicketPhotos({ photos, number }: { photos: FileView[]; number: string }) {
  if (photos.length === 0) return null;
  return (
    <div className="ticket-photos">
      {photos.map((photo, i) => {
        const url = fileUrl(photo.url);
        return url ? (
          <a key={photo.id} className="photo" href={url} target="_blank" rel="noreferrer">
            <img src={url} alt={t('service.photoAlt', { index: i + 1, number })} />
          </a>
        ) : (
          <span key={photo.id} className="photo deleted">
            {t('service.photoDeleted')}
          </span>
        );
      })}
      <span className="small">
        {t('service.photoCount', { count: photos.length })}
        {photos[0]?.url && (
          <>
            <br />
            <a className="link" href={fileUrl(photos[0].url)!} target="_blank" rel="noreferrer">
              {t('tickets.enlarge')}
            </a>
          </>
        )}
      </span>
    </div>
  );
}
