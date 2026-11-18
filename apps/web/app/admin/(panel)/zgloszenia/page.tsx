import { Suspense } from 'react';
import { TicketList } from '../../../../components/admin/tickets/tickets';

export default function TicketsPage() {
  return (
    <main className="page-main">
      <Suspense>
        <TicketList />
      </Suspense>
    </main>
  );
}
