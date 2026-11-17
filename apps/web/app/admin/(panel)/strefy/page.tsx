import { Suspense } from 'react';
import { ZonesScreen } from '../../../../components/admin/zones/zones-page';

export default function ZonesPage() {
  return (
    <Suspense>
      <ZonesScreen />
    </Suspense>
  );
}
