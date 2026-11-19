import { ReportDefinitionsPage } from '../../../../../../components/admin/reports/definitions';

/** Raporty → Definicje → definicja raportu (nazwa, opis, aktywność, kolejność; pola z kodu tylko do odczytu). */
export default async function ReportDefinitionPage({ params }: { params: Promise<{ kod: string }> }) {
  const { kod } = await params;
  return (
    <main className="page-main">
      <ReportDefinitionsPage code={kod} />
    </main>
  );
}
