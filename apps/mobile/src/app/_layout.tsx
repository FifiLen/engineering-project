import { Stack, router, usePathname } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { useEffect } from 'react';
import { NotificationBanner } from '../components/notification-banner';
import { useTheme } from '../components/ui';
import { ContentProvider } from '../lib/content';
import { LocationProvider } from '../lib/location';
import { MapIntentProvider } from '../lib/map-intent';
import { NotificationsProvider } from '../lib/notifications';
import { PaymentsProvider } from '../lib/payments';
import { PreferencesProvider } from '../lib/preferences';
import { holdsRideScreen, RentalProvider, useRental } from '../lib/rental';
import { SessionProvider } from '../lib/session';
import { WalletProvider } from '../lib/wallet';

/** Ekrany dostępne w trakcie przejazdu; z każdego innego aplikacja wraca na ekran przejazdu. */
const RIDE_PATHS = ['/przejazd', '/dokument', '/zdjecie'];

/**
 * Otwarty przejazd przejmuje aplikację (także po ponownym uruchomieniu, bo stan pochodzi z
 * `GET /rentals/current`); rezerwacja zostaje na mapie, która jest ekranem głównym. Zakończenie bez
 * łączności trzyma ekran przejazdu tylko do wysłania zdjęcia (ADR 0056).
 */
function RideTakeover() {
  const { rental, photoSent, photoDue, clearPhotoDue } = useRental();
  const pathname = usePathname();
  const view = rental?.view;
  const riding = holdsRideScreen(view, !!view && photoSent(view.id));
  useEffect(() => {
    if (riding && !RIDE_PATHS.some((p) => pathname.startsWith(p))) router.replace('/przejazd');
  }, [riding, pathname]);
  // Zakończony przejazd bez wymaganego zdjęcia (np. aplikacja zamknięta na ekranie zdjęcia): raz po starcie.
  useEffect(() => {
    if (!photoDue || riding || pathname === '/') return;
    clearPhotoDue();
    if (!pathname.startsWith('/zdjecie'))
      router.push({ pathname: '/zdjecie/[id]', params: { id: photoDue.id, then: 'map' } });
  }, [photoDue, riding, pathname, clearPhotoDue]);
  return null;
}

function Shell() {
  const theme = useTheme();
  return (
    <>
      <StatusBar style={theme.scheme === 'dark' ? 'light' : 'dark'} />
      <RideTakeover />
      <Stack screenOptions={{ headerShown: false, contentStyle: { backgroundColor: theme.bg } }} />
      <NotificationBanner />
    </>
  );
}

export default function RootLayout() {
  return (
    <PreferencesProvider>
      <ContentProvider>
        <SessionProvider>
          <NotificationsProvider>
            <PaymentsProvider>
              <WalletProvider>
                <LocationProvider>
                  <RentalProvider>
                    <MapIntentProvider>
                      <Shell />
                    </MapIntentProvider>
                  </RentalProvider>
                </LocationProvider>
              </WalletProvider>
            </PaymentsProvider>
          </NotificationsProvider>
        </SessionProvider>
      </ContentProvider>
    </PreferencesProvider>
  );
}
