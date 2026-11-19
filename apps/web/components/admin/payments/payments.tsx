'use client';

/**
 * Płatności w panelu (makieta platnosci-lista, D5): lista doładowań i płatności za przejazdy tylko do odczytu,
 * szczegóły w panelu bocznym z historią webhooków i zwrotami oraz osobna strona płatności.
 */
import {
  formatPln,
  paymentsResource,
  refundsResource,
  PAYMENT_STATUSES,
  type ListResponse,
  type PaymentAdminDetails,
  type PaymentListItem,
} from '@hulajnogi/shared';
import Link from 'next/link';
import { useEffect, useState, type ReactNode } from 'react';
import { api } from '../../../lib/api';
import { formatClock, formatDate, formatDateTime, formatTime, isToday, startOfToday, t } from '../../../lib/i18n';
import { useSession } from '../../../lib/session';
import { Banner } from '../access/common';
import type { FilterSpec } from '../filter-drawer';
import { rentalNumber } from '../fleet/fleet-format';
import { CardIcon, CheckIcon, ChevronRightIcon, CloseIcon, CopyIcon, PersonIcon } from '../icons';
import { valueLabel } from '../labels';
import { ResourceList, type Column } from '../resource-list';
import {
  cardLabel,
  cardOf,
  CustomerLink,
  PAYMENT_STATUS_PILL,
  PAYMENTS_BASE,
  PaymentsTabs,
  providerLabel,
  useApiRecord,
} from './payment-format';
import { useCustomerLabel } from '../list-format';

const customer = (p: Pick<PaymentListItem, 'userName'>) => p.userName ?? t('access.users.noName');

export function PaymentStatusPill({ status }: { status: PaymentListItem['status'] }) {
  return <span className={PAYMENT_STATUS_PILL[status]}>{valueLabel(paymentsResource, 'status', status)}</span>;
}

/** Cel płatności: „Doładowanie” albo „Przejazd R-51858”. */
function purposeCell(p: PaymentListItem): ReactNode {
  if (p.purpose === 'RIDE' && p.rentalNumber !== null) {
    return (
      <span>
        {t('payments.purposeRide')} <span className="strong">{rentalNumber(p.rentalNumber)}</span>
      </span>
    );
  }
  return valueLabel(paymentsResource, 'purpose', p.purpose);
}

/** Metoda: karta z numerem albo BLIK. */
export function methodLabel(p: Pick<PaymentListItem, 'method' | 'cardBrand' | 'cardLast4'>): string {
  const card = cardOf(p.cardBrand, p.cardLast4);
  if (p.method === 'CARD' && card) return cardLabel(card);
  return valueLabel(paymentsResource, 'method', p.method);
}

const columns: Column<PaymentListItem>[] = [
  {
    field: 'createdAt',
    width: '64px',
    render: (p) => (
      <span className="num" title={formatTime(p.createdAt)}>
        {isToday(p.createdAt) ? formatClock(p.createdAt) : formatDate(p.createdAt)}
      </span>
    ),
  },
  { field: 'userName', width: 'minmax(0,1fr)', render: customer },
  { field: 'purpose', width: 'minmax(0,1fr)', render: purposeCell },
  { field: 'method', width: 'minmax(0,1.1fr)', render: methodLabel },
  {
    field: 'amount',
    width: '96px',
    render: (p) => <span className="num amount-cell">{formatPln(p.amount)}</span>,
  },
  { field: 'status', width: '96px', render: (p) => <PaymentStatusPill status={p.status} /> },
];

/** Kolejność szybkich filtrów z makiety: Udane, W toku, Nieudane, Zwrócone. */
const QUICK_STATUSES = ['SUCCEEDED', 'PENDING', 'FAILED', 'REFUNDED'] as const satisfies ReadonlyArray<
  (typeof PAYMENT_STATUSES)[number]
>;

const filters: FilterSpec[] = [
  { field: 'status', kind: 'checklist' },
  { field: 'purpose', kind: 'checklist' },
  { field: 'method', kind: 'checklist' },
  { field: 'createdAt', kind: 'dateRange' },
];

