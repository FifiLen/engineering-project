import { TaskDetailsPage } from '../../../../../components/admin/tasks/task-details';

export default async function TaskPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return (
    <main className="page-main">
      <TaskDetailsPage id={id} />
    </main>
  );
}
