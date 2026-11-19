import type { DestinationView, NearbyResponse, NearbyScooter, RouteView } from '@hulajnogi/shared';
import * as Linking from 'expo-linking';
import { Redirect, router } from 'expo-router';
import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react';
import { ActivityIndicator, Platform, Pressable, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Icon } from '../components/icons';
import {
  boundsOf,
  metersBetween,
  serviceAreaCenter,
  type LngLat,
  type MapFocus,
  type MapPoint,
  type ZoneCollection,
} from '../components/map/map-layers';
import { ContentNotice, useContentNotice } from '../components/content-notice';
import { MapView } from '../components/map/map-view';
import { OfflineState } from '../components/offline';
import { ScooterRender } from '../components/scooter';
import {
  AlertHeader,
  BottomSheet,
  ButtonRow,
  FloatingSheet,
  IconBadge,
  Pill,
  RoundButton,
  SheetText,
  glass,
  sheetStyles,
  Toast,
} from '../components/sheet';
import { usePaymentGate, type GateTarget } from '../components/start-payment';
import { Button, useTheme } from '../components/ui';
import { t } from '../i18n';
import { ApiError, api, errorMessage } from '../lib/api';
import { around, clock, dayTime, distance, money, pln, scooterNo, walkMinutes } from '../lib/format';
import { useLocation } from '../lib/location';
import { useMapIntent, type Place } from '../lib/map-intent';
import { usePreferences } from '../lib/preferences';
import { useNotifications } from '../lib/notifications';
import { isOfflineEnding, reservationSecondsLeft, useNow, useRental, type TrackedRental } from '../lib/rental';
import { loadWalk, routeMinutes, useLiveRoute, walkLabel } from '../lib/routes';
import { homeFor, useSession } from '../lib/session';
import { cardTitle, useWallet } from '../lib/wallet';
import { LEGEND_TYPES, slowLimits, useZones } from '../lib/zones';

const NEARBY_REFRESH_MS = 15000;
const TOAST_MS = 4000;

/** Odświeżenie listy po przesunięciu mapy o więcej niż tyle metrów (wyszukiwanie bez lokalizacji). */
const MOVE_THRESHOLD_M = 300;
/** Klient stoi przy hulajnodze: trasa piesza znika (makieta hulajnoga-trasa). */
const ARRIVED_M = 20;

/**
 * Mapa: ekran główny po zalogowaniu (makiety produkt-mapa, mapa-karta-rezerwuj, mapa-rezerwacja,
 * mapa-strefy, szukaj-wynik, hulajnoga-trasa i stany z 08-mobile-stany i 20-mobile-wypozyczenie). Wolne
 * hulajnogi z `GET /scooters/nearby` wokół klienta albo, bez lokalizacji, wokół środka widoku; strefy
 * z `GET /zones` (tylko widoczne w aplikacji, odświeżane po `zones.changed`).
 */
