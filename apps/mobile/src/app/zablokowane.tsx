import { Redirect, router } from 'expo-router';
import { Text, View } from 'react-native';
import { Badge, Body, Button, Group, Lead, Screen, Title, useTheme } from '../components/ui';
import { t } from '../i18n';
import { useSession } from '../lib/session';

/**
 * Konto zablokowane (makieta konto-zablokowane): powód wybrany przez operatora, bez jego notatki.
 * Dane kontaktowe pomocy przejdą do bloków treści w iteracji 7 (ADR 0027).
 */
export default function BlockedScreen() {
  const theme = useTheme();
  const { me, signOut, reload } = useSession();
  if (!me) return <Redirect href="/witaj" />;
  const reason = me.blockedReason ? t.dynamic(`blocked.reasons.${me.blockedReason}`) : t('blocked.reasonUnknown');
  const masked = me.phone.replace(/^\+48(\d{3})\d{3}(\d{3})$/, '+48 $1 ••• $2');

  return (
    <Screen
      footer={
        <>
          <Button label={t('blocked.check')} onPress={() => void reload().then((m) => m && m.nextStep !== 'BLOCKED' && router.replace('/'))} />
          <Button label={t('blocked.signOut')} kind="secondary" onPress={() => void signOut().then(() => router.replace('/witaj'))} />
        </>
      }
    >
      <Badge tone="danger">
        <Text style={{ fontSize: 26, color: theme.danger, fontWeight: '700' }}>{t('common.alertMark')}</Text>
      </Badge>
      <Title>{t('blocked.title')}</Title>
      <Lead>{t('blocked.lead', { reason })}</Lead>
      <View style={{ marginTop: 28 }}>
        <Group>
          {[
            [t('blocked.email'), t('blocked.emailHint')],
            [t('blocked.phone'), t('blocked.phoneHint')],
          ].map(([value, hint], i) => (
            <View key={value} style={{ padding: 16, gap: 2, borderTopWidth: i ? 1 : 0, borderColor: theme.line }}>
              <Body>{value}</Body>
              <Text style={{ fontSize: 13, color: theme.muted }}>{hint}</Text>
            </View>
          ))}
        </Group>
      </View>
      <Body muted style={{ marginTop: 16 }}>
        {t('blocked.phoneNote', { phone: masked })}
      </Body>
    </Screen>
  );
}
