import { Suspense } from 'react';
import { PaymentMethodList } from '../../../../../components/admin/payments/payment-lists';

export default function PaymentMethodsPage() {
  return (
    <main className="page-main">
      <Suspense>
        <PaymentMethodList />
      </Suspense>
    </main>
  );
}
