import { Redirect } from 'expo-router';
import { ActivityIndicator, View } from 'react-native';
import { useTheme } from '../components/ui';
import { homeFor, useSession } from '../lib/session';

/** Bramka: po odtworzeniu sesji aplikacja kieruje na start, dokończenie rejestracji, zgody, blokadę albo konto. */
export default function Gate() {
  const { status, me } = useSession();
  const theme = useTheme();
  if (status === 'loading') {
    return (
      <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: theme.bg }}>
        <ActivityIndicator color={theme.accent} />
      </View>
    );
  }
  return <Redirect href={homeFor(me)} />;
}