export default function MapScreen() {
  const theme = useTheme();
  const insets = useSafeAreaInsets();
  const { me } = useSession();
  const location = useLocation();
  const { showZones } = usePreferences();
  const { rental, outcome, reserve, cancelReservation, clearOutcome } = useRental();
  const { destination, setDestination, walkTo, setWalkTo } = useMapIntent();
  const { zones, error: zonesError, reload: reloadZones } = useZones();
  const { summary: wallet } = useWallet();
  const { askOnce } = useNotifications();
  const [nearby, setNearby] = useState<NearbyResponse | null>(null);
  const [offline, setOffline] = useState(false);
  const [manualCenter, setManualCenter] = useState<MapPoint | null>(null);
  // Wybór klienta obowiązuje w kontekście (cel, „Trasa”), w którym go dokonał; bez wyboru karta najbliższej
  // hulajnogi (makieta produkt-mapa), przy celu karta celu, po „Trasa” karta tej hulajnogi.
  const [selection, setSelection] = useState<{ id: string | null; context: string } | null>(null);
  // Widok ustawiony przez klienta (położenie, strefa z karty celu) do następnej zmiany widoku automatycznego.
  const [focusRequest, setFocusRequest] = useState<{ focus: MapFocus; base: string | number | null } | null>(null);
  const [cancelOpen, setCancelOpen] = useState(false);
  const [legend, setLegend] = useState(false);
  const [noLocationDismissed, setNoLocationDismissed] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // Rezerwacja odrzucona przez regułę płatności (ADR 0049): brak środków, zaległość, jazda kartą.
  const gate = usePaymentGate({
    action: t('cardStart.reserve'),
    perform: async (id, payment) => {
      await reserve(id, payment);
    },
  });
  // Komunikat z treści `mobile.notice` (makieta 31-mobile-tresci/komunikat) i jego wysokość do odstępu mapy.
  const contentNotice = useContentNotice();
  const [noticeHeight, setNoticeHeight] = useState(0);

  const user = location.position;
  const area = useMemo(() => serviceAreaCenter(zones), [zones]);
  const searchCenter = user ?? manualCenter ?? area;
  const reservation = rental?.view.state === 'RESERVED' ? rental : null;
  // Zakończenie bez łączności po wysłaniu zdjęcia: przejazd czeka na blokadę, a nowego nie da się zacząć.
  const ending = rental && isOfflineEnding(rental.view) ? rental.view : null;
  const zonesOffline = zonesError instanceof ApiError && zonesError.code === 'NETWORK';

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

  const selectionContext = `${destination?.id ?? ''}|${walkTo ?? ''}`;
  const selectedId =
    selection && selection.context === selectionContext
      ? selection.id
      : (walkTo ?? (user && !destination ? (nearby?.scooters[0]?.id ?? null) : null));
  const selected = nearby?.scooters.find((s) => s.id === selectedId) ?? null;

  // Trasa piesza (ADR 0048): do zarezerwowanej hulajnogi albo do hulajnogi z „Trasa”, dopóki klient do niej nie dojdzie.
  const walkScooter: { id: string; point: MapPoint } | null = reservation
    ? reservation.view.scooter.lat !== null && reservation.view.scooter.lon !== null
      ? {
          id: reservation.view.scooter.id,
          point: { lat: reservation.view.scooter.lat, lon: reservation.view.scooter.lon },
        }
      : null
    : walkTo && selected?.id === walkTo
      ? { id: selected.id, point: selected }
      : null;
  const atScooter = !!walkScooter && !!user && metersBetween(user, walkScooter.point) < ARRIVED_M;
  const walkId = walkScooter && !atScooter ? walkScooter.id : null;
  const walk = useLiveRoute<RouteView>(
    walkId ? `walk:${walkId}` : null,
    user,
    (from) => loadWalk(walkId!, from),
    (r) => r.line,
  );

  // Wynik wyszukiwania (decyzja D5): szacunek przejazdu i strefa parkowania przy celu.
  const [destinationView, setDestinationView] = useState<{ key: string; view: DestinationView | null } | null>(null);
  const origin = user ?? searchCenter;
  const destinationKey = destination && origin ? `${destination.id}:${user ? 'user' : 'center'}` : null;
  useEffect(() => {
    if (!destination || !origin || !destinationKey) return;
    let cancelled = false;
    const q = `lat=${origin.lat.toFixed(6)}&lon=${origin.lon.toFixed(6)}&toLat=${destination.lat.toFixed(6)}&toLon=${destination.lon.toFixed(6)}`;
    api<DestinationView>(`/places/destination?${q}`)
      .then((view) => !cancelled && setDestinationView({ key: destinationKey, view }))
      .catch(() => !cancelled && setDestinationView({ key: destinationKey, view: null }));
    return () => {
      cancelled = true;
    };
    // Szacunek liczymy raz dla celu (i ponownie, gdy pojawi się lokalizacja klienta).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [destinationKey]);
  const destinationResult = destinationView && destinationView.key === destinationKey ? destinationView : null;

  // Widok automatyczny: trasa piesza z klientem, cel ze strefą parkowania przy celu i klientem, a bez nich
  // klient albo, bez lokalizacji, środek obszaru działania. Mapa przesuwa się tylko po zmianie klucza.
  const walkBounds = walk.data && walkId ? boundsOf(walk.data.line) : null;
  const destinationPoints: LngLat[] = destination ? [[destination.lon, destination.lat]] : [];
  if (destination && user) destinationPoints.push([user.lon, user.lat]);
  if (destinationResult?.view?.parking) destinationPoints.push(destinationResult.view.parking.anchor);
  const destinationBounds = boundsOf(destinationPoints);
  const autoFocus: MapFocus | null = walkBounds
    ? { key: `walk:${walkId}`, bounds: walkBounds }
    : destination && destinationBounds
      ? {
          key: `destination:${destination.id}:${destinationResult?.view?.parking?.code ?? ''}`,
          bounds: destinationBounds,
        }
      : user
        ? { key: 'user', center: [user.lon, user.lat] }
        : area && (location.permission === 'denied' || location.skipped)
          ? { key: 'area', center: [area.lon, area.lat], zoom: 14 }
          : null;
  const focus: MapFocus | null =
    focusRequest && focusRequest.base === (autoFocus?.key ?? null) ? focusRequest.focus : autoFocus;
  const requestFocus = (next: Omit<MapFocus, 'key'>) =>
    setFocusRequest({ focus: { ...next, key: Date.now() }, base: autoFocus?.key ?? null });

  // Komunikat o anulowaniu znika po chwili.
  useEffect(() => {
    if (outcome?.cause !== 'cancelled') return;
    const timer = setTimeout(clearOutcome, TOAST_MS);
    return () => clearTimeout(timer);
  }, [outcome, clearOutcome]);

  if (!me) return <Redirect href="/witaj" />;
  if (me.nextStep === 'BLOCKED' || me.nextStep === 'PROFILE') return <Redirect href={homeFor(me)} />;
  if (location.permission === 'undetermined' && !location.skipped) return <Redirect href="/lokalizacja" />;

  if ((offline || zonesOffline) && !nearby) {
    return (
      <OfflineState
        lead={t('map.offline.lead')}
        onRetry={() => {
          reloadZones();
          if (searchCenter) void loadNearby(searchCenter);
        }}
      />
    );
  }

  const tariff = nearby?.tariff ?? null;

  async function run(action: () => Promise<unknown>, target?: GateTarget | null) {
    setBusy(true);
    setError(null);
    try {
      await action();
    } catch (e) {
      if (target && gate.handle(target, e)) return;
      if (e instanceof ApiError && (e.code === 'CONSENT_REQUIRED' || e.code === 'DOCUMENTS_NOT_ACCEPTED'))
        router.push('/zgody');
      else setError(errorMessage(e));
    } finally {
      setBusy(false);
    }
  }

  /** Rezerwacja; przed pierwszą prośba o powiadomienia (ADR 0058, makieta powiadomienia-zgoda). */
  async function reserveAsking(id: string) {
    await askOnce();
    return reserve(id);
  }

  /** Opis hulajnogi i stawki do arkusza płatności kartą przy rezerwacji. */
  const gateTarget = (
    scooter: { id: string; number: number; batteryPct: number | null } | null,
    rates = tariff,
  ): GateTarget | null =>
    scooter && rates
      ? {
          scooterId: scooter.id,
          caption:
            scooter.batteryPct !== null
              ? t('cardStart.caption', { number: scooterNo(scooter.number), battery: scooter.batteryPct })
              : t('cardStart.captionShort', { number: scooterNo(scooter.number) }),
          tariff: rates,
        }
      : null;

  const select = (id: string | null) => {
    setError(null);
    const keepWalk = !!walkTo && id === walkTo;
    if (!keepWalk) setWalkTo(null);
    setSelection({ id, context: `${destination?.id ?? ''}|${keepWalk ? walkTo : ''}` });
  };

  const reservedPoint: MapPoint | null = reservation && walkScooter ? walkScooter.point : null;
  const scooters = (nearby?.scooters ?? []).filter((s) => s.id !== reservation?.view.scooter.id);
  const mapScooters = reservedPoint ? [...scooters, { id: reservation!.view.scooter.id, ...reservedPoint }] : scooters;
  // Linia przerywana: trasa piesza, a do jej pobrania przy rezerwacji linia prosta jak w mapa-rezerwacja.
  const guide: LngLat[] =
    walk.data && walkId
      ? walk.data.line
      : reservedPoint && user && !atScooter
        ? [
            [user.lon, user.lat],
            [reservedPoint.lon, reservedPoint.lat],
          ]
        : [];
  const noLocation = !user && (location.permission === 'denied' || location.skipped) && !noLocationDismissed;
  const nearest = nearby?.scooters[0] ?? null;

  let sheet: ReactNode = null;
  if (legend) {
    sheet = <LegendSheet zones={zones} />;
  } else if (ending) {
    sheet = (
      <FloatingSheet>
        <AlertHeader
          icon="wifiOff"
          tone="neutral"
          title={t('map.ending.title')}
          subtitle={t('map.ending.subtitle', { number: scooterNo(ending.scooter.number) })}
        />
        <SheetText>{t('map.ending.lead')}</SheetText>
        <Button label={t('map.ending.show')} kind="secondary" onPress={() => router.push('/przejazd')} />
      </FloatingSheet>
    );
  } else if (!reservation && wallet && wallet.overdue.length) {
    // Zaległość (makieta mapa-zaleglosc): panel bez zamykania, pierwszeństwo przed ujemnym saldem.
    sheet = <OverdueCard overdue={wallet.overdue} />;
  } else if (!reservation && wallet && wallet.balance < 0) {
    sheet = (
      <FloatingSheet>
        <AlertHeader
          icon="wallet"
          tone="danger"
          title={t('funds.negative.title')}
          subtitle={t('funds.balance', { balance: pln(wallet.balance) })}
        />
        <SheetText>{t('funds.negative.lead')}</SheetText>
        <Button label={t('funds.topup')} onPress={() => router.push('/portfel')} />
      </FloatingSheet>
    );
  } else if (reservation) {
    sheet = (
      <ReservationCard
        tracked={reservation}
        user={user}
        walk={walkId ? walk.data : null}
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
        <AlertHeader
          icon="clock"
          tone="neutral"
          title={t('map.expired.title')}
          subtitle={t('map.expired.subtitle', { number: scooterNo(v.scooter.number) })}
        />
        <SheetText>{t('map.expired.lead', { minutes: v.tariff.freeReservationMinutes })}</SheetText>
        {error && <SheetText style={{ color: theme.danger }}>{error}</SheetText>}
        <View style={{ gap: 10 }}>
          <Button
            label={t('map.expired.again')}
            busy={busy}
            onPress={() => void run(() => reserveAsking(v.scooter.id), gateTarget(v.scooter, v.tariff))}
          />
          <Button label={t('map.expired.close')} kind="secondary" onPress={clearOutcome} />
        </View>
      </FloatingSheet>
    );
  } else if (selected && tariff) {
    sheet = (
      <ScooterCard
        scooter={selected}
        user={user}
        walk={walkId === selected.id ? walk : null}
        minuteRate={tariff.minuteRate}
        freeMinutes={tariff.freeReservationMinutes}
        busy={busy}
        error={error}
        onReserve={() => void run(() => reserveAsking(selected.id), gateTarget(selected))}
        onScan={() => router.push('/skan')}
        onReport={() => router.push({ pathname: '/zglos', params: { number: String(selected.number) } })}
      />
    );
  } else if (destination) {
    sheet = (
      <DestinationCard
        place={destination}
        user={user}
        result={destinationResult ? destinationResult.view : undefined}
        nearest={nearest}
        busy={busy}
        error={error}
        onParking={(anchor) => requestFocus({ center: anchor, zoom: 17 })}
        onScooter={(id) => select(id)}
        onReserve={(id) =>
          void run(() => reserveAsking(id), gateTarget(nearby?.scooters.find((s) => s.id === id) ?? null))
        }
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
        <Text
          accessibilityRole="header"
          style={{ fontSize: 22, fontWeight: '600', letterSpacing: -0.4, color: theme.ink }}
        >
          {t('map.empty.title')}
        </Text>
        <SheetText>{t('map.empty.lead', { radius: distance(nearby.radiusM) })}</SheetText>
        <Button label={t('map.empty.retry')} onPress={() => searchCenter && void loadNearby(searchCenter)} />
      </FloatingSheet>
    );
  }

  const initial = me.name?.trim()[0]?.toUpperCase();
  const top = insets.top + 20;
  const locate = (
    <RoundButton
      label={t('map.locate')}
      kind="glass"
      onPress={() => {
        if (user) requestFocus({ center: [user.lon, user.lat] });
        else setNoLocationDismissed(false);
      }}
    >
      <Icon name="locate" color={theme.ink} />
    </RoundButton>
  );

  // Komunikat tylko w widoku podstawowym: nie zasłania legendy, celu ani karty rezerwacji.
  const showNotice = !!contentNotice && !legend && !destination && !reservation;
  let header: ReactNode;
  if (legend) {
    // Legenda (makieta mapa-strefy): wstecz i nazwa widoku.
    header = (
      <View
        style={{ position: 'absolute', left: 16, right: 16, top, flexDirection: 'row', alignItems: 'center', gap: 10 }}
      >
        <RoundButton label={t('map.legend.back')} kind="glass" onPress={() => setLegend(false)}>
          <Icon name="back" color={theme.ink} />
        </RoundButton>
        <Pill>{t('map.zonesChip')}</Pill>
      </View>
    );
  } else if (destination && !reservation) {
    // Wybrany cel w pasku (makieta szukaj-wynik): strzałka wraca do mapy, krzyżyk otwiera wyszukiwanie.
    header = (
      <View
        style={[
          glass(theme),
          {
            position: 'absolute',
            left: 16,
            right: 16,
            top,
            height: 52,
            borderRadius: 26,
            flexDirection: 'row',
            alignItems: 'center',
            paddingHorizontal: 6,
            gap: 6,
          },
        ]}
      >
        <BarButton label={t('map.destination.back')} icon="back" onPress={() => setDestination(null)} />
        <Text numberOfLines={1} style={{ flex: 1, fontSize: 16, fontWeight: '500', color: theme.ink }}>
          {destination.name}
        </Text>
        <BarButton
          label={t('map.destination.clear')}
          icon="close"
          onPress={() => {
            setDestination(null);
            router.push('/szukaj');
          }}
        />
      </View>
    );
  } else {
    // Pasek „Dokąd jedziesz?” z profilem (makieta produkt-mapa), pod nim komunikat z treści (bez rezerwacji), legenda
    // stref i położenie.
    header = (
      <View style={{ position: 'absolute', left: 16, right: 16, top, gap: 12 }}>
        <View
          style={[
            glass(theme),
            {
              height: 52,
              borderRadius: 26,
              flexDirection: 'row',
              alignItems: 'center',
              paddingLeft: 18,
              paddingRight: 6,
              gap: 10,
            },
          ]}
        >
          <Icon name="search" color={theme.muted} />
          <Pressable
            accessibilityRole="search"
            accessibilityLabel={t('map.search.open')}
            onPress={() => router.push('/szukaj')}
            style={{ flex: 1, height: 44, justifyContent: 'center' }}
          >
            <Text style={{ fontSize: 16, color: theme.muted }}>{t('map.search.placeholder')}</Text>
          </Pressable>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={t('map.profile')}
            onPress={() => router.push('/profil')}
            style={({ pressed }) => ({
              width: 40,
              height: 40,
              borderRadius: 20,
              backgroundColor: theme.dark,
              alignItems: 'center',
              justifyContent: 'center',
              opacity: pressed ? 0.8 : 1,
            })}
          >
            {initial ? (
              <Text style={{ fontSize: 14, fontWeight: '500', color: theme.onDark }}>{initial}</Text>
            ) : (
              <Icon name="person" color={theme.onDark} size={18} />
            )}
          </Pressable>
        </View>
        {showNotice && (
          <View onLayout={(e) => setNoticeHeight(Math.round(e.nativeEvent.layout.height))}>
            <ContentNotice notice={contentNotice.notice} onDismiss={contentNotice.dismiss} />
          </View>
        )}
        <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={t('map.zonesLabel')}
            onPress={() => setLegend(true)}
          >
            <Pill icon="map">{t('map.zonesChip')}</Pill>
          </Pressable>
          {locate}
        </View>
      </View>
    );
  }

  return (
    <View style={{ flex: 1, backgroundColor: theme.map }} accessibilityLabel={t('map.label')}>
      {focus && (
        <MapView
          focus={focus}
          zones={showZones || legend || destination ? zones : null}
          scooters={mapScooters}
          selectedId={reservation?.view.scooter.id ?? selectedId}
          user={user}
          userStyle={walkId ? 'ring' : 'dot'}
          guide={guide}
          destination={destination}
          padding={{
            top: top + (legend || destination ? 60 : 116 + (showNotice ? noticeHeight + 12 : 0)),
            bottom: legend ? 300 : 360,
            left: 24,
            right: 24,
          }}
          onScooterPress={(id) => {
            if (reservation) return;
            setLegend(false);
            select(id);
            if (outcome?.cause === 'expired') clearOutcome();
          }}
          onPress={() => {
            if (reservation) return;
            select(null);
          }}
          onCenterChange={(center) => {
            if (!user && (!manualCenter || metersBetween(manualCenter, center) > MOVE_THRESHOLD_M))
              setManualCenter(center);
          }}
        />
      )}
      {header}
      {outcome?.cause === 'cancelled' && (
        <Toast title={t('map.cancelled.title')} subtitle={t('map.cancelled.subtitle')} />
      )}
      {sheet}
      {gate.sheets}
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

const capitalize = (text: string) => text.charAt(0).toLocaleUpperCase('pl-PL') + text.slice(1);

/**
 * Nieopłacony przejazd (makieta mapa-zaleglosc, ADR 0049): kwota, nieudana karta i termin automatycznego
 * ponowienia; przy kilku zaległościach suma. Panelu nie można zamknąć, bo zaległość blokuje rezerwację i start.
 */
function OverdueCard({ overdue }: { overdue: NonNullable<ReturnType<typeof useWallet>['summary']>['overdue'] }) {
  const theme = useTheme();
  const first = overdue[0]!;
  const many = overdue.length > 1;
  const total = overdue.reduce((sum, o) => sum + o.amount, 0);
  const subtitle = many
    ? t('map.overdue.subtitleMany', { amount: pln(total) })
    : first.endedAt
      ? t('map.overdue.subtitle', {
          amount: pln(first.amount),
          when: dayTime(first.endedAt).toLocaleLowerCase('pl-PL'),
        })
      : pln(first.amount);
  const lead = many
    ? t('map.overdue.leadMany', { count: overdue.length })
    : first.card
      ? t('map.overdue.leadCard', { card: cardTitle(first.card) })
      : t('map.overdue.lead');
  return (
    <FloatingSheet>
      <AlertHeader
        icon="card"
        tone="danger"
        title={many ? t('map.overdue.titleMany') : t('map.overdue.title')}
        subtitle={subtitle}
      />
      <SheetText>{first.paymentPending ? t('map.overdue.pending') : lead}</SheetText>
      {!many && first.retryAt && !first.paymentPending && (
        <View style={{ flexDirection: 'row', gap: 10, alignItems: 'center', marginTop: -4 }}>
          <Icon name="clock" color={theme.muted} size={18} />
          <Text style={{ flex: 1, fontSize: 14, lineHeight: 20, color: theme.muted }}>
            {t('map.overdue.retry', { when: capitalize(around(first.retryAt)) })}
          </Text>
        </View>
      )}
      <Button
        label={t('map.overdue.pay')}
        onPress={() => router.push({ pathname: '/zaleglosc/[id]', params: { id: first.rentalId } })}
      />
    </FloatingSheet>
  );
}

/** Przycisk 40 px bez tła w szklanym pasku celu. */
function BarButton({ label, icon, onPress }: { label: string; icon: 'back' | 'close'; onPress: () => void }) {
  const theme = useTheme();
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      onPress={onPress}
      hitSlop={4}
      style={({ pressed }) => ({
        width: 40,
        height: 40,
        borderRadius: 20,
        alignItems: 'center',
        justifyContent: 'center',
        opacity: pressed ? 0.6 : 1,
      })}
    >
      <Icon name={icon} color={icon === 'close' ? theme.muted : theme.ink} size={20} strokeWidth={2} />
    </Pressable>
  );
}

/** Znak strefy parkowania z legendy i karty celu: „P” w kobaltowej ramce. */
function ParkingMark({ width = 36, height = 26 }: { width?: number; height?: number }) {
  const theme = useTheme();
  return (
    <View
      style={{
        width,
        height,
        borderRadius: 7,
        borderWidth: 1.5,
        borderColor: theme.accentMap,
        backgroundColor: theme.accentTint,
        alignItems: 'center',
        justifyContent: 'center',
      }}
    >
      <Text style={{ fontSize: width > 32 ? 13 : 12, fontWeight: '600', color: theme.accentMap }}>
        {t('map.legend.parkingMark')}
      </Text>
    </View>
  );
}

/** Legenda stref (makieta mapa-strefy): tylko rodzaje stref widocznych w aplikacji. */
function LegendSheet({ zones }: { zones: ZoneCollection | null }) {
  const theme = useTheme();
  const present = new Set((zones?.features ?? []).map((f) => f.properties.type));
  const types = LEGEND_TYPES.filter((type) => present.has(type));
  const limits = slowLimits(zones);
  const slowLead =
    limits.length > 1
      ? t('map.legend.SLOW.leadRange', { min: limits[0], max: limits[limits.length - 1] })
      : t('map.legend.SLOW.lead', { limit: limits[0] ?? '' });
  return (
    <FloatingSheet style={{ gap: 14 }}>
      <Text accessibilityRole="header" style={{ fontSize: 17, fontWeight: '600', color: theme.ink }}>
        {t('map.legend.title')}
      </Text>
      {types.length === 0 && <SheetText>{t('map.legend.empty')}</SheetText>}
      {types.map((type) => (
        <View key={type} style={{ flexDirection: 'row', alignItems: 'center', gap: 14 }}>
          {type === 'PARKING' ? (
            <ParkingMark />
          ) : (
            <View
              style={{
                width: 36,
                height: 26,
                borderRadius: 7,
                borderWidth: 1.5,
                borderStyle: type === 'SLOW' ? 'dashed' : 'solid',
                borderColor: type === 'SLOW' ? theme.warning : theme.danger,
                backgroundColor: type === 'SLOW' ? theme.warningTint : theme.dangerTint,
              }}
            />
          )}
          <View style={{ flex: 1, gap: 2 }}>
            <Text style={{ fontSize: 15, fontWeight: '600', color: theme.ink }}>
              {t.dynamic(`map.legend.${type}.title`)}
            </Text>
            <Text style={{ fontSize: 13, color: theme.muted }}>
              {type === 'SLOW' ? slowLead : t.dynamic(`map.legend.${type}.lead`)}
            </Text>
          </View>
        </View>
      ))}
    </FloatingSheet>
  );
}

/** Karta celu z wyszukiwania (makieta szukaj-wynik, decyzja D5). `result` nieustalony: szacunek w drodze. */
function DestinationCard({
  place,
  user,
  result,
  nearest,
  busy,
  error,
  onParking,
  onScooter,
  onReserve,
  onScan,
}: {
  place: Place;
  user: MapPoint | null;
  result: DestinationView | null | undefined;
  nearest: NearbyScooter | null;
  busy: boolean;
  error: string | null;
  onParking: (anchor: LngLat) => void;
  onScooter: (id: string) => void;
  onReserve: (id: string) => void;
  onScan: () => void;
}) {
  const theme = useTheme();
  const away = user ? metersBetween(user, place) : null;
  const subtitle =
    away !== null
      ? place.description
        ? t('map.destination.awayWithDescription', { description: place.description, distance: distance(away) })
        : t('map.destination.away', { distance: distance(away) })
      : (place.description ?? '');
  const route = result?.route;
  const minutes = route && !route.approximate && route.durationSec !== null ? routeMinutes(route.durationSec) : null;
  const note = result?.speedLimitKmh
    ? t('map.destination.noteSlow', { limit: result.speedLimitKmh })
    : t('map.destination.note');
  const rowStyle = {
    flexDirection: 'row' as const,
    alignItems: 'center' as const,
    gap: 12,
    minHeight: 54,
    paddingHorizontal: 16,
  };
  return (
    <FloatingSheet>
      <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start', gap: 16 }}>
        <View style={{ flex: 1, gap: 4, minWidth: 0 }}>
          <Text
            accessibilityRole="header"
            numberOfLines={2}
            style={{ fontSize: 22, fontWeight: '600', letterSpacing: -0.4, color: theme.ink }}
          >
            {place.name}
          </Text>
          {subtitle ? <Text style={{ fontSize: 14, color: theme.muted }}>{subtitle}</Text> : null}
        </View>
        {result === undefined ? (
          <ActivityIndicator
            accessibilityLabel={t('map.destination.loading')}
            color={theme.accent}
            style={{ marginTop: 6 }}
          />
        ) : minutes !== null ? (
          <View style={{ alignItems: 'flex-end', gap: 2 }}>
            <Text style={{ fontSize: 27, fontWeight: '500', letterSpacing: -0.5, lineHeight: 30, color: theme.ink }}>
              {t('map.destination.minutes', { minutes })}
            </Text>
            <Text style={{ fontSize: 13, color: theme.muted }}>{t('map.destination.byScooter')}</Text>
          </View>
        ) : route ? (
          <Text style={{ fontSize: 14, color: theme.muted, marginTop: 4 }}>
            {t('map.destination.straight', { distance: distance(route.distanceM) })}
          </Text>
        ) : null}
      </View>
      <View
        style={{
          backgroundColor: theme.surface,
          borderRadius: 20,
          borderWidth: 1,
          borderColor: theme.line,
          overflow: 'hidden',
        }}
      >
        {result !== undefined && (
          <Pressable
            accessibilityRole="button"
            disabled={!result?.parking}
            onPress={() => result?.parking && onParking(result.parking.anchor)}
            style={rowStyle}
          >
            <ParkingMark width={30} height={22} />
            {result?.parking ? (
              <>
                <Text numberOfLines={1} style={{ flex: 1, fontSize: 15, fontWeight: '500', color: theme.ink }}>
                  {`${result.parking.code} ${result.parking.name}`}
                </Text>
                <Text style={{ fontSize: 14, color: theme.muted }}>
                  {t('map.destination.parkingFromTarget', { distance: distance(result.parking.distanceM) })}
                </Text>
              </>
            ) : (
              <Text style={{ flex: 1, fontSize: 15, color: theme.muted }}>{t('map.destination.noParking')}</Text>
            )}
          </Pressable>
        )}
        <Pressable
          accessibilityRole="button"
          disabled={!nearest}
          onPress={() => nearest && onScooter(nearest.id)}
          style={[rowStyle, result !== undefined ? { borderTopWidth: 1, borderColor: theme.line } : null]}
        >
          <View style={{ width: 30, alignItems: 'center' }}>
            <Icon name="scooter" color={theme.ink} size={22} />
          </View>
          {nearest ? (
            <>
              <Text numberOfLines={1} style={{ flex: 1, fontSize: 15, fontWeight: '500', color: theme.ink }}>
                {t('map.destination.scooter', { number: scooterNo(nearest.number) })}
              </Text>
              {user && (
                <Text style={{ fontSize: 14, color: theme.muted }}>
                  {t('map.destination.scooterAway', { distance: distance(nearest.distanceM) })}
                </Text>
              )}
            </>
          ) : (
            <Text style={{ flex: 1, fontSize: 15, color: theme.muted }}>{t('map.destination.noScooter')}</Text>
          )}
        </Pressable>
      </View>
      <Text style={{ fontSize: 13, lineHeight: 19, color: theme.muted, marginTop: -4 }}>
        {result && !result.insideServiceArea ? `${t('map.destination.noteOutside')} ${note}` : note}
      </Text>
      {error && <SheetText style={{ color: theme.danger, fontSize: 14 }}>{error}</SheetText>}
      {nearest ? (
        <ButtonRow split>
          <Button
            label={t('map.destination.reserve')}
            kind="secondary"
            busy={busy}
            onPress={() => onReserve(nearest.id)}
          />
          <Button label={t('map.destination.scan')} onPress={onScan} />
        </ButtonRow>
      ) : (
        <Button label={t('map.destination.scan')} onPress={onScan} />
      )}
    </FloatingSheet>
  );
}

/** Karta wybranej hulajnogi z rezerwacją i skanem (makieta mapa-karta-rezerwuj); po „Trasa” z trasą pieszą. */
function ScooterCard({
  scooter,
  user,
  walk,
  minuteRate,
  freeMinutes,
  busy,
  error,
  onReserve,
  onScan,
  onReport,
}: {
  scooter: NearbyScooter;
  user: MapPoint | null;
  walk: { data: RouteView | null; failed: boolean } | null;
  minuteRate: number;
  freeMinutes: number;
  busy: boolean;
  error: string | null;
  onReserve: () => void;
  onScan: () => void;
  onReport: () => void;
}) {
  const theme = useTheme();
  const walkText = walk?.data
    ? walkLabel(walk.data, user)
    : user
      ? t('map.card.walk', { distance: distance(scooter.distanceM), minutes: walkMinutes(scooter.distanceM) })
      : '';
  return (
    <FloatingSheet>
      <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 16 }}>
        <View style={{ gap: 2 }}>
          <Text style={[sheetStyles.caption, { color: theme.muted }]}>
            {t('map.card.scooter', { number: scooterNo(scooter.number) })}
          </Text>
          <Text style={[sheetStyles.bigNumber, { color: theme.ink }]}>
            {t('units.percent', { value: scooter.batteryPct })}
          </Text>
          {scooter.rangeKm !== null && (
            <Text style={{ fontSize: 14, color: theme.muted }}>{t('map.card.range', { km: scooter.rangeKm })}</Text>
          )}
        </View>
        <ScooterRender
          variant={scooter.variant}
          side
          style={{ width: 140, height: 112 }}
          label={t('variants.render', { variant: t(`variants.${scooter.variant}`) })}
        />
      </View>
      <View
        style={{
          flexDirection: 'row',
          justifyContent: 'space-between',
          alignItems: 'center',
          gap: 8,
          paddingTop: 16,
          borderTopWidth: 1,
          borderColor: theme.line,
        }}
      >
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, flexShrink: 1 }}>
          {walk && <Icon name="walk" color={theme.accentMap} size={18} strokeWidth={2} />}
          <Text style={{ fontSize: 14, color: theme.ink, flexShrink: 1 }}>
            {walk && !walk.data && !walk.failed ? t('map.card.walkLoading') : walkText}
          </Text>
        </View>
        <Text style={{ fontSize: 14, fontWeight: '500', color: theme.ink }}>
          {t('map.card.price', { price: money(minuteRate) })}
        </Text>
      </View>
      <View style={{ flexDirection: 'row', alignItems: 'flex-start', gap: 12, marginTop: -4 }}>
        <SheetText style={{ fontSize: 14, flex: 1 }}>
          {t('map.card.freeReservation', { minutes: freeMinutes })}
        </SheetText>
        {/* Zgłoszenie z karty hulajnogi bez przejazdu (makieta zgloszenie-z-przejazdu, link pod ceną). */}
        <Pressable accessibilityRole="link" onPress={onReport} hitSlop={8}>
          <Text style={{ fontSize: 14, lineHeight: 22, fontWeight: '500', color: theme.accent }}>
            {t('map.card.report')}
          </Text>
        </Pressable>
      </View>
      {error && <SheetText style={{ color: theme.danger, fontSize: 14 }}>{error}</SheetText>}
      <ButtonRow split>
        <Button label={t('map.card.reserve')} kind="secondary" busy={busy} onPress={onReserve} />
        <Button label={t('map.card.scan')} onPress={onScan} />
      </ButtonRow>
    </FloatingSheet>
  );
}

