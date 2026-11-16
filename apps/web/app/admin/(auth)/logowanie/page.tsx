import { Suspense } from 'react';
import { LoginFlow } from '../../../../components/admin/auth/login-flow';

export default function LoginPage() {
  // useSearchParams (adres powrotu) wymaga granicy Suspense przy renderowaniu statycznym.
  return (
    <Suspense>
      <LoginFlow />
    </Suspense>
  );
}
