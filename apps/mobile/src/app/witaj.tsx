import { router } from 'expo-router';
import { StyleSheet, Text, View } from 'react-native';
import { Button, Screen, useTheme } from '../components/ui';
import { t } from '../i18n';

/** Ekran startowy (makieta flow-start). Render hulajnogi dojdzie z biblioteki mediów (iteracja 7). */
export default function StartScreen() {
  const theme = useTheme();
  return (
    <Screen
      footer={
        <>
          <Button label={t('start.createAccount')} onPress={() => router.push({ pathname: '/telefon', params: { tryb: 'rejestracja' } })} />
          <Button label={t('start.signIn')} kind="secondary" onPress={() => router.push({ pathname: '/telefon', params: { tryb: 'logowanie' } })} />
        </>
      }
    >
      <Text style={[styles.brand, { color: theme.ink }]}>{t('brand')}</Text>
      <View style={styles.flex} />
      <Text accessibilityRole="header" style={[styles.title, { color: theme.ink }]}>
        {t('start.headline')}
      </Text>
      <Text style={[styles.lead, { color: theme.muted }]}>{t('start.lead')}</Text>
    </Screen>
  );
}

const styles = StyleSheet.create({
  brand: { fontSize: 20, fontWeight: '600', letterSpacing: -0.4, marginTop: 4 },
  flex: { flex: 1, minHeight: 120 },
  title: { fontSize: 38, fontWeight: '600', letterSpacing: -1.3, lineHeight: 41 },
  lead: { fontSize: 16, lineHeight: 24, marginTop: 12, marginBottom: 24 },
});
