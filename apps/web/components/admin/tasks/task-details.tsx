'use client';

/**
 * Szczegóły zadania serwisowego (makieta zadanie-zakoncz, ADR 0055): opis, części z magazynu (stan maleje przy
 * dodaniu, usunięcie zwraca część), hulajnoga, oś czasu z dziennika audytu oraz rozpoczęcie, anulowanie z powodem
 * i zakończenie z notatką i skutkiem dla hulajnogi (pytanie 5). Zmiany przychodzą z pokoju `service`.
 */
import {
  formatPln,
  type AuditLogDetails,
  type ListResponse,
  type ReturnToFleetCheck,
  type ServiceTaskDetails,
  type SparePartListItem,
} from '@hulajnogi/shared';
import Link from 'next/link';
import { useCallback, useEffect, useRef, useState } from 'react';
import { api, errorMessage } from '../../../lib/api';
import { formatClock, formatRelative, t } from '../../../lib/i18n';
import { useStaffFeed } from '../../../lib/realtime';
import { useSession } from '../../../lib/session';
import { Banner } from '../access/common';
import { scooterNumber } from '../fleet/fleet-format';
import { AlertIcon, CheckIcon, CloseIcon, DocumentIcon, FlagIcon, PlusIcon, WarningIcon } from '../icons';
import { PrintButton } from '../prints/print-dialog';
import {
  categoryLabel,
  PriorityPill,
  TASKS_BASE,
  TaskStatusPill,
  TICKETS_BASE,
  taskNumber,
  taskTypeLabel,
  ticketNumber,
} from '../service/service-format';
import { ServiceTimeline, taskTimeline } from '../service/service-timeline';
import { dueLabel } from './tasks';

