import type { RentalView } from '@hulajnogi/shared';
import { router, useLocalSearchParams } from 'expo-router';
import { useEffect, useState } from 'react';
import { ActivityIndicator, ScrollView, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Icon } from '../../components/icons';
import { boundsOf, type LngLat, type MapFocus } from '../../components/map/map-layers';
import { MapView } from '../../components/map/map-view';
import { Stats } from '../../components/sheet';
import { Button, ErrorBox, useTheme } from '../../components/ui';
import { t } from '../../i18n';
import { api, errorMessage } from '../../lib/api';
import { clock, dayTime, km, money } from '../../lib/format';
import { useRental } from '../../lib/rental';

/**
 * Podsumowanie przejazdu bez obciążenia portfela (makieta podsumowanie-bez-platnosci, decyzja D1,
 * ADR 0042): kwota według cennika z chwili startu, pozycje wyceny z API i adnotacja o rozliczeniu
 * w kolejnej wersji. Ten sam ekran otwiera historia przejazdów.
 */
export default function SummaryScreen() {
  const theme = useTheme();
  const insets = useSafeAreaInsets();
  const { id, from } = useLocalSearchParams<{ id: string; from?: string }>();
  const { outcome, clearOutcome } = useRental();
  const fromOutcome = outcome?.view.id === id ? outcome.view : null;
  const [view, setView] = useState<RentalView | null>(fromOutcome);
  const [error, setError] = useState<string | null>(null);

  // Widok ze zdarzenia może nie mieć jeszcze trasy i dystansu z zakończenia: zawsze pobieramy szczegóły.
  useEffect(() => {
    api<RentalView>(`/rentals/${id}`)
      .then(setView)
      .catch((e: unknown) => setError(errorMessage(e)));
  }, [id]);

  const done = () => {
    clearOutcome();
    if (from === 'historia' && router.canGoBack()) router.back();
    else router.dismissTo('/mapa');
  };

  if (!view) {
    return (
      <View style={{ flex: 1, backgroundColor: theme.bg, padding: 24, paddingTop: insets.top + 24 }}>
        {error ? <ErrorBox message={error} /> : <ActivityIndicator style={{ marginTop: 80 }} color={theme.accent} />}
      </View>
    );
  }

  const end: LngLat | null = view.scooter.lat !== null && view.scooter.lon !== null ? [view.scooter.lon, view.scooter.lat] : null;
  // Trasa z telemetrii przejazdu (`route` w widoku), także po otwarciu z historii.
  const route = view.route;
  const bounds = route.length ? boundsOf(route) : null;
  const focus: MapFocus | null = bounds ? { key: 'route', bounds } : end ? { key: 'end', center: end, zoom: 15 } : null;
  const totalSeconds = view.rideSeconds + view.pauseSeconds;
  const avgKmh = view.rideSeconds > 0 ? Math.round(view.distanceM / 1000 / (view.rideSeconds / 3600)) : 0;
  const finishedAt = view.endedAt ?? view.billedUntil ?? view.asOf;
  const subtitle = view.endZone
    ? t('summary.subtitle', { date: dayTime(finishedAt), zone: `${view.endZone.code} ${view.endZone.name}` })
    : dayTime(finishedAt);
  const remote = view.notice === 'ENDED_REMOTELY';

  const line = (label: string, value: string, strong?: boolean) => (
    <View key={label} style={{ flexDirection: 'row', justifyContent: 'space-between', paddingVertical: 12, borderTopWidth: 1, borderColor: theme.line }}>
      <Text style={{ fontSize: 15, color: strong ? theme.ink : theme.muted, fontWeight: strong ? '600' : '400' }}>{label}</Text>
      <Text style={{ fontSize: 15, color: theme.ink, fontWeight: strong ? '600' : '500' }}>{value}</Text>
    </View>
  );

  return (
    <View style={{ flex: 1, backgroundColor: theme.map }}>
      <View style={{ height: 300 }} accessibilityLabel={t('summary.map')}>
        {focus && (
          <MapView
            focus={focus}
            route={route}
            parked={end ? { lon: end[0], lat: end[1] } : null}
            padding={{ top: insets.top + 24, bottom: 64, left: 40, right: 40 }}
          />
        )}
      </View>
      <View style={{ flex: 1, marginTop: -44, backgroundColor: theme.scheme === 'dark' ? theme.surface : theme.bg, borderTopLeftRadius: 32, borderTopRightRadius: 32 }}>
        <ScrollView contentContainerStyle={{ padding: 24, paddingBottom: 16 }}>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 14 }}>
            <View style={{ width: 44, height: 44, borderRadius: 22, backgroundColor: theme.accent, alignItems: 'center', justifyContent: 'center' }}>
              <Icon name="check" color="#FFFFFF" size={22} strokeWidth={2.6} />
            </View>
            <View style={{ flex: 1, gap: 2 }}>
              <Text accessibilityRole="header" style={{ fontSize: 22, fontWeight: '600', letterSpacing: -0.4, color: theme.ink }}>
                {t('summary.title')}
              </Text>
              <Text style={{ fontSize: 14, color: theme.muted }}>{subtitle}</Text>
            </View>
          </View>
          <Text style={{ marginTop: 20, fontSize: 46, fontWeight: '500', letterSpacing: -1.6, lineHeight: 48, color: theme.ink }}>
            {t('units.amount', { amount: money(view.price.total) })}
          </Text>
          <View style={{ marginTop: 20 }}>
            <Stats
              size={18}
              align="left"
              items={[
                { value: clock(totalSeconds), label: t('summary.time') },
                { value: km(view.distanceM), label: t('summary.distance') },
                { value: t('units.kmh', { value: avgKmh }), label: t('summary.avg') },
              ]}
            />
          </View>
          <View style={{ marginTop: 20, borderBottomWidth: 1, borderColor: theme.line }}>
            {line(t('summary.unlock'), t('units.amount', { amount: money(view.price.unlockFee) }))}
            {line(t('summary.ride', { minutes: view.price.rideMinutes }), t('units.amount', { amount: money(view.price.rideAmount) }))}
            {view.price.pauseMinutes > 0 &&
              line(t('summary.pause', { minutes: view.price.pauseMinutes }), t('units.amount', { amount: money(view.price.pauseAmount) }))}
            {line(t('summary.total'), t('units.amount', { amount: money(view.price.total) }), true)}
          </View>
          <View style={{ marginTop: 16, flexDirection: 'row', gap: 12, alignItems: 'flex-start' }}>
            <Icon name="info" color={theme.muted} size={18} />
            <Text style={{ flex: 1, fontSize: 14, lineHeight: 20, color: theme.muted }}>
              {remote ? `${t('summary.remote')} ${t('summary.note')}` : t('summary.note')}
            </Text>
          </View>
        </ScrollView>
        <View style={{ paddingHorizontal: 24, paddingBottom: 16 + insets.bottom }}>
          <Button label={t('summary.done')} kind="dark" onPress={done} />
        </View>
      </View>
    </View>
  );
}
