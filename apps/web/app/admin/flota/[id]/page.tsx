import { ScooterForm } from '../../../../components/admin/fleet/scooters';

export default async function ScooterPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return (
    <main className="page-main">
      <ScooterForm id={id} />
    </main>
  );
}
