import { Suspense } from 'react';
import { PaymentCustomerList } from '../../../../../components/admin/payments/payment-customers';

/** Płatności → Klienci operatora (ADR 0076): powiązania klientów z operatorem płatności. */
export default function PaymentCustomersPage() {
  return (
    <main className="page-main">
      <Suspense>
        <PaymentCustomerList />
      </Suspense>
    </main>
  );
}
