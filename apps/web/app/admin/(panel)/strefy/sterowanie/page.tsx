import { Suspense } from 'react';
import { ZoneControlList } from '../../../../../components/admin/zones/zone-lists';

/** Strefy → Komendy stref (ADR 0076): stan limitu prędkości i zatrzymania uzgadniany ze strefami. */
export default function ZoneControlPage() {
  return (
    <main className="page-main">
      <Suspense>
        <ZoneControlList />
      </Suspense>
    </main>
  );
}
