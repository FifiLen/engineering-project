import type { NearestParkingRoute, RentalView } from '@hulajnogi/shared';
import { Redirect, router } from 'expo-router';
import { useEffect, useRef, useState, type ReactNode } from 'react';
import { ActivityIndicator, Pressable, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Icon, type IconName } from '../components/icons';
import { boundsOf, type MapFocus, type MapPoint } from '../components/map/map-layers';
import { MapView } from '../components/map/map-view';
import { FootNote, WaitScreen } from '../components/scooter';
import {
  AlertHeader,
  ButtonRow,
  FloatingSheet,
  IconBadge,
  Pill,
  RoundButton,
  SheetText,
  Stats,
  Steps,
  glass,
  type BadgeTone,
} from '../components/sheet';
import { Button, useTheme } from '../components/ui';
import { t } from '../i18n';
import { ApiError, errorMessage } from '../lib/api';
import { clock, distance, km, money, scooterNo, timeOnly } from '../lib/format';
import { useLocation } from '../lib/location';
import { usePreferences } from '../lib/preferences';
import { liveCounters, liveTotal, useNow, useRental, wantsParkingPhoto, type TrackedRental } from '../lib/rental';
import { loadNearestParking, rideLabel, routeMinutes, useLiveRoute } from '../lib/routes';
import { useZones } from '../lib/zones';

/** Najbliższa strefa parkowania w szczegółach błędu `OUTSIDE_PARKING`. */
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
 * komunikaty stref i prowadzenie do strefy (iteracja 4), poza strefą parkowania, kończenie i nieudane
 * odblokowanie. Stan pochodzi z widoku przejazdu
 * (`state`, `pendingCommand`, `notice`), a liczniki aplikacja dolicza lokalnie (ADR 0042).
 */
