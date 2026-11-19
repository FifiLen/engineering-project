'use client';

/**
 * Szczegóły zgłoszenia (makieta zgloszenie-szczegoly, ADR 0055, D6, D7): opis i zdjęcia, rozliczenie przejazdu
 * ze „Zwrotem za przejazd” (zwrot robi istniejące okno zwrotu z `ticketId`), zmiana statusu z „Odpowiedzią dla
 * klienta”, oś czasu z dziennika audytu i zdarzeń systemu, klient i hulajnoga. Zmiany przychodzą z pokoju `tickets`.
 */
import {
  formatPln,
  MANUAL_TICKET_STATUSES,
  scootersResource,
  TICKET_REPLY_MAX,
  TICKET_STATUSES,
  type RentalAdminDetails,
  type TicketAdminDetails,
  type TicketStatus,
} from '@hulajnogi/shared';
import Link from 'next/link';
import { useEffect, useState, type ReactNode } from 'react';
import { api, errorMessage } from '../../../lib/api';
import { formatDateTime, formatDuration, t } from '../../../lib/i18n';
import { useStaffFeed } from '../../../lib/realtime';
import { useSession } from '../../../lib/session';
import { Banner, initials } from '../access/common';
import { rentalNumber, scooterNumber } from '../fleet/fleet-format';
import { CheckIcon, ChevronRightIcon, InfoIcon, ScooterIcon, ServiceIcon, UndoIcon } from '../icons';
import { PrintButton } from '../prints/print-dialog';
import { valueLabel } from '../labels';
import { cardLabel, PAYMENTS_BASE } from '../payments/payment-format';
import { RefundDialog } from '../rentals/refund-dialog';
import {
  Categories,
  reporterLabel,
  TICKETS_BASE,
  TicketStatusPill,
  taskNumber,
  ticketNumber,
} from '../service/service-format';
import { ServiceTimeline, ticketTimeline } from '../service/service-timeline';
import { TaskCreateDialog } from '../service/task-create-dialog';
import { AssignControl, TicketPhotos, useTicketDetails } from './ticket-parts';

