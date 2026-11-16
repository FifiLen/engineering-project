import { ScooterModelForm } from '../../../../../components/admin/fleet/scooter-models';

export default async function ModelPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return (
    <main className="page-main">
      <ScooterModelForm id={id} />
    </main>
  );
}