export default function RideScreen() {
  const theme = useTheme();
  const { rental, outcome, start, clearOutcome, photoSent } = useRental();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Zakończony przejazd prowadzi do zdjęcia parkowania (po zakończeniu przez klienta, ADR 0057), a potem
  // do podsumowania; zakończony zdalnie przez operatora od razu do podsumowania.
  useEffect(() => {
    if (outcome?.cause !== 'ended') return;
    const v = outcome.view;
    if (wantsParkingPhoto(v) && !photoSent(v.id)) router.replace({ pathname: '/zdjecie/[id]', params: { id: v.id } });
    else router.replace({ pathname: '/podsumowanie/[id]', params: { id: v.id } });
  }, [outcome, photoSent]);

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
                  // Ponowienie z tym samym źródłem płatności, które klient wybrał przy starcie (ADR 0049).
                  start(v.scooter.id, { paymentSource: v.settlement.source })
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
  if (v.state === 'ENDING' && v.endMode === 'CUSTOMER_OFFLINE') return <OfflineEnding tracked={rental} />;
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
              label: v.endZone
                ? t('ride.ending.inZone', { zone: `${v.endZone.code} ${v.endZone.name}` })
                : t('ride.ending.inParking'),
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
      header={
        <CenteredCaption>
          {t('ride.resuming.pauseTimer', { time: clock(liveCounters(tracked, now).pauseSeconds) })}
        </CenteredCaption>
      }
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

/** Chwilowe komunikaty strefy (bez osobnych plansz): wjazd i koniec wolnej jazdy, powrót silnika. */
const FLASH_MS = 5000;
/** „Jesteś w strefie … Możesz zakończyć przejazd.” po samoczynnym końcu prowadzenia. */
const ARRIVED_MS = 6000;

type StopReason = 'NO_RIDE' | 'OUT_OF_AREA';

/**
 * Przyczyna zatrzymania z widoku przejazdu (ADR 0044): strefa zakazu, a bez obszaru działania wśród
 * stref hulajnogi wyjazd poza obszar. Zatrzymanie bez żadnej z nich traktujemy jak zakaz.
 */
function stopReason(v: RentalView): StopReason | null {
  if (!v.zoneControl.stopped) return null;
  if (v.zones.some((z) => z.type === 'NO_RIDE')) return 'NO_RIDE';
  return v.zones.some((z) => z.type === 'SERVICE_AREA') ? 'NO_RIDE' : 'OUT_OF_AREA';
}

/** Trasa do najbliższej strefy z błędu `OUTSIDE_PARKING`, gdy API tras nie odpowiada: linia prosta. */
function straightTo(hint: NearestParking, from: MapPoint): NearestParkingRoute {
  const target: [number, number] = [hint.lon, hint.lat];
  return {
    zone: { id: hint.code, code: hint.code, name: hint.name, anchor: target },
    target,
    route: {
      line: [[from.lon, from.lat], target],
      distanceM: hint.distanceM,
      durationSec: null,
      approximate: true,
      profile: 'bike',
    },
  };
}

interface Banner {
  key: string;
  icon: IconName;
  tone: BadgeTone;
  title: string;
  lead: string;
}

/**
 * Jazda i pauza na mapie (makiety produkt-przejazd, przejazd-pauza, przejazd-poza-strefa,
 * przejazd-blokada-nieudana, przejazd-strefa, przejazd-zakaz, przejazd-poza-obszarem,
 * przejazd-prowadz-do-strefy). Komunikat strefy pochodzi z `zoneControl` i `zones` w widoku przejazdu.
 */
function Riding({ tracked }: { tracked: TrackedRental }) {
  const theme = useTheme();
  const insets = useSafeAreaInsets();
  const now = useNow();
  const { pause, resume, end } = useRental();
  const { position } = useLocation();
  const { showZones } = usePreferences();
  const { zones } = useZones();
  // Najbliższa strefa z odmowy zakończenia; panel „Tu nie zakończysz jazdy”; prowadzenie do strefy.
  const [hint, setHint] = useState<NearestParking | null>(null);
  const [panel, setPanel] = useState(false);
  // Odmowa zakończenia bez łączności z powodu starej pozycji (`POSITION_STALE`, ADR 0056).
  const [stale, setStale] = useState(false);
  const [guiding, setGuiding] = useState(false);
  const [arrived, setArrived] = useState<{ code: string; name: string } | null>(null);
  const [flash, setFlash] = useState<Banner | null>(null);
  const [busy, setBusy] = useState<'pause' | 'resume' | 'end' | null>(null);
  const [error, setError] = useState<string | null>(null);
  const v = tracked.view;
  const scooter = scooterPoint(v);
  const paused = v.state === 'PAUSED';
  const counters = liveCounters(tracked, now);
  const stop = stopReason(v);
  const limit = stop ? null : v.zoneControl.speedLimitKmh;
  // Limit ze strefy wolnej jazdy; bez niej limit 10 km/h pochodzi z krytycznej baterii (ADR 0056).
  const zoneLimit = limit !== null && v.zones.some((z) => z.speedLimitKmh !== null) ? limit : null;
  const battery = v.batteryAlert ?? null;
  const parkingZone = v.zones.find((z) => z.type === 'PARKING');
  // Hulajnoga bez łączności (ADR 0056): ostatnia pozycja i jej wiek, prowadzenie od telefonu.
  const offline = v.scooterOnline === false;
  const positionAge = v.positionAt
    ? Math.max(0, (Date.parse(v.asOf) - Date.parse(v.positionAt)) / 1000 + (now - tracked.receivedAt) / 1000)
    : null;
  const origin = offline ? position : scooter;

  // Trasa do strefy parkowania od hulajnogi (ADR 0048), a bez łączności od telefonu, bo klient stoi przy
  // hulajnodze, a jej pozycja się nie zmienia: podgląd w panelu odmowy i prowadzenie.
  const parking = useLiveRoute<NearestParkingRoute>(
    panel || guiding ? 'parking' : null,
    origin,
    loadNearestParking,
    (r) => r.route.line,
  );
  const toParking =
    parking.data ?? (hint && origin && (parking.failed || parking.revision > 0) ? straightTo(hint, origin) : null);

  // Zmiany stref w trakcie jazdy: chwilowy komunikat po zdjęciu zatrzymania i przy wjeździe do wolnej jazdy i wyjeździe z niej.
  const previous = useRef({ stop, limit: zoneLimit });
  useEffect(() => {
    const limit = zoneLimit;
    const before = previous.current;
    previous.current = { stop, limit };
    if (before.stop && !stop) {
      setFlash({
        key: 'resumed',
        icon: 'check',
        tone: 'neutral',
        title: t('ride.zone.resumed.title'),
        lead: t('ride.zone.resumed.lead'),
      });
    } else if (!stop && before.limit === null && limit !== null) {
      setFlash({
        key: 'slow',
        icon: 'gauge',
        tone: 'warning',
        title: t('ride.zone.SLOW.title'),
        lead: t('ride.zone.SLOW.lead', { limit }),
      });
    } else if (!stop && before.limit !== null && limit === null) {
      setFlash({
        key: 'slowEnded',
        icon: 'gauge',
        tone: 'neutral',
        title: t('ride.zone.slowEnded.title'),
        lead: t('ride.zone.slowEnded.lead'),
      });
    }
  }, [stop, zoneLimit]);
  useEffect(() => {
    if (!flash) return;
    const timer = setTimeout(() => setFlash(null), FLASH_MS);
    return () => clearTimeout(timer);
  }, [flash]);

  // Prowadzenie kończy się samo po wjeździe do strefy parkowania (ADR 0043); zmiana stanu w trakcie
  // renderowania, bo wynika wprost z nowego widoku przejazdu.
  if (guiding && parkingZone) {
    setGuiding(false);
    setArrived({ code: parkingZone.code, name: parkingZone.name });
  }
  useEffect(() => {
    if (!arrived) return;
    const timer = setTimeout(() => setArrived(null), ARRIVED_MS);
    return () => clearTimeout(timer);
  }, [arrived]);

  // Widok: hulajnoga (podąża za jazdą), przy odmowie i prowadzeniu hulajnoga razem z trasą do strefy.
  // Mapa przesuwa się tylko po zmianie klucza: nowy punkt trasy, nowa trasa do strefy albo panel odmowy.
  const showParking = (panel || guiding) && !!toParking;
  const parkingBounds =
    showParking && origin ? boundsOf([[origin.lon, origin.lat], toParking!.target, ...toParking!.route.line]) : null;
  const focus: MapFocus | null = !scooter
    ? null
    : parkingBounds
      ? {
          key: `parking:${panel ? 'panel' : 'guide'}:${parking.revision}:${toParking!.zone.code}`,
          bounds: parkingBounds,
        }
      : { key: `follow:${v.route.length}`, center: [scooter.lon, scooter.lat], zoom: 16 };

  async function act(kind: 'pause' | 'resume' | 'end', action: () => Promise<unknown>) {
    setBusy(kind);
    setError(null);
    try {
      await action();
      setPanel(false);
    } catch (e) {
      const nearest =
        e instanceof ApiError && e.code === 'OUTSIDE_PARKING'
          ? (e.details?.nearestParking as NearestParking | undefined)
          : undefined;
      if (e instanceof ApiError && (e.code === 'OUTSIDE_PARKING' || e.code === 'POSITION_STALE')) {
        setHint(nearest ?? null);
        setStale(e.code === 'POSITION_STALE');
        setGuiding(false);
        setPanel(true);
      } else setError(errorMessage(e));
    } finally {
      setBusy(null);
    }
  }

  // Komunikat z widoku przejazdu, dopóki nie trwa kolejna komenda.
  const notice = v.pendingCommand ? null : v.notice;
  const lockFailed = notice === 'LOCK_FAILED';
  const failure =
    notice === 'LOCK_FAILED'
      ? {
          title: t('ride.lockFailed.title'),
          lead: t('ride.lockFailed.lead', { number: scooterNo(v.scooter.number) }),
          icon: 'lockOpen' as const,
        }
      : notice === 'PAUSE_FAILED'
        ? {
            title: t('ride.pauseFailed.title'),
            lead: t('ride.pauseFailed.lead', { number: scooterNo(v.scooter.number) }),
            icon: 'lockOpen' as const,
          }
        : notice === 'RESUME_FAILED'
          ? {
              title: t('ride.resumeFailed.title'),
              lead: t('ride.resumeFailed.lead', { number: scooterNo(v.scooter.number) }),
              icon: 'lock' as const,
            }
          : error
            ? { title: error, lead: '', icon: 'alert' as const }
            : null;

  // Komunikat u góry (Ustalenia z plansz 22-mobile-strefy): zatrzymanie ma pierwszeństwo, potem koniec
  // prowadzenia (strefa parkowania może leżeć w wolnej jeździe), chwilowe komunikaty, karta prowadzenia
  // i trwała wolna jazda.
  let banner: Banner | null = null;
  if (!paused && !panel) {
    if (offline) {
      // Hulajnoga nie odpowiada (makieta przejazd-lacznosc); po 30 min naliczanie stoi, a kończy operator.
      banner = {
        key: 'offline',
        icon: 'wifiOff',
        tone: 'neutral',
        title: v.billingStopped ? t('ride.offline.stoppedTitle') : t('ride.offline.title'),
        lead: v.billingStopped ? t('ride.offline.stoppedLead') : t('ride.offline.lead'),
      };
    } else if (stop) {
      banner = {
        key: stop,
        icon: stop === 'NO_RIDE' ? 'noEntry' : 'map',
        tone: 'danger',
        title: t.dynamic(`ride.zone.${stop}.title`),
        lead: t.dynamic(`ride.zone.${stop}.lead`),
      };
    } else if (arrived) {
      banner = {
        key: 'arrived',
        icon: 'parking',
        tone: 'accent',
        title: t('ride.guide.arrived', { zone: `${arrived.code} ${arrived.name}` }),
        lead: t('ride.guide.arrivedLead'),
      };
    } else if (flash) banner = flash;
    else if (battery && !guiding) {
      // Niska bateria (makieta przejazd-bateria): przy progu krytycznym hulajnoga zwalnia do 10 km/h.
      banner = {
        key: `battery:${battery}`,
        icon: 'batteryLow',
        tone: 'warning',
        title: t.dynamic(`ride.lowBattery.${battery}.title`),
        lead: t.dynamic(`ride.lowBattery.${battery}.lead`, { value: v.scooter.batteryPct ?? 0, limit: limit ?? 0 }),
      };
    } else if (!guiding && limit !== null) {
      banner = {
        key: 'slow',
        icon: 'gauge',
        tone: 'warning',
        title: t('ride.zone.SLOW.title'),
        lead: t('ride.zone.SLOW.lead', { limit }),
      };
    }
  }
  const guideCard = !paused && !panel && guiding && !banner && toParking;

  const pauseTimer = clock(counters.pauseSeconds);
  // Arkusz jazdy: tło ekranu w jasnym motywie, powierzchnia w ciemnym (makiety produkt-przejazd, ciemny-przejazd).
  const sheetBg = theme.scheme === 'dark' ? theme.surface : theme.bg;
  const rideTimer = clock(counters.rideSeconds + counters.pauseSeconds);
  const sheetHeight = limit !== null ? 400 : 384;
  const speed = v.speedKmh !== null ? t('units.kmh', { value: Math.round(v.speedKmh) }) : t('scooter.noValue');
  const outsideSubtitle =
    stop === 'NO_RIDE'
      ? t('ride.outside.subtitleNoRide')
      : stop === 'OUT_OF_AREA'
        ? t('ride.outside.subtitleOutsideArea')
        : t('ride.outside.subtitle');

  let bottom: ReactNode;
  if (panel) {
    const route = toParking?.route;
    const zoneName = toParking
      ? `${toParking.zone.code} ${toParking.zone.name}`
      : hint
        ? `${hint.code} ${hint.name}`
        : '';
    const meters = route?.distanceM ?? hint?.distanceM ?? null;
    // Bez łączności (makieta koniec-offline-poza-strefa): ostatnia pozycja poza strefą albo za stara.
    const subtitle = stale
      ? t('ride.offlineEnd.staleSubtitle')
      : offline
        ? t('ride.offlineEnd.subtitle')
        : outsideSubtitle;
    const lead = stale
      ? t('ride.offlineEnd.staleLead', { minutes: Math.max(1, Math.round((positionAge ?? 0) / 60)) })
      : offline && meters !== null
        ? t('ride.offlineEnd.lead', { zone: zoneName, distance: distance(meters) })
        : meters === null
          ? null
          : route && !route.approximate && route.durationSec !== null
            ? t('ride.outside.leadRoute', {
                zone: zoneName,
                distance: distance(meters),
                minutes: routeMinutes(route.durationSec),
              })
            : t('ride.outside.lead', { zone: zoneName, distance: distance(meters) });
    bottom = (
      <FloatingSheet>
        <AlertHeader icon="parking" tone="danger" title={t('ride.outside.title')} subtitle={subtitle} />
        {lead && <SheetText>{lead}</SheetText>}
        <View style={{ gap: 10 }}>
          {(!stale || origin) && (
            <Button
              label={t('ride.outside.guide')}
              disabled={!toParking}
              onPress={() => {
                setPanel(false);
                setArrived(null);
                setGuiding(true);
              }}
            />
          )}
          <Button label={t('ride.outside.back')} kind="secondary" onPress={() => setPanel(false)} />
        </View>
        {(offline || stale) && (
          <Text style={{ fontSize: 14, color: theme.muted, textAlign: 'center', marginTop: -2 }}>
            {t('ride.help', { phone: t('blocked.phone') })}
          </Text>
        )}
      </FloatingSheet>
    );
  } else if (paused) {
    bottom = (
      <FloatingSheet>
        <View style={{ gap: 4 }}>
          <Text style={{ fontSize: 14, fontWeight: '600', color: theme.muted }}>{t('ride.paused.label')}</Text>
          <Text style={{ fontSize: 56, fontWeight: '500', letterSpacing: -2, lineHeight: 58, color: theme.ink }}>
            {pauseTimer}
          </Text>
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
      <View
        style={{
          position: 'absolute',
          left: 0,
          right: 0,
          bottom: 0,
          height: sheetHeight + insets.bottom,
          backgroundColor: sheetBg,
          borderTopLeftRadius: 32,
          borderTopRightRadius: 32,
          paddingTop: 32,
          paddingHorizontal: 24,
          paddingBottom: 28 + insets.bottom,
        }}
      >
        {limit !== null ? (
          // Wolna jazda (makieta przejazd-strefa): prędkość jako główna liczba, pod nią limit strefy.
          <>
            <View style={{ flexDirection: 'row', justifyContent: 'center', alignItems: 'flex-end', gap: 10 }}>
              <Text
                accessibilityLabel={speed}
                style={{ fontSize: 72, fontWeight: '500', letterSpacing: -2.5, lineHeight: 74, color: theme.ink }}
              >
                {v.speedKmh !== null ? String(Math.round(v.speedKmh)) : t('scooter.noValue')}
              </Text>
              <Text style={{ fontSize: 18, fontWeight: '500', color: theme.muted, paddingBottom: 10 }}>
                {t('ride.zone.kmh')}
              </Text>
            </View>
            <ZoneChip tone="warning">{t('ride.zone.limit', { limit })}</ZoneChip>
            <View style={{ marginTop: 28 }}>
              <Stats
                items={[
                  { value: rideTimer, label: t('ride.timeShort') },
                  { value: km(v.distanceM), label: t('ride.distance') },
                  { value: money(liveTotal(tracked, now)), label: t('ride.cost') },
                ]}
              />
            </View>
          </>
        ) : (
          <>
            <Text style={{ fontSize: 13, fontWeight: '500', color: theme.muted, textAlign: 'center' }}>
              {t('ride.time')}
            </Text>
            <Text
              accessibilityRole="timer"
              style={{
                fontSize: 72,
                fontWeight: '500',
                letterSpacing: -2.5,
                lineHeight: 74,
                textAlign: 'center',
                marginTop: 6,
                color: theme.ink,
              }}
            >
              {rideTimer}
            </Text>
            {stop && <ZoneChip tone="danger">{t('ride.zone.stopped')}</ZoneChip>}
            <View style={{ marginTop: stop ? 22 : 28 }}>
              <Stats
                items={[
                  { value: km(v.distanceM), label: t('ride.distance') },
                  offline
                    ? {
                        value: t('scooter.noValue'),
                        label:
                          positionAge !== null
                            ? t('ride.offline.lastPosition', { time: clock(positionAge) })
                            : t('ride.offline.noPosition'),
                      }
                    : battery && v.scooter.batteryPct !== null
                      ? {
                          value: t('units.percent', { value: v.scooter.batteryPct }),
                          label: t('ride.batteryShort'),
                          color: theme.warning,
                        }
                      : { value: speed, label: t('ride.speed') },
                  { value: money(liveTotal(tracked, now)), label: t('ride.cost') },
                ]}
              />
            </View>
          </>
        )}
        <View style={{ flex: 1 }} />
        <ButtonRow>
          {battery && !guiding && !offline ? (
            // Niska bateria (makieta przejazd-bateria): prowadzenie do strefy zamiast pauzy.
            <Button
              label={t('ride.outside.guide')}
              kind="secondary"
              onPress={() => {
                setArrived(null);
                setGuiding(true);
              }}
            />
          ) : (
            <Button
              label={t('ride.pause')}
              kind="secondary"
              busy={busy === 'pause' || v.pendingCommand === 'LOCK'}
              disabled={!!busy || !!v.pendingCommand}
              onPress={() => void act('pause', pause)}
            />
          )}
          <Button
            label={lockFailed ? t('ride.retry') : t('ride.end')}
            kind="dark"
            busy={busy === 'end'}
            disabled={!!busy || !!v.pendingCommand}
            onPress={() => void act('end', end)}
          />
        </ButtonRow>
        {lockFailed ? (
          <Text style={{ marginTop: 14, fontSize: 14, color: theme.muted, textAlign: 'center' }}>
            {t('ride.help', { phone: t('blocked.phone') })}
          </Text>
        ) : stop ? (
          <Text style={{ marginTop: 14, fontSize: 14, color: theme.muted, textAlign: 'center' }}>
            {t.dynamic(`ride.zone.${stop}.note`)}
          </Text>
        ) : null}
      </View>
    );
  }

  // Linie na mapie: pełna kobaltowa to jazda (ślad albo prowadzenie), przerywana to podgląd i linia prosta bez OSRM.
  const parkingLine = showParking ? toParking!.route.line : [];
  const solidParking = guiding && showParking && !toParking!.route.approximate;
  const topInset = insets.top + (banner || guideCard ? 140 : 80);

  return (
    <View style={{ flex: 1, backgroundColor: theme.map }} accessibilityLabel={t('ride.map')}>
      {focus && (
        <MapView
          focus={focus}
          zones={showZones || panel || guiding || stop ? zones : null}
          route={guiding ? [] : v.route}
          routeMuted={paused}
          drive={solidParking ? parkingLine : []}
          guide={solidParking ? [] : parkingLine}
          user={paused || panel || offline ? position : scooter}
          userStyle={paused ? 'ring' : 'dot'}
          parked={paused || panel || offline ? scooter : null}
          padding={{ top: topInset, bottom: paused || panel ? 330 : sheetHeight + 16, left: 40, right: 40 }}
        />
      )}
      {banner ? (
        <ZoneBanner banner={banner} />
      ) : guideCard ? (
        <GuideCard route={toParking} from={scooter} onClose={() => setGuiding(false)} />
      ) : (
        <View
          style={{
            position: 'absolute',
            left: 16,
            right: 16,
            top: insets.top + 20,
            flexDirection: 'row',
            justifyContent: 'space-between',
            gap: 10,
          }}
        >
          {paused ? (
            <Pill icon="lockClosed">{t('ride.paused.locked')}</Pill>
          ) : panel && offline ? (
            <Pill icon="wifiOff">
              {t('ride.offlineEnd.pill', { minutes: Math.max(1, Math.round((positionAge ?? 0) / 60)) })}
            </Pill>
          ) : panel ? (
            <Pill>{t('ride.paused.rideTimer', { time: rideTimer })}</Pill>
          ) : (
            <View />
          )}
          {paused ? (
            <Pill>{t('ride.paused.rideTimer', { time: clock(counters.rideSeconds) })}</Pill>
          ) : panel && offline ? (
            <Pill>{rideTimer}</Pill>
          ) : panel ? (
            <Pill>{km(v.distanceM)}</Pill>
          ) : v.scooter.batteryPct !== null ? (
            <View accessible accessibilityLabel={t('ride.battery', { value: v.scooter.batteryPct })}>
              <Pill>{t('units.percent', { value: v.scooter.batteryPct })}</Pill>
            </View>
          ) : null}
        </View>
      )}
      {failure && !panel && (
        <View
          accessibilityRole="alert"
          style={[
            glass(theme),
            {
              position: 'absolute',
              left: 12,
              right: 12,
              bottom: (paused ? 300 : sheetHeight + 12) + insets.bottom,
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
            {failure.lead ? (
              <Text style={{ fontSize: 14, lineHeight: 20, color: theme.muted }}>{failure.lead}</Text>
            ) : null}
          </View>
        </View>
      )}
      {bottom}
    </View>
  );
}

/** Pigułka pod licznikiem: „Limit N km/h” (bursztyn) albo „Silnik zatrzymany” (kolor błędu). */
function ZoneChip({ tone, children }: { tone: 'warning' | 'danger'; children: string }) {
  const theme = useTheme();
  return (
    <View style={{ alignItems: 'center', marginTop: tone === 'warning' ? 10 : 12 }}>
      <View
        style={{
          height: 30,
          paddingHorizontal: 12,
          borderRadius: 15,
          justifyContent: 'center',
          backgroundColor: tone === 'warning' ? theme.warningTint : theme.dangerTint,
        }}
      >
        <Text style={{ fontSize: 13, fontWeight: '600', color: tone === 'warning' ? theme.warning : theme.danger }}>
          {children}
        </Text>
      </View>
    </View>
  );
}

/** Komunikat strefy u góry ekranu jazdy (makiety przejazd-strefa, przejazd-zakaz, przejazd-poza-obszarem). */
function ZoneBanner({ banner }: { banner: Banner }) {
  const theme = useTheme();
  const insets = useSafeAreaInsets();
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
          paddingVertical: 14,
          paddingHorizontal: 16,
          flexDirection: 'row',
          gap: 14,
          alignItems: banner.lead.length > 60 ? 'flex-start' : 'center',
        },
      ]}
    >
      <IconBadge icon={banner.icon} tone={banner.tone} size={44} iconSize={19} />
      <View style={{ flex: 1, gap: 3 }}>
        <Text style={{ fontSize: 16, fontWeight: '600', color: theme.ink }}>{banner.title}</Text>
        <Text style={{ fontSize: 14, lineHeight: 20, color: theme.muted }}>{banner.lead}</Text>
      </View>
    </View>
  );
}

