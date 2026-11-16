import type { OtpRequestResult } from '@hulajnogi/shared';
import { router, useLocalSearchParams } from 'expo-router';
import { useState } from 'react';
import { Pressable, Text, View } from 'react-native';
import { Body, Button, Checkbox, ErrorBox, Field, Lead, Prefix, Screen, Title, TopBar, useTheme } from '../components/ui';
import { t } from '../i18n';
import { api, errorMessage } from '../lib/api';
import { useSession } from '../lib/session';

/**
 * Numer telefonu (makiety flow-telefon i konto-logowanie). Przy rejestracji klient akceptuje regulamin
 * i politykę prywatności; logowanie adresem e-mail nie wchodzi w zakres (ADR 0019).
 */
export default function PhoneScreen() {
  const { tryb } = useLocalSearchParams<{ tryb?: string }>();
  const register = tryb !== 'logowanie';
  const theme = useTheme();
  const { termsAccepted, setTermsAccepted } = useSession();
  const [phone, setPhone] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const digits = phone.replace(/\D/g, '');

  async function send() {
    setBusy(true);
    setError(null);
    try {
      const result = await api<OtpRequestResult>('/auth/otp', { method: 'POST', json: { phone } });
      router.push({
        pathname: '/kod',
        params: { telefon: result.phone, tryb: register ? 'rejestracja' : 'logowanie', pozostalo: String(result.remainingCodes) },
      });
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy(false);
    }
  }

  const link = (slug: string, label: string) => (
    <Text
      accessibilityRole="link"
      onPress={() => router.push({ pathname: '/dokument/[slug]', params: { slug } })}
      style={{ color: theme.accent, fontWeight: '500' }}
    >
      {label}
    </Text>
  );

  return (
    <Screen
      footer={
        <>
          {register && (
            <View style={{ marginBottom: 10 }}>
              <Checkbox checked={termsAccepted} onToggle={() => setTermsAccepted(!termsAccepted)} label={t('phone.acceptLabel')}>
                <Body>
                  {t('phone.acceptPrefix')}
                  {link('regulamin', t('phone.terms'))}
                  {t('phone.and')}
                  {link('polityka-prywatnosci', t('phone.privacy'))}
                  {t('phone.acceptSuffix')}
                </Body>
              </Checkbox>
            </View>
          )}
          <Button label={t('phone.send')} onPress={() => void send()} busy={busy} disabled={digits.length < 9 || (register && !termsAccepted)} />
          {!register && (
            <Pressable accessibilityRole="link" onPress={() => router.replace({ pathname: '/telefon', params: { tryb: 'rejestracja' } })}>
              <Text style={{ textAlign: 'center', fontSize: 15, color: theme.muted, marginTop: 8 }}>
                {t('phone.noAccount')}
                <Text style={{ color: theme.accent, fontWeight: '500' }}>{t('phone.createAccount')}</Text>
              </Text>
            </Pressable>
          )}
        </>
      }
    >
      <TopBar onBack={() => router.back()} step={register ? { current: 1, total: 3 } : undefined} />
      <Title>{register ? t('phone.registerTitle') : t('phone.loginTitle')}</Title>
      <Lead>{register ? t('phone.registerLead') : t('phone.loginLead')}</Lead>
      <View style={{ marginTop: 28 }}>
        <Field
          label={t('phone.label')}
          prefix={<Prefix label={t('phone.prefix')} />}
          value={phone}
          onChangeText={setPhone}
          keyboardType="phone-pad"
          textContentType="telephoneNumber"
          autoComplete="tel"
          autoFocus
          onSubmitEditing={() => digits.length >= 9 && (!register || termsAccepted) && void send()}
        />
      </View>
      {error && <ErrorBox message={error} />}
    </Screen>
  );
}
