import { PaymentPage } from '../../../../../components/admin/payments/payments';

export default async function PaymentDetails({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return (
    <main className="page-main">
      <PaymentPage id={id} />
    </main>
  );
}
