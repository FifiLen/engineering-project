import type { RentalHistoryItem } from '@hulajnogi/shared';
import { router } from 'expo-router';
import { Fragment, useEffect, useState } from 'react';
import { ActivityIndicator, Pressable, Text, View } from 'react-native';
import Svg, { Circle, Path, Rect } from 'react-native-svg';
import { PageScreen } from '../../components/list';
import { ScooterRender } from '../../components/scooter';
import { Button, ErrorBox, useTheme } from '../../components/ui';
import { t } from '../../i18n';
import { api, errorMessage } from '../../lib/api';
import { dayTime, km, money, monthName } from '../../lib/format';

/**
 * Miniatura przejazdu: fragment mapy z punktem końca. API nie zwraca trasy w historii, więc miniatura
 * nie pokazuje jej kształtu (odstępstwo od makiety profil-historia).
 */
function Thumbnail() {
  const theme = useTheme();
  return (
    <Svg width={56} height={56} viewBox="0 0 56 56" accessibilityLabel={t('history.thumbnail')}>
      <Rect width="56" height="56" rx="14" fill={theme.map} />
      <Path d="M0 20 L56 16 M20 0 L24 56" stroke={theme.surface} strokeWidth="4" />
      <Circle cx="38" cy="34" r="6" fill={theme.ink} stroke={theme.surface} strokeWidth="2.5" />
    </Svg>
  );
}

/** Historia przejazdów pogrupowana według miesięcy (makiety profil-historia, profil-historia-pusta). */
export default function HistoryScreen() {
  const theme = useTheme();
  const [items, setItems] = useState<RentalHistoryItem[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const back = () => (router.canGoBack() ? router.back() : router.replace('/profil'));

  useEffect(() => {
    api<RentalHistoryItem[]>('/rentals?limit=100')
      .then(setItems)
      .catch((e: unknown) => setError(errorMessage(e)));
  }, []);

  if (items && !items.length) {
    return (
      <PageScreen
        title={t('history.title')}
        onBack={back}
        scroll={false}
        footer={<Button label={t('history.empty.find')} onPress={() => router.dismissTo('/mapa')} />}
      >
        <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 4 }}>
          <ScooterRender
            variant="GRAFIT"
            side
            style={{ width: 240, height: 200 }}
            label={t('variants.render', { variant: t('variants.GRAFIT') })}
          />
          <Text accessibilityRole="header" style={{ marginTop: 24, fontSize: 26, fontWeight: '600', letterSpacing: -0.8, textAlign: 'center', color: theme.ink }}>
            {t('history.empty.title')}
          </Text>
          <Text style={{ marginTop: 10, fontSize: 16, lineHeight: 24, textAlign: 'center', color: theme.muted }}>{t('history.empty.lead')}</Text>
        </View>
      </PageScreen>
    );
  }

  let lastMonth = '';
  return (
    <PageScreen title={t('history.title')} onBack={back}>
      {error && <ErrorBox message={error} />}
      {!items && !error && <ActivityIndicator style={{ marginTop: 40 }} color={theme.accent} />}
      <View>
        {items?.map((item) => {
          const at = item.startedAt ?? item.endedAt ?? '';
          const month = at ? monthName(at) : '';
          const header = month !== lastMonth;
          const first = !lastMonth;
          lastMonth = month;
          const minutes = Math.max(1, Math.round((item.rideSeconds + item.pauseSeconds) / 60));
          return (
            <Fragment key={item.id}>
              {header && <Text style={{ fontSize: 14, fontWeight: '600', color: theme.muted, marginTop: first ? 4 : 24 }}>{month}</Text>}
              <Pressable
                accessibilityRole="button"
                onPress={() => router.push({ pathname: '/podsumowanie/[id]', params: { id: item.id, from: 'historia' } })}
                style={({ pressed }) => ({
                  flexDirection: 'row',
                  alignItems: 'center',
                  gap: 14,
                  paddingVertical: 12,
                  borderBottomWidth: 1,
                  borderColor: theme.line,
                  opacity: pressed ? 0.7 : 1,
                })}
              >
                <Thumbnail />
                <View style={{ flex: 1, gap: 2 }}>
                  <Text style={{ fontSize: 16, fontWeight: '500', color: theme.ink }}>{at ? dayTime(at) : ''}</Text>
                  <Text style={{ fontSize: 14, color: theme.muted }}>{t('history.line', { distance: km(item.distanceM), minutes })}</Text>
                </View>
                {item.totalAmount !== null && (
                  <Text style={{ fontSize: 15, fontWeight: '500', color: theme.ink }}>{t('units.amount', { amount: money(item.totalAmount) })}</Text>
                )}
              </Pressable>
            </Fragment>
          );
        })}
      </View>
    </PageScreen>
  );
}
