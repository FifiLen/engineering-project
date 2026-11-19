import { Redirect, router } from 'expo-router';
import { Linking, Pressable, Text, View } from 'react-native';
import { Badge, Body, Button, Group, Lead, Screen, Title, useTheme } from '../components/ui';
import { t } from '../i18n';
import { mailtoHref, telHref, useCompany } from '../lib/content';
import { useSession } from '../lib/session';

/**
 * Konto zablokowane (makieta konto-zablokowane): powód wybrany przez operatora, bez jego notatki.
 * Kontakt pomocy z danych firmy (ADR 0062); dotknięcie otwiera `mailto:` albo `tel:`.
 */
export default function BlockedScreen() {
  const theme = useTheme();
  const { me, signOut, reload } = useSession();
  const company = useCompany();
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
      {company && (
        <View style={{ marginTop: 28 }}>
          <Group>
            {[
              { value: company.supportEmail, hint: t('blocked.emailHint'), href: mailtoHref(company.supportEmail) },
              { value: company.supportPhone, hint: company.supportHours, href: telHref(company.supportPhone) },
            ].map(({ value, hint, href }, i) => (
              <Pressable
                key={href}
                accessibilityRole="link"
                onPress={() => void Linking.openURL(href).catch(() => undefined)}
                style={({ pressed }) => ({ padding: 16, gap: 2, borderTopWidth: i ? 1 : 0, borderColor: theme.line, opacity: pressed ? 0.7 : 1 })}
              >
                <Body>{value}</Body>
                <Text style={{ fontSize: 13, color: theme.muted }}>{hint}</Text>
              </Pressable>
            ))}
          </Group>
        </View>
      )}
      <Body muted style={{ marginTop: 16 }}>
        {t('blocked.phoneNote', { phone: masked })}
      </Body>
    </Screen>
  );
}
