import { Suspense } from 'react';
import { ReceiptList } from '../../../../../components/admin/payments/receipts';

export default function ReceiptsPage() {
  return (
    <main className="page-main">
      <Suspense>
        <ReceiptList />
      </Suspense>
    </main>
  );
}