/** Karta prowadzenia do strefy parkowania (makieta przejazd-prowadz-do-strefy). */
function GuideCard({
  route,
  from,
  onClose,
}: {
  route: NearestParkingRoute;
  from: MapPoint | null;
  onClose: () => void;
}) {
  const theme = useTheme();
  const insets = useSafeAreaInsets();
  return (
    <View
      accessibilityRole="summary"
      style={[
        glass(theme),
        {
          position: 'absolute',
          left: 16,
          right: 16,
          top: insets.top + 20,
          borderRadius: 22,
          paddingVertical: 12,
          paddingLeft: 14,
          paddingRight: 10,
          flexDirection: 'row',
          gap: 14,
          alignItems: 'center',
        },
      ]}
    >
      <IconBadge icon="parking" tone="accent" size={44} iconSize={20} />
      <View style={{ flex: 1, gap: 2, minWidth: 0 }}>
        <Text numberOfLines={1} style={{ fontSize: 16, fontWeight: '600', color: theme.ink }}>
          {t('ride.guide.title', { zone: `${route.zone.code} ${route.zone.name}` })}
        </Text>
        <Text style={{ fontSize: 14, color: theme.ink }}>{rideLabel(route.route, from)}</Text>
      </View>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={t('ride.guide.close')}
        onPress={onClose}
        hitSlop={6}
        style={({ pressed }) => ({
          width: 44,
          height: 44,
          borderRadius: 22,
          backgroundColor: theme.scheme === 'dark' ? 'rgba(255,255,255,0.08)' : 'rgba(22,24,29,0.06)',
          alignItems: 'center',
          justifyContent: 'center',
          opacity: pressed ? 0.7 : 1,
        })}
      >
        <Icon name="close" color={theme.ink} size={18} strokeWidth={2} />
      </Pressable>
    </View>
  );
}

