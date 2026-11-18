import { Suspense } from 'react';
import { MovementList } from '../../../../../components/admin/parts/parts';

export default function PartMovementsPage() {
  return (
    <main className="page-main">
      <Suspense>
        <MovementList />
      </Suspense>
    </main>
  );
}
