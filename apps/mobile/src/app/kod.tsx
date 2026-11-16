import type { CustomerSession, OtpRequestResult } from '@hulajnogi/shared';
import { router, useLocalSearchParams } from 'expo-router';
import { useEffect, useState } from 'react';
import { Text } from 'react-native';
import { Body, Button, CodeInput, ErrorBox, Lead, Screen, Title, TopBar, useTheme } from '../components/ui';
import { t } from '../i18n';
import { api, ApiError, errorMessage, formatPhone } from '../lib/api';
import { homeFor, useSession } from '../lib/session';

const RESEND_SECONDS = 60;

/** Kod SMS (makiety flow-kod i konto-kod-proby): 6 cyfr, odliczanie do ponownego wysłania, limit prób. */
export default function CodeScreen() {
  const { telefon = '', tryb, pozostalo } = useLocalSearchParams<{ telefon?: string; tryb?: string; pozostalo?: string }>();
  const theme = useTheme();
  const { signIn } = useSession();
  const [code, setCode] = useState('');
  const [error, setError] = useState<{ title?: string; message: string; exhausted: boolean } | null>(null);
  const [wait, setWait] = useState(RESEND_SECONDS);
  const [remaining, setRemaining] = useState<number | null>(pozostalo ? Number(pozostalo) : null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (wait <= 0) return;
    const timer = setTimeout(() => setWait((w) => w - 1), 1000);
    return () => clearTimeout(timer);
  }, [wait]);

  async function verify(value: string) {
    setBusy(true);
    setError(null);
    try {
      const session = await api<CustomerSession>('/auth/otp/verify', {
        method: 'POST',
        json: { phone: telefon, code: value, device: null },
      });
      await signIn(session);
      router.replace(homeFor(session.me));
    } catch (e) {
      const code = e instanceof ApiError ? e.code : '';
      const exhausted = code === 'OTP_ATTEMPTS_EXCEEDED' || code === 'OTP_EXPIRED';
      setError({
        title: code === 'OTP_ATTEMPTS_EXCEEDED' ? t('code.exhaustedTitle') : undefined,
        message: errorMessage(e),
        exhausted,
      });
      if (!exhausted) setCode('');
    } finally {
      setBusy(false);
    }
  }

  async function resend() {
    setError(null);
    setCode('');
    try {
      const result = await api<OtpRequestResult>('/auth/otp', { method: 'POST', json: { phone: telefon } });
      setWait(result.resendInSeconds);
      setRemaining(result.remainingCodes);
    } catch (e) {
      setError({ message: errorMessage(e), exhausted: true });
    }
  }

  const change = (value: string) => {
    setCode(value);
    if (error && !error.exhausted) setError(null);
    if (value.length === 6) void verify(value);
  };
  const formatted = formatPhone(telefon);
  const minutes = Math.floor(wait / 60);
  const seconds = String(wait % 60).padStart(2, '0');

  return (
    <Screen
      footer={
        error?.exhausted ? (
          <>
            <Button label={t('code.resend')} onPress={() => void resend()} disabled={wait > 0 || remaining === 0} />
            <Text style={{ textAlign: 'center', fontSize: 13, lineHeight: 19, color: theme.muted }}>
              {wait > 0 ? t('code.wait', { time: `${minutes}:${seconds}` }) : remaining !== null ? t('code.remaining', { count: remaining }) : ''}
            </Text>
          </>
        ) : (
          <Button label={t('code.confirm')} onPress={() => void verify(code)} disabled={code.length !== 6} busy={busy} />
        )
      }
    >
      <TopBar onBack={() => router.back()} step={tryb === 'logowanie' ? undefined : { current: 2, total: 3 }} />
      <Title>{t('code.title')}</Title>
      <Lead>
        {t('code.lead', { phone: formatted })}
        <Text accessibilityRole="link" onPress={() => router.back()} style={{ color: theme.accent, fontWeight: '500' }}>
          {t('code.change')}
        </Text>
      </Lead>
      <CodeInput value={code} onChange={change} invalid={!!error?.exhausted} />
      {error ? (
        <ErrorBox title={error.title} message={error.message} />
      ) : (
        <Body muted style={{ marginTop: 20 }}>
          {wait > 0 ? t('code.wait', { time: `${minutes}:${seconds}` }) : ''}
        </Body>
      )}
      {!error && wait <= 0 && (
        <Text accessibilityRole="button" onPress={() => void resend()} style={{ color: theme.accent, fontWeight: '500', fontSize: 15 }}>
          {t('code.resend')}
        </Text>
      )}
    </Screen>
  );
}
