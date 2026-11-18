'use client';

/**
 * Pozostałe zakładki „Płatności” na wzorcu listy (ADR 0031, D5, tylko do odczytu): księga portfeli, portfele
 * ze zgodnością z księgą, metody płatności, zdarzenia webhooków i zwroty. Wiersz prowadzi do rekordu,
 * którego dotyczy (portfel klienta, płatność, przejazd).
 */
import {
  formatPln,
  paymentMethodsResource,
  refundsResource,
  walletLedgerResource,
  walletsResource,
  webhookEventsResource,
  LEDGER_ENTRY_TYPES,
  type ListResponse,
  type PaymentMethodAdminItem,
  type RefundListItem,
  type WalletLedgerItem,
  type WalletListItem,
  type WebhookEventItem,
} from '@hulajnogi/shared';
import Link from 'next/link';
import type { ReactNode } from 'react';
import { formatClock, formatDate, formatDateTime, formatRelative, formatTime, isToday, t } from '../../../lib/i18n';
import { useSession } from '../../../lib/session';
import { Person } from '../access/common';
import type { FilterSpec } from '../filter-drawer';
import { rentalNumber } from '../fleet/fleet-format';
import { CardIcon, ReceiptIcon, UndoIcon } from '../icons';
import { valueLabel } from '../labels';
import { ResourceList, type Column, type QuickPreset } from '../resource-list';
import {
  cardLabel,
  cardOf,
  CardMark,
  PAYMENTS_BASE,
  PaymentsTabs,
  providerLabel,
  REFUND_STATUS_PILL,
  signedPln,
} from './payment-format';

const noName = () => t('access.users.noName');

function When({ at }: { at: string }) {
  return (
    <span className="num" title={formatDateTime(at)}>
      {isToday(at) ? formatClock(at) : formatDate(at)}
    </span>
  );
}

const amount = (value: number, signed = false) => (
  <span className="num amount-cell">{signed ? signedPln(value) : formatPln(value)}</span>
);

/** Adres karty klienta (portfel) albo `null` bez uprawnienia do klientów. */
function useWalletHref() {
  const { can } = useSession();
  return (userId: string) => (can('users.read') ? `/admin/klienci/${userId}/portfel` : null);
}

// ---------------------------------------------------------------------------------------------
// Księga
// ---------------------------------------------------------------------------------------------

/** Typ wpisu z kodem pod spodem, jak w makiecie klient-portfel. */
export function LedgerType({ entry }: { entry: Pick<WalletLedgerItem, 'type'> }) {
  return (
    <span className="stack">
      <span>{valueLabel(walletLedgerResource, 'type', entry.type)}</span>
      <span className="code">{entry.type}</span>
    </span>
  );
}

/** Szczegóły wpisu księgi: przejazd z paragonem, metoda doładowania, powód korekty z operatorem i notatką. */
export function LedgerDetails({ entry }: { entry: WalletLedgerItem }) {
  const { can } = useSession();
  const rental =
    entry.rentalId && entry.rentalNumber !== null ? (
      can('rentals.read') ? (
        <Link className="link" href={`/admin/przejazdy/${entry.rentalId}`}>
          {rentalNumber(entry.rentalNumber)}
        </Link>
      ) : (
        <span className="strong">{rentalNumber(entry.rentalNumber)}</span>
      )
    ) : null;
  const card = cardOf(entry.cardBrand, entry.cardLast4);
  let title: ReactNode = null;
  let detail: ReactNode = null;
  switch (entry.type) {
    // Opłata za odholowanie: osobny wpis tego samego przejazdu i paragonu (ADR 0060).
    case 'RIDE_CHARGE':
    case 'TOWING_FEE':
      title = rental;
      detail = [
        entry.type === 'TOWING_FEE' ? t('payments.ledger.towingFee') : t('payments.ledger.fromWallet'),
        entry.receiptNumber,
      ]
        .filter(Boolean)
        .join(' · ');
      break;
    case 'TOPUP':
    case 'PAYOUT':
      title =
        entry.paymentMethod === 'CARD' && card
          ? cardLabel(card)
          : entry.paymentMethod
            ? valueLabel(walletLedgerResource, 'paymentMethod', entry.paymentMethod)
            : t('common.none');
      detail = entry.providerPaymentId ? <span className="code">{entry.providerPaymentId}</span> : null;
      if (entry.type === 'PAYOUT') detail = t('payments.ledger.payout', { staff: entry.staffName ?? t('common.none') });
      break;
    case 'REFUND':
      title = (
        <>
          {rental}
          {rental && ' · '}
          {entry.refundReason ? t.dynamic(`payments.refundReason.${entry.refundReason}`) : t('common.none')}
        </>
      );
      detail = [entry.staffName, t('payments.ledger.toWallet')].filter(Boolean).join(' · ');
      break;
    case 'ADJUSTMENT':
      title = entry.reason ? valueLabel(walletLedgerResource, 'reason', entry.reason) : t('common.none');
      detail = [entry.staffName, entry.note && t('payments.ledger.note', { note: entry.note })]
        .filter(Boolean)
        .join(' · ');
      break;
  }
  return (
    <span className="stack">
      <span>{title}</span>
      {detail && <span className="small">{detail}</span>}
    </span>
  );
}

