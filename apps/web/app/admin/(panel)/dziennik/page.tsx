import { Suspense } from 'react';
import { AuditList } from '../../../../components/admin/access/audit';

export default function AuditPage() {
  return (
    <main className="page-main">
      <Suspense>
        <AuditList />
      </Suspense>
    </main>
  );
}
