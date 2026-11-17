import { ReceiptPage } from '../../../../../../components/admin/payments/receipts';

export default async function ReceiptDetails({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return (
    <main className="page-main">
      <ReceiptPage id={id} />
    </main>
  );
}