export function TicketDetailsPage({ id }: { id: string }) {
  const { can } = useSession();
  const [revision, setRevision] = useState(0);
  const { ticket, error, apply, refresh } = useTicketDetails(id, revision);
  const [rental, setRental] = useState<RentalAdminDetails | null>(null);
  const [refunding, setRefunding] = useState(false);
  const [creating, setCreating] = useState(false);
  const [assigning, setAssigning] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [draft, setDraft] = useState<{ status: TicketStatus; reply: string; note: string } | null>(null);
  const rentalId = ticket?.rental?.id ?? null;

  useStaffFeed({
    tickets: (changed) => {
      if (changed.id === id) setRevision((n) => n + 1);
    },
    reconnected: refresh,
  });

  // Rozliczenie przejazdu w karcie „Rozliczenie przejazdu” (tylko z `rentals.read`).
  useEffect(() => {
    if (!rentalId || !can('rentals.read')) return;
    api<RentalAdminDetails>(`/admin/rentals/${rentalId}`)
      .then(setRental)
      .catch(() => setRental(null));
  }, [rentalId, can, revision]);

  if (!ticket) return error ? <Banner kind="danger">{error}</Banner> : <div className="card" aria-busy="true" />;

  const number = ticketNumber(ticket.number);
  const reporter = reporterLabel(ticket.source, ticket.reporter?.name ?? null);
  const sub = [
    reporter,
    ticket.rental && t('tickets.sub.rental', { number: rentalNumber(ticket.rental.number) }),
    t('tickets.sub.scooter', { number: scooterNumber(ticket.scooter.number) }),
    t('tickets.sub.created', { date: formatDateTime(ticket.createdAt) }),
  ].filter(Boolean);

  const status = draft?.status ?? ticket.status;
  const reply = draft?.reply ?? '';
  const pending = draft
    ? [
        status !== ticket.status ? t.dynamic(`service.ticketStatus.${status}`) : null,
        reply.trim() ? t('tickets.status.withReply') : null,
      ]
        .filter(Boolean)
        .join(' ') || null
    : null;

  return (
    <>
      <div className="page-head">
        <div>
          <nav className="crumbs" aria-label={t('form.backToList')}>
            <Link href={TICKETS_BASE}>{t('resource.tickets.title')}</Link>
            <span aria-hidden="true">/</span>
            <span>{number}</span>
          </nav>
          <h1 className="title-with-pills">
            {t('tickets.title', { number })}
            <span className="pill-row">
              <TicketStatusPill status={ticket.status} />
              <Categories categories={ticket.categories} urgent={ticket.urgent} />
            </span>
          </h1>
          <div className="sub">{sub.join(' · ')}</div>
        </div>
        <div className="actions">
          <PrintButton documentType="INCIDENT_REPORT" entityId={ticket.id} entityLabel={number} />
          {can('service.manage') && ticket.status !== 'RESOLVED' && ticket.availableTaskTypes.length > 0 && (
            <button type="button" className="btn" onClick={() => setCreating(true)}>
              <ServiceIcon size={16} />
              {t('tickets.createTask')}
            </button>
          )}
          {ticket.rental && can('rentals.read') && (
            <Link className="btn" href={`/admin/przejazdy/${ticket.rental.id}`}>
              <ChevronRightIcon size={16} />
              {t('tickets.rentalButton', { number: rentalNumber(ticket.rental.number) })}
            </Link>
          )}
        </div>
      </div>

      {notice && <Banner kind="ok">{notice}</Banner>}
      {error && <Banner kind="danger">{error}</Banner>}

      <div className="rental-layout ticket-layout">
        <div className="col">
          <section className="card section-card">
            <div className="section-head">
              <h2>{t('tickets.card.ticket')}</h2>
              <span className="small assigned-line">
                {ticket.photos.length === 0
                  ? t('tickets.noPhotos')
                  : t('service.photoCount', { count: ticket.photos.length })}
                {' · '}
                {ticket.assignee ? (
                  <>
                    {t('tickets.assigned')}{' '}
                    <span className="av xs dark" aria-hidden="true">
                      {initials(ticket.assignee.name)}
                    </span>
                    <span className="strong-500">{ticket.assignee.name}</span>
                  </>
                ) : (
                  t('service.unassigned')
                )}
                {can('tickets.manage') && ticket.status !== 'RESOLVED' && (
                  <button type="button" className="link" onClick={() => setAssigning((v) => !v)}>
                    {t('tickets.change')}
                  </button>
                )}
              </span>
            </div>
            {assigning && (
              <AssignControl
                ticket={ticket}
                onAssigned={(next) => {
                  apply(next);
                  setAssigning(false);
                }}
              />
            )}
            {ticket.description ? (
              <div className="quote">{ticket.description}</div>
            ) : (
              <p className="muted small">{t('tickets.noDescription')}</p>
            )}
            <TicketPhotos photos={ticket.photos} number={number} />
          </section>

          {ticket.rental && rental && (
            <section className="card section-card">
              <div className="section-head">
                <h2>{t('tickets.card.settlement')}</h2>
                {can('rentals.manage') && rental.refundable > 0 && (
                  <button type="button" className="btn" onClick={() => setRefunding(true)}>
                    <UndoIcon />
                    {t('tickets.refund')}
                  </button>
                )}
              </div>
              <div className="stat-grid">
                <Stat
                  value={formatPln(rental.settlement.paidAmount || rental.price.total)}
                  label={
                    rental.settlement.source === 'CARD' && rental.settlement.card
                      ? t('tickets.settlement.byCard', { card: cardLabel(rental.settlement.card) })
                      : t('tickets.settlement.byWallet')
                  }
                />
                <Stat
                  value={formatPln(rental.settlement.refundedAmount)}
                  label={
                    rental.refunds[0]
                      ? t('tickets.settlement.refundedAt', { date: formatDateTime(rental.refunds[0].createdAt) })
                      : t('tickets.settlement.refunded')
                  }
                />
                <Stat value={formatDuration(rental.rideSeconds)} label={t('tickets.settlement.rideTime')} />
                <Stat
                  value={
                    rental.settlement.receiptId && rental.settlement.receiptNumber ? (
                      can('payments.read') ? (
                        <Link className="link" href={`${PAYMENTS_BASE}/paragony/${rental.settlement.receiptId}`}>
                          {rental.settlement.receiptNumber}
                        </Link>
                      ) : (
                        rental.settlement.receiptNumber
                      )
                    ) : (
                      t('common.none')
                    )
                  }
                  label={
                    rental.settlement.refundedAmount > 0
                      ? t('tickets.settlement.receiptCorrected')
                      : t('tickets.settlement.receipt')
                  }
                  small
                />
              </div>
              <div className="notice info">
                <span className="ic">
                  <InfoIcon size={15} />
                </span>
                <span>{t('tickets.settlement.notice')}</span>
              </div>
            </section>
          )}

          {can('tickets.manage') ? (
            <StatusCard
              key={ticket.version}
              ticket={ticket}
              onDraft={setDraft}
              onSaved={(next) => {
                apply(next);
                setDraft(null);
                setNotice(t('tickets.status.saved', { number }));
              }}
            />
          ) : (
            ticket.reply && (
              <section className="card section-card">
                <h2>{t('tickets.status.reply')}</h2>
                <div className="quote">{ticket.reply.text}</div>
              </section>
            )
          )}
        </div>

        <div className="col">
          <section className="card timeline-card">
            <div className="card-head">
              <h2>{t('tickets.timeline.title')}</h2>
              <span className="small">{t('tickets.timeline.hint')}</span>
            </div>
            <ServiceTimeline items={ticketTimeline(ticket.timeline)} pending={pending} />
          </section>

          <section className="card people-card">
            <h2>{ticket.source === 'USER' ? t('tickets.people.title') : t('tickets.people.scooterOnly')}</h2>
            {ticket.source === 'USER' && ticket.reporter && (
              <PersonLink href={can('users.read') ? `/admin/klienci/${ticket.reporter.id}` : null}>
                <span className="av big" aria-hidden="true">
                  {initials(ticket.reporter.name ?? t('service.customer'))}
                </span>
                <span className="stack grow">
                  <span className="name">{reporter}</span>
                  <small>{t('tickets.people.reporter')}</small>
                </span>
              </PersonLink>
            )}
            <PersonLink href={can('scooters.read') ? `/admin/flota/${ticket.scooter.id}` : null}>
              <span className="av big scooter" aria-hidden="true">
                <ScooterIcon size={22} />
              </span>
              <span className="stack grow">
                <span className="name">{scooterNumber(ticket.scooter.number)}</span>
                <small>
                  {[
                    valueLabel(scootersResource, 'status', ticket.scooter.status),
                    t(ticket.scooter.online ? 'tickets.people.online' : 'tickets.people.offline'),
                    ticket.scooter.batteryPct !== null && t('common.percent', { value: ticket.scooter.batteryPct }),
                  ]
                    .filter(Boolean)
                    .join(' · ')}
                </small>
              </span>
            </PersonLink>
          </section>
        </div>
      </div>

      {refunding && rental && (
        <RefundDialog
          rental={rental}
          ticketId={ticket.id}
          onClose={() => setRefunding(false)}
          onRefunded={(next, amount) => {
            setRefunding(false);
            setRental(next);
            refresh();
            setNotice(t('rentals.refund.done', { amount: formatPln(amount), number: rentalNumber(next.number) }));
          }}
        />
      )}
      {creating && (
        <TaskCreateDialog
          mode="create"
          scooter={ticket.scooter}
          ticket={ticket}
          suggestedType={ticket.suggestedTaskType}
          availableTypes={ticket.availableTaskTypes}
          onClose={() => setCreating(false)}
          onCreated={(task) => {
            setCreating(false);
            refresh();
            setNotice(t('tickets.taskCreated', { number: taskNumber(task.number) }));
          }}
        />
      )}
    </>
  );
}

