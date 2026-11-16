import { Suspense } from 'react';
import { ScooterModelList } from '../../../components/admin/fleet/scooter-models';

export default function ModelsPage() {
  return (
    <main className="page-main">
      <Suspense>
        <ScooterModelList />
      </Suspense>
    </main>
  );
}
