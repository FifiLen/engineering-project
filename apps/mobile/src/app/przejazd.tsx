import type { RentalView } from '@hulajnogi/shared';
import { Redirect, router } from 'expo-router';
import { useEffect, useState, type ReactNode } from 'react';
import { ActivityIndicator, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Icon } from '../components/icons';
import { boundsOf, type LngLat, type MapFocus, type MapPoint, type ZoneCollection } from '../components/map/map-layers';
import { MapView } from '../components/map/map-view';
import { FootNote, WaitScreen } from '../components/scooter';
import { AlertHeader, ButtonRow, FloatingSheet, IconBadge, Pill, RoundButton, SheetText, Stats, Steps, glass } from '../components/sheet';
import { Button, useTheme } from '../components/ui';
import { t } from '../i18n';
import { ApiError, api, errorMessage } from '../lib/api';
import { clock, distance, km, money, scooterNo } from '../lib/format';
import { useLocation } from '../lib/location';
import { usePreferences } from '../lib/preferences';
import { liveCounters, liveTotal, useNow, useRental, type TrackedRental } from '../lib/rental';

interface NearestParking {
  code: string;
  name: string;
  distanceM: number;
  lat: number;
  lon: number;
}

const scooterPoint = (v: RentalView): MapPoint | null =>
  v.scooter.lat !== null && v.scooter.lon !== null ? { lat: v.scooter.lat, lon: v.scooter.lon } : null;

/**
 * Przejazd przejmuje aplikację (ADR 0036): odblokowywanie, jazda, pauza i oczekiwanie na komendy,
 * poza strefą parkowania, kończenie i nieudane odblokowanie. Stan pochodzi z widoku przejazdu
 * (`state`, `pendingCommand`, `notice`), a liczniki aplikacja dolicza lokalnie (ADR 0042).
 */
export default function RideScreen() {
  const theme = useTheme();
  const { rental, outcome, start, clearOutcome } = useRental();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Zakończony przejazd (także zdalnie przez operatora) prowadzi do podsumowania.
  useEffect(() => {
    if (outcome?.cause === 'ended') router.replace({ pathname: '/podsumowanie/[id]', params: { id: outcome.view.id } });
  }, [outcome]);

  if (!rental) {
    if (outcome?.cause === 'unlockFailed') {
      const v = outcome.view;
      const other = () => {
        clearOutcome();
        router.dismissTo('/mapa');
      };
      return (
        <WaitScreen
          header={
            <RoundButton label={t('common.close')} onPress={other}>
              <Icon name="close" color={theme.ink} />
            </RoundButton>
          }
          variant={v.scooter.variant}
          dimmed
          title={t('ride.unlockFailed.title')}
          lead={t('ride.unlockFailed.lead')}
          footer={
            <View style={{ gap: 10 }}>
              {error && <SheetText style={{ textAlign: 'center' }}>{error}</SheetText>}
              <Button
                label={t('ride.unlockFailed.retry')}
                busy={busy}
                onPress={() => {
                  setBusy(true);
                  setError(null);
                  start(v.scooter.id)
                    .catch((e: unknown) => setError(errorMessage(e)))
                    .finally(() => setBusy(false));
                }}
              />
              <Button label={t('ride.unlockFailed.other')} kind="secondary" onPress={other} />
            </View>
          }
        >
          <Steps
            steps={[
              { label: t('ride.unlocking.connected', { number: scooterNo(v.scooter.number) }), state: 'done' },
              { label: t('ride.unlockFailed.step'), state: 'fail' },
            ]}
          />
        </WaitScreen>
      );
    }
    if (outcome?.cause === 'ended') return <Loading />;
    return <Redirect href="/mapa" />;
  }

  const v = rental.view;
  if (v.state === 'RESERVED') return <Redirect href="/mapa" />;
  if (v.state === 'UNLOCKING') {
    return (
      <WaitScreen
        header={null}
        variant={v.scooter.variant}
        title={t('ride.unlocking.title')}
        lead={t('ride.unlocking.lead')}
        footer={<FootNote>{t('ride.unlocking.note')}</FootNote>}
      >
        <Steps
          steps={[
            { label: t('ride.unlocking.connected', { number: scooterNo(v.scooter.number) }), state: 'done' },
            { label: t('ride.unlocking.releasing'), state: 'spin' },
            { label: t('ride.unlocking.lights'), state: 'todo' },
          ]}
        />
      </WaitScreen>
    );
  }
  if (v.state === 'ENDING') {
    return (
      <WaitScreen
        header={<CenteredCaption>{t('ride.ending.header', { number: scooterNo(v.scooter.number) })}</CenteredCaption>}
        variant={v.scooter.variant}
        title={t('ride.ending.title')}
        lead={t('ride.ending.lead')}
        footer={<FootNote>{t('ride.ending.note')}</FootNote>}
      >
        <Steps
          steps={[
            {
              label: v.endZone ? t('ride.ending.inZone', { zone: `${v.endZone.code} ${v.endZone.name}` }) : t('ride.ending.inParking'),
              state: 'done',
            },
            { label: t('ride.ending.locking'), state: 'spin' },
            { label: t('ride.ending.summary'), state: 'todo' },
          ]}
        />
      </WaitScreen>
    );
  }
  if (v.state === 'PAUSED' && v.pendingCommand === 'UNLOCK') return <Resuming tracked={rental} />;
  return <Riding tracked={rental} />;
}

