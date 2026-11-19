import { Suspense } from 'react';
import { GeneratedList } from '../../../../../components/admin/prints/generated';

/** Wydruki → Wygenerowane (`documents.generate`, makieta wydruki-wygenerowane). */
export default function GeneratedDocumentsPage() {
  return (
    <main className="page-main">
      <Suspense>
        <GeneratedList />
      </Suspense>
    </main>
  );
}
