import { Suspense } from 'react';
import { ConsentList } from '../../../../../components/admin/access/consents';

/** Użytkownicy → Zgody (ADR 0076): zgody klientów z wycofaniem zgody marketingowej. */
export default function ConsentsPage() {
  return (
    <main className="page-main">
      <Suspense>
        <ConsentList />
      </Suspense>
    </main>
  );
}
