import { Suspense } from 'react';
import { SentNotificationList } from '../../../../../components/admin/notifications/notification-lists';

export default function SentNotificationsPage() {
  return (
    <main className="page-main">
      <Suspense>
        <SentNotificationList />
      </Suspense>
    </main>
  );
}
