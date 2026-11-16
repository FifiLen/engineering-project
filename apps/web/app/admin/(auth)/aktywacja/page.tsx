import { Suspense } from 'react';
import { Activation } from '../../../../components/admin/auth/activation';

export default function ActivationPage() {
  return (
    <Suspense>
      <Activation />
    </Suspense>
  );
}