const ledgerColumns: Column<WalletLedgerItem>[] = [
  { field: 'createdAt', width: '64px', render: (e) => <When at={e.createdAt} /> },
  { field: 'userName', width: 'minmax(0,0.9fr)', render: (e) => e.userName ?? noName() },
  { field: 'type', width: '120px', render: (e) => <LedgerType entry={e} /> },
  { field: 'note', width: 'minmax(0,1.4fr)', render: (e) => <LedgerDetails entry={e} /> },
  { field: 'amount', width: '96px', render: (e) => amount(e.amount, true) },
  { field: 'balanceAfter', width: '96px', render: (e) => amount(e.balanceAfter) },
];

const ledgerFilters: FilterSpec[] = [
  { field: 'type', kind: 'checklist' },
  // Powód korekty bez liczników (pole bez `facet`), więc jako lista wyboru.
  { field: 'reason', kind: 'select' },
  { field: 'createdAt', kind: 'dateRange' },
];

export function LedgerList() {
  const walletHref = useWalletHref();
  return (
    <ResourceList<WalletLedgerItem>
      resource={walletLedgerResource}
      basePath={`${PAYMENTS_BASE}/ksiega`}
      columns={ledgerColumns}
      quick={{ field: 'type', values: LEDGER_ENTRY_TYPES }}
      filters={ledgerFilters}
      rowLabel={(e) => String(e.id)}
      summary={(data) => t('resource.wallet-ledger.summary', { count: data.total })}
      emptyIcon={<ReceiptIcon size={22} />}
      tabs={<PaymentsTabs />}
      createLabel={null}
      selectable={false}
      itemHref={(e) => walletHref(e.userId)}
    />
  );
}

// ---------------------------------------------------------------------------------------------
// Portfele
// ---------------------------------------------------------------------------------------------

type WalletRow = WalletListItem & { id: string };

const walletColumns: Column<WalletRow>[] = [
  { field: 'name', width: 'minmax(0,1.6fr)', render: (w) => <Person name={w.name ?? noName()} detail={w.phone} /> },
  { field: 'ledgerBalance', width: '110px', render: (w) => amount(w.ledgerBalance) },
  {
    field: 'outOfSync',
    width: '150px',
    render: (w) =>
      w.outOfSync ? (
        <span className="pill danger" title={t('payments.wallets.cached', { amount: formatPln(w.cachedBalance) })}>
          {t('payments.wallets.outOfSync')}
        </span>
      ) : (
        <span className="pill muted">{t('payments.wallets.inSync')}</span>
      ),
  },
  { field: 'entries', width: '80px', render: (w) => <span className="num">{w.entries}</span> },
  {
    field: 'lastEntryAt',
    width: '140px',
    render: (w) => (w.lastEntryAt ? formatRelative(w.lastEntryAt) : <span className="muted">{t('common.none')}</span>),
  },
];

const walletFilters: FilterSpec[] = [
  { field: 'outOfSync', kind: 'boolean' },
  { field: 'lastEntryAt', kind: 'dateRange' },
];

const walletPresets: { items: QuickPreset[]; facets: string[]; total: (f: ListResponse<unknown>['facets']) => number } =
  {
    facets: ['outOfSync'],
    total: (f) => Object.values(f.outOfSync ?? {}).reduce((a, b) => a + b, 0),
    items: [
      {
        key: 'outOfSync',
        label: t('resource.wallets.quick.outOfSync'),
        filters: [{ field: 'outOfSync', op: 'eq', values: [true] }],
        count: (f) => f.outOfSync?.true ?? 0,
      },
    ],
  };

