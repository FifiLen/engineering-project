import { RoleEditor } from '../../../../../components/admin/access/roles';

export default async function RolePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return (
    <main className="page-main">
      <RoleEditor id={id} />
    </main>
  );
}
