/**
 * Elementy ekranów mapy i przejazdu według plansz 01-kierunek-produktowy, 04–08 i 20-mobile-wypozyczenie:
 * karta „glass” nad mapą, nagłówek komunikatu z odznaką, okrągłe przyciski, pigułki, komunikat u góry,
 * arkusz potwierdzenia z przyciemnieniem, lista kroków i trzy liczniki w wierszu.
 */
import type { ReactNode } from 'react';
import { ActivityIndicator, Modal, Platform, Pressable, StyleSheet, Text, View, type ViewStyle } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { t } from '../i18n';
import { radius, type Theme } from '../theme/tokens';
import { Icon, type IconName } from './icons';
import { useTheme } from './ui';

/** Szkło z makiet: półprzezroczyste tło, rozmycie (tylko web), jasna krawędź i cień. */
export function glass(theme: Theme): ViewStyle {
  return {
    backgroundColor: theme.glass,
    borderWidth: 1,
    borderColor: theme.glassBorder,
    shadowColor: '#16181D',
    shadowOpacity: theme.scheme === 'dark' ? 0.35 : 0.14,
    shadowRadius: 20,
    shadowOffset: { width: 0, height: 12 },
    elevation: 8,
    ...(Platform.OS === 'web' ? ({ backdropFilter: 'blur(28px) saturate(180%)' } as object) : {}),
  };
}

/** Karta nad mapą (12 px od krawędzi, promień 32, odstęp 16). */
export function FloatingSheet({ children, style }: { children: ReactNode; style?: ViewStyle }) {
  const theme = useTheme();
  const insets = useSafeAreaInsets();
  return <View style={[styles.sheet, glass(theme), { bottom: 12 + insets.bottom }, style]}>{children}</View>;
}

export type BadgeTone = 'neutral' | 'danger' | 'warning' | 'accent';

export function IconBadge({ icon, tone, size = 48, iconSize = 21 }: { icon: IconName; tone: BadgeTone; size?: number; iconSize?: number }) {
  const theme = useTheme();
  const bg = { neutral: theme.line, danger: theme.dangerTint, warning: theme.warningTint, accent: theme.accentTint }[tone];
  const fg = { neutral: theme.ink, danger: theme.danger, warning: theme.warning, accent: theme.accentMap }[tone];
  return (
    <View style={{ width: size, height: size, borderRadius: size / 2, backgroundColor: bg, alignItems: 'center', justifyContent: 'center' }}>
      <Icon name={icon} color={fg} size={iconSize} strokeWidth={2} />
    </View>
  );
}

/** Odznaka, tytuł 19/600 i podtytuł (makiety rezerwacja-wygasla, stan-niedostepna, przejazd-poza-strefa). */
export function AlertHeader({ icon, tone, title, subtitle }: { icon: IconName; tone: BadgeTone; title: string; subtitle?: string }) {
  const theme = useTheme();
  return (
    <View style={styles.alertHeader}>
      <IconBadge icon={icon} tone={tone} />
      <View style={styles.flex}>
        <Text accessibilityRole="header" style={[styles.alertTitle, { color: theme.ink }]}>
          {title}
        </Text>
        {subtitle ? <Text style={[styles.alertSubtitle, { color: theme.muted }]}>{subtitle}</Text> : null}
      </View>
    </View>
  );
}

export function SheetText({ children, style }: { children: ReactNode; style?: object }) {
  const theme = useTheme();
  return <Text style={[styles.sheetText, { color: theme.muted }, style]}>{children}</Text>;
}

/** Dwa przyciski obok siebie; `split` to proporcja 1 : 1,6 z makiety karty hulajnogi. */
export function ButtonRow({ children, split }: { children: [ReactNode, ReactNode]; split?: boolean }) {
  return (
    <View style={styles.row}>
      <View style={{ flex: split ? 1 : 1 }}>{children[0]}</View>
      <View style={{ flex: split ? 1.6 : 1 }}>{children[1]}</View>
    </View>
  );
}

