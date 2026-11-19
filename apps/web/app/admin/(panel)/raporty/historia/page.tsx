import { Suspense } from 'react';
import { ReportHistoryList } from '../../../../../components/admin/reports/history';

/** Raporty → Historia uruchomień (ADR 0071, makieta raporty-historia). */
export default function ReportHistoryPage() {
  return (
    <main className="page-main">
      <Suspense>
        <ReportHistoryList />
      </Suspense>
    </main>
  );
}
