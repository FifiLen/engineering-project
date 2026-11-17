/**
 * Wspólne elementy ekranów konta według makiet 02-mobile-przeplyw, 03-mobile-konto i 19-mobile-dostep:
 * przycisk wstecz, pasek kroków, tytuł, pole tekstowe 60 px, pole kodu z 6 komórek, pole wyboru, przyciski.
 */
import { useState, type ReactNode } from 'react';
import {
  ActivityIndicator,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  useColorScheme,
  View,
  type TextInputProps,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { t } from '../i18n';
import { usePreferences } from '../lib/preferences';
import { colors, radius, type Theme } from '../theme/tokens';

const THEMES: Record<'light' | 'dark', Theme> = {
  light: { ...colors.light, scheme: 'light' },
  dark: { ...colors.dark, scheme: 'dark' },
};

/** Motyw z ustawień (systemowy, jasny, ciemny; decyzja D6). */
export function useTheme(): Theme {
  const system = useColorScheme();
  const { themeMode } = usePreferences();
  return THEMES[themeMode === 'system' ? (system === 'dark' ? 'dark' : 'light') : themeMode];
}

/** Ekran z marginesami makiety (24 px) i przewijaniem, gdy klawiatura zabiera miejsce. */
export function Screen({ children, footer }: { children: ReactNode; footer?: ReactNode }) {
  const theme = useTheme();
  return (
    <SafeAreaView style={[styles.screen, { backgroundColor: theme.bg }]}>
      <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
        {children}
      </ScrollView>
      {footer && <View style={styles.footer}>{footer}</View>}
    </SafeAreaView>
  );
}

/** Strzałka „wstecz” z dwóch kresek (bez biblioteki ikon). */
function Chevron({ color }: { color: string }) {
  return (
    <View
      style={{
        width: 11,
        height: 11,
        borderLeftWidth: 2,
        borderBottomWidth: 2,
        borderColor: color,
        transform: [{ rotate: '45deg' }],
        marginLeft: 4,
      }}
    />
  );
}

export function TopBar({ onBack, step }: { onBack?: () => void; step?: { current: number; total: number } }) {
  const theme = useTheme();
  return (
    <View style={styles.topBar}>
      {onBack && (
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={t('common.back')}
          onPress={onBack}
          style={[styles.back, { backgroundColor: theme.line }]}
          hitSlop={8}
        >
          <Chevron color={theme.ink} />
        </Pressable>
      )}
      {step && (
        <View
          style={styles.steps}
          accessible
          accessibilityRole="progressbar"
          accessibilityLabel={t('common.step', { current: step.current, total: step.total })}
        >
          {Array.from({ length: step.total }, (_, i) => (
            <View key={i} style={[styles.stepBar, { backgroundColor: i < step.current ? theme.accent : theme.line }]} />
          ))}
        </View>
      )}
    </View>
  );
}

export function Title({ children, size = 32 }: { children: ReactNode; size?: number }) {
  const theme = useTheme();
  return (
    <Text accessibilityRole="header" style={[styles.title, { color: theme.ink, fontSize: size }]}>
      {children}
    </Text>
  );
}

export function Lead({ children }: { children: ReactNode }) {
  const theme = useTheme();
  return <Text style={[styles.lead, { color: theme.muted }]}>{children}</Text>;
}

export function Button({
  label,
  onPress,
  kind = 'primary',
  disabled,
  busy,
  style,
}: {
  label: string;
  onPress: () => void;
  kind?: 'primary' | 'secondary' | 'plain' | 'dark' | 'danger' | 'light';
  disabled?: boolean;
  busy?: boolean;
  style?: object;
}) {
  const theme = useTheme();
  // Grafitowy: akcje kończące (Zakończ, Gotowe); jasny: na tle aparatu (makieta flow-skan).
  const background = {
    primary: theme.accent,
    secondary: theme.line,
    plain: 'transparent',
    dark: theme.dark,
    danger: theme.danger,
    light: '#F6F6F3',
  }[kind];
  const color = { primary: theme.onAccent, secondary: theme.ink, plain: theme.ink, dark: theme.onDark, danger: '#FFFFFF', light: '#16181D' }[kind];
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityState={{ disabled: disabled || busy, busy }}
      disabled={disabled || busy}
      onPress={onPress}
      style={({ pressed }) => [
        styles.button,
        kind === 'plain' && styles.plainButton,
        { backgroundColor: background, opacity: disabled ? 0.35 : pressed ? 0.85 : 1 },
        style,
      ]}
    >
      {busy ? <ActivityIndicator color={color} /> : <Text style={[styles.buttonText, { color }]}>{label}</Text>}
    </Pressable>
  );
}

