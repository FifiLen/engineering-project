'use client';

/**
 * Karta hulajnogi z zakładką „Serwis” (makieta hulajnoga-serwis, ADR 0055): nagłówek ze stanem i przyczyną stanu,
 * „Wyłącz z ruchu” (`scooters.write`), „Przywróć do floty” z regułą powrotu (pytanie 5) i „Wyślij do serwisu”
 * (to samo okno co „Utwórz zadanie”). Zakładka „Przegląd” to dotychczasowy formularz hulajnogi.
 */
import {
  formatPln,
  RETIRE_REASONS,
  scootersResource,
  type ListResponse,
  type RetireReason,
  type ScooterDetails,
  type ScooterServiceSummary,
  type TicketListItem,
} from '@hulajnogi/shared';
import Link from 'next/link';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { useCallback, useEffect, useRef, useState } from 'react';
import { api, errorMessage } from '../../../lib/api';
import { formatDate, formatKm, t } from '../../../lib/i18n';
import { useStaffFeed } from '../../../lib/realtime';
import { useSession } from '../../../lib/session';
import { Banner } from '../access/common';
import { scooterNumber, StatusPill } from '../fleet/fleet-format';
import { ScooterForm } from '../fleet/scooters';
import { AlertIcon, BanIcon, DocumentIcon, RestoreIcon, ServiceIcon } from '../icons';
import { LabelButton } from '../prints/label-dialog';
import { PrintButton } from '../prints/print-dialog';
import { valueLabel } from '../labels';
import { ReturnCheckLines } from '../tasks/task-details';
import {
  categoryLabel,
  reporterLabel,
  TASKS_BASE,
  TICKETS_BASE,
  TicketStatusPill,
  taskNumber,
  taskTypeLabel,
  ticketNumber,
} from './service-format';
import { TaskCreateDialog } from './task-create-dialog';

const FLEET = '/admin/flota';

