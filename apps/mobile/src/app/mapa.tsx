import type { NearbyResponse, NearbyScooter } from '@hulajnogi/shared';
import * as Linking from 'expo-linking';
import { Redirect, router } from 'expo-router';
import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react';
import { Platform, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Icon } from '../components/icons';
import {
  metersBetween,
  serviceAreaCenter,
  type LngLat,
  type MapFocus,
  type MapPoint,
  type ZoneCollection,
} from '../components/map/map-layers';
import { MapView } from '../components/map/map-view';
import { ScooterRender } from '../components/scooter';
import {
  AlertHeader,
  BottomSheet,
  ButtonRow,
  FloatingSheet,
  RoundButton,
  SheetText,
  sheetStyles,
  Toast,
} from '../components/sheet';
import { Button, useTheme } from '../components/ui';
import { t } from '../i18n';
import { ApiError, api, errorMessage } from '../lib/api';
import { clock, distance, money, scooterNo, walkMinutes } from '../lib/format';
import { useLocation } from '../lib/location';
import { usePreferences } from '../lib/preferences';
import { reservationSecondsLeft, useNow, useRental, type TrackedRental } from '../lib/rental';
import { homeFor, useSession } from '../lib/session';

const NEARBY_REFRESH_MS = 15000;
const TOAST_MS = 4000;

/** Odświeżenie listy po przesunięciu mapy o więcej niż tyle metrów (wyszukiwanie bez lokalizacji). */
const MOVE_THRESHOLD_M = 300;

/**
 * Mapa: ekran główny po zalogowaniu (makiety produkt-mapa, mapa-karta-rezerwuj, mapa-rezerwacja,
 * stany z 08-mobile-stany i 20-mobile-wypozyczenie). Wolne hulajnogi z `GET /scooters/nearby` wokół
 * klienta albo, bez lokalizacji, wokół środka widoku; strefy z `GET /zones` (tylko odczyt).
 */
