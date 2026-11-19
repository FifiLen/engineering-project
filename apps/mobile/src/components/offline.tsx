import { Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { t } from '../i18n';
import { Icon } from './icons';
import { Button, useTheme } from './ui';

/**
 * Brak internetu (makieta stan-offline): mapa bez sieci i ekrany z treściami z bazy, gdy pamięć telefonu jest pusta
 * (pierwsze uruchomienie bez sieci, ADR 0062). Przy błędzie serwera ten sam układ z innym tytułem.
 */
export function OfflineState({
  onRetry,
  title = t('map.offline.title'),
  lead,
  icon = 'wifiOff',
}: {
  onRetry: () => void;
  title?: string;
  lead: string;
  icon?: 'wifiOff' | 'cloudAlert';
}) {
  const theme = useTheme();
  const insets = useSafeAreaInsets();
  return (
    <View
      style={{
        flex: 1,
        backgroundColor: theme.bg,
        paddingHorizontal: 24,
        paddingTop: insets.top + 20,
        paddingBottom: insets.bottom + 16,
      }}
    >
      <View style={{ flex: 1 }} />
      <View style={{ alignItems: 'center' }}>
        <View
          style={{
            width: 72,
            height: 72,
            borderRadius: 36,
            backgroundColor: theme.line,
            alignItems: 'center',
            justifyContent: 'center',
          }}
        >
          <Icon name={icon} color={theme.ink} size={32} strokeWidth={2} />
        </View>
        <Text
          accessibilityRole="header"
          style={{
            marginTop: 24,
            fontSize: 26,
            fontWeight: '600',
            letterSpacing: -0.8,
            color: theme.ink,
            textAlign: 'center',
          }}
        >
          {title}
        </Text>
        <Text style={{ marginTop: 10, fontSize: 16, lineHeight: 24, color: theme.muted, textAlign: 'center' }}>
          {lead}
        </Text>
      </View>
      <View style={{ flex: 1 }} />
      <Button label={t('map.offline.retry')} kind="dark" onPress={onRetry} />
    </View>
  );
}

/** Treści aplikacji niedostępne: bez sieci albo przy błędzie serwera (pamięć telefonu pusta). */
export function ContentUnavailable({
  failure,
  onRetry,
}: {
  failure: 'network' | 'server' | null;
  onRetry: () => void;
}) {
  return failure === 'server' ? (
    <OfflineState
      icon="cloudAlert"
      title={t('content.serverError.title')}
      lead={t('content.serverError.lead')}
      onRetry={onRetry}
    />
  ) : (
    <OfflineState lead={t('content.offline.lead')} onRetry={onRetry} />
  );
}
