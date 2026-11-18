import { DashboardPage } from '../../../components/admin/dashboard/dashboard';

/** Pulpit „Wymaga uwagi” (iteracja 6, D1); bez `dashboard.read` panel otwiera mapę floty. */
export default function AdminPage() {
  return (
    <main className="page-main">
      <DashboardPage />
    </main>
  );
}
