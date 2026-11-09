import { Pressable, StyleSheet, Text, useColorScheme, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { colors, radius } from '../theme/tokens';

// Ekran startowy (szkielet). Pełny przepływ rejestracji: iteracja 2, mapa: iteracja 3.
export default function StartScreen() {
  const theme = colors[useColorScheme() === 'dark' ? 'dark' : 'light'];
  return (
    <SafeAreaView style={[styles.screen, { backgroundColor: theme.bg }]}>
      <Text style={[styles.brand, { color: theme.ink }]}>[nazwa]</Text>
      <View style={styles.flex} />
      <Text style={[styles.title, { color: theme.ink }]}>Hulajnoga zawsze blisko.</Text>
      <Text style={[styles.lead, { color: theme.muted }]}>Znajdź ją na mapie, zeskanuj kod i ruszaj.</Text>
      <View style={styles.actions}>
        <Pressable accessibilityRole="button" style={[styles.button, { backgroundColor: theme.accent }]}>
          <Text style={[styles.buttonText, { color: theme.onAccent }]}>Utwórz konto</Text>
        </Pressable>
        <Pressable accessibilityRole="button" style={[styles.button, { backgroundColor: theme.line }]}>
          <Text style={[styles.buttonText, { color: theme.ink }]}>Zaloguj się</Text>
        </Pressable>
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, paddingHorizontal: 24, paddingBottom: 16 },
  brand: { fontSize: 20, fontWeight: '600', letterSpacing: -0.4, marginTop: 8 },
  flex: { flex: 1 },
  title: { fontSize: 38, fontWeight: '600', letterSpacing: -1.3, lineHeight: 41 },
  lead: { fontSize: 16, lineHeight: 24, marginTop: 12 },
  actions: { gap: 10, marginTop: 32 },
  button: { height: 56, borderRadius: radius.pill, alignItems: 'center', justifyContent: 'center' },
  buttonText: { fontSize: 17, fontWeight: '600' },
});
