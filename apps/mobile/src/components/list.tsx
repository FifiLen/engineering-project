/**
 * Ekrany profilu (makiety 06-mobile-profil, 20-mobile-wypozyczenie/profil-dane): nagłówek z przyciskiem
 * wstecz, grupy wierszy z ikoną, wartością i strzałką, przełącznik i wybór motywu.
 */
import type { ReactNode } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { t } from '../i18n';
import { radius } from '../theme/tokens';
import { Icon, type IconName } from './icons';
import { RoundButton } from './sheet';
import { useTheme } from './ui';

/** Ekran profilu: marginesy 20 px, nagłówek 22/600 obok przycisku wstecz, stopka z przyciskami. */
export function PageScreen({
  title,
  onBack,
  children,
  footer,
  scroll = true,
}: {
  title?: string;
  onBack: () => void;
  children: ReactNode;
  footer?: ReactNode;
  scroll?: boolean;
}) {
  const theme = useTheme();
  const header = (
    <View style={styles.header}>
      <RoundButton label={t('common.back')} onPress={onBack}>
        <Icon name="back" color={theme.ink} />
      </RoundButton>
      {title ? (
        <Text accessibilityRole="header" style={[styles.title, { color: theme.ink }]}>
          {title}
        </Text>
      ) : null}
    </View>
  );
  return (
    <SafeAreaView style={[styles.screen, { backgroundColor: theme.bg }]}>
      {scroll ? (
        <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
          {header}
          {children}
        </ScrollView>
      ) : (
        <View style={[styles.content, styles.flex]}>
          {header}
          {children}
        </View>
      )}
      {footer && <View style={styles.footer}>{footer}</View>}
    </SafeAreaView>
  );
}

export function SectionLabel({ children }: { children: string }) {
  const theme = useTheme();
  return <Text style={[styles.section, { color: theme.muted }]}>{children}</Text>;
}

/** Biała grupa z obramowaniem; wiersze rozdziela linia. */
export function ListGroup({ children }: { children: ReactNode }) {
  const theme = useTheme();
  return <View style={[styles.group, { backgroundColor: theme.surface, borderColor: theme.line }]}>{children}</View>;
}

export function ListRow({
  label,
  icon,
  value,
  onPress,
  first,
  danger,
  chevron = !!onPress,
  right,
}: {
  label: string;
  icon?: IconName;
  value?: string;
  onPress?: () => void;
  first?: boolean;
  danger?: boolean;
  chevron?: boolean;
  right?: ReactNode;
}) {
  const theme = useTheme();
  const content = (
    <>
      {icon && (
        <View style={styles.rowIcon}>
          <Icon name={icon} color={theme.ink} />
        </View>
      )}
      <Text style={[styles.rowLabel, { color: danger ? theme.danger : theme.ink }]}>{label}</Text>
      {value ? <Text style={[styles.rowValue, { color: theme.muted }]}>{value}</Text> : null}
      {right}
      {chevron && <Icon name="chevron" color={theme.checkbox} size={18} />}
    </>
  );
  const style = [styles.row, !first && { borderTopWidth: 1, borderColor: theme.line }];
  return onPress ? (
    <Pressable accessibilityRole="button" onPress={onPress} style={({ pressed }) => [style, { opacity: pressed ? 0.7 : 1 }]}>
      {content}
    </Pressable>
  ) : (
    <View style={style} accessible>
      {content}
    </View>
  );
}

/** Wiersz z przełącznikiem 51×31 z makiety (kolor akcji, gdy włączony); ten sam wygląd na iOS, Androidzie i w wersji web. */
export function ToggleRow({
  label,
  value,
  onChange,
  first,
  disabled,
}: {
  label: string;
  value: boolean;
  onChange: (v: boolean) => void;
  first?: boolean;
  disabled?: boolean;
}) {
  const theme = useTheme();
  return (
    <ListRow
      label={label}
      first={first}
      right={
        <Pressable
          accessibilityRole="switch"
          accessibilityLabel={label}
          accessibilityState={{ checked: value, disabled }}
          disabled={disabled}
          onPress={() => onChange(!value)}
          hitSlop={8}
          style={[
            styles.track,
            { backgroundColor: value ? theme.accent : theme.scheme === 'dark' ? theme.line : '#D5D5CF', opacity: disabled ? 0.5 : 1 },
          ]}
        >
          <View style={[styles.thumb, value ? { right: 2 } : { left: 2 }]} />
        </Pressable>
      }
    />
  );
}

/** Wybór jednej z opcji (motyw: systemowy, jasny, ciemny). */
export function Segmented<T extends string>({
  options,
  value,
  onChange,
}: {
  options: { value: T; label: string }[];
  value: T;
  onChange: (v: T) => void;
}) {
  const theme = useTheme();
  return (
    <View accessibilityRole="radiogroup" style={[styles.segmented, { backgroundColor: theme.line }]}>
      {options.map((o) => {
        const active = o.value === value;
        return (
          <Pressable
            key={o.value}
            accessibilityRole="radio"
            accessibilityState={{ selected: active }}
            onPress={() => onChange(o.value)}
            style={[styles.segment, active && { backgroundColor: theme.dark }]}
          >
            <Text style={[styles.segmentText, { color: active ? theme.onDark : theme.ink }]}>{o.label}</Text>
          </Pressable>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1 },
  flex: { flex: 1 },
  content: { flexGrow: 1, paddingHorizontal: 20, paddingTop: 20, paddingBottom: 28, gap: 20 },
  footer: { paddingHorizontal: 20, paddingBottom: 16, gap: 10 },
  header: { flexDirection: 'row', alignItems: 'center', gap: 14 },
  title: { fontSize: 22, fontWeight: '600', letterSpacing: -0.4, flex: 1 },
  section: { fontSize: 14, fontWeight: '600', marginLeft: 4, marginBottom: -10 },
  group: { borderRadius: radius.list, borderWidth: 1, overflow: 'hidden' },
  row: { flexDirection: 'row', alignItems: 'center', gap: 14, minHeight: 54, paddingHorizontal: 16 },
  rowIcon: { width: 24, alignItems: 'center' },
  rowLabel: { flex: 1, fontSize: 16 },
  rowValue: { fontSize: 15 },
  track: { width: 51, height: 31, borderRadius: 16 },
  thumb: {
    position: 'absolute',
    top: 2,
    width: 27,
    height: 27,
    borderRadius: 14,
    backgroundColor: '#FFFFFF',
    shadowColor: '#16181D',
    shadowOpacity: 0.25,
    shadowRadius: 3,
    shadowOffset: { width: 0, height: 1 },
    elevation: 2,
  },
  segmented: { flexDirection: 'row', borderRadius: 20, padding: 3, marginVertical: 10 },
  segment: { height: 34, paddingHorizontal: 12, borderRadius: 17, justifyContent: 'center' },
  segmentText: { fontSize: 14, fontWeight: '500' },
});