/** Podtytuł z makiety: dzisiejsze płatności według stanu (bez filtrów listy). */
function useTodayCounts(): Record<string, number> | null {
  const [counts, setCounts] = useState<Record<string, number> | null>(null);
  useEffect(() => {
    api<ListResponse<PaymentListItem>>(
      `/admin/payments?createdAt.gte=${encodeURIComponent(startOfToday())}&pageSize=1&facets=status`,
    )
      .then((data) => setCounts(data.facets.status ?? {}))
      .catch(() => setCounts(null));
  }, []);
  return counts;
}

export function PaymentList() {
  const [openId, setOpenId] = useState<string | null>(null);
  const today = useTodayCounts();
  return (
    <>
      <ResourceList<PaymentListItem>
        resource={paymentsResource}
        basePath={PAYMENTS_BASE}
        columns={columns}
        quick={{ field: 'status', values: QUICK_STATUSES, pluralKey: 'resource.payments.quick' }}
        filters={filters}
        rowLabel={(p) => `${customer(p)} ${formatPln(p.amount)}`}
        summary={(data) =>
          today
            ? t('resource.payments.summaryToday', {
                succeeded: today.SUCCEEDED ?? 0,
                failed: today.FAILED ?? 0,
                pending: today.PENDING ?? 0,
              })
            : t('resource.payments.summary', { count: data.total })
        }
        emptyIcon={<CardIcon size={22} />}
        tabs={<PaymentsTabs />}
        createLabel={null}
        selectable={false}
        onOpen={(p) => setOpenId(p.id)}
        activeId={openId}
      />
      {openId && <PaymentDrawer key={openId} id={openId} onClose={() => setOpenId(null)} />}
    </>
  );
}

/** Panel boczny płatności (makieta platnosci-lista). */
function PaymentDrawer({ id, onClose }: { id: string; onClose: () => void }) {
  const { data: payment, error } = useApiRecord<PaymentAdminDetails>(`/admin/payments/${id}`);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  return (
    <aside className="rental-drawer" aria-label={t('payments.details.label')}>
      <div className="rd-head">
        <PaymentHead payment={payment} />
        <button type="button" className="icon-btn plain" aria-label={t('common.close')} onClick={onClose}>
          <CloseIcon size={18} />
        </button>
      </div>
      <div className="rd-body">
        {error && <Banner kind="danger">{error}</Banner>}
        {payment && <PaymentBody payment={payment} />}
      </div>
      <div className="rd-foot">{payment && <PaymentLinks payment={payment} withDetails />}</div>
    </aside>
  );
}

/** Strona płatności (`/admin/platnosci/{id}`): odnośnik z przejazdu, webhooka albo księgi. */
export function PaymentPage({ id }: { id: string }) {
  const { data: payment, error } = useApiRecord<PaymentAdminDetails>(`/admin/payments/${id}`);
  const customerLabel = useCustomerLabel();
  if (!payment) return error ? <Banner kind="danger">{error}</Banner> : <div className="card" aria-busy="true" />;
  return (
    <>
      <div className="page-head">
        <div>
          <nav className="crumbs" aria-label={t('form.backToList')}>
            <Link href={PAYMENTS_BASE}>{t('resource.payments.title')}</Link>
            <span aria-hidden="true">/</span>
            <span>{payment.providerPaymentId ?? payment.id}</span>
          </nav>
          <h1 className="title-with-pills">
            {t.dynamic(`payments.details.title.${payment.purpose}`)}
            <PaymentStatusPill status={payment.status} />
          </h1>
          <div className="sub">
            {customerLabel(payment.userName)}
            {' · '}
            {formatDateTime(payment.createdAt)}
          </div>
        </div>
        <div className="actions">
          <PaymentLinks payment={payment} />
        </div>
      </div>
      <section className="card section-card detail-card">
        <PaymentBody payment={payment} />
      </section>
    </>
  );
}

