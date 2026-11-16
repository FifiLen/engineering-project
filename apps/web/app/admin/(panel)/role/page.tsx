import { Suspense } from 'react';
import { RoleList } from '../../../../components/admin/access/roles';

export default function RolesPage() {
  return (
    <main className="page-main">
      <Suspense>
        <RoleList />
      </Suspense>
    </main>
  );
}
