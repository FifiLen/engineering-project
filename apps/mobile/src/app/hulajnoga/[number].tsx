import type { CustomerScooterView, UnavailableReason } from '@hulajnogi/shared';
import { router, useLocalSearchParams } from 'expo-router';
import { useEffect, useState } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Icon, type IconName } from '../../components/icons';
import { metersBetween } from '../../components/map/map-layers';
import { ScooterRender, UnlockSlider } from '../../components/scooter';
import { AlertHeader, FloatingSheet, RoundButton, SheetText, Stats, type BadgeTone } from '../../components/sheet';
import { usePaymentGate } from '../../components/start-payment';
import { Button, ErrorBox, useTheme } from '../../components/ui';
import { t } from '../../i18n';
import { ApiError, api, errorMessage } from '../../lib/api';
import { distance, money, scooterNo, walkMinutes } from '../../lib/format';
import { useLocation } from '../../lib/location';
import { useMapIntent } from '../../lib/map-intent';
import { useRental } from '../../lib/rental';

const REASON_ICON: Record<UnavailableReason, { icon: IconName; tone: BadgeTone }> = {
  LOW_BATTERY: { icon: 'battery', tone: 'danger' },
  RESERVED: { icon: 'clock', tone: 'neutral' },
  IN_USE: { icon: 'lockOpen', tone: 'neutral' },
  OFFLINE: { icon: 'wifiOff', tone: 'neutral' },
  MAINTENANCE: { icon: 'alert', tone: 'warning' },
  RETIRED: { icon: 'alert', tone: 'neutral' },
  // Strefa zakazu albo poza obszarem działania (makieta hulajnoga-niedostepna-strefa).
  OUT_OF_AREA: { icon: 'noEntry', tone: 'danger' },
};

/**
 * Hulajnoga po skanie albo numerze: szczegóły z dzwonkiem i suwakiem odblokowania (makieta
 * produkt-hulajnoga) albo „Tej hulajnogi nie wypożyczysz” z przyczyną (stan-niedostepna,
 * hulajnoga-niedostepna-strefa). „Trasa” wraca na mapę z trasą pieszą (hulajnoga-trasa); „Zgłoś” jest
 * ukryte do iteracji 6 (decyzja D5).
 */
