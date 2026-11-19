import type { FileView, RentalView } from '@hulajnogi/shared';
import { CameraView, useCameraPermissions } from 'expo-camera';
import { Image } from 'expo-image';
import * as Linking from 'expo-linking';
import { router, useLocalSearchParams } from 'expo-router';
import { useEffect, useRef, useState } from 'react';
import { ActivityIndicator, Platform, Pressable, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Icon } from '../../components/icons';
import { AlertHeader, FloatingSheet, RoundButton, SheetText } from '../../components/sheet';
import { SupportCallNote } from '../../components/support';
import { Button, useTheme } from '../../components/ui';
import { t } from '../../i18n';
import { ApiError, api, errorMessage } from '../../lib/api';
import { pickPhoto, preparePhoto, uploadPhoto, type LocalPhoto } from '../../lib/files';
import { scooterNo } from '../../lib/format';
import { isOfflineEnding, useRental } from '../../lib/rental';

const ON_CAMERA = '#F6F6F3';
const ON_CAMERA_MUTED = '#D5D7DC';
const CAMERA_BG = '#2A2D33';
const FRAME_BG = '#5A5D63';

/** Plik za duży albo w złym formacie: ponowienie nie pomoże, trzeba zrobić nowe zdjęcie. */
const REJECTED = new Set(['FILE_TOO_LARGE', 'FILE_TYPE_NOT_ALLOWED']);

type Stage = 'camera' | 'preview' | 'sending' | 'failed';

/**
 * Zdjęcie parkowania po zakończeniu (makiety przejazd-zdjecie, zdjecie-parkowania, -blad, -bez-aparatu;
 * ADR 0056, ADR 0057). Aparat z „Pomiń”, podgląd z „Zrób ponownie” i „Wyślij”, błąd z „Wyślij ponownie”
 * (ten sam plik, a po udanej wysyłce samo powiązanie z przejazdem), bez aparatu albo w wersji web wybór
 * pliku. Po zakończeniu bez łączności zdjęcie jest wymagane: bez „Pomiń”, z dopiskiem. `then`: dokąd
 * prowadzi koniec (podsumowanie, mapa albo powrót do ekranu zakończenia bez łączności).
 */