/** Pole 60 px z etykietą nad wartością; aktywne ma obramowanie w kolorze akcji (design system). */
export function Field({ label, prefix, ...input }: TextInputProps & { label: string; prefix?: ReactNode }) {
  const theme = useTheme();
  const [focused, setFocused] = useState(false);
  return (
    <View style={styles.fieldRow}>
      {prefix}
      <View
        style={[
          styles.field,
          { backgroundColor: theme.surface, borderColor: focused ? theme.accent : theme.line, borderWidth: focused ? 1.5 : 1 },
        ]}
      >
        <Text style={[styles.fieldLabel, { color: theme.muted }]}>{label}</Text>
        <TextInput
          accessibilityLabel={label}
          {...input}
          onFocus={(e) => {
            setFocused(true);
            input.onFocus?.(e);
          }}
          onBlur={(e) => {
            setFocused(false);
            input.onBlur?.(e);
          }}
          placeholderTextColor={theme.muted}
          style={[styles.fieldInput, { color: theme.ink }]}
        />
      </View>
    </View>
  );
}

/** Kierunkowy przed numerem telefonu (makieta flow-telefon). */
export function Prefix({ label }: { label: string }) {
  const theme = useTheme();
  return (
    <View
      accessible
      accessibilityLabel={t('phone.prefixLabel')}
      style={[styles.prefix, { backgroundColor: theme.surface, borderColor: theme.line }]}
    >
      <Text style={[styles.prefixText, { color: theme.ink }]}>{label}</Text>
    </View>
  );
}

/**
 * Pole kodu z 6 komórek: jedno pole `oneTimeCode` pod komórkami, więc działa wklejanie i podpowiedź
 * kodu z SMS-a w systemie.
 */
export function CodeInput({
  value,
  onChange,
  invalid,
  label,
  sms = true,
  autoFocus = true,
  style,
}: {
  value: string;
  onChange: (v: string) => void;
  invalid?: boolean;
  /** Etykieta dostępności (domyślnie kod z SMS-a). */
  label?: string;
  /** Podpowiedź kodu z SMS-a w systemie; wyłączona dla kodu BLIK. */
  sms?: boolean;
  autoFocus?: boolean;
  style?: object;
}) {
  const theme = useTheme();
  const [focused, setFocused] = useState(autoFocus);
  return (
    <View style={[styles.codeRow, style]}>
      {Array.from({ length: 6 }, (_, i) => {
        const active = focused && i === value.length;
        return (
          <View
            key={i}
            style={[
              styles.codeCell,
              {
                backgroundColor: theme.surface,
                borderColor: invalid ? theme.danger : active ? theme.accent : theme.line,
                borderWidth: invalid || active ? 1.5 : 1,
              },
            ]}
          >
            {value[i] ? (
              <Text style={[styles.codeDigit, { color: invalid ? theme.muted : theme.ink }]}>{value[i]}</Text>
            ) : active ? (
              <View style={[styles.caret, { backgroundColor: theme.accent }]} />
            ) : null}
          </View>
        );
      })}
      <TextInput
        accessibilityLabel={label ?? t('code.label')}
        autoFocus={autoFocus}
        value={value}
        onChangeText={(text) => onChange(text.replace(/\D/g, '').slice(0, 6))}
        onFocus={() => setFocused(true)}
        onBlur={() => setFocused(false)}
        keyboardType="number-pad"
        textContentType={sms ? 'oneTimeCode' : 'none'}
        autoComplete={sms ? 'sms-otp' : 'off'}
        maxLength={6}
        caretHidden
        style={styles.codeHidden}
      />
    </View>
  );
}

export function Checkbox({
  checked,
  onToggle,
  children,
  label,
}: {
  checked: boolean;
  onToggle: () => void;
  children: ReactNode;
  label: string;
}) {
  const theme = useTheme();
  return (
    <Pressable
      accessibilityRole="checkbox"
      accessibilityState={{ checked }}
      accessibilityLabel={label}
      onPress={onToggle}
      style={styles.checkRow}
    >
      <View
        style={[
          styles.checkBox,
          checked ? { backgroundColor: theme.accent, borderWidth: 0 } : { borderColor: theme.checkbox, borderWidth: 1.5 },
        ]}
      >
        {checked && <Text style={styles.checkMark}>{t('common.checkMark')}</Text>}
      </View>
      <View style={styles.checkText}>{children}</View>
    </Pressable>
  );
}

export function Body({ children, muted, style }: { children: ReactNode; muted?: boolean; style?: object }) {
  const theme = useTheme();
  return <Text style={[styles.body, { color: muted ? theme.muted : theme.ink }, style]}>{children}</Text>;
}

