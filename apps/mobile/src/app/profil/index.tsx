import type { ProfileSummary } from '@hulajnogi/shared';
import { Redirect, router } from 'expo-router';
import { useEffect, useState } from 'react';
import { Text, View } from 'react-native';
import { ListGroup, ListRow, PageScreen } from '../../components/list';
import { Stats } from '../../components/sheet';
import { ErrorBox, useTheme } from '../../components/ui';
import { t } from '../../i18n';
import { api, errorMessage, formatPhone } from '../../lib/api';
import { hoursMinutes, pln, totalDistance } from '../../lib/format';
import { useSession } from '../../lib/session';
import { useWallet } from '../../lib/wallet';

/**
 * Profil (makieta profil): statystyki przejazdów, portfel z saldem na żywo (`wallet.updated`), historia,
 * metody płatności (od iteracji 5), cennik, ustawienia, „Pomoc i zgłoszenia” (ekran Pomoc, iteracja 7),
 * dokumenty i wylogowanie.
 */
export default function ProfileScreen() {
  const theme = useTheme();
  const { me, signOut } = useSession();
  const { summary } = useWallet();
  const [profile, setProfile] = useState<ProfileSummary | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    api<ProfileSummary>('/me/profile')
      .then(setProfile)
      .catch((e: unknown) => setError(errorMessage(e)));
  }, []);

  if (!me) return <Redirect href="/witaj" />;
  const doc = (slug: string) => router.push({ pathname: '/dokument/[slug]', params: { slug } });

  return (
    <PageScreen title={t('account.title')} onBack={() => (router.canGoBack() ? router.back() : router.replace('/mapa'))}>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 16 }}>
        <View style={{ width: 64, height: 64, borderRadius: 32, backgroundColor: theme.dark, alignItems: 'center', justifyContent: 'center' }}>
          <Text style={{ fontSize: 24, fontWeight: '600', color: theme.onDark }}>{me.name?.trim()[0]?.toUpperCase() ?? ''}</Text>
        </View>
        <View style={{ gap: 2, flex: 1 }}>
          <Text style={{ fontSize: 22, fontWeight: '600', letterSpacing: -0.4, color: theme.ink }}>{me.name ?? ''}</Text>
          <Text style={{ fontSize: 15, color: theme.muted }}>{formatPhone(me.phone)}</Text>
        </View>
      </View>
      {profile && (
        <View style={{ paddingVertical: 16, backgroundColor: theme.surface, borderWidth: 1, borderColor: theme.line, borderRadius: 20 }}>
          <Stats
            items={[
              { value: String(profile.stats.ridesCount), label: t('account.rides') },
              { value: totalDistance(profile.stats.distanceM), label: t('account.distance') },
              { value: hoursMinutes(profile.stats.travelSeconds), label: t('account.time') },
            ]}
          />
        </View>
      )}
      {error && <ErrorBox message={error} />}
      <ListGroup>
        <ListRow
          first
          icon="wallet"
          label={t('account.wallet')}
          value={summary ? pln(summary.balance) : profile ? pln(profile.balance) : ''}
          onPress={() => router.push('/portfel')}
        />
        <ListRow icon="clock" label={t('account.history')} onPress={() => router.push('/profil/historia')} />
        <ListRow icon="card" label={t('account.paymentMethods')} onPress={() => router.push('/profil/platnosci')} />
      </ListGroup>
      <ListGroup>
        <ListRow first icon="sliders" label={t('account.settings')} onPress={() => router.push('/profil/ustawienia')} />
        <ListRow icon="help" label={t('account.help')} onPress={() => router.push('/pomoc')} />
        <ListRow icon="document" label={t('account.tariff')} onPress={() => router.push('/cennik')} />
        <ListRow icon="document" label={t('account.terms')} onPress={() => doc('regulamin')} />
        <ListRow icon="document" label={t('account.privacy')} onPress={() => doc('polityka-prywatnosci')} />
      </ListGroup>
      <ListGroup>
        <ListRow first icon="logout" label={t('account.signOut')} onPress={() => void signOut().then(() => router.replace('/witaj'))} chevron={false} />
      </ListGroup>
    </PageScreen>
  );
}
