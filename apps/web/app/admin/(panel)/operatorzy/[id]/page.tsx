import { StaffCard } from '../../../../../components/admin/access/staff';

export default async function StaffCardPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return (
    <main className="page-main">
      <StaffCard id={id} />
    </main>
  );
}