/** Okrągły przycisk 44 px: szary, szklany nad mapą, grafitowy (awatar) albo ciemny nad aparatem. */
export function RoundButton({
  label,
  onPress,
  kind = 'line',
  children,
}: {
  label: string;
  onPress: () => void;
  kind?: 'line' | 'glass' | 'dark' | 'camera';
  children: ReactNode;
}) {
  const theme = useTheme();
  const style: ViewStyle =
    kind === 'glass'
      ? glass(theme)
      : kind === 'dark'
        ? { backgroundColor: theme.dark }
        : kind === 'camera'
          ? { backgroundColor: 'rgba(31,34,41,0.6)', borderWidth: 1, borderColor: 'rgba(255,255,255,0.12)' }
          : { backgroundColor: theme.line };
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      onPress={onPress}
      hitSlop={6}
      style={({ pressed }) => [styles.round, style, { opacity: pressed ? 0.8 : 1 }]}
    >
      {children}
    </Pressable>
  );
}

/** Pigułka nad mapą (stan jazdy, bateria, licznik). */
export function Pill({ children, icon, dot }: { children: ReactNode; icon?: IconName; dot?: boolean }) {
  const theme = useTheme();
  return (
    <View style={[styles.pill, glass(theme)]}>
      {dot && <View style={[styles.pillDot, { backgroundColor: theme.accentMap }]} />}
      {icon && <Icon name={icon} color={theme.ink} size={16} />}
      <Text style={[styles.pillText, { color: theme.ink }]}>{children}</Text>
    </View>
  );
}

/** Komunikat u góry mapy (makieta rezerwacja-anulowana). */
export function Toast({ title, subtitle, icon = 'check' }: { title: string; subtitle?: string; icon?: IconName }) {
  const theme = useTheme();
  const insets = useSafeAreaInsets();
  return (
    <View accessibilityRole="alert" style={[styles.toast, glass(theme), { top: insets.top + 76 }]}>
      <IconBadge icon={icon} tone="accent" size={32} iconSize={16} />
      <View style={styles.flex}>
        <Text style={[styles.toastTitle, { color: theme.ink }]}>{title}</Text>
        {subtitle ? <Text style={[styles.toastSubtitle, { color: theme.muted }]}>{subtitle}</Text> : null}
      </View>
    </View>
  );
}

/** Arkusz od dołu z uchwytem i przyciemnieniem (makieta rezerwacja-anuluj). */
export function BottomSheet({ visible, onClose, children }: { visible: boolean; onClose: () => void; children: ReactNode }) {
  const theme = useTheme();
  const insets = useSafeAreaInsets();
  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose}>
      <Pressable accessibilityRole="button" accessibilityLabel={t('common.scrim')} style={[StyleSheet.absoluteFill, { backgroundColor: theme.scrim }]} onPress={onClose} />
      <View style={[styles.bottomSheet, { backgroundColor: theme.bg, paddingBottom: 32 + insets.bottom }]}>
        <View style={[styles.grabber, { backgroundColor: theme.checkbox }]} />
        {children}
      </View>
    </Modal>
  );
}

export type StepState = 'done' | 'spin' | 'todo' | 'fail';

/** Kroki oczekiwania na hulajnogę (makiety przejazd-odblokowywanie, przejazd-konczenie, odblokowanie-nieudane). */
export function Steps({ steps }: { steps: { label: string; state: StepState }[] }) {
  const theme = useTheme();
  return (
    <View style={styles.steps}>
      {steps.map((s) => (
        <View key={s.label} style={styles.step} accessible accessibilityLabel={s.label}>
          {s.state === 'done' || s.state === 'fail' ? (
            <View style={[styles.stepDot, { backgroundColor: s.state === 'done' ? theme.accent : theme.danger }]}>
              <Icon name={s.state === 'done' ? 'check' : 'close'} color="#FFFFFF" size={14} strokeWidth={2.6} />
            </View>
          ) : s.state === 'spin' ? (
            <View style={styles.stepDot}>
              <ActivityIndicator color={theme.accent} />
            </View>
          ) : (
            <View style={[styles.stepDot, { borderWidth: 1.5, borderColor: theme.checkbox }]} />
          )}
          <Text
            style={[
              styles.stepText,
              {
                color: s.state === 'fail' ? theme.danger : s.state === 'todo' ? theme.muted : theme.ink,
                fontWeight: s.state === 'spin' || s.state === 'fail' ? '600' : '400',
              },
            ]}
          >
            {s.label}
          </Text>
        </View>
      ))}
    </View>
  );
}

