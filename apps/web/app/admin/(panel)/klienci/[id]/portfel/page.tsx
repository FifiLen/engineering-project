import { UserCard } from '../../../../../../components/admin/access/users';

export default async function UserWalletPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return (
    <main className="page-main">
      <UserCard id={id} tab="wallet" />
    </main>
  );
}
