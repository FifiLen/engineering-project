import { Redirect } from 'expo-router';
import { useEffect, useState } from 'react';
import { Platform, ScrollView, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Icon, type IconName } from '../components/icons';
import { AppIcon } from '../components/notification-banner';
import { Button, useTheme } from '../components/ui';
import { t } from '../i18n';
import { timeOnly } from '../lib/format';
import { useNotifications } from '../lib/notifications';

/** Zdarzenia z zakresu iteracji 6 (makieta powiadomienia-zgoda), bez długiej pauzy i licznika z planszy 10. */
const EVENTS: { icon: IconName; key: string }[] = [
  { icon: 'clock', key: 'reservationEnd' },
  { icon: 'receipt', key: 'rideEnded' },
  { icon: 'batteryLow', key: 'batteryLow' },
  { icon: 'payment', key: 'paymentFailed' },
  { icon: 'message', key: 'ticketReply' },
];

/**
 * Prośba o powiadomienia przed systemowym oknem (makieta powiadomienia-zgoda, ADR 0058): raz, przy pierwszej
 * rezerwacji albo pierwszym starcie. Po zgodzie aplikacja rejestruje token, po odmowie i po „Nie teraz” wraca
 * do przerwanej akcji bez komunikatu. Wersja web tej planszy nie ma (baner w aplikacji, D2).
 */
export default function NotificationsAskScreen() {
  const theme = useTheme();
  const { enable, finishAsk, releaseAsk } = useNotifications();
  const [busy, setBusy] = useState(false);
  const [now] = useState(() => Date.now());
  useEffect(() => releaseAsk, [releaseAsk]);
  if (Platform.OS === 'web') return <Redirect href="/mapa" />;

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: theme.bg }}>
      <ScrollView contentContainerStyle={{ flexGrow: 1, paddingHorizontal: 24, paddingTop: 20, paddingBottom: 16 }}>
        <View
          accessible
          accessibilityLabel={t('notifications.ask.previewLabel')}
          style={{
            height: 300,
            borderRadius: 28,
            backgroundColor: '#2A2D33',
            padding: 14,
            gap: 10,
            justifyContent: 'flex-end',
            overflow: 'hidden',
          }}
        >
          <Text
            style={{
              position: 'absolute',
              left: 0,
              right: 0,
              top: 20,
              textAlign: 'center',
              color: '#F6F6F3',
              fontSize: 44,
              fontWeight: '500',
              letterSpacing: -1.5,
              lineHeight: 46,
            }}
          >
            {timeOnly(new Date(now).toISOString())}
          </Text>
          <LockNotification
            time={t('notifications.banner.now')}
            title={t('notifications.ask.preview.reservationTitle')}
            body={t('notifications.ask.preview.reservationBody')}
          />
          <LockNotification
            time={timeOnly(new Date(now + 2 * 60000).toISOString())}
            title={t('notifications.ask.preview.rideTitle')}
            body={t('notifications.ask.preview.rideBody')}
          />
        </View>
        <Text
          accessibilityRole="header"
          style={{
            marginTop: 24,
            fontSize: 30,
            fontWeight: '600',
            letterSpacing: -0.9,
            lineHeight: 34,
            color: theme.ink,
          }}
        >
          {t('notifications.ask.title')}
        </Text>
        <Text style={{ marginTop: 10, fontSize: 16, lineHeight: 24, color: theme.muted }}>
          {t('notifications.ask.lead')}
        </Text>
        <View style={{ gap: 4, marginTop: 14 }}>
          {EVENTS.map((e) => (
            <View key={e.key} style={{ flexDirection: 'row', alignItems: 'center', gap: 14, minHeight: 36 }}>
              <Icon name={e.icon} color={theme.ink} />
              <Text style={{ fontSize: 16, color: theme.ink }}>{t.dynamic(`notifications.ask.events.${e.key}`)}</Text>
            </View>
          ))}
        </View>
      </ScrollView>
      <View style={{ paddingHorizontal: 24, paddingBottom: 16, gap: 4 }}>
        <Button
          label={t('notifications.ask.enable')}
          busy={busy}
          onPress={() => {
            setBusy(true);
            void enable().finally(() => {
              setBusy(false);
              finishAsk();
            });
          }}
        />
        <Button label={t('notifications.ask.later')} kind="plain" onPress={finishAsk} />
      </View>
    </SafeAreaView>
  );
}

/** Powiadomienie na podglądzie ekranu blokady. */
function LockNotification({ time, title, body }: { time: string; title: string; body: string }) {
  return (
    <View
      style={{
        borderRadius: 20,
        backgroundColor: 'rgba(246,246,243,0.92)',
        paddingVertical: 12,
        paddingHorizontal: 14,
        flexDirection: 'row',
        gap: 12,
        alignItems: 'flex-start',
      }}
    >
      <AppIcon size={36} />
      <View style={{ flex: 1, gap: 1, minWidth: 0 }}>
        <View style={{ flexDirection: 'row', justifyContent: 'space-between', gap: 8 }}>
          <Text style={{ fontSize: 12, color: '#6B6E75' }}>{t('brand')}</Text>
          <Text style={{ fontSize: 12, color: '#6B6E75' }}>{time}</Text>
        </View>
        <Text style={{ fontSize: 14, fontWeight: '600', color: '#16181D' }}>{title}</Text>
        <Text style={{ fontSize: 14, lineHeight: 19, color: '#16181D' }}>{body}</Text>
      </View>
    </View>
  );
}
