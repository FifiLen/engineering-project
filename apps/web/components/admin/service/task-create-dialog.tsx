'use client';

/**
 * „Utwórz zadanie” i „Wyślij do serwisu” to jedno okno (makieta hulajnoga-serwis, ADR 0055): rodzaj podpowiada
 * kategoria zgłoszenia (Bateria → Wymiana baterii, Poza strefą → Przewiezienie, reszta → Naprawa), rodzaj już
 * otwarty na hulajnodze jest nieaktywny, a przewiezienie wymaga strefy docelowej.
 */
import {
  SERVICE_TASK_TYPES,
  TASK_PRIORITIES,
  type ListResponse,
  type ScooterListItem,
  type ScooterServiceSummary,
  type ServiceTaskDetails,
  type ServiceTaskType,
  type TaskPriority,
  type TicketCategory,
  type TicketListItem,
} from '@hulajnogi/shared';
import { useEffect, useRef, useState } from 'react';
import { api, errorMessage } from '../../../lib/api';
import { t } from '../../../lib/i18n';
import { useSession } from '../../../lib/session';
import { scooterNumber } from '../fleet/fleet-format';
import { AlertIcon, BriefcaseIcon, DocumentIcon, ServiceIcon } from '../icons';
import type { ZoneCollection } from '../map-layers';
import { ageLabel, categoryLabel, reporterLabel, taskTypeLabel, ticketNumber } from './service-format';
import { useStaffOptions } from './staff-options';

export interface TaskTicket {
  id: string;
  number: number;
  categories: readonly TicketCategory[];
}

interface TaskCreateDialogProps {
  /** Hulajnoga z karty albo zgłoszenia; bez niej okno pyta o numer (lista zadań, „Nowe zadanie”). */
  scooter: { id: string; number: number } | null;
  /** Zgłoszenie, z którego powstaje zadanie (`ticketId`). */
  ticket?: TaskTicket | null;
  /** Rodzaj podpowiedziany przez API (`suggestedTaskType`) i rodzaje dostępne na hulajnodze. */
  suggestedType?: ServiceTaskType | null;
  availableTypes?: readonly ServiceTaskType[] | null;
  /** „Wyślij do serwisu” z karty hulajnogi albo „Utwórz zadanie” ze zgłoszenia i listy zadań. */
  mode: 'send' | 'create';
  onClose: () => void;
  onCreated: (task: ServiceTaskDetails) => void;
}

/** Rodzaj z kategorii zgłoszenia (ta sama reguła co `suggestedTaskType` w API). */
export function typeForCategories(categories: readonly string[]): ServiceTaskType | null {
  if (categories.includes('OUT_OF_ZONE')) return 'RELOCATION';
  if (categories.includes('BATTERY')) return 'BATTERY_SWAP';
  return categories.some((c) => c !== 'BILLING') ? 'REPAIR' : null;
}

/** Strefy parkowania z publicznej warstwy stref (cel przewiezienia); wczytywane raz na kartę. */
let parkingRequest: Promise<Array<{ id: string; code: string; name: string }>> | null = null;
function loadParkingZones() {
  parkingRequest ??= api<ZoneCollection>('/zones')
    .then((c) =>
      c.features
        .filter((f) => f.properties.type === 'PARKING' && f.id !== undefined)
        .map((f) => ({ id: String(f.id), code: f.properties.code, name: f.properties.name })),
    )
    .catch(() => {
      parkingRequest = null;
      return [];
    });
  return parkingRequest;
}

