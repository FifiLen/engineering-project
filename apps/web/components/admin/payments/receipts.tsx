'use client';

/**
 * Paragony w panelu (makieta paragony-lista, ADR 0052, D7): lista potwierdzeń sprzedaży i korekt tylko do
 * odczytu, paragon w panelu bocznym i na osobnej stronie (odnośnik ze szczegółów przejazdu i płatności).
 * Opis pozycji pochodzi z pliku tłumaczeń (`receipt.items.<kod>`), kwoty są brutto w groszach.
 */
import {
  formatPln,
  receiptsResource,
  type ListResponse,
  type ReceiptAdminDetails,
  type ReceiptItemView,
  type ReceiptListItem,
} from '@hulajnogi/shared';
import Link from 'next/link';
import { useEffect, useState } from 'react';
import { api } from '../../../lib/api';
import { formatClock, formatDate, formatDateTime, formatTime, isToday, startOfToday, t } from '../../../lib/i18n';
import { useSession } from '../../../lib/session';
import { Banner } from '../access/common';
import type { FilterSpec } from '../filter-drawer';
import { rentalNumber } from '../fleet/fleet-format';
import { CardIcon, ChevronRightIcon, CloseIcon, ReceiptIcon } from '../icons';
import { ResourceList, type Column, type QuickPreset } from '../resource-list';
import { cardOf, PAYMENTS_BASE, PaymentsTabs, signedPln, sourceLabel, useApiRecord } from './payment-format';

const BASE = `${PAYMENTS_BASE}/paragony`;
const buyer = (r: Pick<ReceiptListItem, 'buyerName'>) => r.buyerName ?? t('access.users.noName');

const columns: Column<ReceiptListItem>[] = [
  { field: 'number', width: '150px', render: (r) => r.number },
  {
    field: 'issuedAt',
    width: '56px',
    render: (r) => (
      <span className="num" title={formatTime(r.issuedAt)}>
        {isToday(r.issuedAt) ? formatClock(r.issuedAt) : formatDate(r.issuedAt)}
      </span>
    ),
  },
  { field: 'buyerName', width: 'minmax(0,1fr)', render: buyer },
  {
    field: 'rentalNumber',
    width: '74px',
    render: (r) =>
      r.rentalNumber !== null ? <span className="strong">{rentalNumber(r.rentalNumber)}</span> : t('common.none'),
  },
  {
    field: 'paymentSource',
    width: 'minmax(0,1fr)',
    render: (r) =>
      r.kind === 'CORRECTION' ? (
        <span className="pill muted">{t('receipt.correction')}</span>
      ) : (
        sourceLabel(r.paymentSource, cardOf(r.cardBrand, r.cardLast4))
      ),
  },
  {
    field: 'totalAmount',
    width: '96px',
    render: (r) => <span className="num amount-cell">{formatPln(r.totalAmount)}</span>,
  },
];

const filters: FilterSpec[] = [
  { field: 'kind', kind: 'checklist' },
  { field: 'paymentSource', kind: 'checklist' },
  { field: 'issuedAt', kind: 'dateRange' },
];

/** Szybkie filtry z makiety: z portfela, kartą, korekty. */
const presets: { items: QuickPreset[]; facets: string[]; total: (f: ListResponse<unknown>['facets']) => number } = {
  facets: ['paymentSource', 'kind'],
  total: (f) => Object.values(f.kind ?? {}).reduce((a, b) => a + b, 0),
  items: [
    {
      key: 'wallet',
      label: t('resource.receipts.quick.wallet'),
      filters: [{ field: 'paymentSource', op: 'eq', values: ['WALLET'] }],
      count: (f) => f.paymentSource?.WALLET ?? 0,
    },
    {
      key: 'card',
      label: t('resource.receipts.quick.card'),
      filters: [{ field: 'paymentSource', op: 'eq', values: ['CARD'] }],
      count: (f) => f.paymentSource?.CARD ?? 0,
    },
    {
      key: 'corrections',
      label: t('resource.receipts.quick.corrections'),
      filters: [{ field: 'kind', op: 'eq', values: ['CORRECTION'] }],
      count: (f) => f.kind?.CORRECTION ?? 0,
    },
  ],
};

function useTodayCount(): number | null {
  const [count, setCount] = useState<number | null>(null);
  useEffect(() => {
    api<ListResponse<ReceiptListItem>>(
      `/admin/receipts?issuedAt.gte=${encodeURIComponent(startOfToday())}&kind=SALE&pageSize=1`,
    )
      .then((data) => setCount(data.total))
      .catch(() => setCount(null));
  }, []);
  return count;
}