/** Komunikat błędu na czerwonym tle (makieta konto-kod-proby). */
export function ErrorBox({ title, message }: { title?: string; message: string }) {
  const theme = useTheme();
  return (
    <View accessibilityRole="alert" style={[styles.errorBox, { backgroundColor: theme.dangerTint }]}>
      <View style={[styles.errorDot, { borderColor: theme.danger }]}>
        <Text style={[styles.errorMark, { color: theme.danger }]}>{t('common.alertMark')}</Text>
      </View>
      <View style={styles.flex}>
        {title && <Text style={[styles.errorTitle, { color: theme.ink }]}>{title}</Text>}
        <Text style={[styles.body, { color: theme.ink }]}>{message}</Text>
      </View>
    </View>
  );
}

/** Okrągła odznaka nad tytułem (makiety 19-mobile-dostep). */
export function Badge({ tone, children }: { tone: 'accent' | 'danger'; children: ReactNode }) {
  const theme = useTheme();
  return (
    <View style={[styles.badge, { backgroundColor: tone === 'accent' ? theme.accentTint : theme.dangerTint }]}>
      {children}
    </View>
  );
}

export function Group({ children }: { children: ReactNode }) {
  const theme = useTheme();
  return <View style={[styles.group, { backgroundColor: theme.surface }]}>{children}</View>;
}

export const styles = StyleSheet.create({
  screen: { flex: 1 },
  content: { flexGrow: 1, paddingHorizontal: 24, paddingTop: 20, paddingBottom: 16 },
  footer: { paddingHorizontal: 24, paddingBottom: 16, gap: 10 },
  flex: { flex: 1 },
  topBar: { flexDirection: 'row', alignItems: 'center', gap: 16, minHeight: 44 },
  back: { width: 44, height: 44, borderRadius: 22, alignItems: 'center', justifyContent: 'center' },
  steps: { flex: 1, flexDirection: 'row', gap: 6 },
  stepBar: { flex: 1, height: 4, borderRadius: 2 },
  title: { fontWeight: '600', letterSpacing: -1, lineHeight: 36, marginTop: 36 },
  lead: { fontSize: 16, lineHeight: 24, marginTop: 10 },
  body: { fontSize: 15, lineHeight: 22 },
  button: { height: 56, borderRadius: radius.pill, alignItems: 'center', justifyContent: 'center' },
  plainButton: { height: 48 },
  buttonText: { fontSize: 17, fontWeight: '600' },
  fieldRow: { flexDirection: 'row', gap: 10 },
  field: { flex: 1, height: 60, borderRadius: radius.field, paddingHorizontal: 16, justifyContent: 'center' },
  fieldLabel: { fontSize: 12 },
  // Na webie przeglądarka dodaje własną ramkę fokusu; pole ma już obramowanie w kolorze akcji.
  fieldInput: { fontSize: 17, fontWeight: '500', padding: 0, marginTop: 2, ...(Platform.OS === 'web' ? { outlineStyle: 'none' as never } : {}) },
  prefix: { height: 60, paddingHorizontal: 16, borderRadius: radius.field, borderWidth: 1, justifyContent: 'center' },
  prefixText: { fontSize: 17, fontWeight: '500' },
  codeRow: { flexDirection: 'row', gap: 8, marginTop: 32 },
  codeCell: { flex: 1, height: 64, borderRadius: radius.field, alignItems: 'center', justifyContent: 'center' },
  codeDigit: { fontSize: 26, fontWeight: '500' },
  caret: { width: 2, height: 28, borderRadius: 1 },
  codeHidden: { position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, opacity: 0.01, color: 'transparent' },
  checkRow: { flexDirection: 'row', gap: 12, alignItems: 'flex-start' },
  checkBox: { width: 22, height: 22, borderRadius: 7, alignItems: 'center', justifyContent: 'center', marginTop: 1 },
  checkMark: { color: '#FFFFFF', fontSize: 14, fontWeight: '700' },
  checkText: { flex: 1 },
  errorBox: { flexDirection: 'row', gap: 12, padding: 16, borderRadius: radius.field, marginTop: 20 },
  errorDot: { width: 20, height: 20, borderRadius: 10, borderWidth: 2, alignItems: 'center', justifyContent: 'center', marginTop: 1 },
  errorMark: { fontSize: 12, fontWeight: '800', lineHeight: 14 },
  errorTitle: { fontSize: 15, fontWeight: '600', lineHeight: 22 },
  badge: { width: 64, height: 64, borderRadius: 32, alignItems: 'center', justifyContent: 'center', marginTop: 40 },
  group: { borderRadius: radius.list, overflow: 'hidden' },
});
