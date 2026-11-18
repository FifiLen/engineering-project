import { Suspense } from 'react';
import { TaskList } from '../../../../../components/admin/tasks/tasks';

/** „Nowe zadanie” z listy zadań: lista z oknem tworzenia zadania (wybór hulajnogi po numerze). */
export default function NewTaskPage() {
  return (
    <main className="page-main">
      <Suspense>
        <TaskList creating />
      </Suspense>
    </main>
  );
}