export function ScooterCard({ id }: { id: string }) {
  const { can } = useSession();
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const serviceTab = can('service.read') && searchParams.get('tab') === 'serwis';
  const [scooter, setScooter] = useState<ScooterDetails | null>(null);
  const [summary, setSummary] = useState<ScooterServiceSummary | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [revision, setRevision] = useState(0);
  const [dialog, setDialog] = useState<'send' | 'retire' | 'return' | null>(null);
  const refresh = useCallback(() => setRevision((n) => n + 1), []);

  useStaffFeed({
    service: (task) => {
      if (task.scooterId === id) refresh();
    },
    tickets: can('tickets.read')
      ? (ticket) => {
          if (ticket.scooterId === id) refresh();
        }
      : undefined,
    reconnected: refresh,
  });

  useEffect(() => {
    api<ScooterDetails>(`/admin/scooters/${id}`)
      .then(setScooter)
      .catch((e: unknown) => setError(errorMessage(e)));
    if (can('service.read'))
      api<ScooterServiceSummary>(`/admin/scooters/${id}/service`)
        .then(setSummary)
        .catch(() => setSummary(null));
  }, [id, can, revision]);

  const setTab = (tab: 'serwis' | null) => router.replace(tab ? `${pathname}?tab=${tab}` : pathname, { scroll: false });

  if (!scooter) return error ? <Banner kind="danger">{error}</Banner> : <div className="card" aria-busy="true" />;

  const number = scooterNumber(scooter.number);
  const status = scooter.status;
  const zone = scooter.parkingZoneCode
    ? t('resource.scooters.zoneLabel', { code: scooter.parkingZoneCode, name: scooter.parkingZoneName ?? '' })
    : null;
  const sub = [
    valueLabel(scootersResource, 'variant', scooter.variant),
    zone,
    scooter.online ? t('scooterService.online') : t('scooterService.offline'),
    scooter.batteryPct !== null && t('scooterService.battery', { value: scooter.batteryPct }),
  ].filter(Boolean);
  const canSend =
    can('service.manage') && status !== 'RETIRED' && (summary ? summary.availableTaskTypes.length > 0 : true);
  const canReturn = can('service.manage') && (status === 'MAINTENANCE' || status === 'RETIRED');
  const canRetire = can('scooters.write') && status !== 'RETIRED' && status !== 'IN_USE' && status !== 'RESERVED';
  const version = summary?.version ?? scooter.version;

  return (
    <>
      <nav className="crumbs" aria-label={t('form.backToList')}>
        <Link href={FLEET}>{t('resource.scooters.title')}</Link>
        <span aria-hidden="true">/</span>
        <span>{number}</span>
      </nav>

      <section className="card scooter-head">
        <img src="/rendery/hulajnoga-grafit-bok.png" alt="" width={104} height={104} />
        <div className="stack grow">
          <span className="scooter-title">
            <span className="scooter-number num">{number}</span>
            <StatusPill status={scooter.fleetStatus} />
            {scooter.statusReason && (
              <span className="pill warn">{t.dynamic(`service.statusReason.${scooter.statusReason}`)}</span>
            )}
            {scooter.openTickets > 0 && (
              <span className="pill warn">{t('scooterService.openTickets', { count: scooter.openTickets })}</span>
            )}
          </span>
          <span className="sub">{sub.join(' · ')}</span>
        </div>
        <div className="actions">
          <LabelButton scooterId={scooter.id} number={scooter.number} />
          <PrintButton documentType="SCOOTER_CARD" entityId={scooter.id} entityLabel={number} />
          {canRetire && (
            <button type="button" className="btn danger" onClick={() => setDialog('retire')}>
              <BanIcon size={16} />
              {t('scooterService.retire.open')}
            </button>
          )}
          {canReturn && (
            <button type="button" className="btn" onClick={() => setDialog('return')}>
              <RestoreIcon />
              {t('scooterService.return.open')}
            </button>
          )}
          {canSend && (
            <button type="button" className="btn primary" onClick={() => setDialog('send')}>
              <ServiceIcon size={16} />
              {t('scooterService.send')}
            </button>
          )}
        </div>
      </section>

      {can('service.read') && (
        <nav className="tabs" aria-label={t('scooterService.tabs.label')}>
          <button
            type="button"
            className="tab"
            aria-current={serviceTab ? undefined : 'page'}
            onClick={() => setTab(null)}
          >
            {t('scooterService.tabs.overview')}
          </button>
          <button
            type="button"
            className="tab"
            aria-current={serviceTab ? 'page' : undefined}
            onClick={() => setTab('serwis')}
          >
            {t('scooterService.tabs.service')}
          </button>
        </nav>
      )}

      {notice && <Banner kind="ok">{notice}</Banner>}
      {error && <Banner kind="danger">{error}</Banner>}

      {serviceTab ? (
        summary ? (
          <ServiceTab scooter={scooter} summary={summary} />
        ) : (
          <div className="card" aria-busy="true" />
        )
      ) : (
        <div className="scooter-overview">
          <ScooterForm id={id} />
        </div>
      )}

      {dialog === 'send' && (
        <TaskCreateDialog
          mode="send"
          scooter={{ id, number: scooter.number }}
          availableTypes={summary?.availableTaskTypes ?? null}
          onClose={() => setDialog(null)}
          onCreated={(task) => {
            setDialog(null);
            refresh();
            setNotice(t('scooterService.sent', { scooter: number, task: taskNumber(task.number) }));
          }}
        />
      )}
      {dialog === 'retire' && (
        <RetireDialog
          scooterId={id}
          number={number}
          version={version}
          onClose={() => setDialog(null)}
          onDone={() => {
            setDialog(null);
            refresh();
            setNotice(t('scooterService.retire.done', { scooter: number }));
          }}
        />
      )}
      {dialog === 'return' && summary && (
        <ReturnDialog
          scooterId={id}
          number={number}
          summary={summary}
          onClose={() => setDialog(null)}
          onDone={() => {
            setDialog(null);
            refresh();
            setNotice(t('scooterService.return.done', { scooter: number }));
          }}
        />
      )}
    </>
  );
}

