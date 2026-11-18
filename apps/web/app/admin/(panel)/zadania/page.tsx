import { Suspense } from 'react';
import { TaskList } from '../../../../components/admin/tasks/tasks';

export default function TasksPage() {
  return (
    <main className="page-main">
      <Suspense>
        <TaskList />
      </Suspense>
    </main>
  );
}