/** Rezerwacja z odliczaniem (makiety mapa-rezerwacja, hulajnoga-trasa z trasą pieszą). */
function ReservationCard({
  tracked,
  user,
  walk,
  busy,
  error,
  onCancel,
  onScan,
}: {
  tracked: TrackedRental;
  user: MapPoint | null;
  walk: RouteView | null;
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
    user && v.scooter.lat !== null && v.scooter.lon !== null
      ? metersBetween(user, { lat: v.scooter.lat, lon: v.scooter.lon })
      : null;
  return (
    <FloatingSheet>
      <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 16 }}>
        <View style={{ gap: 2, flex: 1 }}>
          <Text style={{ fontSize: 14, fontWeight: '600', color: theme.accentMap }}>{t('map.reservation.label')}</Text>
          <Text
            accessibilityLabel={t('map.reservation.countdown', { time: clock(left) })}
            style={[sheetStyles.bigNumber, { color: theme.ink }]}
          >
            {clock(left)}
          </Text>
          <Text style={{ fontSize: 14, lineHeight: 20, color: theme.muted }}>
            {walk
              ? t('map.card.scooter', { number: scooterNo(v.scooter.number) })
              : away !== null && away >= ARRIVED_M
                ? t('map.reservation.waiting', { number: scooterNo(v.scooter.number), distance: distance(away) })
                : t('map.reservation.waitingHere', { number: scooterNo(v.scooter.number) })}
          </Text>
        </View>
        <ScooterRender
          variant={v.scooter.variant}
          side
          style={{ width: 120, height: 100 }}
          label={t('variants.render', { variant: t(`variants.${v.scooter.variant}`) })}
        />
      </View>
      {walk ? (
        <View
          style={{
            flexDirection: 'row',
            alignItems: 'center',
            gap: 12,
            paddingTop: 16,
            borderTopWidth: 1,
            borderColor: theme.line,
          }}
        >
          <IconBadge icon="walk" tone="accent" size={40} iconSize={20} />
          <View style={{ flex: 1, gap: 1 }}>
            <Text style={{ fontSize: 15, fontWeight: '500', color: theme.ink }}>{walkLabel(walk, user)}</Text>
            <Text style={{ fontSize: 13, color: theme.muted }}>{t('map.reservation.walkHint')}</Text>
          </View>
        </View>
      ) : null}
      <SheetText
        style={
          walk
            ? { fontSize: 14, marginTop: -2 }
            : { fontSize: 14, paddingTop: 16, borderTopWidth: 1, borderColor: theme.line }
        }
      >
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
      <Text
        accessibilityRole="header"
        style={{ fontSize: 22, fontWeight: '600', letterSpacing: -0.4, color: theme.ink }}
      >
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
        <Text style={{ fontSize: 16, fontWeight: '500', color: theme.ink }}>
          {clock(reservationSecondsLeft(tracked, now))}
        </Text>
      </View>
      <View style={{ gap: 10, marginTop: 24 }}>
        <Button label={t('map.cancel.confirm')} kind="dark" busy={busy} onPress={onConfirm} />
        <Button label={t('map.cancel.keep')} kind="secondary" onPress={onKeep} />
      </View>
    </BottomSheet>
  );
}