/** Zakładka „Serwis”: liczby, zgłoszenia i zadania hulajnogi oraz reguła powrotu do floty. */
function ServiceTab({ scooter, summary }: { scooter: ScooterDetails; summary: ScooterServiceSummary }) {
  const { can } = useSession();
  const [tickets, setTickets] = useState<ListResponse<TicketListItem> | null>(null);
  useEffect(() => {
    if (!can('tickets.read')) return;
    api<ListResponse<TicketListItem>>(`/admin/tickets?scooterId=${scooter.id}&pageSize=5&sort=-createdAt`)
      .then(setTickets)
      .catch(() => setTickets(null));
  }, [scooter.id, can, summary]);

  const lastDone = summary.tasks.find((x) => x.status === 'DONE' && x.completedAt);
  return (
    <>
      <section className="card stat-card">
        <div className="stat">
          <span className="v">{formatKm(scooter.odometerM)}</span>
          <span className="l">{t('scooterService.stats.odometer')}</span>
        </div>
        <div className="stat">
          <span className="v">{tickets?.total ?? summary.openTickets}</span>
          <span className="l">{t('scooterService.stats.tickets', { open: summary.openTickets })}</span>
        </div>
        <div className="stat">
          <span className="v">{summary.tasksDone}</span>
          <span className="l">{t('scooterService.stats.tasksDone')}</span>
        </div>
        <div className="stat">
          <span className="v">{formatPln(summary.partsCost)}</span>
          <span className="l">{t('scooterService.stats.partsCost')}</span>
        </div>
        <div className="stat">
          <span className="v">{lastDone?.completedAt ? formatDate(lastDone.completedAt) : t('common.none')}</span>
          <span className="l">{t('scooterService.stats.lastService')}</span>
        </div>
      </section>

      {(summary.status === 'MAINTENANCE' || summary.status === 'RETIRED') && (
        <section className="card section-card">
          <div className="section-head">
            <h2>{t('scooterService.rule.title')}</h2>
            <span className="small">
              {summary.statusReason
                ? t('scooterService.rule.since', {
                    reason: t.dynamic(`service.statusReason.${summary.statusReason}`),
                    date: formatDate(summary.statusChangedAt),
                  })
                : t('scooterService.rule.sinceNoReason', { date: formatDate(summary.statusChangedAt) })}
            </span>
          </div>
          <div className="effect-box">
            <ReturnCheckLines check={summary.returnCheck} />
          </div>
        </section>
      )}

      <div className="two-cards">
        {can('tickets.read') && (
          <section className="card section-card">
            <div className="section-head">
              <h2>{t('scooterService.tickets')}</h2>
              {tickets && tickets.total > 0 && (
                <Link className="link" href={`${TICKETS_BASE}?scooterId=${scooter.id}`}>
                  {t('scooterService.all', { count: tickets.total })}
                </Link>
              )}
            </div>
            {tickets?.items.length === 0 && <p className="muted small">{t('scooterService.noTickets')}</p>}
            {tickets?.items.map((x) => (
              <Link key={x.id} className="lrow tickets-row" href={`${TICKETS_BASE}/${x.id}`}>
                <span className="strong">{ticketNumber(x.number)}</span>
                <span>
                  {[x.categories.map(categoryLabel).join(', '), reporterLabel(x.source, x.reporterName)].join(' · ')}
                </span>
                <span>
                  <TicketStatusPill status={x.status} />
                </span>
                <span className="small">{formatDate(x.createdAt)}</span>
              </Link>
            ))}
          </section>
        )}
        <section className="card section-card">
          <div className="section-head">
            <h2>{t('scooterService.tasks')}</h2>
            {summary.tasks.length > 0 && (
              <Link className="link" href={`${TASKS_BASE}?scooterId=${scooter.id}`}>
                {t('scooterService.allTasks')}
              </Link>
            )}
          </div>
          {summary.tasks.length === 0 && <p className="muted small">{t('scooterService.noTasks')}</p>}
          {summary.tasks.map((x) => (
            <Link key={x.id} className="lrow tasks-row" href={`${TASKS_BASE}/${x.id}`}>
              <span className="strong">{taskNumber(x.number)}</span>
              <span>{[taskTypeLabel(x.type), x.assigneeName ?? t('service.unassigned')].join(' · ')}</span>
              <span className="num right-cell">{x.partsCost > 0 ? formatPln(x.partsCost) : t('common.none')}</span>
              <span className="small">{formatDate(x.completedAt ?? x.createdAt)}</span>
            </Link>
          ))}
        </section>
      </div>
    </>
  );
}

