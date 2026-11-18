import { PartForm } from '../../../../../components/admin/parts/part-form';

export default async function PartPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return (
    <main className="page-main">
      <PartForm id={id} />
    </main>
  );
}
