import { SectionEditor } from '../../../../../../components/admin/content/section-editor';

/** Edytor sekcji (makiety tresci-blok-edycja, tresci-sekcja-lista). */
export default async function SectionPage({ params }: { params: Promise<{ key: string }> }) {
  const { key } = await params;
  return (
    <main className="page-main">
      <SectionEditor key={key} sectionKey={decodeURIComponent(key)} />
    </main>
  );
}