export default function MapScreen() {
  const theme = useTheme();
  const insets = useSafeAreaInsets();
  const { me } = useSession();
  const location = useLocation();
  const { showZones } = usePreferences();
  const { rental, outcome, reserve, cancelReservation, clearOutcome } = useRental();
  const [zones, setZones] = useState<ZoneCollection | null>(null);
  const [nearby, setNearby] = useState<NearbyResponse | null>(null);
  const [offline, setOffline] = useState(false);
  const [manualCenter, setManualCenter] = useState<MapPoint | null>(null);
  // `undefined`: karta najbliższej hulajnogi wybrana automatycznie (makieta produkt-mapa).
  const [selection, setSelection] = useState<string | null | undefined>(undefined);
  const [focusRequest, setFocusRequest] = useState<MapFocus | null>(null);
  const [cancelOpen, setCancelOpen] = useState(false);
  const [noLocationDismissed, setNoLocationDismissed] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const user = location.position;
  const area = useMemo(() => serviceAreaCenter(zones), [zones]);
  const searchCenter = user ?? manualCenter ?? area;
  const reservation = rental?.view.state === 'RESERVED' ? rental : null;

  const loadZones = useCallback(() => {
    api<ZoneCollection>('/zones')
      .then((z) => {
        setZones(z);
        setOffline(false);
      })
      .catch((e: unknown) => setOffline(e instanceof ApiError && e.code === 'NETWORK'));
  }, []);
  useEffect(loadZones, [loadZones]);

  const loadNearby = useCallback(
    (center: MapPoint) =>
      api<NearbyResponse>(`/scooters/nearby?lat=${center.lat.toFixed(6)}&lon=${center.lon.toFixed(6)}`)
        .then((res) => {
          setNearby(res);
          setOffline(false);
        })
        .catch((e: unknown) => {
          if (e instanceof ApiError && e.code === 'NETWORK') setOffline(true);
        }),
    [],
  );

  // Lista hulajnóg: po zmianie punktu wyszukiwania i co 15 s (pozycje i bateria się zmieniają).
  const centerKey = searchCenter ? `${searchCenter.lat.toFixed(3)},${searchCenter.lon.toFixed(3)}` : null;
  useEffect(() => {
    if (!searchCenter) return;
    void loadNearby(searchCenter);
    const timer = setInterval(() => void loadNearby(searchCenter), NEARBY_REFRESH_MS);
    return () => clearInterval(timer);
    // Punkt wyszukiwania zmienia się dopiero po przesunięciu o ok. 100 m (klucz z zaokrągleniem).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [centerKey, loadNearby]);

  // Pierwszy widok: klient, a bez lokalizacji środek obszaru działania; potem prośby z przycisku położenia.
  const focus: MapFocus | null =
    focusRequest ??
    (user
      ? { key: 'user', center: [user.lon, user.lat] }
      : area && (location.permission === 'denied' || location.skipped)
        ? { key: 'area', center: [area.lon, area.lat], zoom: 14 }
        : null);
  const selectedId = selection === undefined ? (user ? (nearby?.scooters[0]?.id ?? null) : null) : selection;

  // Komunikat o anulowaniu znika po chwili.
  useEffect(() => {
    if (outcome?.cause !== 'cancelled') return;
    const timer = setTimeout(clearOutcome, TOAST_MS);
    return () => clearTimeout(timer);
  }, [outcome, clearOutcome]);

  if (!me) return <Redirect href="/witaj" />;
  if (me.nextStep === 'BLOCKED' || me.nextStep === 'PROFILE') return <Redirect href={homeFor(me)} />;
  if (location.permission === 'undetermined' && !location.skipped) return <Redirect href="/lokalizacja" />;

  if (offline && !nearby) {
    return (
      <OfflineState
        onRetry={() => {
          loadZones();
          if (searchCenter) void loadNearby(searchCenter);
        }}
      />
    );
  }

  const selected = nearby?.scooters.find((s) => s.id === selectedId) ?? null;
  const tariff = nearby?.tariff ?? null;

  async function run(action: () => Promise<unknown>) {
    setBusy(true);
    setError(null);
    try {
      await action();
    } catch (e) {
      if (e instanceof ApiError && (e.code === 'CONSENT_REQUIRED' || e.code === 'DOCUMENTS_NOT_ACCEPTED')) router.push('/zgody');
      else setError(errorMessage(e));
    } finally {
      setBusy(false);
    }
  }

  const reservedPoint: MapPoint | null =
    reservation && reservation.view.scooter.lat !== null && reservation.view.scooter.lon !== null
      ? { lat: reservation.view.scooter.lat, lon: reservation.view.scooter.lon }
      : null;
  const scooters = (nearby?.scooters ?? []).filter((s) => s.id !== reservation?.view.scooter.id);
  const mapScooters = reservedPoint ? [...scooters, { id: reservation!.view.scooter.id, ...reservedPoint }] : scooters;
  const guide: LngLat[] = reservedPoint && user ? [[user.lon, user.lat], [reservedPoint.lon, reservedPoint.lat]] : [];
  const noLocation = !user && (location.permission === 'denied' || location.skipped) && !noLocationDismissed;

  let sheet: ReactNode = null;
  if (reservation) {
    sheet = (
      <ReservationCard
        tracked={reservation}
        user={user}
        busy={busy}
        error={error}
        onCancel={() => setCancelOpen(true)}
        onScan={() => router.push('/skan')}
      />
    );
  } else if (outcome?.cause === 'expired') {
    const v = outcome.view;
    sheet = (
      <FloatingSheet>
        <AlertHeader icon="clock" tone="neutral" title={t('map.expired.title')} subtitle={t('map.expired.subtitle', { number: scooterNo(v.scooter.number) })} />
        <SheetText>{t('map.expired.lead', { minutes: v.tariff.freeReservationMinutes })}</SheetText>
        {error && <SheetText style={{ color: theme.danger }}>{error}</SheetText>}
        <View style={{ gap: 10 }}>
          <Button label={t('map.expired.again')} busy={busy} onPress={() => void run(() => reserve(v.scooter.id))} />
          <Button label={t('map.expired.close')} kind="secondary" onPress={clearOutcome} />
        </View>
      </FloatingSheet>
    );
  } else if (selected && tariff) {
    sheet = (
      <ScooterCard
        scooter={selected}
        user={user}
        minuteRate={tariff.minuteRate}
        freeMinutes={tariff.freeReservationMinutes}
        busy={busy}
        error={error}
        onReserve={() => void run(() => reserve(selected.id))}
        onScan={() => router.push('/skan')}
      />
    );
  } else if (noLocation) {
    const canAsk = location.permission !== 'denied' || Platform.OS === 'web';
    sheet = (
      <FloatingSheet>
        <AlertHeader icon="locate" tone="neutral" title={t('map.noLocation.title')} />
        <SheetText>{t('map.noLocation.lead')}</SheetText>
        <View style={{ gap: 10 }}>
          <Button
            label={canAsk ? t('map.noLocation.allow') : t('map.noLocation.settings')}
            onPress={() => void (canAsk ? location.request() : Linking.openSettings())}
          />
          <Button label={t('map.noLocation.manual')} kind="secondary" onPress={() => setNoLocationDismissed(true)} />
        </View>
      </FloatingSheet>
    );
  } else if (nearby && !nearby.scooters.length) {
    sheet = (
      <FloatingSheet>
        <Text accessibilityRole="header" style={{ fontSize: 22, fontWeight: '600', letterSpacing: -0.4, color: theme.ink }}>
          {t('map.empty.title')}
        </Text>
        <SheetText>{t('map.empty.lead', { radius: distance(nearby.radiusM) })}</SheetText>
        <Button label={t('map.empty.retry')} onPress={() => searchCenter && void loadNearby(searchCenter)} />
      </FloatingSheet>
    );
  }

  const initial = me.name?.trim()[0]?.toUpperCase();
  return (
    <View style={{ flex: 1, backgroundColor: theme.map }} accessibilityLabel={t('map.label')}>
      {focus && (
        <MapView
          focus={focus}
          zones={showZones ? zones : null}
          scooters={mapScooters}
          selectedId={reservation?.view.scooter.id ?? selectedId}
          user={user}
          guide={guide}
          padding={{ top: insets.top + 80, bottom: 340, left: 24, right: 24 }}
          onScooterPress={(id) => {
            if (reservation) return;
            setError(null);
            setSelection(id);
            if (outcome?.cause === 'expired') clearOutcome();
          }}
          onPress={() => !reservation && setSelection(null)}
          onCenterChange={(center) => {
            if (!user && (!manualCenter || metersBetween(manualCenter, center) > MOVE_THRESHOLD_M)) setManualCenter(center);
          }}
        />
      )}
      <View style={{ position: 'absolute', left: 16, right: 16, top: insets.top + 20, flexDirection: 'row', justifyContent: 'space-between' }}>
        <RoundButton label={t('map.profile')} kind="dark" onPress={() => router.push('/profil')}>
          {initial ? (
            <Text style={{ fontSize: 15, fontWeight: '600', color: theme.onDark }}>{initial}</Text>
          ) : (
            <Icon name="person" color={theme.onDark} />
          )}
        </RoundButton>
        <RoundButton
          label={t('map.locate')}
          kind="glass"
          onPress={() => {
            if (user) setFocusRequest({ key: Date.now(), center: [user.lon, user.lat] });
            else setNoLocationDismissed(false);
          }}
        >
          <Icon name="locate" color={theme.ink} />
        </RoundButton>
      </View>
      {outcome?.cause === 'cancelled' && <Toast title={t('map.cancelled.title')} subtitle={t('map.cancelled.subtitle')} />}
      {sheet}
      {reservation && (
        <CancelSheet
          visible={cancelOpen}
          tracked={reservation}
          busy={busy}
          onKeep={() => setCancelOpen(false)}
          onConfirm={() =>
            void run(async () => {
              await cancelReservation();
              setCancelOpen(false);
            })
          }
        />
      )}
    </View>
  );
}

/** Karta wybranej hulajnogi z rezerwacją i skanem (makieta mapa-karta-rezerwuj). */
function ScooterCard({
  scooter,
  user,
  minuteRate,
  freeMinutes,
  busy,
  error,
  onReserve,
  onScan,
}: {
  scooter: NearbyScooter;
  user: MapPoint | null;
  minuteRate: number;
  freeMinutes: number;
  busy: boolean;
  error: string | null;
  onReserve: () => void;
  onScan: () => void;
}) {
  const theme = useTheme();
  return (
    <FloatingSheet>
      <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 16 }}>
        <View style={{ gap: 2 }}>
          <Text style={[sheetStyles.caption, { color: theme.muted }]}>{t('map.card.scooter', { number: scooterNo(scooter.number) })}</Text>
          <Text style={[sheetStyles.bigNumber, { color: theme.ink }]}>{t('units.percent', { value: scooter.batteryPct })}</Text>
          {scooter.rangeKm !== null && <Text style={{ fontSize: 14, color: theme.muted }}>{t('map.card.range', { km: scooter.rangeKm })}</Text>}
        </View>
        <ScooterRender
          variant={scooter.variant}
          side
          style={{ width: 140, height: 112 }}
          label={t('variants.render', { variant: t(`variants.${scooter.variant}`) })}
        />
      </View>
      <View style={{ flexDirection: 'row', justifyContent: 'space-between', paddingTop: 16, borderTopWidth: 1, borderColor: theme.line }}>
        <Text style={{ fontSize: 14, color: theme.ink }}>
          {user ? t('map.card.walk', { distance: distance(scooter.distanceM), minutes: walkMinutes(scooter.distanceM) }) : ''}
        </Text>
        <Text style={{ fontSize: 14, fontWeight: '500', color: theme.ink }}>{t('map.card.price', { price: money(minuteRate) })}</Text>
      </View>
      <SheetText style={{ fontSize: 14, marginTop: -4 }}>{t('map.card.freeReservation', { minutes: freeMinutes })}</SheetText>
      {error && <SheetText style={{ color: theme.danger, fontSize: 14 }}>{error}</SheetText>}
      <ButtonRow split>
        <Button label={t('map.card.reserve')} kind="secondary" busy={busy} onPress={onReserve} />
        <Button label={t('map.card.scan')} onPress={onScan} />
      </ButtonRow>
    </FloatingSheet>
  );
}