export default function ScooterScreen() {
  const theme = useTheme();
  const { number } = useLocalSearchParams<{ number: string }>();
  const { position } = useLocation();
  const { start } = useRental();
  const { setWalkTo } = useMapIntent();
  const [scooter, setScooter] = useState<CustomerScooterView | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [rung, setRung] = useState(false);
  // Za mało środków, zaległość albo jazda kartą (ADR 0049): arkusze płatności przy starcie.
  const gate = usePaymentGate({
    action: t('cardStart.unlock'),
    perform: async (id, payment) => {
      await start(id, payment);
      router.replace('/przejazd');
    },
  });

  useEffect(() => {
    api<CustomerScooterView>(`/scooters/by-number/${Number(number)}`)
      .then(setScooter)
      .catch((e: unknown) => setError(errorMessage(e)));
  }, [number]);

  const back = () => (router.canGoBack() ? router.back() : router.replace('/mapa'));

  if (!scooter) {
    return (
      <SafeAreaView style={{ flex: 1, backgroundColor: theme.bg, padding: 20 }}>
        <RoundButton label={t('scooter.back')} onPress={back}>
          <Icon name="back" color={theme.ink} />
        </RoundButton>
        {error ? <ErrorBox message={error} /> : <ActivityIndicator style={{ marginTop: 80 }} color={theme.accent} />}
      </SafeAreaView>
    );
  }

  if (!scooter.available && scooter.unavailableReason) {
    const reason = REASON_ICON[scooter.unavailableReason];
    return (
      <View style={{ flex: 1, backgroundColor: theme.camera }}>
        <View style={styles.frameOff} />
        <FloatingSheet>
          <AlertHeader
            icon={reason.icon}
            tone={reason.tone}
            title={t('scooter.unavailable.title')}
            subtitle={
              scooter.batteryPct !== null
                ? t('scooter.unavailable.subtitle', { number: scooterNo(scooter.number), battery: scooter.batteryPct })
                : t('scooter.unavailable.subtitleShort', { number: scooterNo(scooter.number) })
            }
          />
          <SheetText>{t.dynamic(`scooter.unavailable.reasons.${scooter.unavailableReason}`)}</SheetText>
          <View style={{ gap: 10 }}>
            <Button label={t('scooter.unavailable.nearest')} onPress={() => router.dismissTo('/mapa')} />
            <Button
              label={t('scooter.unavailable.scanOther')}
              kind="secondary"
              onPress={() => router.replace('/skan')}
            />
          </View>
        </FloatingSheet>
      </View>
    );
  }

  const away =
    position && scooter.lat !== null && scooter.lon !== null
      ? metersBetween(position, { lat: scooter.lat, lon: scooter.lon })
      : null;

  async function unlock() {
    setBusy(true);
    setError(null);
    try {
      await start(scooter!.id);
      router.replace('/przejazd');
    } catch (e) {
      const target = {
        scooterId: scooter!.id,
        caption:
          scooter!.batteryPct !== null
            ? t('cardStart.caption', { number: scooterNo(scooter!.number), battery: scooter!.batteryPct })
            : t('cardStart.captionShort', { number: scooterNo(scooter!.number) }),
        tariff: scooter!.tariff,
      };
      if (gate.handle(target, e)) return;
      if (e instanceof ApiError && (e.code === 'CONSENT_REQUIRED' || e.code === 'DOCUMENTS_NOT_ACCEPTED'))
        router.push('/zgody');
      else setError(errorMessage(e));
    } finally {
      setBusy(false);
    }
  }

  async function ring() {
    setError(null);
    try {
      await api(`/scooters/${scooter!.id}/ring`, { method: 'POST' });
      setRung(true);
    } catch (e) {
      setError(errorMessage(e));
    }
  }

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: theme.bg }}>
      <View style={{ flex: 1, paddingHorizontal: 20, paddingTop: 20, paddingBottom: 16 }}>
        <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
          <RoundButton label={t('scooter.back')} onPress={back}>
            <Icon name="back" color={theme.ink} strokeWidth={2} />
          </RoundButton>
          <Text style={{ fontSize: 13, fontWeight: '500', color: theme.muted }}>
            {t('number.hash') + scooterNo(scooter.number)}
          </Text>
          <View style={{ width: 44 }} />
        </View>
        <View style={{ alignItems: 'center', marginTop: 28, gap: 6 }}>
          <Text
            accessibilityRole="header"
            style={{ fontSize: 34, fontWeight: '600', letterSpacing: -1, color: theme.ink }}
          >
            {scooter.reservedByMe ? t('scooter.reserved') : t('scooter.ready')}
          </Text>
          {away !== null && (
            <Text style={{ fontSize: 15, color: theme.muted }}>
              {t('scooter.away', { distance: distance(away), minutes: walkMinutes(away) })}
            </Text>
          )}
        </View>
        <ScooterRender
          variant={scooter.variant}
          style={{ height: 280, width: '100%', marginTop: 12 }}
          label={t('variants.render', { variant: t(`variants.${scooter.variant}`) })}
        />
        <View style={{ marginTop: 8 }}>
          <Stats
            size={27}
            items={[
              {
                value:
                  scooter.batteryPct !== null
                    ? t('units.percent', { value: scooter.batteryPct })
                    : t('scooter.noValue'),
                label: t('scooter.battery'),
              },
              {
                value: scooter.rangeKm !== null ? t('units.km', { value: scooter.rangeKm }) : t('scooter.noValue'),
                label: t('scooter.range'),
              },
              { value: money(scooter.tariff.minuteRate), label: t('scooter.price') },
            ]}
          />
        </View>
        <View style={{ flexDirection: 'row', justifyContent: 'center', gap: 36, marginTop: 28 }}>
          <RoundAction
            icon="bell"
            label={rung ? t('scooter.rung') : t('scooter.ring')}
            a11y={t('scooter.ringLabel')}
            onPress={() => void ring()}
          />
          {position && (
            <RoundAction
              icon="pin"
              label={t('scooter.route')}
              a11y={t('scooter.routeLabel')}
              onPress={() => {
                setWalkTo(scooter.id);
                router.dismissTo('/mapa');
              }}
            />
          )}
        </View>
        {error && <ErrorBox message={error} />}
        <View style={{ flex: 1 }} />
        <UnlockSlider label={t('scooter.unlock')} onUnlock={() => void unlock()} disabled={busy} />
      </View>
      {gate.sheets}
    </SafeAreaView>
  );
}

/** Okrągły przycisk 56 px z podpisem pod spodem (Dzwonek, Trasa; makieta produkt-hulajnoga). */
function RoundAction({
  icon,
  label,
  a11y,
  onPress,
}: {
  icon: IconName;
  label: string;
  a11y: string;
  onPress: () => void;
}) {
  const theme = useTheme();
  return (
    <View style={{ alignItems: 'center', gap: 8, maxWidth: 140 }}>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={a11y}
        onPress={onPress}
        style={({ pressed }) => ({
          width: 56,
          height: 56,
          borderRadius: 28,
          backgroundColor: theme.line,
          alignItems: 'center',
          justifyContent: 'center',
          opacity: pressed ? 0.8 : 1,
        })}
      >
        <Icon name={icon} color={theme.ink} size={22} strokeWidth={1.8} />
      </Pressable>
      <Text style={{ fontSize: 12, color: theme.muted, textAlign: 'center' }}>{label}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  frameOff: {
    position: 'absolute',
    width: 254,
    height: 254,
    left: '50%',
    top: '50%',
    marginLeft: -127,
    marginTop: -200,
    borderRadius: 32,
    borderWidth: 1.5,
    borderColor: 'rgba(246,246,243,0.35)',
  },
});
