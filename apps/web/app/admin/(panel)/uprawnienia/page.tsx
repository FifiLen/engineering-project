import { Suspense } from 'react';
import { PermissionList } from '../../../../components/admin/access/permissions';

/** Operatorzy i role → Uprawnienia (ADR 0076): katalog z kodu, w panelu tylko opis. */
export default function PermissionsPage() {
  return (
    <main className="page-main">
      <Suspense>
        <PermissionList />
      </Suspense>
    </main>
  );
}