/** Rezerwacja z odliczaniem (makieta mapa-rezerwacja). */
function ReservationCard({
  tracked,
  user,
  busy,
  error,
  onCancel,
  onScan,
}: {
  tracked: TrackedRental;
  user: MapPoint | null;
  busy: boolean;
  error: string | null;
  onCancel: () => void;
  onScan: () => void;
}) {
  const theme = useTheme();
  const now = useNow();
  const v = tracked.view;
  const left = reservationSecondsLeft(tracked, now);
  const away =
    user && v.scooter.lat !== null && v.scooter.lon !== null ? metersBetween(user, { lat: v.scooter.lat, lon: v.scooter.lon }) : null;
  return (
    <FloatingSheet>
      <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 16 }}>
        <View style={{ gap: 2, flex: 1 }}>
          <Text style={{ fontSize: 13, fontWeight: '600', color: theme.accentMap }}>{t('map.reservation.label')}</Text>
          <Text
            accessibilityLabel={t('map.reservation.countdown', { time: clock(left) })}
            style={[sheetStyles.bigNumber, { color: theme.ink }]}
          >
            {clock(left)}
          </Text>
          <Text style={{ fontSize: 14, lineHeight: 20, color: theme.muted }}>
            {away !== null
              ? t('map.reservation.waiting', { number: scooterNo(v.scooter.number), distance: distance(away) })
              : t('map.reservation.waitingHere', { number: scooterNo(v.scooter.number) })}
          </Text>
        </View>
        <ScooterRender variant={v.scooter.variant} side style={{ width: 120, height: 100 }} label={t('variants.render', { variant: t(`variants.${v.scooter.variant}`) })} />
      </View>
      <SheetText style={{ fontSize: 14, paddingTop: 16, borderTopWidth: 1, borderColor: theme.line }}>
        {t('map.reservation.lead', { minutes: v.tariff.freeReservationMinutes })}
      </SheetText>
      {error && <SheetText style={{ color: theme.danger, fontSize: 14 }}>{error}</SheetText>}
      <ButtonRow split>
        <Button label={t('map.reservation.cancel')} kind="secondary" busy={busy} onPress={onCancel} />
        <Button label={t('map.reservation.scan')} onPress={onScan} />
      </ButtonRow>
    </FloatingSheet>
  );
}

