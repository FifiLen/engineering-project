import { redirect } from 'next/navigation';

// Pulpit powstaje w iteracji 8; do tego czasu panel otwiera mapę floty.
export default function AdminPage() {
  redirect('/admin/mapa');
}
