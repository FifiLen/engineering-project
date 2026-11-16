import { Suspense } from 'react';
import { StaffList } from '../../../../components/admin/access/staff';

export default function StaffPage() {
  return (
    <main className="page-main">
      <Suspense>
        <StaffList />
      </Suspense>
    </main>
  );
}
