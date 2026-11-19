import { Suspense } from 'react';
import { RentalEventList } from '../../../../../components/admin/rentals/rental-events';

/** Przejazdy → Zdarzenia (ADR 0076): zdarzenia przejazdów z filtrami, tylko do odczytu. */
export default function RentalEventsPage() {
  return (
    <main className="page-main">
      <Suspense>
        <RentalEventList />
      </Suspense>
    </main>
  );
}
