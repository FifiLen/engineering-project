import { Suspense } from 'react';
import { ReportPage } from '../../../../../components/admin/reports/report-page';

/** Raport z parametrami w adresie URL i podglądem (ADR 0071, makiety raport-przychody, raport-strefy-godziny). */
export default async function ReportPreviewPage({ params }: { params: Promise<{ kod: string }> }) {
  const { kod } = await params;
  return (
    <main className="page-main">
      <Suspense>
        <ReportPage code={kod} />
      </Suspense>
    </main>
  );
}
