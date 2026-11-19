import { Suspense } from 'react';
import { StaffSessionList } from '../../../../../components/admin/access/staff-lists';

/** Operatorzy i role → Sesje (ADR 0076): sesje operatorów z unieważnieniem. */
export default function StaffSessionsPage() {
  return (
    <main className="page-main">
      <Suspense>
        <StaffSessionList />
      </Suspense>
    </main>
  );
}
