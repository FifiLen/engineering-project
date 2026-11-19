import { TemplatesPage } from '../../../../components/admin/prints/templates';

/** Wydruki → Szablony (`templates.read`, makieta wydruki-szablony); bez uprawnienia przejście do Wygenerowanych. */
export default function PrintsPage() {
  return (
    <main className="page-main">
      <TemplatesPage />
    </main>
  );
}
