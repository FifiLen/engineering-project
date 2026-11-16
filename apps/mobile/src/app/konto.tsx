import { Redirect, router } from 'expo-router';
import { View } from 'react-native';
import { Body, Button, Group, Lead, Screen, Title } from '../components/ui';
import { t } from '../i18n';
import { formatPhone } from '../lib/api';
import { homeFor, useSession } from '../lib/session';

/** Ekran po zalogowaniu do iteracji 3, w której powstaje mapa z hulajnogami. */
export default function AccountScreen() {
  const { me, signOut } = useSession();
  if (!me) return <Redirect href="/witaj" />;
  if (me.nextStep === 'BLOCKED' || me.nextStep === 'PROFILE') return <Redirect href={homeFor(me)} />;
  return (
    <Screen footer={<Button label={t('account.signOut')} kind="secondary" onPress={() => void signOut().then(() => router.replace('/witaj'))} />}>
      <Title>{t('account.hello', { name: me.name ?? '' })}</Title>
      <Lead>{t('account.lead')}</Lead>
      <View style={{ marginTop: 28 }}>
        <Group>
          <View style={{ padding: 16, gap: 4 }}>
            <Body>{formatPhone(me.phone)}</Body>
            {me.email ? <Body muted>{me.email}</Body> : null}
          </View>
        </Group>
      </View>
      {me.nextStep === 'CONSENTS' && (
        <View style={{ marginTop: 16 }}>
          <Button label={t('account.pendingConsents')} kind="secondary" onPress={() => router.push('/zgody')} />
        </View>
      )}
    </Screen>
  );
}