export function TaskDetailsPage({ id }: { id: string }) {
  const { can } = useSession();
  const [task, setTask] = useState<ServiceTaskDetails | null>(null);
  const [history, setHistory] = useState<AuditLogDetails[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [revision, setRevision] = useState(0);
  const [dialog, setDialog] = useState<'complete' | 'cancel' | null>(null);
  const [busy, setBusy] = useState(false);

  const refresh = useCallback(() => setRevision((n) => n + 1), []);
  useStaffFeed({
    service: (changed) => {
      if (changed.id === id) refresh();
    },
    reconnected: refresh,
  });

  useEffect(() => {
    const controller = new AbortController();
    Promise.all([
      api<ServiceTaskDetails>(`/admin/service-tasks/${id}`, { signal: controller.signal }),
      api<AuditLogDetails[]>(`/admin/service-tasks/${id}/history`, { signal: controller.signal }).catch(() => []),
    ])
      .then(([details, entries]) => {
        setTask(details);
        setHistory(entries);
        setError(null);
      })
      .catch((e: unknown) => {
        if ((e as Error).name !== 'AbortError') setError(errorMessage(e));
      });
    return () => controller.abort();
  }, [id, revision]);

  if (!task) return error ? <Banner kind="danger">{error}</Banner> : <div className="card" aria-busy="true" />;

  const number = taskNumber(task.number);
  const manage = can('service.manage');
  const open = task.status === 'OPEN' || task.status === 'IN_PROGRESS';
  const apply = (next: ServiceTaskDetails) => {
    setTask(next);
    refresh();
  };

  const start = async () => {
    setBusy(true);
    setError(null);
    try {
      apply(
        await api<ServiceTaskDetails>(`/admin/service-tasks/${id}/start`, {
          method: 'POST',
          json: { version: task.version },
        }),
      );
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy(false);
    }
  };

  const sub = [
    taskTypeLabel(task.type),
    t('tasks.sub.scooter', { number: scooterNumber(task.scooter.number) }),
    task.ticket && t('tasks.sub.ticket', { number: ticketNumber(task.ticket.number) }),
    task.assigneeName ?? t('service.unassigned'),
    task.dueAt && t('tasks.sub.due', { due: dueLabel(task.dueAt) }),
  ].filter(Boolean);

  return (
    <>
      <div className="page-head">
        <div>
          <nav className="crumbs" aria-label={t('form.backToList')}>
            <Link href={TASKS_BASE}>{t('admin.nav.tasks')}</Link>
            <span aria-hidden="true">/</span>
            <span>{number}</span>
          </nav>
          <h1 className="title-with-pills">
            {t('tasks.title', { number })}
            <span className="pill-row">
              <TaskStatusPill status={task.status} />
              <PriorityPill priority={task.priority} />
            </span>
          </h1>
          <div className="sub">{sub.join(' · ')}</div>
        </div>
        <div className="actions">
          <PrintButton
            documentType="SERVICE_PROTOCOL"
            entityId={task.id}
            entityLabel={number}
            summary={[
              task.parts.length > 0
                ? t('prints.types.SERVICE_PROTOCOL.partsSummary', {
                    count: task.parts.length,
                    cost: formatPln(task.partsCost),
                  })
                : t('prints.types.SERVICE_PROTOCOL.noParts'),
              task.resultNote && t('prints.types.SERVICE_PROTOCOL.note'),
              t('prints.types.SERVICE_PROTOCOL.outcome', { scooter: scooterNumber(task.scooter.number) }),
            ]
              .filter(Boolean)
              .join(' · ')}
          />
          {manage && open && (
            <>
              <button type="button" className="btn danger" onClick={() => setDialog('cancel')}>
                {t('tasks.cancel.open')}
              </button>
              {task.status === 'OPEN' ? (
                <button type="button" className="btn primary" disabled={busy} onClick={() => void start()}>
                  {t('tasks.start')}
                </button>
              ) : (
                <button type="button" className="btn primary" onClick={() => setDialog('complete')}>
                  <CheckIcon size={15} />
                  {t('tasks.complete.open')}
                </button>
              )}
            </>
          )}
        </div>
      </div>

      {notice && <Banner kind="ok">{notice}</Banner>}
      {error && <Banner kind="danger">{error}</Banner>}

      <div className="rental-layout task-layout">
        <div className="col">
          <section className="card section-card">
            <div className="section-head">
              <h2>{t('tasks.card.description')}</h2>
              {task.ticket && (
                <span className="small">
                  {t('tasks.fromTicket')}{' '}
                  {can('tickets.read') ? (
                    <Link className="link" href={`${TICKETS_BASE}/${task.ticket.id}`}>
                      {ticketNumber(task.ticket.number)}
                    </Link>
                  ) : (
                    ticketNumber(task.ticket.number)
                  )}
                  {task.ticket.categories.length > 0 && `, ${task.ticket.categories.map(categoryLabel).join(', ')}`}
                </span>
              )}
            </div>
            {task.description ? (
              <div className="quote">{task.description}</div>
            ) : (
              <p className="muted small">{t('tasks.noDescription')}</p>
            )}
            {task.target && (
              <p className="small">
                {'zoneCode' in task.target
                  ? t('tasks.target.zone', { code: task.target.zoneCode, name: task.target.zoneName })
                  : t('tasks.target.point', {
                      lat: task.target.point.lat.toFixed(5),
                      lon: task.target.point.lon.toFixed(5),
                    })}
              </p>
            )}
            {task.resultNote && (
              <div className="field">
                <span className="label">{t('tasks.resultNote')}</span>
                <div className="quote">{task.resultNote}</div>
              </div>
            )}
            {task.cancelReason && (
              <div className="field">
                <span className="label">{t('tasks.cancelReason')}</span>
                <div className="quote">{task.cancelReason}</div>
              </div>
            )}
          </section>

          <PartsCard
            task={task}
            editable={manage && task.status === 'IN_PROGRESS'}
            onChanged={(next, message) => {
              apply(next);
              setNotice(message);
            }}
          />

          <section className="card section-card">
            <div className="section-head">
              <h2>{t('tasks.card.scooter', { number: scooterNumber(task.scooter.number) })}</h2>
              {can('scooters.read') && (
                <Link className="link" href={`/admin/flota/${task.scooter.id}?tab=serwis`}>
                  {t('tasks.scooterCard')}
                </Link>
              )}
            </div>
            <div className="stat-row">
              <div className="stat">
                <span className="v">{t.dynamic(`fleetStatus.${task.scooter.status}`)}</span>
                <span className="l">
                  {task.scooter.statusReason
                    ? t.dynamic(`service.statusReason.${task.scooter.statusReason}`)
                    : t('tasks.scooterState')}
                </span>
              </div>
              <div className="stat">
                <span className="v">
                  {task.returnCheck.batteryPct === null
                    ? t('common.none')
                    : t('common.percent', { value: task.returnCheck.batteryPct })}
                </span>
                <span className="l">{t('tasks.battery')}</span>
              </div>
              <div className="stat">
                <span className="v">{task.returnCheck.online ? t('tasks.online') : t('tasks.offline')}</span>
                <span className="l">
                  {t('tasks.signal', { relative: formatRelative(task.returnCheck.lastSeenAt) })}
                </span>
              </div>
            </div>
          </section>
        </div>

        <div className="col">
          <section className="card timeline-card">
            <div className="card-head">
              <h2>{t('tickets.timeline.title')}</h2>
              <span className="small">{t('tasks.timelineHint')}</span>
            </div>
            <ServiceTimeline items={taskTimeline(history)} />
          </section>
        </div>
      </div>

      {dialog === 'complete' && (
        <CompleteDialog
          task={task}
          onClose={() => setDialog(null)}
          onDone={(next, message) => {
            setDialog(null);
            apply(next);
            setNotice(message);
          }}
        />
      )}
      {dialog === 'cancel' && (
        <CancelDialog
          task={task}
          onClose={() => setDialog(null)}
          onDone={(next) => {
            setDialog(null);
            apply(next);
            setNotice(t('tasks.cancel.done', { number }));
          }}
        />
      )}
    </>
  );
}

/** „Części z magazynu”: pozycje z kosztem z chwili użycia; dodanie i usunięcie tylko w zadaniu w toku. */
function PartsCard({
  task,
  editable,
  onChanged,
}: {
  task: ServiceTaskDetails;
  editable: boolean;
  onChanged: (task: ServiceTaskDetails, message: string) => void;
}) {
  const [adding, setAdding] = useState(false);
  const [parts, setParts] = useState<SparePartListItem[]>([]);
  const [partId, setPartId] = useState('');
  const [quantity, setQuantity] = useState('1');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!adding) return;
    api<ListResponse<SparePartListItem>>('/admin/spare-parts?active=true&pageSize=100&sort=name')
      .then((r) => setParts(r.items))
      .catch((e: unknown) => setError(errorMessage(e)));
  }, [adding]);

  const run = async (path: string, json: unknown, message: string) => {
    setBusy(true);
    setError(null);
    try {
      onChanged(
        await api<ServiceTaskDetails>(`/admin/service-tasks/${task.id}/${path}`, { method: 'POST', json }),
        message,
      );
      return true;
    } catch (e) {
      setError(errorMessage(e));
      return false;
    } finally {
      setBusy(false);
    }
  };

  const add = async () => {
    const qty = Number(quantity);
    const part = parts.find((p) => p.id === partId);
    if (!part || !Number.isInteger(qty) || qty < 1) return;
    if (await run('parts', { partId, quantity: qty }, t('tasks.parts.added', { name: part.name, quantity: qty }))) {
      setAdding(false);
      setPartId('');
      setQuantity('1');
    }
  };

  const selected = parts.find((p) => p.id === partId);
  const total = task.parts.reduce((s, p) => s + p.cost, 0);
  return (
    <section className="card section-card">
      <div className="section-head">
        <h2>{t('tasks.parts.title')}</h2>
        <span className="small">{t('tasks.parts.hint')}</span>
      </div>
      <div className="parts-table" role="table">
        <div className="prow head" role="row">
          <span role="columnheader">{t('tasks.parts.part')}</span>
          <span role="columnheader">{t('tasks.parts.sku')}</span>
          <span role="columnheader">{t('tasks.parts.quantity')}</span>
          <span role="columnheader">{t('tasks.parts.unitCost')}</span>
          <span role="columnheader" className="right-cell">
            {t('tasks.parts.cost')}
          </span>
          <span role="columnheader" />
        </div>
        {task.parts.length === 0 && <p className="muted small empty-line">{t('tasks.parts.none')}</p>}
        {task.parts.map((p) => (
          <div key={p.partId} className="prow" role="row">
            <span role="cell" className="strong-500">
              {p.name}
            </span>
            <span role="cell" className="code">
              {p.sku}
            </span>
            <span role="cell" className="num">
              {p.quantity}
            </span>
            <span role="cell" className="num">
              {formatPln(p.unitCost)}
            </span>
            <span role="cell" className="num right-cell">
              {formatPln(p.cost)}
            </span>
            <span role="cell">
              {editable && (
                <button
                  type="button"
                  className="icon-btn plain"
                  disabled={busy}
                  aria-label={t('tasks.parts.remove', { name: p.name })}
                  title={t('tasks.parts.remove', { name: p.name })}
                  onClick={() =>
                    void run('parts/remove', { partId: p.partId }, t('tasks.parts.removed', { name: p.name }))
                  }
                >
                  <CloseIcon size={16} />
                </button>
              )}
            </span>
          </div>
        ))}
      </div>
      {adding && (
        <div className="part-add">
          <select
            className="input"
            value={partId}
            aria-label={t('tasks.parts.part')}
            onChange={(e) => setPartId(e.target.value)}
          >
            <option value="">{t('tasks.parts.pick')}</option>
            {parts.map((p) => (
              <option key={p.id} value={p.id} disabled={p.stockQty <= 0}>
                {t('tasks.parts.option', { name: p.name, sku: p.sku, stock: p.stockQty })}
              </option>
            ))}
          </select>
          <input
            className="input qty"
            inputMode="numeric"
            value={quantity}
            aria-label={t('tasks.parts.quantity')}
            onChange={(e) => setQuantity(e.target.value.replace(/\D/g, ''))}
          />
          <button type="button" className="btn primary" disabled={busy || !selected} onClick={() => void add()}>
            {t('tasks.parts.addSubmit')}
          </button>
          <button type="button" className="btn" onClick={() => setAdding(false)}>
            {t('common.cancel')}
          </button>
        </div>
      )}
      {error && <Banner kind="danger">{error}</Banner>}
      <div className="parts-foot">
        {editable && !adding ? (
          <button type="button" className="btn" onClick={() => setAdding(true)}>
            <PlusIcon size={16} />
            {t('tasks.parts.add')}
          </button>
        ) : (
          <span />
        )}
        <span className="parts-total">
          {t('tasks.parts.total')} <span className="num">{formatPln(total)}</span>
        </span>
      </div>
    </section>
  );
}

