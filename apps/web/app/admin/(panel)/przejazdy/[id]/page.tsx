import { RentalDetailsPage } from '../../../../../components/admin/rentals/rental-details';

export default async function RentalPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return (
    <main className="page-main">
      <RentalDetailsPage id={id} />
    </main>
  );
}