function PaymentHead({ payment }: { payment: PaymentAdminDetails | null }) {
  const customerLabel = useCustomerLabel();
  if (!payment) return <h2 className="rd-title">{t('common.loading')}</h2>;
  return (
    <div>
      <div className="rd-title">
        <h2>{t.dynamic(`payments.details.title.${payment.purpose}`)}</h2>
        <PaymentStatusPill status={payment.status} />
      </div>
      <div className="rd-sub">
        <CustomerLink id={payment.userId} name={customerLabel(payment.userName)} />
        {' · '}
        {formatDateTime(payment.createdAt)}
      </div>
    </div>
  );
}

/** Kwota, dane płatności i zdarzenia operatora (webhooki, zwroty). */
function PaymentBody({ payment }: { payment: PaymentAdminDetails }) {
  const { can } = useSession();
  const card = cardOf(payment.cardBrand, payment.cardLast4);
  return (
    <>
      <div className="amount-box">
        <span className="stack">
          <span className="amount-big num">{formatPln(payment.amount)}</span>
          <span className="small">{t.dynamic(`payments.details.how.${payment.purpose}_${payment.method}`)}</span>
        </span>
        <span className="small">{t('payments.currency')}</span>
      </div>
      <dl className="kv-grid">
        {payment.rentalId && payment.rentalNumber !== null ? (
          <>
            <dt>{t('payments.details.rental')}</dt>
            <dd>
              {can('rentals.read') ? (
                <Link className="link" href={`/admin/przejazdy/${payment.rentalId}`}>
                  {rentalNumber(payment.rentalNumber)}
                </Link>
              ) : (
                rentalNumber(payment.rentalNumber)
              )}
            </dd>
          </>
        ) : (
          <>
            <dt>{t('payments.details.purpose')}</dt>
            <dd>{valueLabel(paymentsResource, 'purpose', payment.purpose)}</dd>
          </>
        )}
        <dt>{t('payments.details.method')}</dt>
        <dd>
          {payment.method === 'CARD' && card ? cardLabel(card) : valueLabel(paymentsResource, 'method', payment.method)}
        </dd>
        <dt>{t('payments.details.provider')}</dt>
        <dd>{providerLabel(payment.provider)}</dd>
        <dt>{t('payments.details.providerId')}</dt>
        <dd>
          {payment.providerPaymentId ? (
            <CopyCode value={payment.providerPaymentId} />
          ) : (
            <span className="muted">{t('common.none')}</span>
          )}
        </dd>
        <dt>{t('payments.details.idempotencyKey')}</dt>
        <dd>
          <span className="code ink">{payment.idempotencyKey}</span>
        </dd>
        <dt>{t('payments.details.receipt')}</dt>
        <dd>
          {payment.receiptId && payment.receiptNumber ? (
            <Link className="link" href={`${PAYMENTS_BASE}/paragony/${payment.receiptId}`}>
              {payment.receiptNumber}
            </Link>
          ) : (
            <span className="muted">{t('payments.details.none')}</span>
          )}
        </dd>
        <dt>{t('payments.details.refunds')}</dt>
        <dd>
          {payment.refundedAmount > 0 ? (
            <span className="num">{formatPln(payment.refundedAmount)}</span>
          ) : (
            <span className="muted">{t('payments.details.none')}</span>
          )}
        </dd>
        {payment.status === 'FAILED' && (
          <>
            <dt>{t('payments.details.failure')}</dt>
            <dd className="wrap">
              {[payment.failureReason, payment.failureCode].filter(Boolean).join(' · ') || t('common.none')}
            </dd>
          </>
        )}
      </dl>
      <section>
        <div className="rd-section-head">
          <h3>{t('payments.details.events')}</h3>
          <span className="small">{t('payments.details.eventsHint')}</span>
        </div>
        <PaymentEvents payment={payment} />
      </section>
    </>
  );
}

interface EventItem {
  key: string;
  at: string;
  title: string;
  tag: string | null;
  detail: ReactNode;
  tone: 'muted' | '' | 'danger' | 'accent';
}

