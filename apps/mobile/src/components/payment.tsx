/**
 * Elementy ekranów płatności według plansz 07-mobile-platnosci i 24-mobile-platnosci: miniatura karty,
 * pole wyboru, odznaka stanu karty, pigułki wyboru, wiersze w białej grupie, linie kwot, uwaga z ikoną
 * i ekran stanu (oczekiwanie, sukces, odmowa) z odznaką 72 px.
 */
import type { ReactNode } from 'react';
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import Svg, { Circle } from 'react-native-svg';
import { t } from '../i18n';
import { radius } from '../theme/tokens';
import { Icon, type IconName } from './icons';
import { useTheme } from './ui';

/** Ramka pola karty 60 px jak `Field` (etykieta nad wartością, obramowanie w kolorze akcji przy fokusie). */
export function CardFieldBox({
  label,
  focused,
  invalid,
  children,
  flex = 1,
}: {
  label: string;
  focused?: boolean;
  invalid?: boolean;
  children: ReactNode;
  flex?: number;
}) {
  const theme = useTheme();
  const border = invalid ? theme.danger : focused ? theme.accent : theme.line;
  return (
    <View
      style={[
        styles.fieldBox,
        { flex, backgroundColor: theme.surface, borderColor: border, borderWidth: focused || invalid ? 1.5 : 1 },
      ]}
    >
      <Text style={[styles.fieldLabel, { color: theme.muted }]}>{label}</Text>
      {children}
    </View>
  );
}

export type MiniKind = 'card' | 'blik' | 'wallet';

/** Miniatura 36×24 z makiet: Visa (grafit), Mastercard (dwa koła), BLIK, portfel. */
export function CardMini({ kind = 'card', brand }: { kind?: MiniKind; brand?: string | null }) {
  const theme = useTheme();
  if (kind === 'wallet') {
    return (
      <View style={styles.mini}>
        <Icon name="wallet" color={theme.ink} />
      </View>
    );
  }
  if (kind === 'blik') {
    return (
      <View style={[styles.mini, { backgroundColor: theme.line }]}>
        <Text style={[styles.miniText, { color: theme.ink, fontSize: 9, letterSpacing: 0 }]}>
          {t('payment.mini.blik')}
        </Text>
      </View>
    );
  }
  if (brand === 'mastercard') {
    return (
      <View style={[styles.mini, { backgroundColor: '#3A3E46' }]}>
        <Svg width={22} height={14} viewBox="0 0 22 14">
          <Circle cx="8" cy="7" r="5.5" fill="#B9B9B2" />
          <Circle cx="14" cy="7" r="5.5" fill="#E3E3DE" fillOpacity={0.85} />
        </Svg>
      </View>
    );
  }
  return (
    <View style={[styles.mini, { backgroundColor: '#16181D' }]}>
      {brand === 'visa' ? (
        <Text style={[styles.miniText, { color: '#FFFFFF' }]}>{t('payment.mini.visa')}</Text>
      ) : (
        <Icon name="card" color="#FFFFFF" size={16} />
      )}
    </View>
  );
}

/** Pole wyboru 22 px (wybrane: obramowanie 6 px w kolorze akcji; niedostępne: wypełnione). */
export function Radio({ on, disabled }: { on: boolean; disabled?: boolean }) {
  const theme = useTheme();
  return (
    <View
      style={[
        styles.radio,
        on
          ? { borderWidth: 6, borderColor: theme.accent }
          : disabled
            ? { borderWidth: 1.5, borderColor: theme.line, backgroundColor: theme.readonly }
            : { borderWidth: 1.5, borderColor: theme.checkbox },
      ]}
    />
  );
}

/** Odznaka stanu („Domyślna”, „Wygasa”, „Wygasła”). */
export function Chip({ label, tone }: { label: string; tone: 'neutral' | 'warning' | 'danger' }) {
  const theme = useTheme();
  const bg = { neutral: theme.line, warning: theme.warningTint, danger: theme.dangerTint }[tone];
  const fg = { neutral: theme.ink, warning: theme.warning, danger: theme.danger }[tone];
  return (
    <View style={[styles.chip, { backgroundColor: bg }]}>
      <Text style={[styles.chipText, { color: fg }]}>{label}</Text>
    </View>
  );
}

/** Pigułka 40 px wyboru kwoty albo metody; wybrana jest grafitowa z haczykiem. */
export function PillSelect({
  label,
  selected,
  onPress,
  check,
  inverted,
  flex = 1,
}: {
  label: string;
  selected: boolean;
  onPress: () => void;
  /** Haczyk przed etykietą wybranej pigułki (wybór metody). */
  check?: boolean;
  /** Pigułki na grafitowej karcie salda (makieta flow-portfel). */
  inverted?: boolean;
  /** Udział w szerokości wiersza pigułek na karcie salda. */
  flex?: number;
}) {
  const theme = useTheme();
  const on = inverted ? { bg: '#F6F6F3', fg: '#16181D' } : { bg: theme.dark, fg: theme.onDark };
  const off = inverted
    ? { bg: 'transparent', fg: '#F6F6F3', border: 'rgba(246,246,243,0.28)' }
    : { bg: theme.surface, fg: theme.ink, border: theme.line };
  return (
    <Pressable
      accessibilityRole="radio"
      accessibilityState={{ selected }}
      onPress={onPress}
      style={({ pressed }) => [
        inverted ? [styles.pillWide, { flex }] : styles.pill,
        selected ? { backgroundColor: on.bg } : { backgroundColor: off.bg, borderWidth: 1, borderColor: off.border },
        { opacity: pressed ? 0.85 : 1 },
      ]}
    >
      {selected && check && <Icon name="check" color={on.fg} size={16} strokeWidth={2.5} />}
      <Text numberOfLines={1} style={[styles.pillText, { color: selected ? on.fg : off.fg }]}>
        {label}
      </Text>
    </Pressable>
  );
}

