'use client';

/**
 * Rozliczenie przejazdu w szczegółach (makieta przejazd-zwrot, ADR 0049, ADR 0054): stan, źródło zapłaty,
 * płatność kartą, paragon i zwroty. Przed zakończeniem przejazd nie ma rozliczenia.
 */
import { formatPln, type RentalAdminDetails } from '@hulajnogi/shared';
import Link from 'next/link';
import type { ReactNode } from 'react';
import { formatDateTime, t } from '../../../lib/i18n';
import { useSession } from '../../../lib/session';
import { PAYMENTS_BASE, REFUND_STATUS_PILL, SETTLEMENT_PILL, sourceLabel } from '../payments/payment-format';
import { OPEN_STATES } from './rental-parts';

/** Pigułka rozliczenia w karcie „Opłata”; otwarty przejazd jeszcze się nie rozlicza. */
export function settlementPill(rental: RentalAdminDetails): ReactNode {
  const { state } = rental.settlement;
  if (state === 'NONE' && OPEN_STATES.includes(rental.state)) {
    return <span className="pill muted">{t('rentals.price.settlement')}</span>;
  }
  return <span className={SETTLEMENT_PILL[state]}>{t.dynamic(`rentals.settlement.${state}`)}</span>;
}

export function RentalSettlementCard({ rental }: { rental: RentalAdminDetails }) {
  const { can } = useSession();
  const s = rental.settlement;
  const open = OPEN_STATES.includes(rental.state);
  const payments = can('payments.read');
  return (
    <section className="card settlement-card">
      <div className="card-head">
        <h2>{t('rentals.settlement.title')}</h2>
      </div>
      <div className="lines">
        <Line label={t('rentals.settlement.source')}>
          <span>
            {sourceLabel(s.source, s.card)}
            {open && <small className="muted">{` ${t('rentals.settlement.chosenAtStart')}`}</small>}
          </span>
        </Line>
        {s.paymentId && (
          <Line label={t('rentals.settlement.payment')}>
            {payments ? (
              <Link className="link" href={`${PAYMENTS_BASE}/${s.paymentId}`}>
                {t('rentals.settlement.paymentLink')}
              </Link>
            ) : (
              <span>{t('rentals.settlement.paymentLink')}</span>
            )}
          </Line>
        )}
        {s.paidAmount > 0 && (
          <Line label={t('rentals.settlement.paid')}>
            <span className="num">{formatPln(s.paidAmount)}</span>
          </Line>
        )}
        <Line label={t('rentals.settlement.receipt')}>
          {s.receiptId && s.receiptNumber ? (
            payments ? (
              <Link className="link" href={`${PAYMENTS_BASE}/paragony/${s.receiptId}`}>
                {s.receiptNumber}
              </Link>
            ) : (
              <span>{s.receiptNumber}</span>
            )
          ) : (
            <span className="muted">{t('payments.details.none')}</span>
          )}
        </Line>
        {s.state === 'FAILED' && (
          <Line label={t('rentals.settlement.failure')}>
            <span className="bad wrap">{s.failureReason ?? s.failureCode ?? t('common.none')}</span>
          </Line>
        )}
        <Line label={t('rentals.settlement.refunds')}>
          {rental.refunds.length === 0 ? (
            <span className="muted">{t('payments.details.none')}</span>
          ) : (
            <span className="num">{formatPln(s.refundedAmount)}</span>
          )}
        </Line>
      </div>
      {rental.refunds.length > 0 && (
        <ul className="refund-list">
          {rental.refunds.map((r) => (
            <li key={r.id}>
              <span className="stack grow">
                <span>
                  {t.dynamic(`payments.refundReason.${r.reason}`)}
                  {r.note && <span className="muted">{` · ${r.note}`}</span>}
                </span>
                <small>
                  {[formatDateTime(r.createdAt), r.staffName, t.dynamic(`payments.source.${r.source}`)]
                    .filter(Boolean)
                    .join(' · ')}
                </small>
              </span>
              <span className="stack end">
                <span className="num">{formatPln(r.amount)}</span>
                <span className={`${REFUND_STATUS_PILL[r.status]} sm`}>
                  {t.dynamic(`resource.refunds.values.status.${r.status}`)}
                </span>
              </span>
            </li>
          ))}
        </ul>
      )}
      {s.state === 'NONE' && !open && rental.state !== 'EXPIRED' && (
        <p className="small">{t('rentals.settlement.noneNote')}</p>
      )}
    </section>
  );
}

function Line({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="line-item">
      <span className="muted">{label}</span>
      {children}
    </div>
  );
}
