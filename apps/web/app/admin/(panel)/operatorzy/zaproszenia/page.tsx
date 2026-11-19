import { Suspense } from 'react';
import { InvitationList } from '../../../../../components/admin/access/staff-lists';

/** Operatorzy i role → Zaproszenia (ADR 0076): ponowne wysłanie i unieważnienie. */
export default function StaffInvitationsPage() {
  return (
    <main className="page-main">
      <Suspense>
        <InvitationList />
      </Suspense>
    </main>
  );
}
