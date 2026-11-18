import type { MeResponse } from '@hulajnogi/shared';
import { router } from 'expo-router';
import { useState } from 'react';
import { Text, View } from 'react-native';
import { Icon } from '../../components/icons';
import { PageScreen } from '../../components/list';
import { Button, ErrorBox, Field, useTheme } from '../../components/ui';
import { t } from '../../i18n';
import { api, errorMessage, formatPhone } from '../../lib/api';
import { useSession } from '../../lib/session';
import { radius } from '../../theme/tokens';

/**
 * Dane osobowe (makieta profil-dane): imię i e-mail przez `PATCH /me`; telefon tylko do odczytu, bo
 * zmienia go nowy kod SMS (zmiana numeru odsyła do pomocy, decyzja na później).
 */
export default function PersonalDataScreen() {
  const theme = useTheme();
  const { me, setMe } = useSession();
  const [name, setName] = useState(me?.name ?? '');
  const [email, setEmail] = useState(me?.email ?? '');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const back = () => (router.canGoBack() ? router.back() : router.replace('/profil/ustawienia'));
  if (!me) return null;

  async function save() {
    setBusy(true);
    setError(null);
    setSaved(false);
    try {
      setMe(await api<MeResponse>('/me', { method: 'PATCH', json: { name: name.trim(), email: email.trim() || null } }));
      setSaved(true);
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy(false);
    }
  }

  const changed = name.trim() !== (me.name ?? '') || (email.trim() || null) !== me.email;
  return (
    <PageScreen
      title={t('personal.title')}
      onBack={back}
      footer={<Button label={t('personal.save')} busy={busy} disabled={!name.trim() || !changed} onPress={() => void save()} />}
    >
      <View style={{ gap: 12 }}>
        <Field label={t('personal.name')} value={name} onChangeText={setName} textContentType="givenName" autoComplete="name" />
        <Field
          label={t('personal.email')}
          value={email}
          onChangeText={setEmail}
          keyboardType="email-address"
          autoCapitalize="none"
          textContentType="emailAddress"
          autoComplete="email"
        />
      </View>
      <View style={{ gap: 12 }}>
        <View
          accessible
          accessibilityLabel={`${t('personal.phone')}: ${formatPhone(me.phone)}`}
          style={{
            height: 60,
            borderRadius: radius.field,
            paddingHorizontal: 16,
            backgroundColor: theme.readonly,
            flexDirection: 'row',
            alignItems: 'center',
          }}
        >
          <View style={{ flex: 1 }}>
            <Text style={{ fontSize: 12, color: theme.muted }}>{t('personal.phone')}</Text>
            <Text style={{ fontSize: 17, fontWeight: '500', color: theme.ink, marginTop: 2 }}>{formatPhone(me.phone)}</Text>
          </View>
          <Icon name="lockClosed" color={theme.muted} />
        </View>
        <Text style={{ fontSize: 14, lineHeight: 20, color: theme.muted, marginHorizontal: 4 }}>
          {t('personal.phoneHint', { email: t('blocked.email') })}
        </Text>
      </View>
      {error && <ErrorBox message={error} />}
      {saved && !changed && <Text style={{ fontSize: 14, color: theme.muted, marginHorizontal: 4 }}>{t('personal.saved')}</Text>}
    </PageScreen>
  );
}
