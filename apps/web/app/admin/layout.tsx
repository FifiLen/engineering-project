import type { Metadata } from 'next';
import type { ReactNode } from 'react';
import { Sidebar } from '../../components/admin/sidebar';
import { t } from '../../lib/i18n';
import './admin.css';

export const metadata: Metadata = { title: t('meta.adminTitle') };

// Panel operatora. Logowanie i ochrona tras: iteracja 2 (ADR 0019, ADR 0028).
export default function AdminLayout({ children }: { children: ReactNode }) {
  return (
    <div className="admin">
      <Sidebar />
      {children}
    </div>
  );
}