function Loading() {
  const theme = useTheme();
  return (
    <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: theme.bg }}>
      <ActivityIndicator color={theme.accent} />
    </View>
  );
}

function CenteredCaption({ children }: { children: string }) {
  const theme = useTheme();
  return <Text style={{ textAlign: 'center', fontSize: 13, fontWeight: '500', color: theme.muted }}>{children}</Text>;
}

/** Wznawianie jazdy po pauzie (makieta przejazd-wznawianie): oczekiwanie na potwierdzenie odblokowania. */
function Resuming({ tracked }: { tracked: TrackedRental }) {
  const now = useNow();
  const v = tracked.view;
  return (
    <WaitScreen
      header={<CenteredCaption>{t('ride.resuming.pauseTimer', { time: clock(liveCounters(tracked, now).pauseSeconds) })}</CenteredCaption>}
      variant={v.scooter.variant}
      title={t('ride.resuming.title')}
      lead={t('ride.resuming.lead')}
      footer={<FootNote>{t('ride.resuming.note')}</FootNote>}
    >
      <Steps
        steps={[
          { label: t('ride.unlocking.connected', { number: scooterNo(v.scooter.number) }), state: 'done' },
          { label: t('ride.unlocking.releasing'), state: 'spin' },
          { label: t('ride.unlocking.lights'), state: 'todo' },
        ]}
      />
    </WaitScreen>
  );
}