/** Wiersz „Skutku dla hulajnogi”: spełniony warunek z ptaszkiem, niespełniony z ostrzeżeniem. */
function CheckLine({ ok, children }: { ok: boolean; children: React.ReactNode }) {
  return (
    <div className={ok ? 'chk' : 'chk warn'}>
      <span className="ok-ic" aria-hidden="true">
        {ok ? <CheckIcon size={13} /> : <WarningIcon size={13} />}
      </span>
      <span>{children}</span>
    </div>
  );
}

/**
 * Warunki powrotu do floty (pytanie 5) z `returnCheck`; ten sam układ na karcie hulajnogi. Otwarte pilne zgłoszenie
 * pokazuje się tylko wtedy, gdy zatrzymuje hulajnogę.
 */
export function ReturnCheckLines({ check }: { check: ReturnToFleetCheck }) {
  return (
    <>
      {check.blockers.includes('URGENT_TICKET') && (
        <CheckLine ok={false}>{t('tasks.check.urgent', { count: check.openUrgentTickets })}</CheckLine>
      )}
      <CheckLine ok={!check.blockers.includes('OPEN_TASKS')}>
        {check.openTasks === 0 ? t('tasks.check.noTasks') : t('tasks.check.tasks', { count: check.openTasks })}
      </CheckLine>
      <CheckLine ok={!check.blockers.includes('OFFLINE')}>
        {check.online
          ? t('tasks.check.online', { relative: formatRelative(check.lastSeenAt) })
          : t('tasks.check.offline', { relative: formatRelative(check.lastSeenAt) })}
      </CheckLine>
      <CheckLine ok={!check.blockers.includes('BATTERY_BELOW_THRESHOLD')}>
        {t('tasks.check.battery', {
          battery: check.batteryPct === null ? t('common.none') : t('common.percent', { value: check.batteryPct }),
          min: check.minBatteryPct,
        })}
      </CheckLine>
    </>
  );
}

