import { TemplateDetailsPage } from '../../../../../../components/admin/prints/template-details';

/** Szablon wydruku z wersjami, walidacją i podglądem PDF (makiety wydruki-szablon-wersja, wydruki-wgranie-bledy). */
export default async function TemplatePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return (
    <main className="page-main">
      <TemplateDetailsPage id={id} />
    </main>
  );
}
