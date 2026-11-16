'use client';

import type { InvitationView, StaffLoginStep } from '@hulajnogi/shared';
import { useSearchParams } from 'next/navigation';
import { useEffect, useState, type FormEvent } from 'react';
import { api, errorMessage } from '../../../lib/api';
import { formatDateTime, t } from '../../../lib/i18n';
import { CheckIcon, CloseIcon } from '../icons';
import { AuthError, AuthShell, AuthSteps } from './auth-parts';
import { TotpStep } from './login-flow';

/** Minimalna długość hasła z ekranu aktywacji; decyduje API (reguła w packages/core). */
const MIN_PASSWORD_LENGTH = 12;

/** Aktywacja konta z zaproszenia: hasło (krok 1 z 2), potem konfiguracja TOTP (makieta dostep-aktywacja). */
export function Activation() {
  const token = useSearchParams().get('token') ?? '';
  const [invitation, setInvitation] = useState<InvitationView | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [name, setName] = useState('');
  const [password, setPassword] = useState('');
  const [repeat, setRepeat] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [step, setStep] = useState<StaffLoginStep | null>(null);

  useEffect(() => {
    api<InvitationView>(`/admin/auth/invitations/${encodeURIComponent(token)}`)
      .then((inv) => {
        setInvitation(inv);
        setName(inv.name);
      })
      .catch((err: unknown) => setLoadError(errorMessage(err)));
  }, [token]);

  const local = invitation?.email.split('@')[0]?.toLowerCase() ?? '';
  const requirements = [
    { ok: [...password].length >= MIN_PASSWORD_LENGTH, label: t('admin.auth.reqLength', { min: MIN_PASSWORD_LENGTH }) },
    { ok: password.length > 0 && !(local.length >= 4 && password.toLowerCase().includes(local)), label: t('admin.auth.reqEmail') },
    { ok: password.length > 0 && password === repeat, label: t('admin.auth.reqMatch') },
  ];

  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      setStep(
        await api<StaffLoginStep>(`/admin/auth/invitations/${encodeURIComponent(token)}/accept`, {
          method: 'POST',
          json: { name, password },
        }),
      );
    } catch (err) {
      setError(errorMessage(err));
      setBusy(false);
    }
  }

  const sideText = invitation?.invitedByName
    ? t('admin.auth.activationSideInvited', { name: invitation.invitedByName })
    : t('admin.auth.activationSide');

  return (
    <AuthShell title={t('admin.auth.activationSideTitle')} text={sideText} wide={!!step}>
      {step ? (
        <TotpStep step={step} />
      ) : loadError ? (
        <>
          <h1>{t('admin.auth.activationInvalidTitle')}</h1>
          <p className="auth-lead">{loadError}</p>
        </>
      ) : invitation ? (
        <form onSubmit={(e) => void submit(e)}>
          <AuthSteps current={1} />
          <h1>{t('admin.auth.activationTitle')}</h1>
          <p className="auth-lead">{t('admin.auth.activationLead', { expiresAt: formatDateTime(invitation.expiresAt) })}</p>
          <div className="auth-fields">
            <div className="auth-field readonly">
              <span>{t('admin.auth.email')}</span>
              <input value={invitation.email} readOnly aria-readonly="true" />
            </div>
            <label className="auth-field">
              <span>{t('admin.auth.name')}</span>
              <input autoComplete="name" value={name} onChange={(e) => setName(e.target.value)} />
            </label>
            <label className="auth-field">
              <span>{t('admin.auth.newPassword')}</span>
              <input type="password" autoComplete="new-password" value={password} onChange={(e) => setPassword(e.target.value)} autoFocus />
            </label>
            <label className="auth-field">
              <span>{t('admin.auth.repeatPassword')}</span>
              <input type="password" autoComplete="new-password" value={repeat} onChange={(e) => setRepeat(e.target.value)} />
            </label>
          </div>
          <ul className="auth-reqs" aria-live="polite" style={{ listStyle: 'none', padding: 0, margin: '16px 0 0' }}>
            {requirements.map((r) => (
              <li key={r.label} className={r.ok ? 'ok' : ''}>
                <span className="dot">{r.ok ? <CheckIcon size={12} strokeWidth={3} /> : <CloseIcon size={12} />}</span>
                {r.label}
              </li>
            ))}
          </ul>
          <AuthError message={error} />
          <button type="submit" className="auth-cta" disabled={busy || name.trim().length < 2 || !requirements.every((r) => r.ok)}>
            {t('admin.auth.activationSubmit')}
          </button>
        </form>
      ) : (
        <p className="auth-lead" role="status">
          {t('admin.auth.loading')}
        </p>
      )}
    </AuthShell>
  );
}
