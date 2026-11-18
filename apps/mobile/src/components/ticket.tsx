import type { TicketStatus } from '@hulajnogi/shared';
import { Text, View } from 'react-native';
import { statusName } from '../lib/tickets';
import { Icon } from './icons';
import { useTheme } from './ui';

/** Status dla klienta: „Rozwiązane” z obrysem i znacznikiem, pozostałe na szarym tle (`.chip`). */
export function StatusChip({ status }: { status: TicketStatus }) {
  const theme = useTheme();
  const resolved = status === 'RESOLVED';
  return (
    <View
      style={{
        height: 26,
        paddingHorizontal: 10,
        borderRadius: 13,
        flexDirection: 'row',
        alignItems: 'center',
        gap: 4,
        backgroundColor: resolved ? theme.surface : theme.line,
        borderWidth: resolved ? 1 : 0,
        borderColor: theme.checkbox,
      }}
    >
      {resolved && <Icon name="check" color={theme.ink} size={12} strokeWidth={2.6} />}
      <Text style={{ fontSize: 12, fontWeight: '600', color: theme.ink }}>{statusName(status)}</Text>
    </View>
  );
}
