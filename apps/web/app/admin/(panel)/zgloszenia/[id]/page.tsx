import { TicketDetailsPage } from '../../../../../components/admin/tickets/ticket-details';

export default async function TicketPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return (
    <main className="page-main">
      <TicketDetailsPage id={id} />
    </main>
  );
}