/** Potwierdzenie anulowania (makieta rezerwacja-anuluj): przycisk grafitowy, bo operacja jest nieszkodliwa. */
function CancelSheet({
  visible,
  tracked,
  busy,
  onKeep,
  onConfirm,
}: {
  visible: boolean;
  tracked: TrackedRental;
  busy: boolean;
  onKeep: () => void;
  onConfirm: () => void;
}) {
  const theme = useTheme();
  const now = useNow(visible);
  return (
    <BottomSheet visible={visible} onClose={onKeep}>
      <Text accessibilityRole="header" style={{ fontSize: 22, fontWeight: '600', letterSpacing: -0.4, color: theme.ink }}>
        {t('map.cancel.title')}
      </Text>
      <Text style={{ fontSize: 16, lineHeight: 24, color: theme.muted, marginTop: 10 }}>
        {t('map.cancel.lead', { number: scooterNo(tracked.view.scooter.number) })}
      </Text>
      <View
        style={{
          marginTop: 24,
          height: 56,
          borderRadius: 20,
          borderWidth: 1,
          borderColor: theme.line,
          backgroundColor: theme.surface,
          paddingHorizontal: 16,
          flexDirection: 'row',
          alignItems: 'center',
          justifyContent: 'space-between',
        }}
      >
        <Text style={{ fontSize: 16, color: theme.muted }}>{t('map.cancel.expiresIn')}</Text>
        <Text style={{ fontSize: 16, fontWeight: '500', color: theme.ink }}>{clock(reservationSecondsLeft(tracked, now))}</Text>
      </View>
      <View style={{ gap: 10, marginTop: 24 }}>
        <Button label={t('map.cancel.confirm')} kind="dark" busy={busy} onPress={onConfirm} />
        <Button label={t('map.cancel.keep')} kind="secondary" onPress={onKeep} />
      </View>
    </BottomSheet>
  );
}

