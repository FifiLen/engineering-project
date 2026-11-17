import { Suspense } from 'react';
import { WebhookList } from '../../../../../components/admin/payments/payment-lists';

export default function WebhooksPage() {
  return (
    <main className="page-main">
      <Suspense>
        <WebhookList />
      </Suspense>
    </main>
  );
}
