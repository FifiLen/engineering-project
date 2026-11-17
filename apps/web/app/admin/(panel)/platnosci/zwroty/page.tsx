import { Suspense } from 'react';
import { RefundList } from '../../../../../components/admin/payments/payment-lists';

export default function RefundsPage() {
  return (
    <main className="page-main">
      <Suspense>
        <RefundList />
      </Suspense>
    </main>
  );
}