export function ReceiptList() {
  const [openId, setOpenId] = useState<string | null>(null);
  const today = useTodayCount();
  return (
    <>
      <ResourceList<ReceiptListItem>
        resource={receiptsResource}
        basePath={BASE}
        columns={columns}
        presets={presets}
        filters={filters}
        rowLabel={(r) => r.number}
        summary={(data) =>
          today !== null
            ? t('resource.receipts.summaryToday', { count: today })
            : t('resource.receipts.summary', { count: data.total })
        }
        emptyIcon={<ReceiptIcon size={22} />}
        tabs={<PaymentsTabs />}
        createLabel={null}
        selectable={false}
        onOpen={(r) => setOpenId(r.id)}
        activeId={openId}
      />
      {openId && <ReceiptDrawer key={openId} id={openId} onClose={() => setOpenId(null)} />}
    </>
  );
}

function ReceiptDrawer({ id, onClose }: { id: string; onClose: () => void }) {
  const { data: receipt, error } = useApiRecord<ReceiptAdminDetails>(`/admin/receipts/${id}`);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  return (
    <aside className="rental-drawer" aria-label={t('receipt.label')}>
      <div className="rd-head">
        {receipt ? (
          <div>
            <div className="rd-title">
              <h2>{receipt.number}</h2>
            </div>
            <div className="rd-sub">
              <ReceiptSub receipt={receipt} />
            </div>
          </div>
        ) : (
          <h2 className="rd-title">{t('common.loading')}</h2>
        )}
        <button type="button" className="icon-btn plain" aria-label={t('common.close')} onClick={onClose}>
          <CloseIcon size={18} />
        </button>
      </div>
      <div className="rd-body">
        {error && <Banner kind="danger">{error}</Banner>}
        {receipt && <ReceiptDocument receipt={receipt} />}
      </div>
      <div className="rd-foot">{receipt && <ReceiptLinks receipt={receipt} withDetails />}</div>
    </aside>
  );
}

/** Strona paragonu (`/admin/platnosci/paragony/{id}`). */
export function ReceiptPage({ id }: { id: string }) {
  const { data: receipt, error } = useApiRecord<ReceiptAdminDetails>(`/admin/receipts/${id}`);
  if (!receipt) return error ? <Banner kind="danger">{error}</Banner> : <div className="card" aria-busy="true" />;
  return (
    <>
      <div className="page-head">
        <div>
          <nav className="crumbs" aria-label={t('form.backToList')}>
            <Link href={BASE}>{t('payments.tabs.receipts')}</Link>
            <span aria-hidden="true">/</span>
            <span>{receipt.number}</span>
          </nav>
          <h1>{receipt.number}</h1>
          <div className="sub">
            <ReceiptSub receipt={receipt} />
          </div>
        </div>
        <div className="actions">
          <ReceiptLinks receipt={receipt} />
        </div>
      </div>
      <div className="detail-card receipt-page">
        <ReceiptDocument receipt={receipt} />
      </div>
    </>
  );
}

function ReceiptSub({ receipt }: { receipt: ReceiptAdminDetails }) {
  const { can } = useSession();
  return (
    <>
      {t('receipt.issued', { date: formatDateTime(receipt.issuedAt) })}
      {receipt.rentalId && receipt.rentalNumber !== null && (
        <>
          {' · '}
          {can('rentals.read') ? (
            <Link className="link" href={`/admin/przejazdy/${receipt.rentalId}`}>
              {rentalNumber(receipt.rentalNumber)}
            </Link>
          ) : (
            rentalNumber(receipt.rentalNumber)
          )}
        </>
      )}
    </>
  );
}

/**
 * Opis ilości pozycji: „24 min × 0,80 zł · VAT 23%” dla minut, „1 × 3,00 zł · VAT 23%” dla odblokowania,
 * „1 × 20,00 zł · VAT np.” dla pozycji, która nie podlega VAT (opłata za odholowanie, ADR 0061).
 */
function itemQuantity(item: ReceiptItemView): string {
  if (item.vatRate === null) {
    return t('receipt.timesOutsideVat', { count: item.quantity, price: formatPln(item.unitPrice) });
  }
  const minutes = item.description === 'RIDE_MINUTES' || item.description === 'PAUSE_MINUTES';
  return t(minutes ? 'receipt.minutesTimes' : 'receipt.times', {
    count: item.quantity,
    price: formatPln(item.unitPrice),
    vat: item.vatRate,
  });
}

