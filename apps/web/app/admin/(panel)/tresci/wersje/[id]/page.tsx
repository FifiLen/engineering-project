import { VersionEditor } from '../../../../../../components/admin/access/documents';

export default async function VersionPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return (
    <main className="page-main">
      <VersionEditor versionId={id} />
    </main>
  );
}
