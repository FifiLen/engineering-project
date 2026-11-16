import { Suspense } from 'react';
import { UserList } from '../../../../components/admin/access/users';

export default function UsersPage() {
  return (
    <main className="page-main">
      <Suspense>
        <UserList />
      </Suspense>
    </main>
  );
}
