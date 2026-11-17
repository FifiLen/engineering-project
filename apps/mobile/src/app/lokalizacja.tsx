import { router } from 'expo-router';
import { Text, View } from 'react-native';
import Svg, { Circle, ClipPath, Defs, G, Path, Rect } from 'react-native-svg';
import { Button, useTheme } from '../components/ui';
import { t } from '../i18n';
import { useLocation } from '../lib/location';
import { SafeAreaView } from 'react-native-safe-area-context';

/** Ilustracja z makiety konto-lokalizacja: wycinek mapy z położeniem i hulajnogami. */
function Illustration() {
  const theme = useTheme();
  return (
    <Svg width={260} height={260} viewBox="0 0 260 260" accessibilityLabel={t('location.illustration')}>
      <Defs>
        <ClipPath id="c">
          <Circle cx="130" cy="130" r="128" />
        </ClipPath>
      </Defs>
      <G clipPath="url(#c)">
        <Rect width="260" height="260" fill={theme.map} />
        <Path d="M0 90 L260 70 M90 0 L110 260 M0 190 L260 170 M200 0 L215 260" stroke={theme.surface} strokeWidth="9" fill="none" />
        <Path d="M0 40 L260 30 M40 0 L50 260 M0 140 L260 125" stroke={theme.bg} strokeWidth="4" fill="none" />
        <Circle cx="130" cy="130" r="56" fill={theme.accentMap} fillOpacity="0.10" />
        <Circle cx="130" cy="130" r="12" fill={theme.surface} stroke={theme.accentMap} strokeWidth="4" />
        <Circle cx="70" cy="100" r="7" fill={theme.ink} stroke={theme.surface} strokeWidth="2.5" />
        <Circle cx="185" cy="160" r="7" fill={theme.ink} stroke={theme.surface} strokeWidth="2.5" />
        <Circle cx="160" cy="70" r="7" fill={theme.ink} stroke={theme.surface} strokeWidth="2.5" />
      </G>
      <Circle cx="130" cy="130" r="128" fill="none" stroke={theme.line} strokeWidth="2" />
    </Svg>
  );
}

/** Zgoda na lokalizację przed pierwszym pokazaniem mapy (makieta konto-lokalizacja, ADR 0040). */
export default function LocationScreen() {
  const theme = useTheme();
  const location = useLocation();
  const done = () => router.replace('/mapa');
  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: theme.bg }}>
      <View style={{ flex: 1, paddingHorizontal: 24, paddingTop: 20, paddingBottom: 16 }}>
        <View style={{ height: 360, marginTop: 24, alignItems: 'center', justifyContent: 'center' }}>
          <Illustration />
        </View>
        <Text accessibilityRole="header" style={{ marginTop: 8, fontSize: 30, fontWeight: '600', letterSpacing: -0.9, lineHeight: 34, color: theme.ink }}>
          {t('location.title')}
        </Text>
        <Text style={{ marginTop: 10, fontSize: 16, lineHeight: 24, color: theme.muted }}>{t('location.lead')}</Text>
        <View style={{ flex: 1 }} />
        <View style={{ gap: 10 }}>
          <Button label={t('location.allow')} onPress={() => void location.request().finally(done)} />
          <Button
            label={t('location.later')}
            kind="secondary"
            onPress={() => {
              location.skip();
              done();
            }}
          />
        </View>
      </View>
    </SafeAreaView>
  );
}