/**
 * Zakończenie zadania (makieta zadanie-zakoncz): wymagana notatka, skutek dla hulajnogi liczony z trzech warunków
 * i propozycja zadania Wymiana baterii, gdy bateria jest poniżej progu.
 */
function CompleteDialog({
  task,
  onClose,
  onDone,
}: {
  task: ServiceTaskDetails;
  onClose: () => void;
  onDone: (task: ServiceTaskDetails, message: string) => void;
}) {
  const { staff } = useSession();
  const ref = useRef<HTMLDialogElement>(null);
  const [note, setNote] = useState('');
  const check = task.returnCheck;
  const lowBattery = check.blockers.includes('BATTERY_BELOW_THRESHOLD');
  const offerSwap = lowBattery && task.type !== 'BATTERY_SWAP' && check.openTasks === 0;
  const [swap, setSwap] = useState(offerSwap);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const scooter = scooterNumber(task.scooter.number);
  const number = taskNumber(task.number);
  const partsCost = task.parts.reduce((s, p) => s + p.cost, 0);
  // Po wymianie baterii API nie zakłada 100%: hulajnoga czeka w serwisie na odczyt nowej baterii z telemetrii
  // i wraca sama (ADR 0059), więc sama bateria poniżej progu nie jest tu przeszkodą „do usunięcia”.
  const awaitsBattery = task.type === 'BATTERY_SWAP' && check.blockers.includes('BATTERY_BELOW_THRESHOLD');
  const blockers = check.blockers.filter((b) => !(awaitsBattery && b === 'BATTERY_BELOW_THRESHOLD'));

  useEffect(() => {
    ref.current?.showModal();
  }, []);

  const submit = async () => {
    setBusy(true);
    setError(null);
    try {
      const done = await api<ServiceTaskDetails>(`/admin/service-tasks/${task.id}/complete`, {
        method: 'POST',
        json: { version: task.version, note: note.trim() },
      });
      let message = t('tasks.complete.done', { number });
      if (swap && offerSwap) {
        try {
          const created = await api<ServiceTaskDetails>('/admin/service-tasks', {
            method: 'POST',
            json: { scooterId: task.scooter.id, type: 'BATTERY_SWAP', assigneeId: staff.id, priority: 'NORMAL' },
          });
          message = t('tasks.complete.doneWithSwap', { number, swap: taskNumber(created.number) });
        } catch (e) {
          message = t('tasks.complete.swapFailed', { number, error: errorMessage(e) });
        }
      }
      onDone(done, message);
    } catch (e) {
      setError(errorMessage(e));
      setBusy(false);
    }
  };

  return (
    <dialog ref={ref} className="end-dialog task-dialog" onClose={onClose} aria-labelledby="task-complete-title">
      <div className="end-head">
        <span className="end-icon accent" aria-hidden="true">
          <CheckIcon size={20} />
        </span>
        <div>
          <h2 id="task-complete-title">{t('tasks.complete.title', { number })}</h2>
          <p>
            {t('tasks.complete.body', {
              type: taskTypeLabel(task.type),
              scooter,
              ticket: task.ticket ? ticketNumber(task.ticket.number) : '',
              hasTicket: task.ticket ? 'yes' : 'no',
              since: task.startedAt ? formatClock(task.startedAt) : t('common.none'),
            })}
          </p>
        </div>
      </div>

      <label className="field">
        <span className="label">{t('tasks.complete.note')}</span>
        <textarea
          className="input"
          value={note}
          maxLength={2000}
          required
          autoFocus
          onChange={(e) => setNote(e.target.value)}
        />
        <span className="hint">
          {t('tasks.complete.noteHint', { count: task.parts.length, cost: formatPln(partsCost) })}
        </span>
      </label>

      <div className="end-conseq effect-box">
        <span className="label-row">
          <span className="label">{t('tasks.complete.effect', { scooter })}</span>
          <span className="small">{t('tasks.complete.checkedOnSave')}</span>
        </span>
        <ReturnCheckLines check={check} />
        {blockers.length > 0 ? (
          <div className="notice warn">
            <span className="ic">
              <WarningIcon size={14} />
            </span>
            <span>
              <b>{t('tasks.complete.staysTitle')}</b>{' '}
              {t('tasks.complete.staysBody', { reason: t.dynamic(`service.blocker.${blockers[0]}`) })}
            </span>
          </div>
        ) : (
          <div className="notice info">
            <span className="ic">
              <CheckIcon size={14} />
            </span>
            <span>
              {awaitsBattery
                ? t('tasks.complete.returnsAfterSwap', { scooter })
                : t('tasks.complete.returns', { scooter })}
            </span>
          </div>
        )}
        {offerSwap && (
          <label className="check-row small-check">
            <input type="checkbox" className="cb" checked={swap} onChange={(e) => setSwap(e.target.checked)} />
            <span>{t('tasks.complete.swap', { scooter })}</span>
          </label>
        )}
      </div>

      <div className="conseq-list">
        {task.ticket && (
          <div className="conseq">
            <span className="ci">
              <FlagIcon size={15} />
            </span>
            <span>{t('tasks.complete.conseqTicket', { ticket: ticketNumber(task.ticket.number) })}</span>
          </div>
        )}
        <div className="conseq">
          <span className="ci">
            <DocumentIcon size={15} />
          </span>
          <span>{t('tasks.complete.conseqAudit')}</span>
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
        <button type="button" className="btn primary" disabled={busy || !note.trim()} onClick={() => void submit()}>
          <CheckIcon size={15} />
          {t('tasks.complete.submit')}
        </button>
      </div>
    </dialog>
  );
}