export function TaskCreateDialog(props: TaskCreateDialogProps) {
  const { mode, onClose, onCreated } = props;
  const { staff, can } = useSession();
  const ref = useRef<HTMLDialogElement>(null);
  const [scooter, setScooter] = useState(props.scooter);
  const [numberInput, setNumberInput] = useState('');
  const [available, setAvailable] = useState<readonly ServiceTaskType[] | null>(props.availableTypes ?? null);
  const [tickets, setTickets] = useState<TicketListItem[]>([]);
  const [ticketId, setTicketId] = useState<string | null>(props.ticket?.id ?? null);
  const initialType =
    props.suggestedType ?? (props.ticket ? typeForCategories(props.ticket.categories) : null) ?? 'REPAIR';
  const [type, setType] = useState<ServiceTaskType>(initialType);
  const [assigneeId, setAssigneeId] = useState<string>('');
  const [priority, setPriority] = useState<TaskPriority>('NORMAL');
  const [description, setDescription] = useState('');
  const [zones, setZones] = useState<Array<{ id: string; code: string; name: string }>>([]);
  const [zoneId, setZoneId] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const staffOptions = useStaffOptions();

  useEffect(() => {
    ref.current?.showModal();
  }, []);

  // Rodzaje dostępne na hulajnodze, gdy okno nie dostało ich od wywołującego.
  useEffect(() => {
    if (!scooter || props.availableTypes) return;
    api<ScooterServiceSummary>(`/admin/scooters/${scooter.id}/service`)
      .then((s) => setAvailable(s.availableTaskTypes))
      .catch(() => setAvailable(null));
  }, [scooter, props.availableTypes]);

  // Otwarte zgłoszenia hulajnogi do powiązania z zadaniem (tylko z `tickets.read`).
  useEffect(() => {
    if (!scooter || !can('tickets.read')) return;
    api<ListResponse<TicketListItem>>(
      `/admin/tickets?scooterId=${scooter.id}&status=NEW,IN_PROGRESS,AT_SERVICE&pageSize=20`,
    )
      .then((r) => setTickets(r.items))
      .catch(() => setTickets([]));
  }, [scooter, can]);

  useEffect(() => {
    if (type === 'RELOCATION') void loadParkingZones().then(setZones);
  }, [type]);

  // Rodzaj już otwarty na hulajnodze jest nieaktywny; wybór przechodzi na pierwszy dostępny.
  useEffect(() => {
    if (available && !available.includes(type) && available.length > 0) setType(available[0]!);
  }, [available, type]);

  const findScooter = async () => {
    const n = Number(numberInput.replace(/^#/, ''));
    if (!Number.isInteger(n) || n <= 0) return;
    setError(null);
    try {
      const r = await api<ListResponse<ScooterListItem>>(`/admin/scooters?number=${n}&pageSize=1`);
      const found = r.items[0];
      if (found) setScooter({ id: found.id, number: found.number });
      else setError(t('tasks.create.scooterNotFound', { number: scooterNumber(n) }));
    } catch (e) {
      setError(errorMessage(e));
    }
  };

  const pickTicket = (id: string) => {
    setTicketId(id || null);
    const picked = tickets.find((x) => x.id === id);
    const suggested = picked ? typeForCategories(picked.categories) : null;
    if (suggested && (!available || available.includes(suggested))) setType(suggested);
  };

  const ticketLabelOf = (id: string | null) => {
    if (!id) return null;
    if (props.ticket?.id === id) return ticketNumber(props.ticket.number);
    const found = tickets.find((x) => x.id === id);
    return found ? ticketNumber(found.number) : null;
  };

  const assignee = staffOptions.find((o) => o.id === assigneeId) ?? null;
  const valid =
    scooter !== null && (type !== 'RELOCATION' || zoneId !== '') && (!available || available.includes(type));

  const submit = async () => {
    if (!scooter || !valid) return;
    setBusy(true);
    setError(null);
    try {
      onCreated(
        await api<ServiceTaskDetails>('/admin/service-tasks', {
          method: 'POST',
          json: {
            scooterId: scooter.id,
            type,
            ticketId,
            assigneeId: assigneeId || null,
            priority,
            description: description.trim() || null,
            target: type === 'RELOCATION' ? { zoneId } : null,
          },
        }),
      );
    } catch (e) {
      setError(errorMessage(e));
      setBusy(false);
    }
  };

  const label = scooter ? scooterNumber(scooter.number) : null;
  const ticketLabel = ticketLabelOf(ticketId);
  const ticketOptions: Array<TaskTicket & Partial<Pick<TicketListItem, 'source' | 'reporterName' | 'ageSeconds'>>> = [
    ...(props.ticket && !tickets.some((x) => x.id === props.ticket!.id) ? [props.ticket] : []),
    ...tickets,
  ];

  return (
    <dialog ref={ref} className="end-dialog task-dialog" onClose={onClose} aria-labelledby="task-create-title">
      <div className="end-head">
        <span className="end-icon accent" aria-hidden="true">
          <ServiceIcon size={20} />
        </span>
        <div>
          <h2 id="task-create-title">
            {mode === 'send'
              ? t('tasks.create.sendTitle', { scooter: label ?? '' })
              : label
                ? t('tasks.create.title', { scooter: label })
                : t('tasks.create.titleNoScooter')}
          </h2>
          <p>{mode === 'send' ? t('tasks.create.sendBody') : t('tasks.create.body')}</p>
        </div>
      </div>

      {!props.scooter && (
        <div className="field">
          <label className="label" htmlFor="task-scooter">
            {t('tasks.create.scooter')}
          </label>
          <div className="inline-field">
            <input
              id="task-scooter"
              className="input"
              inputMode="numeric"
              value={numberInput}
              placeholder={t('tasks.create.scooterPlaceholder')}
              onChange={(e) => {
                setNumberInput(e.target.value);
                setScooter(null);
                setAvailable(null);
              }}
              onKeyDown={(e) => {
                if (e.key === 'Enter') {
                  e.preventDefault();
                  void findScooter();
                }
              }}
            />
            <button type="button" className="btn" onClick={() => void findScooter()}>
              {scooter ? scooterNumber(scooter.number) : t('tasks.create.find')}
            </button>
          </div>
        </div>
      )}

      <div className="field">
        <span className="label" id="task-type-label">
          {t('tasks.create.type')}
        </span>
        <div className="zc-seg" role="radiogroup" aria-labelledby="task-type-label">
          {SERVICE_TASK_TYPES.map((value) => (
            <button
              key={value}
              type="button"
              role="radio"
              aria-checked={type === value}
              disabled={available !== null && !available.includes(value)}
              title={available !== null && !available.includes(value) ? t('tasks.create.typeOpen') : undefined}
              onClick={() => setType(value)}
            >
              {taskTypeLabel(value)}
            </button>
          ))}
        </div>
      </div>

      {type === 'RELOCATION' && (
        <div className="field">
          <label className="label" htmlFor="task-zone">
            {t('tasks.create.target')}
          </label>
          <select id="task-zone" className="input" value={zoneId} onChange={(e) => setZoneId(e.target.value)}>
            <option value="">{t('tasks.create.targetPick')}</option>
            {zones.map((z) => (
              <option key={z.id} value={z.id}>
                {t('tasks.create.zoneOption', { code: z.code, name: z.name })}
              </option>
            ))}
          </select>
        </div>
      )}

      {(ticketOptions.length > 0 || props.ticket) && (
        <div className="field">
          <label className="label" htmlFor="task-ticket">
            {t('tasks.create.ticket')} <span className="opt">{t('common.optional')}</span>
          </label>
          <select
            id="task-ticket"
            className="input"
            value={ticketId ?? ''}
            onChange={(e) => pickTicket(e.target.value)}
          >
            <option value="">{t('tasks.create.noTicket')}</option>
            {ticketOptions.map((x) => (
              <option key={x.id} value={x.id}>
                {[
                  `${ticketNumber(x.number)} · ${x.categories.map(categoryLabel).join(', ')}`,
                  x.source ? reporterLabel(x.source, x.reporterName ?? null) : null,
                  x.ageSeconds !== undefined ? ageLabel(x.ageSeconds) : null,
                ]
                  .filter(Boolean)
                  .join(' · ')}
              </option>
            ))}
          </select>
        </div>
      )}

      <div className="task-dialog-row">
        <div className="field">
          <label className="label" htmlFor="task-assignee">
            {t('tasks.create.assignee')} <span className="opt">{t('tasks.create.optional')}</span>
          </label>
          <select
            id="task-assignee"
            className="input"
            value={assigneeId}
            onChange={(e) => setAssigneeId(e.target.value)}
          >
            <option value="">{t('tasks.create.noAssignee')}</option>
            {staffOptions.map((o) => (
              <option key={o.id} value={o.id}>
                {o.id === staff.id ? t('tasks.create.me', { name: o.name }) : o.name}
              </option>
            ))}
          </select>
        </div>
        <div className="field">
          <span className="label" id="task-priority-label">
            {t('tasks.create.priority')}
          </span>
          <div className="zc-seg" role="radiogroup" aria-labelledby="task-priority-label">
            {TASK_PRIORITIES.map((value) => (
              <button
                key={value}
                type="button"
                role="radio"
                aria-checked={priority === value}
                onClick={() => setPriority(value)}
              >
                {t.dynamic(`service.priority.${value}`)}
              </button>
            ))}
          </div>
        </div>
      </div>

      <label className="field">
        <span className="label">{t('tasks.create.description')}</span>
        <textarea
          className="input"
          value={description}
          maxLength={1000}
          onChange={(e) => setDescription(e.target.value)}
        />
      </label>

      <div className="end-conseq">
        <span className="label">{t('tasks.create.whatHappens')}</span>
        <div>
          <span className="ci">
            <ServiceIcon size={15} />
          </span>
          <span>{t('tasks.create.conseqScooter', { scooter: label ?? t('tasks.create.theScooter') })}</span>
        </div>
        <div>
          <span className="ci">
            <BriefcaseIcon size={15} />
          </span>
          <span>
            {assignee
              ? t('tasks.create.conseqTaskFor', { type: taskTypeLabel(type), name: assignee.name })
              : t('tasks.create.conseqTask', { type: taskTypeLabel(type) })}
            {ticketLabel && ` ${t('tasks.create.conseqTicket', { ticket: ticketLabel })}`}
          </span>
        </div>
        <div>
          <span className="ci">
            <DocumentIcon size={15} />
          </span>
          <span>{t('tasks.create.conseqAudit')}</span>
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
        <button type="button" className="btn primary" disabled={busy || !valid} onClick={() => void submit()}>
          <ServiceIcon size={16} />
          {mode === 'send' ? t('tasks.create.sendSubmit') : t('tasks.create.submit')}
        </button>
      </div>
    </dialog>
  );
}