export default function ParkingPhotoScreen() {
  const theme = useTheme();
  const insets = useSafeAreaInsets();
  const { id, then } = useLocalSearchParams<{ id: string; then?: 'summary' | 'map' | 'offline' }>();
  const { rental, attachParkingPhoto } = useRental();
  const [permission, requestPermission] = useCameraPermissions();
  const camera = useRef<CameraView>(null);
  const [view, setView] = useState<RentalView | null>(rental?.view.id === id ? rental.view : null);
  const [stage, setStage] = useState<Stage>('camera');
  const [photo, setPhoto] = useState<LocalPhoto | null>(null);
  const [file, setFile] = useState<FileView | null>(null);
  const [failure, setFailure] = useState<{ code: string; message: string } | null>(null);
  const [capturing, setCapturing] = useState(false);

  useEffect(() => {
    api<RentalView>(`/rentals/${id}`)
      .then(setView)
      .catch(() => undefined);
  }, [id]);

  useEffect(() => {
    if (Platform.OS === 'web' || !permission) return;
    if (!permission.granted && permission.canAskAgain) void requestPermission();
  }, [permission, requestPermission]);
  // Bez aparatu: wersja web albo odmowa bez możliwości ponownego pytania.
  const noCamera = Platform.OS === 'web' || (!!permission && !permission.granted && !permission.canAskAgain);

  const required = !!view && (!!view.parkingPhotoRequired || isOfflineEnding(view));
  const finish = () => {
    if (then === 'offline') {
      if (router.canGoBack()) router.back();
      else router.replace('/przejazd');
    } else if (then === 'map') router.dismissTo('/mapa');
    else router.replace({ pathname: '/podsumowanie/[id]', params: { id } });
  };
  // Bez wymaganego zdjęcia zamknięcie aparatu to „Pomiń”; przy wymaganym powrót bez zdjęcia.
  const close = () => {
    if (required && then !== 'offline') router.dismissTo('/mapa');
    else finish();
  };

  async function capture() {
    if (!camera.current || capturing) return;
    setCapturing(true);
    try {
      const shot = await camera.current.takePictureAsync({ quality: 1, exif: false });
      if (shot) show(await preparePhoto(shot.uri));
    } catch {
      setFailure({ code: 'CAMERA', message: t('parkingPhoto.cameraFailed') });
    } finally {
      setCapturing(false);
    }
  }

  async function chooseFile() {
    const result = await pickPhoto('library').catch(() => null);
    if (result?.kind === 'photo') show(result.photo);
  }

  function show(next: LocalPhoto) {
    setPhoto(next);
    setFile(null);
    setFailure(null);
    setStage('preview');
  }

  async function send() {
    if (!photo) return;
    setStage('sending');
    setFailure(null);
    try {
      const uploaded = file ?? (await uploadPhoto(photo, 'PARKING_PHOTO'));
      setFile(uploaded);
      await attachParkingPhoto(id, uploaded.id).catch((e: unknown) => {
        // Zdjęcie dodane wcześniej (np. na innym urządzeniu): ekran ma już to, czego potrzebuje.
        if (!(e instanceof ApiError) || e.code !== 'PARKING_PHOTO_EXISTS') throw e;
      });
      finish();
    } catch (e) {
      const code = e instanceof ApiError ? e.code : 'INTERNAL_ERROR';
      if (REJECTED.has(code)) setFile(null);
      setFailure({ code, message: errorMessage(e) });
      setStage('failed');
    }
  }

  const retake = () => {
    setPhoto(null);
    setFile(null);
    setFailure(null);
    setStage('camera');
  };

  const subtitle = view
    ? view.endZone
      ? t('parkingPhoto.subtitle', {
          number: scooterNo(view.scooter.number),
          zone: `${view.endZone.code} ${view.endZone.name}`,
        })
      : t('parkingPhoto.subtitleShort', { number: scooterNo(view.scooter.number) })
    : '';
  const requiredNote = (
    <Text style={{ fontSize: 13, lineHeight: 19, color: '#A3A6AD', textAlign: 'center' }}>
      {t('parkingPhoto.required')}
    </Text>
  );

  // Podgląd, wysyłka i błąd wysyłki.
  if (photo && stage !== 'camera') {
    const rejected = !!failure && REJECTED.has(failure.code);
    return (
      <View style={{ flex: 1, backgroundColor: CAMERA_BG }}>
        <View style={{ paddingTop: insets.top + 22, paddingHorizontal: 24, alignItems: 'center', gap: 4 }}>
          <Text
            accessibilityRole="header"
            style={{ fontSize: 20, fontWeight: '600', letterSpacing: -0.4, color: ON_CAMERA }}
          >
            {t('parkingPhoto.title')}
          </Text>
          {subtitle ? <Text style={{ fontSize: 14, color: ON_CAMERA_MUTED }}>{subtitle}</Text> : null}
        </View>
        <View
          style={{
            flex: 1,
            marginTop: 18,
            marginHorizontal: 16,
            borderRadius: 28,
            overflow: 'hidden',
            backgroundColor: FRAME_BG,
          }}
        >
          <Image
            source={{ uri: photo.uri }}
            style={StyleSheet.absoluteFill}
            contentFit="cover"
            accessibilityLabel={t('parkingPhoto.previewLabel')}
          />
          {stage === 'failed' && <View style={[StyleSheet.absoluteFill, { backgroundColor: 'rgba(10,11,14,0.45)' }]} />}
        </View>
        {stage === 'failed' && failure ? (
          <>
            <View style={{ height: 170 + insets.bottom }} />
            <FloatingSheet>
              <AlertHeader
                icon="upload"
                tone="danger"
                title={rejected ? t('parkingPhoto.rejected.title') : t('parkingPhoto.failed.title')}
              />
              <SheetText>
                {rejected
                  ? failure.message
                  : view && isOfflineEnding(view)
                    ? t('parkingPhoto.failed.leadOffline')
                    : t('parkingPhoto.failed.lead')}
              </SheetText>
              <View style={{ gap: 10 }}>
                {rejected ? (
                  <Button label={t('parkingPhoto.retake')} onPress={retake} />
                ) : (
                  <Button label={t('parkingPhoto.failed.retry')} onPress={() => void send()} />
                )}
                {required ? (
                  <SupportCallNote />
                ) : (
                  <Button label={t('parkingPhoto.skip')} kind="secondary" onPress={finish} />
                )}
              </View>
            </FloatingSheet>
          </>
        ) : (
          <View style={{ paddingHorizontal: 24, paddingTop: 24, paddingBottom: 28 + insets.bottom, gap: 6 }}>
            <View style={{ flexDirection: 'row', gap: 12 }}>
              <View style={{ flex: 1 }}>
                <Button
                  label={t('parkingPhoto.retake')}
                  kind="plain"
                  disabled={stage === 'sending'}
                  onPress={retake}
                  style={{ height: 56, backgroundColor: 'rgba(246,246,243,0.16)' }}
                  textColor={ON_CAMERA}
                />
              </View>
              <View style={{ flex: 1 }}>
                <SendButton busy={stage === 'sending'} onPress={() => void send()} />
              </View>
            </View>
            {required ? (
              <View style={{ paddingVertical: 12 }}>{requiredNote}</View>
            ) : (
              <Button
                label={t('parkingPhoto.skip')}
                kind="plain"
                disabled={stage === 'sending'}
                onPress={finish}
                textColor={ON_CAMERA_MUTED}
              />
            )}
            <Text style={{ fontSize: 13, color: '#A3A6AD', textAlign: 'center' }}>{t('parkingPhoto.retention')}</Text>
          </View>
        )}
      </View>
    );
  }

  // Bez aparatu (odmowa dostępu) i w wersji web: wybór pliku.
  if (noCamera) {
    const web = Platform.OS === 'web';
    return (
      <View style={{ flex: 1, backgroundColor: theme.camera }}>
        <View style={[StyleSheet.absoluteFill, { backgroundColor: 'rgba(10,11,14,0.55)' }]} />
        <View style={[styles.frameOff, { top: insets.top + 150 }]}>
          <Icon name="cameraOff" color="rgba(246,246,243,0.45)" size={40} strokeWidth={1.6} />
        </View>
        <View style={{ position: 'absolute', left: 16, top: insets.top + 20 }}>
          <RoundButton label={t('common.close')} kind="camera" onPress={close}>
            <Icon name="close" color={ON_CAMERA} size={18} strokeWidth={2.2} />
          </RoundButton>
        </View>
        <FloatingSheet>
          <AlertHeader
            icon="cameraOff"
            tone="neutral"
            title={web ? t('parkingPhoto.noCamera.titleWeb') : t('parkingPhoto.noCamera.title')}
          />
          <SheetText>{web ? t('parkingPhoto.noCamera.leadWeb') : t('parkingPhoto.noCamera.lead')}</SheetText>
          <View style={{ gap: 10 }}>
            <Button label={t('parkingPhoto.noCamera.file')} onPress={() => void chooseFile()} />
            {!web && (
              <Button
                label={t('scan.noCamera.settings')}
                kind="secondary"
                onPress={() => void Linking.openSettings()}
              />
            )}
          </View>
          <View style={{ alignItems: 'center', marginTop: -6 }}>
            {required ? (
              <Text
                style={{ fontSize: 14, lineHeight: 20, color: theme.muted, textAlign: 'center', paddingVertical: 12 }}
              >
                {t('parkingPhoto.required')}
              </Text>
            ) : (
              <Button label={t('parkingPhoto.skip')} kind="plain" onPress={finish} style={{ alignSelf: 'stretch' }} />
            )}
            <Text style={{ fontSize: 13, color: theme.muted }}>{t('parkingPhoto.formats')}</Text>
          </View>
        </FloatingSheet>
      </View>
    );
  }

  // Aparat (makieta przejazd-zdjecie z „Pomiń” pod spustem).
  return (
    <View style={{ flex: 1, backgroundColor: theme.camera }}>
      {permission?.granted && <CameraView ref={camera} style={StyleSheet.absoluteFill} facing="back" />}
      <View style={[styles.topBar, { top: insets.top + 20 }]}>
        <RoundButton label={required ? t('common.close') : t('parkingPhoto.skip')} kind="camera" onPress={close}>
          <Icon name="close" color={ON_CAMERA} size={18} strokeWidth={2.2} />
        </RoundButton>
      </View>
      <View style={[styles.heading, { top: insets.top + 74 }]}>
        <Text accessibilityRole="header" style={styles.title}>
          {t('parkingPhoto.cameraTitle')}
        </Text>
        <Text style={styles.lead}>{failure?.code === 'CAMERA' ? failure.message : t('parkingPhoto.cameraLead')}</Text>
      </View>
      <View style={[styles.frame, { top: insets.top + 170, bottom: 230 + insets.bottom }]} pointerEvents="none" />
      <View style={[styles.bottomBar, { paddingBottom: 24 + insets.bottom }]}>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={t('parkingPhoto.shutter')}
          disabled={!permission?.granted || capturing}
          onPress={() => void capture()}
          style={({ pressed }) => [styles.shutter, { opacity: pressed || capturing ? 0.7 : 1 }]}
        >
          {capturing ? <ActivityIndicator color={CAMERA_BG} /> : <View style={styles.shutterInner} />}
        </Pressable>
        {required ? (
          requiredNote
        ) : (
          <Button label={t('parkingPhoto.skip')} kind="plain" onPress={finish} textColor={ON_CAMERA_MUTED} />
        )}
      </View>
    </View>
  );
}

