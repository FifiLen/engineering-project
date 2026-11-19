import { Redirect, router } from 'expo-router';
import { ActivityIndicator, Text, View } from 'react-native';
import { CONTENT_ICON_NAMES, Icon } from '../components/icons';
import { InlineMarkdown } from '../components/markdown';
import { ContentUnavailable } from '../components/offline';
import { RoundButton } from '../components/sheet';
import { Button, Lead, Screen, useTheme } from '../components/ui';
import { t } from '../i18n';
import { useContent } from '../lib/content';

/**
 * Zasady przed pierwszą jazdą (makieta konto-zasady, plansza panelu tresci-sekcja-lista): sekcja-lista
 * `mobile.rules` z ikonami z zamkniętej listy (ADR 0062). API podaje tylko opublikowane elementy; dokument
 * `zasady-jazdy` zostaje pełną treścią na stronie. Sekcja w szkicu albo archiwum: aplikacja przechodzi do mapy.
 */
export default function RulesScreen() {
  const theme = useTheme();
  const { status, content, failure, refresh } = useContent();
  const rules = content?.sections['mobile.rules'] ?? null;
  const done = () => router.replace('/mapa');

  if (status === 'unavailable') return <ContentUnavailable failure={failure} onRetry={() => void refresh()} />;
  if (status === 'ready' && !rules) return <Redirect href="/mapa" />;

  return (
    <Screen footer={<Button label={t('rules.understood')} onPress={done} />}>
      <View style={{ flexDirection: 'row' }}>
        <RoundButton label={t('common.close')} onPress={done}>
          <Icon name="close" color={theme.ink} />
        </RoundButton>
      </View>
      {!rules ? (
        <ActivityIndicator style={{ marginTop: 40 }} color={theme.accent} />
      ) : (
        <>
          {rules.title ? (
            <Text
              accessibilityRole="header"
              style={{
                marginTop: 28,
                fontSize: 32,
                fontWeight: '600',
                letterSpacing: -1,
                lineHeight: 36,
                color: theme.ink,
              }}
            >
              {rules.title}
            </Text>
          ) : null}
          {rules.bodyMd ? (
            <Lead>
              <InlineMarkdown source={rules.bodyMd} style={{ fontSize: 16, lineHeight: 24, color: theme.muted }} />
            </Lead>
          ) : null}
          <View style={{ gap: 24, marginTop: 32 }}>
            {rules.items.map((item) => (
              <View key={item.id} style={{ flexDirection: 'row', gap: 16, alignItems: 'flex-start' }}>
                <View
                  style={{
                    width: 48,
                    height: 48,
                    borderRadius: 24,
                    backgroundColor: theme.line,
                    alignItems: 'center',
                    justifyContent: 'center',
                  }}
                >
                  {item.icon ? (
                    <Icon name={CONTENT_ICON_NAMES[item.icon]} color={theme.ink} size={21} strokeWidth={2} />
                  ) : null}
                </View>
                <View style={{ flex: 1, gap: 4, paddingTop: 2 }}>
                  {item.title ? (
                    <Text style={{ fontSize: 17, fontWeight: '600', color: theme.ink }}>{item.title}</Text>
                  ) : null}
                  {item.bodyMd ? (
                    <InlineMarkdown source={item.bodyMd} style={{ fontSize: 15, lineHeight: 22, color: theme.muted }} />
                  ) : null}
                </View>
              </View>
            ))}
          </View>
        </>
      )}
    </Screen>
  );
}