/** Anulowanie z wymaganym powodem; części wracają do magazynu. */
function CancelDialog({
  task,
  onClose,
  onDone,
}: {
  task: ServiceTaskDetails;
  onClose: () => void;
  onDone: (task: ServiceTaskDetails) => void;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    ref.current?.showModal();
  }, []);

  const submit = async () => {
    setBusy(true);
    setError(null);
    try {
      onDone(
        await api<ServiceTaskDetails>(`/admin/service-tasks/${task.id}/cancel`, {
          method: 'POST',
          json: { version: task.version, reason: reason.trim() },
        }),
      );
    } catch (e) {
      setError(errorMessage(e));
      setBusy(false);
    }
  };

  return (
    <dialog ref={ref} className="end-dialog" onClose={onClose} aria-labelledby="task-cancel-title">
      <div className="end-head">
        <span className="end-icon" aria-hidden="true">
          <CloseIcon size={20} />
        </span>
        <div>
          <h2 id="task-cancel-title">{t('tasks.cancel.title', { number: taskNumber(task.number) })}</h2>
          <p>{t('tasks.cancel.body')}</p>
        </div>
      </div>
      <label className="field">
        <span className="label">{t('tasks.cancel.reason')}</span>
        <textarea
          className="input"
          value={reason}
          maxLength={500}
          required
          autoFocus
          onChange={(e) => setReason(e.target.value)}
        />
      </label>
      <div className="end-conseq">
        {task.parts.length > 0 && (
          <div>
            <span className="ci">
              <PlusIcon size={15} />
            </span>
            <span>{t('tasks.cancel.parts', { count: task.parts.length })}</span>
          </div>
        )}
        {task.ticket && (
          <div>
            <span className="ci">
              <FlagIcon size={15} />
            </span>
            <span>{t('tasks.cancel.ticket', { ticket: ticketNumber(task.ticket.number) })}</span>
          </div>
        )}
        <div>
          <span className="ci">
            <DocumentIcon size={15} />
          </span>
          <span>{t('tasks.cancel.audit')}</span>
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
          className="btn solid-danger"
          disabled={busy || !reason.trim()}
          onClick={() => void submit()}
        >
          {t('tasks.cancel.submit')}
        </button>
      </div>
    </dialog>
  );
}
