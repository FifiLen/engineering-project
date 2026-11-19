import { Suspense } from 'react';
import { NewsPage } from '../../../../../components/admin/content/news';

/** Aktualności z planowaniem (makieta tresci-aktualnosci). */
export default function ContentNewsPage() {
  return (
    <main className="page-main">
      <Suspense>
        <NewsPage />
      </Suspense>
    </main>
  );
}
