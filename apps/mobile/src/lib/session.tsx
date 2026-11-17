import type { CustomerSession, MeResponse } from '@hulajnogi/shared';
import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import { api, refreshTokens, storeTokens } from './api';
import { readRefreshToken } from './storage';

type Status = 'loading' | 'signedOut' | 'signedIn';

interface SessionValue {
  status: Status;
  me: MeResponse | null;
  /** Klient zaakceptował regulamin i politykę na ekranie numeru telefonu (rejestracja). */
  termsAccepted: boolean;
  setTermsAccepted(value: boolean): void;
  signIn(session: CustomerSession): Promise<void>;
  setMe(me: MeResponse): void;
  reload(): Promise<MeResponse | null>;
  signOut(): Promise<void>;
}

const SessionContext = createContext<SessionValue | null>(null);

export function useSession(): SessionValue {
  const value = useContext(SessionContext);
  if (!value) throw new Error('useSession poza SessionProvider');
  return value;
}

/** Sesja klienta (ADR 0035): po starcie aplikacja odtwarza ją z tokenu odświeżającego w Secure Store. */
export function SessionProvider({ children }: { children: ReactNode }) {
  const [status, setStatus] = useState<Status>('loading');
  const [me, setMeState] = useState<MeResponse | null>(null);
  const [termsAccepted, setTermsAccepted] = useState(false);

  const reload = useCallback(async () => {
    try {
      const fresh = await api<MeResponse>('/me');
      setMeState(fresh);
      setStatus('signedIn');
      return fresh;
    } catch {
      setMeState(null);
      setStatus('signedOut');
      return null;
    }
  }, []);

  useEffect(() => {
    void refreshTokens().then(async (ok) => {
      if (ok) await reload();
      else setStatus('signedOut');
    });
  }, [reload]);

  const value = useMemo<SessionValue>(
    () => ({
      status,
      me,
      termsAccepted,
      setTermsAccepted,
      signIn: async (session) => {
        await storeTokens(session);
        setMeState(session.me);
        setStatus('signedIn');
      },
      setMe: setMeState,
      reload,
      signOut: async () => {
        const refreshToken = await readRefreshToken();
        if (refreshToken) await api('/auth/logout', { method: 'POST', json: { refreshToken } }).catch(() => undefined);
        await storeTokens(null);
        setMeState(null);
        setTermsAccepted(false);
        setStatus('signedOut');
      },
    }),
    [status, me, termsAccepted, reload],
  );

  return <SessionContext.Provider value={value}>{children}</SessionContext.Provider>;
}

/** Ekran, na który aplikacja kieruje klienta po zalogowaniu albo uruchomieniu (`nextStep` z API). */
export function homeFor(me: MeResponse | null): '/witaj' | '/dane' | '/zgody' | '/zablokowane' | '/mapa' {
  if (!me) return '/witaj';
  switch (me.nextStep) {
    case 'PROFILE':
      return '/dane';
    case 'CONSENTS':
      return '/zgody';
    case 'BLOCKED':
      return '/zablokowane';
    default:
      return '/mapa';
  }
}