/** Uwaga z ikoną (makiety: informacja pod formularzem, przypomnienie o ponowieniu). */
export function Note({ children, icon = 'info', style }: { children: ReactNode; icon?: IconName; style?: object }) {
  const theme = useTheme();
  return (
    <View style={[styles.note, style]}>
      <Icon name={icon} color={theme.muted} size={18} />
      <Text style={[styles.noteText, { color: theme.muted }]}>{children}</Text>
    </View>
  );
}

/** Biała grupa z obramowaniem (wiersze rozdziela linia). */
export function Group({ children, style }: { children: ReactNode; style?: object }) {
  const theme = useTheme();
  return (
    <View style={[styles.group, { backgroundColor: theme.surface, borderColor: theme.line }, style]}>{children}</View>
  );
}

/** Wiersz grupy 54 px: etykieta po lewej i wartość po prawej (Saldo teraz, Kwota, Metoda). */
export function ValueRow({
  label,
  value,
  color,
  first,
}: {
  label: string;
  value: string;
  color?: string;
  first?: boolean;
}) {
  const theme = useTheme();
  return (
    <View style={[styles.row, !first && { borderTopWidth: 1, borderColor: theme.line }]} accessible>
      <Text style={[styles.rowLabel, { color: theme.muted }]}>{label}</Text>
      <Text style={[styles.rowValue, { color: color ?? theme.ink }]}>{value}</Text>
    </View>
  );
}

/**
 * Wiersz wyboru w grupie: miniatura, tekst z podpisem, a po prawej pole wyboru, odznaka albo akcja
 * (metody płatności, spłata zaległości, arkusz płatności kartą).
 */
export function OptionRow({
  mini,
  title,
  subtitle,
  subtitleColor,
  right,
  onPress,
  first,
  disabled,
  selected,
}: {
  mini?: ReactNode;
  title: string;
  subtitle?: string;
  subtitleColor?: string;
  right?: ReactNode;
  onPress?: () => void;
  first?: boolean;
  disabled?: boolean;
  selected?: boolean;
}) {
  const theme = useTheme();
  const content = (
    <>
      {mini}
      <View style={styles.optionText}>
        <Text style={[styles.optionTitle, { color: theme.ink }]}>{title}</Text>
        {subtitle ? (
          <Text style={[styles.optionSubtitle, { color: subtitleColor ?? theme.muted }]}>{subtitle}</Text>
        ) : null}
      </View>
      {right}
    </>
  );
  const style = [styles.row, !first && { borderTopWidth: 1, borderColor: theme.line }];
  return onPress ? (
    <Pressable
      accessibilityRole={selected === undefined ? 'button' : 'radio'}
      accessibilityState={{ disabled, selected }}
      disabled={disabled}
      onPress={onPress}
      style={({ pressed }) => [style, { opacity: disabled ? 0.5 : pressed ? 0.7 : 1 }]}
    >
      {content}
    </Pressable>
  ) : (
    <View style={style} accessible>
      {content}
    </View>
  );
}

/** Wiersz „+ Dodaj kartę” w kolorze akcji. */
export function AddRow({ label, onPress, first }: { label: string; onPress: () => void; first?: boolean }) {
  const theme = useTheme();
  return (
    <Pressable
      accessibilityRole="button"
      onPress={onPress}
      style={({ pressed }) => [
        styles.row,
        !first && { borderTopWidth: 1, borderColor: theme.line },
        { opacity: pressed ? 0.7 : 1 },
      ]}
    >
      <View style={styles.addIcon}>
        <Icon name="plus" color={theme.accent} />
      </View>
      <Text style={[styles.addText, { color: theme.accent }]}>{label}</Text>
    </Pressable>
  );
}

/** Linie kwot z liniami między wierszami (podsumowanie, arkusz płatności kartą, spłata). */
export function Lines({ rows }: { rows: { label: string; value: ReactNode; strong?: boolean; color?: string }[] }) {
  const theme = useTheme();
  return (
    <View style={{ borderBottomWidth: 1, borderColor: theme.line }}>
      {rows.map((r) => (
        <View key={r.label} style={[styles.line, { borderColor: theme.line }]}>
          <Text
            style={{ fontSize: 15, color: r.strong ? theme.ink : theme.muted, fontWeight: r.strong ? '600' : '400' }}
          >
            {r.label}
          </Text>
          {typeof r.value === 'string' ? (
            <Text
              style={{
                fontSize: 15,
                fontWeight: r.strong ? '600' : '500',
                color: r.color ?? theme.ink,
                flexShrink: 1,
                textAlign: 'right',
              }}
            >
              {r.value}
            </Text>
          ) : (
            r.value
          )}
        </View>
      ))}
    </View>
  );
}

