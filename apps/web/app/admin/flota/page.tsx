import { Suspense } from 'react';
import { ScooterList } from '../../../components/admin/fleet/scooters';

export default function FleetPage() {
  return (
    <main className="page-main">
      <Suspense>
        <ScooterList />
      </Suspense>
    </main>
  );
}
