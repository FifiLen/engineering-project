import { Suspense } from 'react';
import { ScooterCard } from '../../../../../components/admin/service/scooter-service';

/** Karta hulajnogi: zakładki „Przegląd” (formularz) i „Serwis” (makieta hulajnoga-serwis). */
export default async function ScooterPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return (
    <main className="page-main">
      <Suspense>
        <ScooterCard id={id} />
      </Suspense>
    </main>
  );
}