export function WalletList() {
  const walletHref = useWalletHref();
  return (
    <ResourceList<WalletRow>
      resource={walletsResource}
      basePath={`${PAYMENTS_BASE}/portfele`}
      columns={walletColumns}
      presets={walletPresets}
      filters={walletFilters}
      rowLabel={(w) => w.name ?? noName()}
      summary={(data) => t('resource.wallets.summary', { count: data.total })}
      emptyIcon={<CardIcon size={22} />}
      tabs={<PaymentsTabs />}
      createLabel={null}
      selectable={false}
      rowKey={(w) => w.userId}
      itemHref={(w) => walletHref(w.userId)}
    />
  );
}

// ---------------------------------------------------------------------------------------------
// Metody płatności
// ---------------------------------------------------------------------------------------------

const CARD_STATE_PILL: Record<PaymentMethodAdminItem['state'], string> = {
  ACTIVE: 'pill',
  EXPIRING: 'pill warn',
  EXPIRED: 'pill danger',
  REMOVED: 'pill muted',
};

export function CardStatePill({ state }: { state: PaymentMethodAdminItem['state'] }) {
  return <span className={CARD_STATE_PILL[state]}>{valueLabel(paymentMethodsResource, 'state', state)}</span>;
}

export const expiry = (m: Pick<PaymentMethodAdminItem, 'expMonth' | 'expYear'>) =>
  t('payments.methods.expiry', { month: String(m.expMonth).padStart(2, '0'), year: m.expYear });

const methodColumns: Column<PaymentMethodAdminItem>[] = [
  {
    field: 'brand',
    width: 'minmax(0,1.2fr)',
    render: (m) => (
      <span className="person">
        <CardMark brand={m.brand} small />
        <span className="who">
          <span className="strong">{cardLabel(m)}</span>
          <small>{providerLabel(m.provider)}</small>
        </span>
      </span>
    ),
  },
  {
    field: 'userName',
    width: 'minmax(0,1fr)',
    render: (m) => <Person name={m.userName ?? noName()} detail={m.userPhone} />,
  },
  { field: 'expYear', width: '90px', render: (m) => <span className="num">{expiry(m)}</span> },
  {
    field: 'isDefault',
    width: '100px',
    render: (m) => (m.isDefault ? <span className="pill accent">{t('payments.methods.default')}</span> : null),
  },
  { field: 'state', width: '110px', render: (m) => <CardStatePill state={m.state} /> },
  { field: 'createdAt', width: '110px', render: (m) => <When at={m.createdAt} /> },
];

const methodFilters: FilterSpec[] = [
  { field: 'state', kind: 'checklist' },
  { field: 'isDefault', kind: 'boolean' },
  { field: 'createdAt', kind: 'dateRange' },
];

export function PaymentMethodList() {
  const walletHref = useWalletHref();
  return (
    <ResourceList<PaymentMethodAdminItem>
      resource={paymentMethodsResource}
      basePath={`${PAYMENTS_BASE}/metody`}
      columns={methodColumns}
      quick={{ field: 'state', values: ['ACTIVE', 'EXPIRING', 'EXPIRED', 'REMOVED'] }}
      filters={methodFilters}
      rowLabel={(m) => cardLabel(m)}
      summary={(data) => t('resource.payment-methods.summary', { count: data.total })}
      emptyIcon={<CardIcon size={22} />}
      tabs={<PaymentsTabs />}
      createLabel={null}
      selectable={false}
      itemHref={(m) => walletHref(m.userId)}
    />
  );
}

// ---------------------------------------------------------------------------------------------
// Webhooki
// ---------------------------------------------------------------------------------------------

const RESULT_PILL: Record<string, string> = {
  APPLIED: 'pill',
  NO_CHANGE: 'pill muted',
  IGNORED: 'pill muted',
  FAILED: 'pill danger',
};