/** Potwierdzenie sprzedaży albo korekta (makieta paragony-lista): ten sam dokument, który widzi klient. */
export function ReceiptDocument({ receipt }: { receipt: ReceiptAdminDetails }) {
  const seller = [
    receipt.seller.name,
    receipt.seller.address,
    receipt.seller.taxId && t('receipt.taxId', { taxId: receipt.seller.taxId }),
  ]
    .filter(Boolean)
    .join(' · ');
  const correction = receipt.kind === 'CORRECTION';
  return (
    <>
      <div className="rc">
        <div className="rc-head">
          <span className="stack">
            <span className="rc-title">{t.dynamic(`receipt.kind.${receipt.kind}`)}</span>
            <span className="small">{seller}</span>
          </span>
          <span className="pill muted sm on-surface">{t('receipt.nonFiscal')}</span>
        </div>
        <div className="rc-sum">
          <span className="muted">{t('receipt.buyer')}</span>
          <span className="right">
            {receipt.buyer.name ?? t('access.users.noName')}
            {receipt.buyer.phone && (
              <>
                <br />
                <span className="small">{receipt.buyer.phone}</span>
              </>
            )}
          </span>
        </div>
        {receipt.rentalNumber !== null && (
          <div className="rc-sum">
            <span className="muted">{t('receipt.rental')}</span>
            <span>{rentalNumber(receipt.rentalNumber)}</span>
          </div>
        )}
        {correction && receipt.correctsReceiptId && receipt.correctsNumber && (
          <div className="rc-sum">
            <span className="muted">{t('receipt.corrects')}</span>
            <Link className="link" href={`${BASE}/${receipt.correctsReceiptId}`}>
              {receipt.correctsNumber}
            </Link>
          </div>
        )}
        <div className="rc-items">
          {receipt.items.map((item) => (
            <div key={item.lineNo} className="rc-line">
              <span className="stack">
                <span className="strong-500">{t.dynamic(`receipt.items.${item.description}`)}</span>
                <span className="small">{itemQuantity(item)}</span>
              </span>
              <span className="num">{correction ? signedPln(item.amount) : formatPln(item.amount)}</span>
            </div>
          ))}
        </div>
        <div className="rc-totals">
          <div className="rc-sum">
            <span className="muted">{t('receipt.net')}</span>
            <span className="num">{formatPln(receipt.netAmount)}</span>
          </div>
          {/* VAT osobno dla każdej stawki, a pozycje poza VAT jedną kwotą brutto (ADR 0061). */}
          {receipt.vatGroups.map((group) => (
            <div key={group.vatRate ?? 'outside'} className="rc-sum">
              <span className="muted">
                {group.vatRate !== null ? t('receipt.vatRate', { rate: group.vatRate }) : t('receipt.outsideVat')}
              </span>
              <span className="num">{formatPln(group.vatRate !== null ? group.vat : group.gross)}</span>
            </div>
          ))}
        </div>
        <div className="rc-total">
          <span>{t('receipt.total')}</span>
          <b className="num">{correction ? signedPln(receipt.totalAmount) : formatPln(receipt.totalAmount)}</b>
        </div>
        {receipt.paymentSource && (
          <div className="rc-sum">
            <span className="muted">{correction ? t('receipt.refundedTo') : t('receipt.paid')}</span>
            <span>{sourceLabel(receipt.paymentSource, receipt.card)}</span>
          </div>
        )}
      </div>
      {receipt.corrections.length > 0 && (
        <section>
          <div className="rd-section-head">
            <h3>{t('receipt.corrections')}</h3>
          </div>
          <ul className="list-plain">
            {receipt.corrections.map((c) => (
              <li key={c.id}>
                <span className="grow">
                  <Link className="link" href={`${BASE}/${c.id}`}>
                    {c.number}
                  </Link>
                  <small>{formatDateTime(c.issuedAt)}</small>
                </span>
                <span className="num">{signedPln(c.totalAmount)}</span>
              </li>
            ))}
          </ul>
        </section>
      )}
      <span className="small note">{t('receipt.note')}</span>
    </>
  );
}

function ReceiptLinks({ receipt, withDetails }: { receipt: ReceiptAdminDetails; withDetails?: boolean }) {
  const { can } = useSession();
  return (
    <>
      {receipt.paymentId && (
        <Link className="btn" href={`${PAYMENTS_BASE}/${receipt.paymentId}`}>
          <CardIcon size={16} />
          {t('receipt.payment')}
        </Link>
      )}
      <span className="spacer" />
      {receipt.rentalId && receipt.rentalNumber !== null && can('rentals.read') ? (
        <Link className="btn primary" href={`/admin/przejazdy/${receipt.rentalId}`}>
          {t('payments.details.toRental', { number: rentalNumber(receipt.rentalNumber) })}
          <ChevronRightIcon size={15} />
        </Link>
      ) : (
        withDetails && (
          <Link className="btn primary" href={`${BASE}/${receipt.id}`}>
            {t('receipt.open')}
            <ChevronRightIcon size={15} />
          </Link>
        )
      )}
    </>
  );
}
