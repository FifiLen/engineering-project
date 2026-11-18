import { Suspense } from 'react';
import { TemplatesPage } from '../../../../components/admin/notifications/templates';

export default function NotificationTemplatesPage() {
  return (
    <main className="page-main">
      <Suspense>
        <TemplatesPage />
      </Suspense>
    </main>
  );
}
