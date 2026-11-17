import { Suspense } from 'react';
import { WalletList } from '../../../../../components/admin/payments/payment-lists';

export default function WalletsPage() {
  return (
    <main className="page-main">
      <Suspense>
        <WalletList />
      </Suspense>
    </main>
  );
}
