import { Suspense } from 'react';
import { SessionList } from '../../../../../components/admin/access/sessions';

/** Użytkownicy → Sesje (ADR 0076): sesje klientów z unieważnieniem. */
export default function SessionsPage() {
  return (
    <main className="page-main">
      <Suspense>
        <SessionList />
      </Suspense>
    </main>
  );
}