/** „Wyślij” ze wskaźnikiem i „Wysyłam…” w trakcie (makieta zdjecie-parkowania). */
function SendButton({ busy, onPress }: { busy: boolean; onPress: () => void }) {
  const theme = useTheme();
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityState={{ busy, disabled: busy }}
      disabled={busy}
      onPress={onPress}
      style={({ pressed }) => ({
        height: 56,
        borderRadius: 28,
        backgroundColor: theme.accent,
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'center',
        gap: 10,
        opacity: pressed ? 0.85 : 1,
      })}
    >
      {busy && <ActivityIndicator color={theme.onAccent} />}
      <Text style={{ fontSize: 17, fontWeight: '600', color: theme.onAccent }}>
        {busy ? t('parkingPhoto.sending') : t('parkingPhoto.send')}
      </Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  topBar: { position: 'absolute', left: 16, right: 16, flexDirection: 'row', justifyContent: 'space-between' },
  heading: { position: 'absolute', left: 24, right: 24, alignItems: 'center', gap: 8 },
  title: { fontSize: 22, fontWeight: '600', letterSpacing: -0.4, color: ON_CAMERA, textAlign: 'center' },
  lead: { fontSize: 15, lineHeight: 22, color: ON_CAMERA_MUTED, textAlign: 'center' },
  frame: {
    position: 'absolute',
    left: 24,
    right: 24,
    borderRadius: 28,
    borderWidth: 2,
    borderColor: 'rgba(246,246,243,0.85)',
  },
  frameOff: {
    position: 'absolute',
    width: 250,
    height: 250,
    alignSelf: 'center',
    borderRadius: 32,
    borderWidth: 2,
    borderColor: 'rgba(246,246,243,0.35)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  bottomBar: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 0,
    paddingTop: 36,
    paddingHorizontal: 24,
    alignItems: 'center',
    gap: 10,
    backgroundColor: '#25272C',
  },
  shutter: {
    width: 78,
    height: 78,
    borderRadius: 39,
    borderWidth: 4,
    borderColor: ON_CAMERA,
    alignItems: 'center',
    justifyContent: 'center',
  },
  shutterInner: { width: 62, height: 62, borderRadius: 31, backgroundColor: ON_CAMERA },
});
