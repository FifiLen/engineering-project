import { Image } from 'expo-image';
import { router } from 'expo-router';
import { ActivityIndicator, StyleSheet, Text, useWindowDimensions, View } from 'react-native';
import { InlineMarkdown } from '../components/markdown';
import { ContentUnavailable } from '../components/offline';
import { Button, Screen, useTheme } from '../components/ui';
import { t } from '../i18n';
import { mediaUrl, useContent } from '../lib/content';

/**
 * Ekran startowy (makieta flow-start): render, hasło i wstęp z sekcji `mobile.start` (ADR 0062), grafika
 * z biblioteki mediów (ADR 0064). Bez treści w pamięci i bez sieci ekran „Brak internetu”, bo bez sieci i tak nie
 * da się zalogować (rozstrzygnięcie ADR 0062).
 */
export default function StartScreen() {
  const theme = useTheme();
  const { status, content, failure, refresh } = useContent();
  const { height } = useWindowDimensions();
  const start = content?.sections['mobile.start'] ?? null;

  if (status === 'unavailable') return <ContentUnavailable failure={failure} onRetry={() => void refresh()} />;

  return (
    <Screen
      footer={
        <>
          <Button
            label={t('start.createAccount')}
            onPress={() => router.push({ pathname: '/telefon', params: { tryb: 'rejestracja' } })}
          />
          <Button
            label={t('start.signIn')}
            kind="secondary"
            onPress={() => router.push({ pathname: '/telefon', params: { tryb: 'logowanie' } })}
          />
        </>
      }
    >
      <Text style={[styles.brand, { color: theme.ink }]}>{t('brand')}</Text>
      {status === 'loading' ? (
        <View style={[styles.flex, styles.center]}>
          <ActivityIndicator color={theme.accent} />
        </View>
      ) : (
        <>
          {start?.media ? (
            <Image
              source={{ uri: mediaUrl(start.media) }}
              accessibilityLabel={start.media.altText}
              accessible
              contentFit="contain"
              cachePolicy="memory-disk"
              style={[styles.render, { height: Math.min(390, Math.round(height * 0.45)) }]}
            />
          ) : (
            <View style={styles.flex} />
          )}
          {start?.title ? (
            <Text accessibilityRole="header" style={[styles.title, { color: theme.ink }]}>
              {start.title}
            </Text>
          ) : null}
          {start?.bodyMd ? (
            <InlineMarkdown source={start.bodyMd} style={{ ...styles.lead, color: theme.muted }} />
          ) : null}
        </>
      )}
    </Screen>
  );
}

const styles = StyleSheet.create({
  brand: { fontSize: 20, fontWeight: '600', letterSpacing: -0.4, marginTop: 4 },
  flex: { flex: 1, minHeight: 120 },
  center: { alignItems: 'center', justifyContent: 'center' },
  render: { width: '100%', marginTop: 17 },
  title: { fontSize: 38, fontWeight: '600', letterSpacing: -1.3, lineHeight: 41, marginTop: 21 },
  lead: { fontSize: 16, lineHeight: 24, marginTop: 12, marginBottom: 24 },
});