/** Kwota wiodąca („Do zapłaty”, „Saldo”): etykieta 14 i liczba 50/500. */
export function BigAmount({ label, value, color }: { label: string; value: string; color?: string }) {
  const theme = useTheme();
  return (
    <View style={{ gap: 4 }}>
      <Text style={{ fontSize: 14, color: theme.muted }}>{label}</Text>
      <Text style={{ fontSize: 50, fontWeight: '500', letterSpacing: -1.5, lineHeight: 52, color: color ?? theme.ink }}>
        {value}
      </Text>
    </View>
  );
}

export type StatusTone = 'accent' | 'solid' | 'danger';

/**
 * Ekran stanu płatności (makiety doladowanie-oczekiwanie, -sukces, -odmowa): odznaka 72 px, tytuł 30/600,
 * opis i treść, przyciski w stopce. Bez przycisku wstecz: wyjście tylko przyciskami.
 */
export function StatusScreen({
  icon,
  tone,
  title,
  lead,
  children,
  footer,
  spinner,
}: {
  icon: IconName;
  tone: StatusTone;
  title: string;
  lead?: string;
  children?: ReactNode;
  footer: ReactNode;
  spinner?: boolean;
}) {
  const theme = useTheme();
  const bg = { accent: theme.accentTint, solid: theme.accent, danger: theme.dangerTint }[tone];
  const fg = { accent: theme.accentMap, solid: '#FFFFFF', danger: theme.danger }[tone];
  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: theme.bg }}>
      <ScrollView contentContainerStyle={styles.statusContent}>
        <View style={[styles.statusBadge, { backgroundColor: bg }]}>
          {spinner ? (
            <ActivityIndicator color={fg} />
          ) : (
            <Icon name={icon} color={fg} size={tone === 'solid' ? 32 : 28} strokeWidth={tone === 'solid' ? 2.6 : 1.9} />
          )}
        </View>
        <Text accessibilityRole="header" style={[styles.statusTitle, { color: theme.ink }]}>
          {title}
        </Text>
        {lead ? <Text style={[styles.statusLead, { color: theme.muted }]}>{lead}</Text> : null}
        {children}
      </ScrollView>
      <View style={styles.statusFooter}>{footer}</View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  fieldBox: { height: 60, borderRadius: radius.field, paddingHorizontal: 16, justifyContent: 'center' },
  fieldLabel: { fontSize: 12, marginBottom: 2 },
  mini: { width: 36, height: 24, borderRadius: 5, alignItems: 'center', justifyContent: 'center' },
  miniText: { fontSize: 8, fontWeight: '700', letterSpacing: 0.3 },
  radio: { width: 22, height: 22, borderRadius: 11 },
  chip: { height: 26, paddingHorizontal: 10, borderRadius: 13, justifyContent: 'center' },
  chipText: { fontSize: 12, fontWeight: '600' },
  pill: { height: 40, paddingHorizontal: 16, borderRadius: 20, flexDirection: 'row', alignItems: 'center', gap: 6 },
  pillWide: {
    height: 44,
    paddingHorizontal: 6,
    borderRadius: 22,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
  },
  pillText: { fontSize: 15, fontWeight: '500' },
  note: { flexDirection: 'row', gap: 12, alignItems: 'flex-start' },
  noteText: { flex: 1, fontSize: 14, lineHeight: 20 },
  group: { borderRadius: radius.list, borderWidth: 1, overflow: 'hidden' },
  row: { flexDirection: 'row', alignItems: 'center', gap: 14, minHeight: 54, paddingHorizontal: 16 },
  rowLabel: { flex: 1, fontSize: 16 },
  rowValue: { fontSize: 16, fontWeight: '500' },
  optionText: { flex: 1, gap: 2, paddingVertical: 10 },
  optionTitle: { fontSize: 16 },
  optionSubtitle: { fontSize: 13 },
  addIcon: { width: 36, alignItems: 'center' },
  addText: { fontSize: 16, fontWeight: '500' },
  line: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    gap: 12,
    paddingVertical: 12,
    borderTopWidth: 1,
  },
  statusContent: { flexGrow: 1, paddingHorizontal: 24, paddingTop: 56, paddingBottom: 16 },
  statusBadge: { width: 72, height: 72, borderRadius: 36, alignItems: 'center', justifyContent: 'center' },
  statusTitle: { marginTop: 24, fontSize: 30, fontWeight: '600', letterSpacing: -0.9, lineHeight: 34 },
  statusLead: { marginTop: 10, fontSize: 16, lineHeight: 24 },
  statusFooter: { paddingHorizontal: 24, paddingBottom: 16, gap: 10 },
});
