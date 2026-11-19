'use client';

/**
 * Płatności → Klienci operatora (ADR 0076): `payment_customers` (klient ↔ identyfikator u operatora płatności) z liczbą
 * kart i ostatnią płatnością; tylko do odczytu z `payments.read`. Bez `users.read` API pokazuje „Klient”.
 */
import { paymentCustomersResource, type PaymentCustomerListItem } from '@hulajnogi/shared';
import { t } from '../../../lib/i18n';
import { useSession } from '../../../lib/session';
import { Person } from '../access/common';
import type { FilterSpec } from '../filter-drawer';
import { CardIcon } from '../icons';
import { valueLabel } from '../labels';
import { ListNote, When } from '../list-format';
import { ResourceList, type Column } from '../resource-list';
import { PAYMENTS_BASE, PaymentsTabs, providerLabel } from './payment-format';

const columns: Column<PaymentCustomerListItem>[] = [
  {
    field: 'userName',
    width: 'minmax(0,1.6fr)',
    render: (c) => <Person name={c.userName ?? t('rentalEvents.customer')} detail={valueLabel(paymentCustomersResource, 'userStatus', c.userStatus)} />,
  },
  { field: 'provider', width: '140px', render: (c) => providerLabel(c.provider) },
  { field: 'providerCustomerId', width: 'minmax(0,1.4fr)', render: (c) => <span className="code">{c.providerCustomerId}</span> },
  { field: 'paymentMethods', width: '90px', render: (c) => <span className="num">{c.paymentMethods}</span> },
  { field: 'lastPaymentAt', width: '150px', render: (c) => <When at={c.lastPaymentAt} /> },
  { field: 'createdAt', width: '150px', render: (c) => <When at={c.createdAt} /> },
];

const filters: FilterSpec[] = [
  { field: 'provider', kind: 'checklist', options: [] },
  { field: 'userStatus', kind: 'checklist' },
  { field: 'paymentMethods', kind: 'range' },
  { field: 'createdAt', kind: 'dateRange' },
  { field: 'lastPaymentAt', kind: 'dateRange' },
];

export function PaymentCustomerList() {
  const { can } = useSession();
  return (
    <ResourceList<PaymentCustomerListItem & { id: string }>
      resource={paymentCustomersResource}
      basePath={`${PAYMENTS_BASE}/klienci-operatora`}
      title={t('resource.payments.title')}
      columns={columns}
      rowKey={(c) => c.userId}
      itemHref={(c) => (can('users.read') ? `/admin/klienci/${c.userId}/portfel` : null)}
      filters={filters.map((f) =>
        f.field === 'provider'
          ? { ...f, options: ['fake', 'stripe'].map((p) => ({ value: p, label: providerLabel(p) })) }
          : f,
      )}
      rowLabel={(c) => c.providerCustomerId}
      summary={(data) => t('resource.payment-customers.summary', { count: data.total })}
      emptyIcon={<CardIcon size={22} />}
      createLabel={null}
      selectable={false}
      tabs={<PaymentsTabs />}
      exportColumns={[
        'userName',
        'userStatus',
        'provider',
        'providerCustomerId',
        'paymentMethods',
        'lastPaymentAt',
        'createdAt',
      ]}
      footer={<ListNote>{t('paymentCustomers.note')}</ListNote>}
    />
  );
}
