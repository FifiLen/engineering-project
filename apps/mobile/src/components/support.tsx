import { Linking, Text, type TextStyle } from 'react-native';
import { t } from '../i18n';
import { telHref, useCompany } from '../lib/content';
import { useTheme } from './ui';

/**
 * „Nadal nie działa? Zadzwoń: …” pod ekranami awarii (przejazd bez łączności, nieudana blokada, zdjęcie parkowania):
 * numer pomocy z danych firmy (ADR 0062), dotknięcie otwiera `tel:`. Bez treści w pamięci przypisu nie ma.
 */
export function SupportCallNote({ style }: { style?: TextStyle }) {
  const theme = useTheme();
  const company = useCompany();
  if (!company) return null;
  const phone = company.supportPhone;
  return (
    <Text
      accessibilityRole="link"
      onPress={() => void Linking.openURL(telHref(phone)).catch(() => undefined)}
      style={[{ fontSize: 14, color: theme.muted, textAlign: 'center' }, style]}
    >
      {t('ride.helpPrefix')}
      <Text style={{ fontWeight: '500', color: theme.accentMap }}>{phone}</Text>
    </Text>
  );
}
