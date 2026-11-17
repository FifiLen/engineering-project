import { Suspense } from 'react';
import { PaymentList } from '../../../../components/admin/payments/payments';

export default function PaymentsPage() {
  return (
    <main className="page-main">
      <Suspense>
        <PaymentList />
      </Suspense>
    </main>
  );
}