const webhookColumns: Column<WebhookEventItem>[] = [
  {
    field: 'receivedAt',
    width: '80px',
    render: (w) => (
      <span className="num" title={formatDateTime(w.receivedAt)}>
        {isToday(w.receivedAt) ? formatTime(w.receivedAt) : formatDate(w.receivedAt)}
      </span>
    ),
  },
  {
    field: 'type',
    width: 'minmax(0,1.3fr)',
    render: (w) => (
      <span className="stack">
        <span className="code ink">{w.type}</span>
        <span className="code">{w.providerEventId}</span>
      </span>
    ),
  },
  {
    field: 'paymentId',
    width: 'minmax(0,1fr)',
    render: (w) =>
      w.paymentId ? (
        <span className="stack">
          <span>
            {w.paymentPurpose
              ? valueLabel(webhookEventsResource, 'paymentPurpose', w.paymentPurpose)
              : t('common.none')}
            {w.paymentAmount !== null && <span className="num">{` · ${formatPln(w.paymentAmount)}`}</span>}
          </span>
          <span className="small">{w.userName ?? noName()}</span>
        </span>
      ) : (
        <span className="muted">{t('payments.webhooks.noPayment')}</span>
      ),
  },
  { field: 'provider', width: '90px', render: (w) => providerLabel(w.provider) },
  { field: 'deliveries', width: '90px', render: (w) => <span className="num">{w.deliveries}</span> },
  {
    field: 'result',
    width: '130px',
    render: (w) =>
      w.result ? (
        <span className={RESULT_PILL[w.result]} title={w.error ?? undefined}>
          {valueLabel(webhookEventsResource, 'result', w.result)}
        </span>
      ) : (
        <span className="pill accent">{t('payments.events.notProcessed')}</span>
      ),
  },
];

const webhookFilters: FilterSpec[] = [
  { field: 'result', kind: 'checklist' },
  { field: 'receivedAt', kind: 'dateRange' },
];

export function WebhookList() {
  return (
    <ResourceList<WebhookEventItem>
      resource={webhookEventsResource}
      basePath={`${PAYMENTS_BASE}/webhooki`}
      columns={webhookColumns}
      quick={{ field: 'result', values: ['APPLIED', 'NO_CHANGE', 'IGNORED', 'FAILED'] }}
      filters={webhookFilters}
      rowLabel={(w) => w.providerEventId}
      summary={(data) => t('resource.payment-webhook-events.summary', { count: data.total })}
      emptyIcon={<ReceiptIcon size={22} />}
      tabs={<PaymentsTabs />}
      createLabel={null}
      selectable={false}
      itemHref={(w) => (w.paymentId ? `${PAYMENTS_BASE}/${w.paymentId}` : null)}
    />
  );
}

// ---------------------------------------------------------------------------------------------
// Zwroty
// ---------------------------------------------------------------------------------------------

const refundColumns: Column<RefundListItem>[] = [
  { field: 'createdAt', width: '64px', render: (r) => <When at={r.createdAt} /> },
  { field: 'userName', width: 'minmax(0,1fr)', render: (r) => r.userName ?? noName() },
  {
    field: 'rentalNumber',
    width: 'minmax(0,1fr)',
    render: (r) => (
      <span className="stack">
        <span>
          {r.rentalNumber !== null
            ? t('payments.purposeRideNumber', { number: rentalNumber(r.rentalNumber) })
            : t('payments.refunds.balance')}
        </span>
        <span className="small">{t.dynamic(`payments.refundReason.${r.reason}`)}</span>
      </span>
    ),
  },
  { field: 'source', width: '100px', render: (r) => valueLabel(refundsResource, 'source', r.source) },
  { field: 'amount', width: '96px', render: (r) => amount(r.amount) },
  {
    field: 'status',
    width: '100px',
    render: (r) => (
      <span className={REFUND_STATUS_PILL[r.status]} title={r.failureReason ?? undefined}>
        {valueLabel(refundsResource, 'status', r.status)}
      </span>
    ),
  },
  { field: 'staffName', width: 'minmax(0,0.8fr)', render: (r) => r.staffName ?? t('common.none') },
];

const refundFilters: FilterSpec[] = [
  { field: 'status', kind: 'checklist' },
  { field: 'source', kind: 'checklist' },
  { field: 'reason', kind: 'checklist' },
  { field: 'createdAt', kind: 'dateRange' },
];

export function RefundList() {
  const walletHref = useWalletHref();
  const { can } = useSession();
  return (
    <ResourceList<RefundListItem>
      resource={refundsResource}
      basePath={`${PAYMENTS_BASE}/zwroty`}
      columns={refundColumns}
      quick={{ field: 'status', values: ['SUCCEEDED', 'PENDING', 'FAILED'] }}
      filters={refundFilters}
      rowLabel={(r) => `${r.userName ?? noName()} ${formatPln(r.amount)}`}
      summary={(data) => t('resource.refunds.summary', { count: data.total })}
      emptyIcon={<UndoIcon size={22} />}
      tabs={<PaymentsTabs />}
      createLabel={null}
      selectable={false}
      itemHref={(r) =>
        r.rentalId && can('rentals.read')
          ? `/admin/przejazdy/${r.rentalId}`
          : r.paymentId
            ? `${PAYMENTS_BASE}/${r.paymentId}`
            : walletHref(r.userId)
      }
    />
  );
}
