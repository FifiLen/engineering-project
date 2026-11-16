'use client';

import type { StaffLoginStep, StaffSession } from '@hulajnogi/shared';
import { useRouter, useSearchParams } from 'next/navigation';
import { useState, type FormEvent } from 'react';
import { api, ApiRequestError, applySession, errorMessage } from '../../../lib/api';
import { t } from '../../../lib/i18n';
import { BackIcon } from '../icons';
import { AuthError, AuthShell, AuthSteps, CodeInput, TotpSetupCard } from './auth-parts';

/** Adres powrotu tylko w obrębie panelu (bez przekierowań na inne strony). */
export function safeNext(next: string | null): string {
  return next && next.startsWith('/admin') && !next.startsWith('//') && !next.startsWith('/admin/logowanie') ? next : '/admin';
}

/**
 * Drugi krok logowania: kod z aplikacji albo jej konfiguracja (makiety dostep-logowanie-totp
 * i dostep-totp-konfiguracja). Wspólny dla logowania i aktywacji konta z zaproszenia.
 */
export function TotpStep({ step, onBack }: { step: StaffLoginStep; onBack?: () => void }) {
  const router = useRouter();
  const params = useSearchParams();
  const [code, setCode] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const setup = step.step === 'TOTP_SETUP' && step.totpSetup;

  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const session = await api<StaffSession>('/admin/auth/totp', { method: 'POST', json: { mfaToken: step.mfaToken, code } });
      applySession(session);
      router.replace(safeNext(params.get('next')));
    } catch (err) {
      // Token drugiego kroku wygasa po 5 min: wtedy logowanie od początku.
      if (err instanceof ApiRequestError && err.code === 'UNAUTHENTICATED' && onBack) {
        onBack();
        return;
      }
      setError(errorMessage(err));
      setCode('');
      setBusy(false);
    }
  }

  return (
    <form onSubmit={(e) => void submit(e)} noValidate>
      {setup ? (
        <>
          <AuthSteps current={2} />
          <h1>{t('admin.auth.totpSetupTitle')}</h1>
          <p className="auth-lead">{t('admin.auth.totpSetupLead')}</p>
          <TotpSetupCard setup={setup} email={step.email} />
          <div className="label" style={{ marginTop: 24, marginBottom: 8 }}>
            {t('admin.auth.totpCodeLabel')}
          </div>
        </>
      ) : (
        <>
          {onBack && (
            <button type="button" className="auth-back" onClick={onBack}>
              <BackIcon size={15} />
              {t('admin.auth.otherAccount')}
            </button>
          )}
          <h1>{t('admin.auth.totpTitle')}</h1>
          <p className="auth-lead">{t('admin.auth.totpLead', { email: step.email })}</p>
          <div style={{ marginTop: 28 }} />
        </>
      )}
      <CodeInput value={code} onChange={setCode} invalid={!!error} label={t('admin.auth.totpCodeLabel')} autoFocus />
      <AuthError message={error} />
      <button type="submit" className="auth-cta" disabled={code.length !== 6 || busy}>
        {setup ? t('admin.auth.totpSetupSubmit') : t('admin.auth.confirm')}
      </button>
      <p className="auth-note">{setup ? t('admin.auth.totpSetupNote') : t('admin.auth.totpNote')}</p>
    </form>
  );
}

/** Logowanie operatora: hasło, potem kod TOTP (ADR 0019, ADR 0035). */
export function LoginFlow() {
  const [step, setStep] = useState<StaffLoginStep | null>(null);
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [remember, setRemember] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      setStep(await api<StaffLoginStep>('/admin/auth/login', { method: 'POST', json: { email, password, remember } }));
      setPassword('');
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <AuthShell title={t('admin.auth.sideTitle')} text={t('admin.auth.sideText')} wide={step?.step === 'TOTP_SETUP'}>
      {step ? (
        <TotpStep step={step} onBack={() => setStep(null)} />
      ) : (
        <form onSubmit={(e) => void submit(e)}>
          <h1>{t('admin.auth.loginTitle')}</h1>
          <p className="auth-lead">{t('admin.auth.loginLead')}</p>
          <div className="auth-fields">
            <label className="auth-field">
              <span>{t('admin.auth.email')}</span>
              <input type="email" autoComplete="username" required value={email} onChange={(e) => setEmail(e.target.value)} autoFocus />
            </label>
            <label className="auth-field">
              <span>{t('admin.auth.password')}</span>
              <input
                type="password"
                autoComplete="current-password"
                required
                value={password}
                onChange={(e) => setPassword(e.target.value)}
              />
            </label>
          </div>
          <label className="auth-check">
            <input type="checkbox" checked={remember} onChange={(e) => setRemember(e.target.checked)} />
            {t('admin.auth.remember')}
          </label>
          <AuthError message={error} />
          <button type="submit" className="auth-cta" disabled={busy || !email || !password}>
            {t('admin.auth.loginSubmit')}
          </button>
          <p className="auth-note">{t('admin.auth.loginNote')}</p>
        </form>
      )}
    </AuthShell>
  );
}
