import { Suspense } from 'react';
import { PushTokenList } from '../../../../../components/admin/notifications/notification-lists';

export default function PushTokensPage() {
  return (
    <main className="page-main">
      <Suspense>
        <PushTokenList />
      </Suspense>
    </main>
  );
}
