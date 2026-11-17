import { Suspense } from 'react';
import { TariffsPage } from '../../../../components/admin/tariffs/tariffs';

export default function TariffPage() {
  return (
    <main className="page-main">
      <Suspense>
        <TariffsPage />
      </Suspense>
    </main>
  );
}