/** Zdarzenia operatora: zlecenie płatności, webhooki z wynikiem przetworzenia i zwroty, od najstarszego. */
function PaymentEvents({ payment }: { payment: PaymentAdminDetails }) {
  const created: EventItem = {
    key: 'created',
    at: payment.createdAt,
    title: t.dynamic(`payments.events.created.${payment.purpose}`),
    tag: 'PENDING',
    detail: t('payments.events.idempotency', { key: payment.idempotencyKey }),
    tone: 'muted',
  };
  const events: EventItem[] = [
    created,
    ...payment.webhooks.map((w): EventItem => ({
      key: `w${w.id}`,
      at: w.receivedAt,
      title: w.type,
      tag: w.result ? t.dynamic(`payments.webhookResult.${w.result}`) : t('payments.events.notProcessed'),
      detail: (
        <>
          {w.deliveries > 1 ? t('payments.events.deliveries', { count: w.deliveries }) : t('payments.events.received')}
          {w.error ? ` · ${w.error}` : ''}
          {' · '}
          <span className="code">{w.providerEventId}</span>
        </>
      ),
      tone: w.result === 'FAILED' ? 'danger' : w.result === 'APPLIED' ? '' : 'muted',
    })),
    ...payment.refunds.map((r): EventItem => ({
      key: `r${r.id}`,
      at: r.createdAt,
      title: t('payments.events.refund', { amount: formatPln(r.amount) }),
      tag: valueLabel(refundsResource, 'status', r.status),
      detail: [t.dynamic(`payments.refundReason.${r.reason}`), r.staffName, r.failureReason]
        .filter(Boolean)
        .join(' · '),
      tone: r.status === 'FAILED' ? 'danger' : r.status === 'PENDING' ? 'accent' : '',
    })),
  ].sort((a, b) => a.at.localeCompare(b.at));

  return (
    <ol className="timeline">
      {events.map((e, i) => (
        <li key={e.key}>
          <span className="rail">
            <span className={`dot ${e.tone}`} />
            {i < events.length - 1 && <span className="line" />}
          </span>
          <span className="body">
            <span className="head">
              <span className="title">{e.title}</span>
              {e.tag && <span className="tl-state">{e.tag}</span>}
            </span>
            <span className="detail">
              <span className="num">{formatTime(e.at)}</span>
              {' · '}
              {e.detail}
            </span>
          </span>
        </li>
      ))}
    </ol>
  );
}

/** Identyfikator u operatora z kopiowaniem do schowka. */
function CopyCode({ value }: { value: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <span className="copy-code">
      <span className="code ink">{value}</span>
      <button
        type="button"
        className="icon-btn plain small-icon"
        aria-label={t('payments.details.copy')}
        title={t('payments.details.copy')}
        onClick={() =>
          void navigator.clipboard.writeText(value).then(() => {
            setCopied(true);
            setTimeout(() => setCopied(false), 1500);
          })
        }
      >
        {copied ? <CheckIcon size={14} /> : <CopyIcon size={14} />}
      </button>
    </span>
  );
}

/** Przyciski stopki: karta klienta i przejazd (albo strona płatności z panelu bocznego). */
function PaymentLinks({ payment, withDetails }: { payment: PaymentAdminDetails; withDetails?: boolean }) {
  const { can } = useSession();
  return (
    <>
      {can('users.read') && (
        <Link className="btn" href={`/admin/klienci/${payment.userId}/portfel`}>
          <PersonIcon />
          {t('payments.details.customer')}
        </Link>
      )}
      <span className="spacer" />
      {payment.rentalId && payment.rentalNumber !== null && can('rentals.read') ? (
        <Link className="btn primary" href={`/admin/przejazdy/${payment.rentalId}`}>
          {t('payments.details.toRental', { number: rentalNumber(payment.rentalNumber) })}
          <ChevronRightIcon size={15} />
        </Link>
      ) : (
        withDetails && (
          <Link className="btn primary" href={`${PAYMENTS_BASE}/${payment.id}`}>
            {t('payments.details.open')}
            <ChevronRightIcon size={15} />
          </Link>
        )
      )}
    </>
  );
}
