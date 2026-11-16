'use client';

import type { StaffMe } from '@hulajnogi/shared';
import { useRouter } from 'next/navigation';
import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import { api, applySession, getAccessToken, onSessionChange, refreshSession } from './api';

/** Odświeżenie przed wygaśnięciem tokenu dostępowego (15 min), z zapasem na wolną sieć. */
const REFRESH_BEFORE_EXPIRY_MS = 60_000;

interface SessionValue {
  staff: StaffMe;
  /** Czy operator ma uprawnienie; panel ukrywa niedostępne elementy, ale decyduje API (ADR 0028). */
  can(permission: string | undefined): boolean;
  logout(): Promise<void>;
}

const SessionContext = createContext<SessionValue | null>(null);

export function useSession(): SessionValue {
  const value = useContext(SessionContext);
  if (!value) throw new Error('useSession poza SessionProvider');
  return value;
}

export function loginPath(next?: string): string {
  return next && next !== '/admin' ? `/admin/logowanie?next=${encodeURIComponent(next)}` : '/admin/logowanie';
}

/**
 * Sesja operatora w panelu (ADR 0035). Po wejściu na stronę panel odtwarza sesję z ciasteczka; bez niej
 * przekierowuje do logowania z adresem powrotu. Treść panelu renderuje się dopiero z sesją.
 */
export function SessionProvider({ children, fallback }: { children: ReactNode; fallback: ReactNode }) {
  const router = useRouter();
  const [state, setState] = useState<{ staff: StaffMe; expiresAt: number } | null>(null);

  useEffect(() => {
    const unsubscribe = onSessionChange((session) => {
      if (session) setState({ staff: session.staff, expiresAt: Date.now() + session.expiresInSeconds * 1000 });
      else router.replace(loginPath(window.location.pathname + window.location.search));
    });
    // Token z logowania jest już w pamięci; po przeładowaniu strony odtwarzamy go z ciasteczka.
    if (getAccessToken()) {
      void api<StaffMe>('/admin/auth/me')
        .then((staff) => setState({ staff, expiresAt: Date.now() + 14 * 60_000 }))
        .catch(() => void refreshSession());
    } else {
      void refreshSession();
    }
    return unsubscribe;
  }, [router]);

  useEffect(() => {
    if (!state) return;
    const timer = setTimeout(() => void refreshSession(), Math.max(5_000, state.expiresAt - Date.now() - REFRESH_BEFORE_EXPIRY_MS));
    return () => clearTimeout(timer);
  }, [state]);

  const logout = useCallback(async () => {
    await api('/admin/auth/logout', { method: 'POST' }).catch(() => undefined);
    applySession(null);
  }, []);

  const value = useMemo<SessionValue | null>(() => {
    if (!state) return null;
    const granted = new Set(state.staff.permissions);
    return { staff: state.staff, can: (p) => p === undefined || granted.has(p), logout };
  }, [state, logout]);

  if (!value) return <>{fallback}</>;
  return (
    <SessionContext.Provider value={value}>{children}</SessionContext.Provider>
  );
}
