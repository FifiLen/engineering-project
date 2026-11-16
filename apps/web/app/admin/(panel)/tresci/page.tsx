import { DocumentsPage } from '../../../../components/admin/access/documents';

export default async function ContentPage({ searchParams }: { searchParams: Promise<{ dokument?: string }> }) {
  const { dokument } = await searchParams;
  return (
    <main className="page-main">
      <DocumentsPage selectedId={dokument} />
    </main>
  );
}
