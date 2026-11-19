import { Suspense } from 'react';
import { NewsPage } from '../../../../../../components/admin/content/news';

/** Nowa aktualność: lista z otwartym panelem edycji (przycisk „Nowa aktualność” prowadzi pod `/nowy`). */
export default function NewNewsPage() {
  return (
    <main className="page-main">
      <Suspense>
        <NewsPage creating />
      </Suspense>
    </main>
  );
}