/**
 * Zakończenie bez łączności (makieta koniec-offline, ADR 0056): naliczanie skończyło się przy żądaniu,
 * blokada czeka na powrót łączności do 10 min, a zdjęcie hulajnogi jest wymagane. Klient nie musi czekać:
 * po wysłaniu zdjęcia wraca do mapy, a przejazd zamknie się sam (z tą samą kwotą także bez blokady).
 */
function OfflineEnding({ tracked }: { tracked: TrackedRental }) {
  const theme = useTheme();
  const insets = useSafeAreaInsets();
  const now = useNow();
  const { photoSent } = useRental();
  const v = tracked.view;
  const scooter = scooterPoint(v);
  const done = !!v.parkingPhoto || photoSent(v.id);
  const counters = liveCounters(tracked, now);
  const zone = v.endZone ?? v.zones.find((z) => z.type === 'PARKING') ?? null;
  const ageMinutes = v.positionAt
    ? Math.max(0, Math.round((Date.parse(v.asOf) - Date.parse(v.positionAt) + now - tracked.receivedAt) / 60000))
    : null;
  // Koniec naliczania: chwila żądania, czyli start przejazdu z czasem jazdy i pauzy z widoku.
  const paidUntil =
    v.billedUntil ??
    (v.startedAt ? new Date(Date.parse(v.startedAt) + (v.rideSeconds + v.pauseSeconds) * 1000).toISOString() : null);
  const route = v.route;
  const bounds = route.length ? boundsOf(route) : null;
  const focus: MapFocus | null = bounds
    ? { key: 'offline-end', bounds }
    : scooter
      ? { key: 'offline-end', center: [scooter.lon, scooter.lat], zoom: 16 }
      : null;

  return (
    <View style={{ flex: 1, backgroundColor: theme.map }}>
      <View style={{ height: 240 + insets.top }} accessibilityLabel={t('ride.map')}>
        {focus && (
          <MapView
            focus={focus}
            route={route}
            routeMuted
            parked={scooter}
            padding={{ top: insets.top + 24, bottom: 48, left: 40, right: 40 }}
          />
        )}
      </View>
      <View
        style={{
          flex: 1,
          marginTop: -20,
          backgroundColor: theme.scheme === 'dark' ? theme.surface : theme.bg,
          borderTopLeftRadius: 32,
          borderTopRightRadius: 32,
          paddingTop: 24,
          paddingHorizontal: 24,
          paddingBottom: 16 + insets.bottom,
        }}
      >
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 14 }}>
          <IconBadge icon="wifiOff" tone="neutral" size={44} iconSize={19} />
          <View style={{ flex: 1, gap: 2 }}>
            <Text
              accessibilityRole="header"
              style={{ fontSize: 22, fontWeight: '600', letterSpacing: -0.4, color: theme.ink }}
            >
              {t('ride.offlineEnd.title')}
            </Text>
            <Text style={{ fontSize: 14, color: theme.muted }}>
              {t('ride.offlineEnd.notResponding', { number: scooterNo(v.scooter.number) })}
            </Text>
          </View>
        </View>
        <View style={{ marginTop: 22 }}>
          <Stats
            align="left"
            items={[
              { value: clock(counters.rideSeconds + counters.pauseSeconds), label: t('ride.timeShort') },
              { value: km(v.distanceM), label: t('ride.distance') },
              { value: money(v.price.total), label: t('ride.offlineEnd.toPay') },
            ]}
          />
        </View>
        <Steps
          style={{ marginTop: 24, paddingTop: 22, gap: 16, borderTopWidth: 1, borderColor: theme.line }}
          steps={[
            {
              label: zone
                ? t('ride.offlineEnd.position', { zone: `${zone.code} ${zone.name}` })
                : t('ride.offlineEnd.positionParking'),
              detail: ageMinutes !== null ? t('ride.offlineEnd.ago', { minutes: ageMinutes }) : undefined,
              state: 'done',
            },
            {
              label: paidUntil
                ? t('ride.offlineEnd.paidUntil', { time: timeOnly(paidUntil) })
                : t('ride.offlineEnd.paid'),
              detail: t('ride.offlineEnd.paidLead'),
              state: 'done',
            },
            { label: t('ride.offlineEnd.lock'), detail: t('ride.offlineEnd.lockLead'), state: 'spin' },
            done
              ? { label: t('ride.offlineEnd.photoDone'), state: 'done' }
              : { label: t('ride.offlineEnd.photo'), detail: t('ride.offlineEnd.photoLead'), state: 'next' },
          ]}
        />
        <View style={{ flex: 1 }} />
        <Text style={{ fontSize: 14, lineHeight: 20, color: theme.muted, textAlign: 'center', marginBottom: 14 }}>
          {t('ride.offlineEnd.note')}
        </Text>
        {done ? (
          <Button label={t('ride.offlineEnd.toMap')} kind="dark" onPress={() => router.replace('/mapa')} />
        ) : (
          <Button
            label={t('ride.offlineEnd.photo')}
            onPress={() => router.push({ pathname: '/zdjecie/[id]', params: { id: v.id, then: 'offline' } })}
          />
        )}
      </View>
    </View>
  );
}