/** Jazda i pauza na mapie (makiety produkt-przejazd, przejazd-pauza, przejazd-poza-strefa, przejazd-blokada-nieudana). */
function Riding({ tracked }: { tracked: TrackedRental }) {
  const theme = useTheme();
  const insets = useSafeAreaInsets();
  const now = useNow();
  const { pause, resume, end } = useRental();
  const { position } = useLocation();
  const { showZones } = usePreferences();
  const [zones, setZones] = useState<ZoneCollection | null>(null);
  const [outside, setOutside] = useState<NearestParking | null>(null);
  const [busy, setBusy] = useState<'pause' | 'resume' | 'end' | null>(null);
  const [error, setError] = useState<string | null>(null);
  const v = tracked.view;
  const scooter = scooterPoint(v);
  const paused = v.state === 'PAUSED';
  const counters = liveCounters(tracked, now);

  useEffect(() => {
    api<ZoneCollection>('/zones')
      .then(setZones)
      .catch(() => undefined);
  }, []);

  // Widok: hulajnoga (podąża za jazdą), a poza strefą hulajnoga razem z najbliższą strefą. Mapa
  // przesuwa się tylko po zmianie klucza: nowy punkt trasy albo komunikat „poza strefą”.
  const followKey = `${v.route.length}:${outside?.code ?? ''}`;
  const outsideBounds = outside && scooter ? boundsOf([[scooter.lon, scooter.lat], [outside.lon, outside.lat]]) : null;
  const focus: MapFocus | null = !scooter
    ? null
    : outsideBounds
      ? { key: followKey, bounds: outsideBounds }
      : { key: followKey, center: [scooter.lon, scooter.lat], zoom: 16 };

  async function act(kind: 'pause' | 'resume' | 'end', action: () => Promise<unknown>) {
    setBusy(kind);
    setError(null);
    try {
      await action();
      setOutside(null);
    } catch (e) {
      const nearest = e instanceof ApiError && e.code === 'OUTSIDE_PARKING' ? (e.details?.nearestParking as NearestParking | undefined) : undefined;
      if (nearest) setOutside(nearest);
      else setError(errorMessage(e));
    } finally {
      setBusy(null);
    }
  }

  // Komunikat z widoku przejazdu, dopóki nie trwa kolejna komenda.
  const notice = v.pendingCommand ? null : v.notice;
  const lockFailed = notice === 'LOCK_FAILED';
  const failure =
    notice === 'LOCK_FAILED'
      ? { title: t('ride.lockFailed.title'), lead: t('ride.lockFailed.lead', { number: scooterNo(v.scooter.number) }), icon: 'lockOpen' as const }
      : notice === 'PAUSE_FAILED'
        ? { title: t('ride.pauseFailed.title'), lead: t('ride.pauseFailed.lead', { number: scooterNo(v.scooter.number) }), icon: 'lockOpen' as const }
        : notice === 'RESUME_FAILED'
          ? { title: t('ride.resumeFailed.title'), lead: t('ride.resumeFailed.lead', { number: scooterNo(v.scooter.number) }), icon: 'lock' as const }
          : error
            ? { title: error, lead: '', icon: 'alert' as const }
            : null;

  const guide: LngLat[] = outside && scooter ? [[scooter.lon, scooter.lat], [outside.lon, outside.lat]] : [];
  const pauseTimer = clock(counters.pauseSeconds);
  // Arkusz jazdy: tło ekranu w jasnym motywie, powierzchnia w ciemnym (makiety produkt-przejazd, ciemny-przejazd).
  const sheetBg = theme.scheme === 'dark' ? theme.surface : theme.bg;
  const rideTimer = clock(counters.rideSeconds + counters.pauseSeconds);

  let bottom: ReactNode;
  if (outside) {
    bottom = (
      <FloatingSheet>
        <AlertHeader icon="parking" tone="danger" title={t('ride.outside.title')} subtitle={t('ride.outside.subtitle')} />
        <SheetText>{t('ride.outside.lead', { zone: `${outside.code} ${outside.name}`, distance: distance(outside.distanceM) })}</SheetText>
        <Button label={t('ride.outside.back')} kind="secondary" onPress={() => setOutside(null)} />
      </FloatingSheet>
    );
  } else if (paused) {
    bottom = (
      <FloatingSheet>
        <View style={{ gap: 4 }}>
          <Text style={{ fontSize: 14, fontWeight: '600', color: theme.muted }}>{t('ride.paused.label')}</Text>
          <Text style={{ fontSize: 56, fontWeight: '500', letterSpacing: -2, lineHeight: 58, color: theme.ink }}>{pauseTimer}</Text>
        </View>
        <SheetText>{t('ride.paused.lead', { price: money(v.tariff.pauseMinuteRate) })}</SheetText>
        <ButtonRow>
          <Button
            label={lockFailed ? t('ride.retry') : t('ride.end')}
            kind="dark"
            busy={busy === 'end'}
            disabled={!!busy || !!v.pendingCommand}
            onPress={() => void act('end', end)}
          />
          <Button
            label={t('ride.paused.resume')}
            busy={busy === 'resume'}
            disabled={!!busy || !!v.pendingCommand}
            onPress={() => void act('resume', resume)}
          />
        </ButtonRow>
      </FloatingSheet>
    );
  } else {
    bottom = (
      <View style={{ position: 'absolute', left: 0, right: 0, bottom: 0, height: 384 + insets.bottom, backgroundColor: sheetBg, borderTopLeftRadius: 32, borderTopRightRadius: 32, paddingTop: 32, paddingHorizontal: 24, paddingBottom: 28 + insets.bottom }}>
        <Text style={{ fontSize: 13, fontWeight: '500', color: theme.muted, textAlign: 'center' }}>{t('ride.time')}</Text>
        <Text
          accessibilityRole="timer"
          style={{ fontSize: 72, fontWeight: '500', letterSpacing: -2.5, lineHeight: 74, textAlign: 'center', marginTop: 6, color: theme.ink }}
        >
          {rideTimer}
        </Text>
        <View style={{ marginTop: 28 }}>
          <Stats
            items={[
              { value: km(v.distanceM), label: t('ride.distance') },
              { value: v.speedKmh !== null ? t('units.kmh', { value: Math.round(v.speedKmh) }) : t('scooter.noValue'), label: t('ride.speed') },
              { value: money(liveTotal(tracked, now)), label: t('ride.cost') },
            ]}
          />
        </View>
        <View style={{ flex: 1 }} />
        <ButtonRow>
          <Button
            label={t('ride.pause')}
            kind="secondary"
            busy={busy === 'pause' || v.pendingCommand === 'LOCK'}
            disabled={!!busy || !!v.pendingCommand}
            onPress={() => void act('pause', pause)}
          />
          <Button
            label={lockFailed ? t('ride.retry') : t('ride.end')}
            kind="dark"
            busy={busy === 'end'}
            disabled={!!busy || !!v.pendingCommand}
            onPress={() => void act('end', end)}
          />
        </ButtonRow>
        {lockFailed && (
          <Text style={{ marginTop: 14, fontSize: 14, color: theme.muted, textAlign: 'center' }}>{t('ride.help', { phone: t('blocked.phone') })}</Text>
        )}
      </View>
    );
  }

  return (
    <View style={{ flex: 1, backgroundColor: theme.map }} accessibilityLabel={t('ride.map')}>
      {focus && (
        <MapView
          focus={focus}
          zones={showZones || outside ? zones : null}
          route={v.route}
          routeMuted={paused}
          user={paused || outside ? position : scooter}
          userStyle={paused ? 'ring' : 'dot'}
          parked={paused || outside ? scooter : null}
          guide={guide}
          padding={{ top: insets.top + 80, bottom: paused || outside ? 330 : 400, left: 40, right: 40 }}
        />
      )}
      <View style={{ position: 'absolute', left: 16, right: 16, top: insets.top + 20, flexDirection: 'row', justifyContent: 'space-between', gap: 10 }}>
        {paused ? <Pill icon="lockClosed">{t('ride.paused.locked')}</Pill> : outside ? <Pill>{t('ride.paused.rideTimer', { time: rideTimer })}</Pill> : <View />}
        {paused ? (
          <Pill>{t('ride.paused.rideTimer', { time: clock(counters.rideSeconds) })}</Pill>
        ) : outside ? (
          <Pill>{km(v.distanceM)}</Pill>
        ) : v.scooter.batteryPct !== null ? (
          <View accessible accessibilityLabel={t('ride.battery', { value: v.scooter.batteryPct })}>
            <Pill>{t('units.percent', { value: v.scooter.batteryPct })}</Pill>
          </View>
        ) : null}
      </View>
      {failure && !outside && (
        <View
          accessibilityRole="alert"
          style={[
            glass(theme),
            {
              position: 'absolute',
              left: 12,
              right: 12,
              bottom: (paused ? 300 : 396) + insets.bottom,
              borderRadius: 28,
              paddingVertical: 18,
              paddingHorizontal: 20,
              flexDirection: 'row',
              gap: 14,
              alignItems: 'flex-start',
            },
          ]}
        >
          <IconBadge icon={failure.icon} tone="danger" size={40} iconSize={19} />
          <View style={{ flex: 1, gap: 4 }}>
            <Text style={{ fontSize: 17, fontWeight: '600', color: theme.ink }}>{failure.title}</Text>
            {failure.lead ? <Text style={{ fontSize: 14, lineHeight: 20, color: theme.muted }}>{failure.lead}</Text> : null}
          </View>
        </View>
      )}
      {bottom}
    </View>
  );
}
