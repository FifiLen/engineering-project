import { Redirect } from 'expo-router';
import { ActivityIndicator, View } from 'react-native';
import { useTheme } from '../components/ui';
import { useRental } from '../lib/rental';
import { homeFor, useSession } from '../lib/session';

/**
 * Bramka: po odtworzeniu sesji aplikacja kieruje na start, dokończenie rejestracji, zgody, blokadę albo
 * mapę; otwarty przejazd przejmuje aplikację dopiero po wczytaniu stanu (`RideTakeover` w układzie).
 */
export default function Gate() {
  const { status, me } = useSession();
  const { loaded } = useRental();
  const theme = useTheme();
  const home = homeFor(me);
  if (status === 'loading' || (home === '/mapa' && !loaded)) {
    return (
      <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: theme.bg }}>
        <ActivityIndicator color={theme.accent} />
      </View>
    );
  }
  return <Redirect href={home} />;
}
