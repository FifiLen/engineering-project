'use client';

import type { TotpSetup as TotpSetupData } from '@hulajnogi/shared';
import QRCode from 'qrcode';
import { useEffect, useState, type ReactNode } from 'react';
import { t } from '../../../lib/i18n';
import { AlertIcon, BrandMark, CopyIcon } from '../icons';

/** Ekran logowania: niebieska kolumna z hasłem marki i formularz (13-panel/admin-logowanie). */
export function AuthShell({ title, text, wide, children }: { title: string; text: string; wide?: boolean; children: ReactNode }) {
  return (
    <div className="auth">
      <aside className="auth-side">
        <div className="auth-brand">
          <span className="mark">
            <BrandMark size={32} color="currentColor" />
          </span>
          {t('admin.brand')}
        </div>
        <h2>{title}</h2>
        <p>{text}</p>
      </aside>
      <main className="auth-main">
        <div className={`auth-box${wide ? ' wide' : ''}`}>{children}</div>
      </main>
    </div>
  );
}

export function AuthSteps({ current }: { current: 1 | 2 }) {
  return (
    <div className="auth-steps" role="img" aria-label={t('admin.auth.step', { current, total: 2 })}>
      <i className="on" />
      <i className={current === 2 ? 'on' : ''} />
    </div>
  );
}

export function AuthError({ message }: { message: string | null }) {
  if (!message) return null;
  return (
    <div className="auth-error" role="alert">
      <AlertIcon size={15} />
      {message}
    </div>
  );
}

/**
 * Pole kodu z 6 komórek (design system): jedno prawdziwe pole tekstowe z `one-time-code` pod spodem,
 * komórki tylko je pokazują, więc działa wklejanie, autouzupełnianie i czytniki ekranu.
 */
export function CodeInput({
  value,
  onChange,
  invalid,
  label,
  autoFocus,
}: {
  value: string;
  onChange: (value: string) => void;
  invalid?: boolean;
  label: string;
  autoFocus?: boolean;
}) {
  const [focused, setFocused] = useState(false);
  return (
    <div className="code-input">
      {Array.from({ length: 6 }, (_, i) => (
        <div
          key={i}
          aria-hidden="true"
          className={`code-cell${invalid && value.length === 6 ? ' bad' : ''}${focused && i === value.length ? ' focus' : ''}`}
        >
          {value[i] ?? (focused && i === value.length ? <span className="caret" /> : null)}
        </div>
      ))}
      <input
        aria-label={label}
        aria-invalid={invalid || undefined}
        inputMode="numeric"
        autoComplete="one-time-code"
        pattern="[0-9]*"
        maxLength={6}
        autoFocus={autoFocus}
        value={value}
        onFocus={() => setFocused(true)}
        onBlur={() => setFocused(false)}
        onChange={(e) => onChange(e.target.value.replace(/\D/g, '').slice(0, 6))}
      />
    </div>
  );
}

/** Kod QR i klucz do przepisania (makieta dostep-totp-konfiguracja). */
export function TotpSetupCard({ setup, email }: { setup: TotpSetupData; email: string }) {
  const [qr, setQr] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  useEffect(() => {
    void QRCode.toString(setup.otpauthUrl, { type: 'svg', margin: 0, errorCorrectionLevel: 'M' }).then((svg) =>
      setQr(`data:image/svg+xml;utf8,${encodeURIComponent(svg)}`),
    );
  }, [setup.otpauthUrl]);
  const grouped = setup.secret.match(/.{1,4}/g)?.join(' ') ?? setup.secret;
  return (
    <div className="totp-card">
      {qr && <img src={qr} alt={t('admin.auth.totpQrAlt')} />}
      <div className="stack" style={{ gap: 10, minWidth: 0 }}>
        <span className="label">{t('admin.auth.totpManualTitle')}</span>
        <span className="hint" style={{ fontSize: 13 }}>
          {t('admin.auth.totpManualText')}
        </span>
        <span className="totp-key">
          {grouped}
          <button
            type="button"
            className="icon-btn"
            style={{ border: 'none', width: 32, height: 32 }}
            aria-label={copied ? t('admin.auth.copied') : t('admin.auth.copyKey')}
            title={copied ? t('admin.auth.copied') : t('admin.auth.copyKey')}
            onClick={() => void navigator.clipboard.writeText(setup.secret).then(() => setCopied(true))}
          >
            <CopyIcon size={16} />
          </button>
        </span>
        <span className="hint">{t('admin.auth.totpAccount', { email })}</span>
      </div>
    </div>
  );
}
