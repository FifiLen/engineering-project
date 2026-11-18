import { Suspense } from 'react';
import { PartList } from '../../../../components/admin/parts/parts';

export default function PartsPage() {
  return (
    <main className="page-main">
      <Suspense>
        <PartList />
      </Suspense>
    </main>
  );
}