/**
 * Zmiana statusu z „Odpowiedzią dla klienta” (D7): ręcznie Nowe, W trakcie i Rozwiązane; „W serwisie” ustawia
 * zadanie. Odpowiedź tylko w zgłoszeniu klienta, wymagana przy Rozwiązane; nowa zastępuje poprzednią.
 */
function StatusCard({
  ticket,
  onDraft,
  onSaved,
}: {
  ticket: TicketAdminDetails;
  onDraft: (draft: { status: TicketStatus; reply: string; note: string } | null) => void;
  onSaved: (ticket: TicketAdminDetails) => void;
}) {
  const [status, setStatus] = useState<TicketStatus>(ticket.status);
  const [reply, setReply] = useState('');
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const customer = ticket.source === 'USER';
  const changed = status !== ticket.status || reply.trim() !== '' || note.trim() !== '';
  const replyRequired = customer && status === 'RESOLVED' && ticket.status !== 'RESOLVED';
  const valid = changed && (!replyRequired || reply.trim() !== '') && (status !== ticket.status || reply.trim() !== '');

  useEffect(() => {
    onDraft(changed ? { status, reply, note } : null);
  }, [changed, status, reply, note, onDraft]);

  const reset = () => {
    setStatus(ticket.status);
    setReply('');
    setNote('');
    setError(null);
  };

  const submit = async () => {
    setBusy(true);
    setError(null);
    try {
      onSaved(
        await api<TicketAdminDetails>(`/admin/tickets/${ticket.id}/status`, {
          method: 'POST',
          json: {
            version: ticket.version,
            ...(status !== ticket.status ? { status } : {}),
            reply: reply.trim() || null,
            note: note.trim() || null,
          },
        }),
      );
    } catch (e) {
      setError(errorMessage(e));
      setBusy(false);
    }
  };

  return (
    <section className="card section-card status-card">
      <h2>{t('tickets.status.title')}</h2>
      <div className="field">
        <span className="label" id="ticket-status-label">
          {t('tickets.status.label')}
        </span>
        <div className="zc-seg status-seg" role="radiogroup" aria-labelledby="ticket-status-label">
          {TICKET_STATUSES.map((value) => {
            const manual = (MANUAL_TICKET_STATUSES as readonly string[]).includes(value);
            return (
              <button
                key={value}
                type="button"
                role="radio"
                aria-checked={status === value}
                disabled={!manual}
                onClick={() => setStatus(value)}
              >
                {t.dynamic(`service.ticketStatus.${value}`)}
              </button>
            );
          })}
        </div>
        <span className="hint">{t('tickets.status.atServiceHint')}</span>
      </div>

      {customer && (
        <div className="field">
          <span className="label-row">
            <label className="label" htmlFor="ticket-reply">
              {t('tickets.status.reply')} {!replyRequired && <span className="opt">{t('common.optional')}</span>}
            </label>
            <span className="small">
              <span className="num strong-500">{reply.length}</span>
              {` / ${TICKET_REPLY_MAX}`}
            </span>
          </span>
          <textarea
            id="ticket-reply"
            className="input"
            value={reply}
            maxLength={TICKET_REPLY_MAX}
            aria-invalid={replyRequired && reply.trim() === '' && error !== null}
            onChange={(e) => setReply(e.target.value)}
          />
          <span className="hint">
            {ticket.reply
              ? t('tickets.status.replyHintReplaces', { previous: ticket.reply.text })
              : t('tickets.status.replyHint')}
          </span>
        </div>
      )}

      <label className="field">
        <span className="label">
          {t('tickets.status.note')} <span className="opt">{t('tickets.status.noteHint')}</span>
        </span>
        <textarea className="input note" value={note} maxLength={1000} onChange={(e) => setNote(e.target.value)} />
      </label>
      {ticket.resolutionNote && (
        <p className="small">{t('tickets.status.currentNote', { note: ticket.resolutionNote })}</p>
      )}

      {error && <Banner kind="danger">{error}</Banner>}

      <div className="actions end">
        <button type="button" className="btn" disabled={!changed || busy} onClick={reset}>
          {t('common.cancel')}
        </button>
        <button type="button" className="btn primary" disabled={!valid || busy} onClick={() => void submit()}>
          <CheckIcon size={15} />
          {customer && reply.trim() ? t('tickets.status.saveAndReply') : t('tickets.status.save')}
        </button>
      </div>
      {replyRequired && reply.trim() === '' && <span className="hint">{t('tickets.status.replyRequired')}</span>}
    </section>
  );
}

function Stat({ value, label, small }: { value: ReactNode; label: string; small?: boolean }) {
  return (
    <div className="stat">
      <span className={small ? 'v small-v' : 'v'}>{value}</span>
      <span className="l">{label}</span>
    </div>
  );
}

function PersonLink({ href, children }: { href: string | null; children: ReactNode }) {
  if (!href) return <div className="person-link">{children}</div>;
  return (
    <Link className="person-link" href={href}>
      {children}
      <ChevronRightIcon />
    </Link>
  );
}
