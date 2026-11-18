import { router } from 'expo-router';
import { useEffect } from 'react';
import { Pressable, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { t } from '../i18n';
import { useNotifications } from '../lib/notifications';
import { Icon } from './icons';
import { glass } from './sheet';
import { useTheme } from './ui';

/** Czas widoczności banera (makieta baner-powiadomienia: [6] s). */
export const BANNER_MS = 6000;

/** Ikona aplikacji 38 px (kobalt z hulajnogą), jak na ekranie blokady w makiecie powiadomienia-zgoda. */
export function AppIcon({ size = 38 }: { size?: number }) {
  const theme = useTheme();
  return (
    <View
      style={{
        width: size,
        height: size,
        borderRadius: Math.round(size * 0.24),
        backgroundColor: theme.accent,
        alignItems: 'center',
        justifyContent: 'center',
      }}
    >
      <Icon name="scooter" color="#FFFFFF" size={Math.round(size * 0.68)} strokeWidth={2.2} />
    </View>
  );
}

/**
 * Baner powiadomienia w wersji web (ADR 0058, D2; makieta baner-powiadomienia): u góry nad każdym ekranem
 * przez [6] s albo do ✕, kolejne powiadomienie zastępuje poprzednie, dotknięcie otwiera ekran z `path`.
 */
export function NotificationBanner() {
  const theme = useTheme();
  const insets = useSafeAreaInsets();
  const { banner, dismissBanner } = useNotifications();

  useEffect(() => {
    if (!banner) return;
    const timer = setTimeout(dismissBanner, BANNER_MS);
    return () => clearTimeout(timer);
  }, [banner, dismissBanner]);

  if (!banner) return null;
  const path = banner.path;
  return (
    <View
      accessibilityRole="alert"
      style={[
        glass(theme),
        {
          position: 'absolute',
          left: 16,
          right: 16,
          top: insets.top + 20,
          borderRadius: 22,
          flexDirection: 'row',
          alignItems: 'flex-start',
        },
      ]}
    >
      <Pressable
        accessibilityRole="button"
        accessibilityHint={path ? t('notifications.banner.openHint') : undefined}
        disabled={!path}
        onPress={() => {
          dismissBanner();
          if (path) router.push(path as never);
        }}
        style={{ flex: 1, flexDirection: 'row', gap: 12, paddingVertical: 14, paddingLeft: 14 }}
      >
        <AppIcon />
        <View style={{ flex: 1, gap: 2, minWidth: 0 }}>
          <View style={{ flexDirection: 'row', justifyContent: 'space-between', gap: 8 }}>
            {banner.title ? (
              <Text numberOfLines={1} style={{ flexShrink: 1, fontSize: 15, fontWeight: '600', color: theme.ink }}>
                {banner.title}
              </Text>
            ) : (
              <View />
            )}
            <Text style={{ fontSize: 13, color: theme.muted }}>{t('notifications.banner.now')}</Text>
          </View>
          <Text style={{ fontSize: 14, lineHeight: 20, color: theme.ink }}>{banner.body}</Text>
        </View>
      </Pressable>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={t('notifications.banner.close')}
        onPress={dismissBanner}
        hitSlop={6}
        style={{ width: 32, height: 32, margin: 10, marginLeft: 8, alignItems: 'center', justifyContent: 'center' }}
      >
        <Icon name="close" color={theme.muted} size={16} strokeWidth={2.2} />
      </Pressable>
    </View>
  );
}
