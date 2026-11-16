import type { ReactNode } from 'react';
import { Sidebar } from '../../../components/admin/sidebar';
import { t } from '../../../lib/i18n';
import { SessionProvider } from '../../../lib/session';

/** Ekrany panelu wymagają zalogowanego operatora (ADR 0035); bez sesji przekierowanie do logowania. */
export default function PanelLayout({ children }: { children: ReactNode }) {
  return (
    <SessionProvider
      fallback={
        <div className="session-loading" role="status">
          {t('admin.auth.restoring')}
        </div>
      }
    >
      <div className="admin">
        <Sidebar />
        {children}
      </div>
    </SessionProvider>
  );
}