/** Trzy wartości w wierszu z pionowymi liniami (ekran jazdy, szczegóły hulajnogi, profil). */
export function Stats({
  items,
  size = 20,
  align = 'center',
}: {
  items: { value: string; label: string }[];
  size?: number;
  align?: 'center' | 'left';
}) {
  const theme = useTheme();
  return (
    <View style={styles.stats}>
      {items.map((item, i) => (
        <View
          key={item.label}
          accessible
          accessibilityLabel={`${item.value} ${item.label}`}
          style={[
            styles.stat,
            align === 'left' ? { alignItems: 'flex-start', paddingLeft: i ? 16 : 0 } : { alignItems: 'center' },
            i ? { borderLeftWidth: 1, borderColor: theme.line } : null,
          ]}
        >
          <Text numberOfLines={1} adjustsFontSizeToFit style={[styles.statValue, { color: theme.ink, fontSize: size }]}>
            {item.value}
          </Text>
          <Text style={[styles.statLabel, { color: theme.muted }]}>{item.label}</Text>
        </View>
      ))}
    </View>
  );
}

export const sheetStyles = StyleSheet.create({
  bigNumber: { fontSize: 50, fontWeight: '500', letterSpacing: -1.5, lineHeight: 52 },
  caption: { fontSize: 13, fontWeight: '500' },
});

const styles = StyleSheet.create({
  flex: { flex: 1 },
  sheet: { position: 'absolute', left: 12, right: 12, borderRadius: radius.sheet, padding: 24, gap: 16 },
  alertHeader: { flexDirection: 'row', alignItems: 'center', gap: 14 },
  alertTitle: { fontSize: 19, fontWeight: '600', letterSpacing: -0.2 },
  alertSubtitle: { fontSize: 15, marginTop: 2 },
  sheetText: { fontSize: 15, lineHeight: 22 },
  row: { flexDirection: 'row', gap: 10 },
  round: { width: 44, height: 44, borderRadius: 22, alignItems: 'center', justifyContent: 'center' },
  pill: { height: 40, paddingHorizontal: 16, borderRadius: 20, flexDirection: 'row', alignItems: 'center', gap: 8 },
  pillDot: { width: 8, height: 8, borderRadius: 4 },
  pillText: { fontSize: 14, fontWeight: '500' },
  toast: { position: 'absolute', left: 16, right: 16, borderRadius: 20, paddingVertical: 12, paddingHorizontal: 16, flexDirection: 'row', alignItems: 'center', gap: 12 },
  toastTitle: { fontSize: 15, fontWeight: '600' },
  toastSubtitle: { fontSize: 14, marginTop: 1 },
  bottomSheet: { position: 'absolute', left: 0, right: 0, bottom: 0, borderTopLeftRadius: 32, borderTopRightRadius: 32, paddingTop: 12, paddingHorizontal: 24 },
  grabber: { width: 36, height: 5, borderRadius: 3, alignSelf: 'center', marginBottom: 24 },
  steps: { gap: 18, marginTop: 28 },
  step: { flexDirection: 'row', alignItems: 'center', gap: 14 },
  stepDot: { width: 26, height: 26, borderRadius: 13, alignItems: 'center', justifyContent: 'center' },
  stepText: { fontSize: 16, flex: 1 },
  stats: { flexDirection: 'row' },
  stat: { flex: 1, gap: 2 },
  statValue: { fontWeight: '500', letterSpacing: -0.3 },
  statLabel: { fontSize: 13 },
});
