import { Suspense } from 'react';
import { RentalList } from '../../../../components/admin/rentals/rentals';

export default function RentalsPage() {
  return (
    <main className="page-main">
      <Suspense>
        <RentalList />
      </Suspense>
    </main>
  );
}
