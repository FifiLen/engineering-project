import type { Metadata } from 'next';
import type { ReactNode } from 'react';
import { t } from '../../lib/i18n';
import './admin.css';
import './analytics.css';
import './lists.css';

export const metadata: Metadata = { title: { absolute: t('meta.adminTitle') } };

/** Panel operatora: ekrany z nawigacją w grupie `(panel)`, logowanie i aktywacja w grupie `(auth)`. */
export default function AdminLayout({ children }: { children: ReactNode }) {
  return children;
}