/** „Wyłącz z ruchu” (`RETIRED`) z powodem; „Inny powód” wymaga notatki. */
function RetireDialog({
  scooterId,
  number,
  version,
  onClose,
  onDone,
}: {
  scooterId: string;
  number: string;
  version: number;
  onClose: () => void;
  onDone: () => void;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  const [reason, setReason] = useState<RetireReason>('DAMAGE');
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
      await api<ScooterServiceSummary>(`/admin/scooters/${scooterId}/retire`, {
        method: 'POST',
        json: { version, reason, note: note.trim() || null },
      });
      onDone();
    } catch (e) {
      setError(errorMessage(e));
      setBusy(false);
    }
  };

  return (
    <dialog ref={ref} className="end-dialog" onClose={onClose} aria-labelledby="retire-title">
      <div className="end-head">
        <span className="end-icon" aria-hidden="true">
          <BanIcon size={20} />
        </span>
        <div>
          <h2 id="retire-title">{t('scooterService.retire.title', { scooter: number })}</h2>
          <p>{t('scooterService.retire.body')}</p>
        </div>
      </div>
      <div role="radiogroup" aria-label={t('scooterService.retire.reason')} className="end-reasons">
        <span className="label">{t('scooterService.retire.reason')}</span>
        {RETIRE_REASONS.map((r) => (
          <label key={r} className="radio-option">
            <input type="radio" name="retire-reason" checked={reason === r} onChange={() => setReason(r)} />
            <span>{t.dynamic(`service.statusReason.${r}`)}</span>
          </label>
        ))}
      </div>
      <label className="field">
        <span className="label">
          {t('rentals.end.note')}{' '}
          <span className="opt">{noteRequired ? t('rentals.end.noteRequired') : t('rentals.end.noteOptional')}</span>
        </span>
        <textarea className="input" value={note} maxLength={500} onChange={(e) => setNote(e.target.value)} />
      </label>
      <div className="end-conseq">
        <div>
          <span className="ci">
            <BanIcon size={15} />
          </span>
          <span>{t('scooterService.retire.conseq', { scooter: number })}</span>
        </div>
        <div>
          <span className="ci">
            <DocumentIcon size={15} />
          </span>
          <span>{t('scooterService.audit')}</span>
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
          disabled={busy || (noteRequired && !note.trim())}
          onClick={() => void submit()}
        >
          <BanIcon size={16} />
          {t('scooterService.retire.submit')}
        </button>
      </div>
    </dialog>
  );
}

/** „Przywróć do floty”: ta sama reguła co po ostatnim zadaniu (bez otwartych zadań, online, bateria ≥ próg). */
function ReturnDialog({
  scooterId,
  number,
  summary,
  onClose,
  onDone,
}: {
  scooterId: string;
  number: string;
  summary: ScooterServiceSummary;
  onClose: () => void;
  onDone: () => void;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const blocked = summary.returnCheck.blockers.length > 0;

  useEffect(() => {
    ref.current?.showModal();
  }, []);

  const submit = async () => {
    setBusy(true);
    setError(null);
    try {
      await api<ScooterServiceSummary>(`/admin/scooters/${scooterId}/return-to-fleet`, {
        method: 'POST',
        json: { version: summary.version, note: note.trim() || null },
      });
      onDone();
    } catch (e) {
      setError(errorMessage(e));
      setBusy(false);
    }
  };

  return (
    <dialog ref={ref} className="end-dialog" onClose={onClose} aria-labelledby="return-title">
      <div className="end-head">
        <span className="end-icon accent" aria-hidden="true">
          <RestoreIcon />
        </span>
        <div>
          <h2 id="return-title">{t('scooterService.return.title', { scooter: number })}</h2>
          <p>{t('scooterService.return.body')}</p>
        </div>
      </div>
      <div className="end-conseq effect-box">
        <span className="label">{t('scooterService.return.rule')}</span>
        <ReturnCheckLines check={summary.returnCheck} />
      </div>
      <label className="field">
        <span className="label">
          {t('rentals.end.note')} <span className="opt">{t('rentals.end.noteOptional')}</span>
        </span>
        <textarea className="input" value={note} maxLength={500} onChange={(e) => setNote(e.target.value)} />
      </label>
      {blocked && (
        <div className="notice warn">
          <span className="ic">
            <AlertIcon size={14} />
          </span>
          <span>{t('scooterService.return.blocked')}</span>
        </div>
      )}
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
        <button type="button" className="btn primary" disabled={busy || blocked} onClick={() => void submit()}>
          <RestoreIcon />
          {t('scooterService.return.submit')}
        </button>
      </div>
    </dialog>
  );
}
