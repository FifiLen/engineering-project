import { parseScooterCode } from '@hulajnogi/shared';
import { CameraView, useCameraPermissions } from 'expo-camera';
import * as Linking from 'expo-linking';
import { router } from 'expo-router';
import { useEffect, useRef, useState } from 'react';
import { Platform, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Icon } from '../components/icons';
import { AlertHeader, FloatingSheet, RoundButton, SheetText } from '../components/sheet';
import { Button, useTheme } from '../components/ui';
import { t } from '../i18n';

const FRAME = 250;
const CAMERA_TEXT = '#C9CBD0';

/** Rogi ramki skanera (makieta flow-skan). */
function Frame({ color }: { color: string }) {
  const corner = { position: 'absolute' as const, width: 44, height: 44, borderColor: color };
  return (
    <View style={styles.frame} pointerEvents="none">
      <View style={[corner, { left: 0, top: 0, borderLeftWidth: 4, borderTopWidth: 4, borderTopLeftRadius: 32 }]} />
      <View style={[corner, { right: 0, top: 0, borderRightWidth: 4, borderTopWidth: 4, borderTopRightRadius: 32 }]} />
      <View style={[corner, { left: 0, bottom: 0, borderLeftWidth: 4, borderBottomWidth: 4, borderBottomLeftRadius: 32 }]} />
      <View style={[corner, { right: 0, bottom: 0, borderRightWidth: 4, borderBottomWidth: 4, borderBottomRightRadius: 32 }]} />
      <View style={styles.scanLine} />
    </View>
  );
}

/**
 * Skanowanie kodu QR z kierownicy (makiety flow-skan, skan-brak-aparatu; ADR 0040, ADR 0041). Kod spoza
 * formatu daje komunikat bez zapytania do API; numer prowadzi do szczegółów hulajnogi.
 */
export default function ScanScreen() {
  const theme = useTheme();
  const insets = useSafeAreaInsets();
  const [permission, requestPermission] = useCameraPermissions();
  const [torch, setTorch] = useState(false);
  const [invalid, setInvalid] = useState(false);
  const handled = useRef(false);

  useEffect(() => {
    if (permission && !permission.granted && permission.canAskAgain) void requestPermission();
  }, [permission, requestPermission]);

  const close = () => (router.canGoBack() ? router.back() : router.replace('/mapa'));
  const enterNumber = () => router.replace('/numer');
  const denied = permission && !permission.granted && !permission.canAskAgain;

  return (
    <View style={{ flex: 1, backgroundColor: theme.camera }}>
      {permission?.granted && (
        <CameraView
          style={StyleSheet.absoluteFill}
          facing="back"
          enableTorch={torch}
          barcodeScannerSettings={{ barcodeTypes: ['qr'] }}
          onBarcodeScanned={({ data }) => {
            if (handled.current) return;
            const number = parseScooterCode(data);
            if (number === null) {
              setInvalid(true);
              return;
            }
            handled.current = true;
            router.replace({ pathname: '/hulajnoga/[number]', params: { number: String(number) } });
          }}
        />
      )}
      {permission?.granted ? (
        <>
          <View style={[StyleSheet.absoluteFill, styles.dim]} pointerEvents="none" />
          <Frame color="#F6F6F3" />
          <View style={[styles.heading, { top: insets.top + 140 }]}>
            <Text accessibilityRole="header" style={styles.title}>
              {t('scan.title')}
            </Text>
            <Text style={styles.lead}>{invalid ? t('scan.notOurs') : t('scan.lead')}</Text>
          </View>
          <View style={[styles.bottom, { bottom: 12 + insets.bottom }]}>
            <Text style={styles.damaged}>{t('scan.damaged')}</Text>
            <Button label={t('scan.enterNumber')} kind="light" onPress={enterNumber} />
          </View>
        </>
      ) : (
        <>
          <View style={[styles.frame, styles.frameOff]}>
            {permission && <Icon name="cameraOff" color="rgba(246,246,243,0.45)" size={36} />}
          </View>
          {(denied || Platform.OS === 'web') && permission && !permission.granted && (
            <FloatingSheet>
              <AlertHeader icon="cameraOff" tone="neutral" title={t('scan.noCamera.title')} />
              <SheetText>{t('scan.noCamera.lead')}</SheetText>
              <View style={{ gap: 10 }}>
                <Button
                  label={denied ? t('scan.noCamera.settings') : t('scan.noCamera.allow')}
                  onPress={() => void (denied ? Linking.openSettings() : requestPermission())}
                />
                <Button label={t('scan.enterNumber')} kind="secondary" onPress={enterNumber} />
              </View>
            </FloatingSheet>
          )}
        </>
      )}
      <View style={[styles.topBar, { top: insets.top + 20 }]}>
        <RoundButton label={t('scan.close')} kind="camera" onPress={close}>
          <Icon name="close" color="#F6F6F3" size={18} strokeWidth={2.2} />
        </RoundButton>
        {permission?.granted && Platform.OS !== 'web' && (
          <RoundButton label={t('scan.torch')} kind="camera" onPress={() => setTorch(!torch)}>
            <Icon name="torch" color={torch ? '#FFD666' : '#F6F6F3'} strokeWidth={1.8} />
          </RoundButton>
        )}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  dim: { backgroundColor: 'rgba(10,11,14,0.35)' },
  frame: { position: 'absolute', width: FRAME, height: FRAME, left: '50%', top: '50%', marginLeft: -FRAME / 2, marginTop: -FRAME / 2 - 40 },
  frameOff: { borderRadius: 32, borderWidth: 1.5, borderColor: 'rgba(246,246,243,0.35)', alignItems: 'center', justifyContent: 'center' },
  scanLine: { position: 'absolute', left: 22, right: 22, top: 150, height: 3, borderRadius: 2, backgroundColor: '#2B3FF5' },
  heading: { position: 'absolute', left: 24, right: 24, alignItems: 'center', gap: 8 },
  title: { fontSize: 26, fontWeight: '600', letterSpacing: -0.5, color: '#F6F6F3', textAlign: 'center' },
  lead: { fontSize: 15, lineHeight: 22, color: CAMERA_TEXT, textAlign: 'center' },
  bottom: {
    position: 'absolute',
    left: 12,
    right: 12,
    borderRadius: 28,
    backgroundColor: 'rgba(31,34,41,0.72)',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.1)',
    padding: 20,
    gap: 14,
  },
  damaged: { fontSize: 15, color: CAMERA_TEXT, textAlign: 'center' },
  topBar: { position: 'absolute', left: 16, right: 16, flexDirection: 'row', justifyContent: 'space-between' },
});
