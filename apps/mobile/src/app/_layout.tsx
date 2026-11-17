import { Stack, router, usePathname } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { useEffect } from 'react';
import { useTheme } from '../components/ui';
import { LocationProvider } from '../lib/location';
import { PreferencesProvider } from '../lib/preferences';
import { isRiding, RentalProvider, useRental } from '../lib/rental';
import { SessionProvider } from '../lib/session';

/** Ekrany dostępne w trakcie przejazdu; z każdego innego aplikacja wraca na ekran przejazdu. */
const RIDE_PATHS = ['/przejazd', '/dokument'];

/**
 * Otwarty przejazd przejmuje aplikację (także po ponownym uruchomieniu, bo stan pochodzi z
 * `GET /rentals/current`); rezerwacja zostaje na mapie, która jest ekranem głównym.
 */
function RideTakeover() {
  const { rental } = useRental();
  const pathname = usePathname();
  const riding = isRiding(rental?.view);
  useEffect(() => {
    if (riding && !RIDE_PATHS.some((p) => pathname.startsWith(p))) router.replace('/przejazd');
  }, [riding, pathname]);
  return null;
}

function Shell() {
  const theme = useTheme();
  return (
    <>
      <StatusBar style={theme.scheme === 'dark' ? 'light' : 'dark'} />
      <RideTakeover />
      <Stack screenOptions={{ headerShown: false, contentStyle: { backgroundColor: theme.bg } }} />
    </>
  );
}

export default function RootLayout() {
  return (
    <PreferencesProvider>
      <SessionProvider>
        <LocationProvider>
          <RentalProvider>
            <Shell />
          </RentalProvider>
        </LocationProvider>
      </SessionProvider>
    </PreferencesProvider>
  );
}