/** Brak internetu (makieta stan-offline). */
function OfflineState({ onRetry }: { onRetry: () => void }) {
  const theme = useTheme();
  const insets = useSafeAreaInsets();
  return (
    <View style={{ flex: 1, backgroundColor: theme.bg, paddingHorizontal: 24, paddingTop: insets.top + 20, paddingBottom: insets.bottom + 16 }}>
      <View style={{ flex: 1 }} />
      <View style={{ alignItems: 'center' }}>
        <View style={{ width: 72, height: 72, borderRadius: 36, backgroundColor: theme.line, alignItems: 'center', justifyContent: 'center' }}>
          <Icon name="wifiOff" color={theme.ink} size={32} strokeWidth={2} />
        </View>
        <Text accessibilityRole="header" style={{ marginTop: 24, fontSize: 26, fontWeight: '600', letterSpacing: -0.8, color: theme.ink, textAlign: 'center' }}>
          {t('map.offline.title')}
        </Text>
        <Text style={{ marginTop: 10, fontSize: 16, lineHeight: 24, color: theme.muted, textAlign: 'center' }}>{t('map.offline.lead')}</Text>
      </View>
      <View style={{ flex: 1 }} />
      <Button label={t('map.offline.retry')} kind="dark" onPress={onRetry} />
    </View>
  );
}
