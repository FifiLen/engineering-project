import { Suspense } from 'react';
import { LedgerList } from '../../../../../components/admin/payments/payment-lists';

export default function LedgerPage() {
  return (
    <main className="page-main">
      <Suspense>
        <LedgerList />
      </Suspense>
    </main>
  );
}
