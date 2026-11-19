/**
 * Elementy ekranów paragonu PDF i „Pobierz moje dane” (plansze 31-mobile-tresci/paragon-pdf*, moje-dane*):
 * przycisk 56 px z ikoną i stanami „w toku” oraz „nieaktywny”, karta stanu z odznaką i lista zawartości pliku.
 */
import type { ReactNode } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, Text, View } from 'react-native';
import { radius } from '../theme/tokens';
import { Icon, type IconName } from './icons';
import { IconBadge, type BadgeTone } from './sheet';
import { useTheme } from './ui';

/**
 * Przycisk z planszy: główny (kolor akcji), drugorzędny (#E3E3DE), w toku (wskaźnik i szary podpis, plansza
 * paragon-pdf) albo nieaktywny (szary podpis na #E3E3DE, plansza moje-dane-przygotowanie).
 */
export function ActionButton({
  label,
  icon,
  kind = 'primary',
  busy,
  disabled,
  onPress,
}: {
  label: string;
  icon?: IconName;
  kind?: 'primary' | 'secondary';
  busy?: boolean;
  disabled?: boolean;
  onPress: () => void;
}) {
  const theme = useTheme();
  const inactive = busy || disabled;
  const background = inactive || kind === 'secondary' ? theme.line : theme.accent;
  const color = busy ? theme.muted : disabled ? theme.inkDisabled : kind === 'primary' ? theme.onAccent : theme.ink;
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityState={{ disabled: inactive, busy }}
      disabled={inactive}
      onPress={onPress}
      style={({ pressed }) => [styles.button, { backgroundColor: background, opacity: pressed ? 0.85 : 1 }]}
    >
      {busy ? (
        <ActivityIndicator size="small" color={theme.accent} />
      ) : icon ? (
        <Icon name={icon} color={color} />
      ) : null}
      <Text style={[styles.buttonText, { color }]}>{label}</Text>
    </Pressable>
  );
}

/**
 * Karta stanu: odznaka (albo wskaźnik w odznace w kolorze akcji), tytuł 16/600 i opis 14 px; `compact` to karta
 * błędu nad przyciskiem (odznaka 40 px, plansza paragon-pdf-blad).
 */
export function StatusCard({
  icon,
  tone = 'accent',
  spinner,
  title,
  children,
  compact,
  footer,
}: {
  icon?: IconName;
  tone?: BadgeTone;
  spinner?: boolean;
  title: string;
  children?: ReactNode;
  compact?: boolean;
  footer?: ReactNode;
}) {
  const theme = useTheme();
  const size = compact ? 40 : 44;
  return (
    <View
      accessibilityRole={tone === 'danger' ? 'alert' : undefined}
      style={[
        styles.card,
        compact ? styles.cardCompact : null,
        { backgroundColor: theme.surface, borderColor: theme.line },
      ]}
    >
      <View style={[styles.cardRow, { gap: compact ? 12 : 14, alignItems: footer ? 'center' : 'flex-start' }]}>
        {spinner ? (
          <View
            style={[
              styles.spinnerBadge,
              { width: size, height: size, borderRadius: size / 2, backgroundColor: theme.accentTint },
            ]}
          >
            <ActivityIndicator color={theme.accent} />
          </View>
        ) : icon ? (
          <IconBadge icon={icon} tone={tone} size={size} iconSize={compact ? 20 : 22} />
        ) : null}
        <View style={[styles.cardText, { gap: compact ? 2 : 4 }]}>
          <Text style={[styles.cardTitle, { color: theme.ink }]}>{title}</Text>
          {typeof children === 'string' ? (
            <Text style={[styles.cardBody, { color: theme.muted }]}>{children}</Text>
          ) : (
            children
          )}
        </View>
      </View>
      {footer}
    </View>
  );
}

/** Opis pod tytułem karty (14 px, szary) z wstawkami, np. godziną w kroju Medium. */
export function CardBody({ children }: { children: ReactNode }) {
  const theme = useTheme();
  return <Text style={[styles.cardBody, { color: theme.muted }]}>{children}</Text>;
}

/** Liczby w zdaniu z tłumaczenia (godzina, data, rozmiar) w kroju Medium, reszta bez zmian. */
export function Numbers({ children }: { children: string }) {
  const parts = children.split(/(\d(?:[\d:.,]*\d)?)/);
  return (
    <>
      {parts.map((part, i) =>
        i % 2 ? (
          <Text key={i} style={styles.number}>
            {part}
          </Text>
        ) : (
          part
        ),
      )}
    </>
  );
}

/** Wiersz listy „W pliku znajdziesz” (50 px, ikona 20 px). */
export function ContentRow({ icon, label, first }: { icon: IconName; label: string; first?: boolean }) {
  const theme = useTheme();
  return (
    <View accessible style={[styles.contentRow, !first && { borderTopWidth: 1, borderColor: theme.line }]}>
      <View style={styles.contentIcon}>
        <Icon name={icon} color={theme.ink} />
      </View>
      <Text style={[styles.contentLabel, { color: theme.ink }]}>{label}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  button: {
    height: 56,
    borderRadius: radius.pill,
    paddingHorizontal: 20,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 10,
  },
  buttonText: { fontSize: 17, fontWeight: '600' },
  card: { borderRadius: radius.list, borderWidth: 1, paddingVertical: 18, paddingHorizontal: 16, gap: 16 },
  cardCompact: { paddingVertical: 14 },
  cardRow: { flexDirection: 'row' },
  cardText: { flex: 1, paddingTop: 1 },
  cardTitle: { fontSize: 16, fontWeight: '600' },
  cardBody: { fontSize: 14, lineHeight: 20 },
  number: { fontWeight: '500' },
  spinnerBadge: { alignItems: 'center', justifyContent: 'center' },
  contentRow: { flexDirection: 'row', alignItems: 'center', gap: 14, minHeight: 50, paddingHorizontal: 16 },
  contentIcon: { width: 24, alignItems: 'center' },
  contentLabel: { flex: 1, fontSize: 16 },
});
