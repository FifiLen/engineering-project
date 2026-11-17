import { formatPln, type ProfileSummary, type RentalView } from '@hulajnogi/shared';
import { router } from 'expo-router';
import { useCallback, useEffect, useState } from 'react';
import { ActivityIndicator, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Icon } from '../../components/icons';
import { IconBadge, RoundButton } from '../../components/sheet';
import { Button, ErrorBox, useTheme } from '../../components/ui';
import { t } from '../../i18n';
import { ApiError, api, errorMessage, storeTokens } from '../../lib/api';
import { scooterNo } from '../../lib/format';
import { isRiding } from '../../lib/rental';
import { useSession } from '../../lib/session';
import { radius } from '../../theme/tokens';

interface Conditions {
  rental: RentalView | null;
  balance: number;
}

async function loadConditions(): Promise<Conditions> {
  const [{ rental }, profile] = await Promise.all([
    api<{ rental: RentalView | null }>('/rentals/current'),
    api<ProfileSummary>('/me/profile'),
  ]);
  return { rental, balance: profile.balance };
}

/**
 * Usunięcie konta (makiety profil-usun-konto, profil-usun-niemozliwe; pytanie 7): warunki to brak
 * otwartej rezerwacji i przejazdu oraz saldo 0. Dane osobowe anonimizuje `sp_anonymize_user`, a przejazdy
 * zostają bez powiązania z klientem.
 */
export default function DeleteAccountScreen() {
  const theme = useTheme();
  const { reload } = useSession();
  const [conditions, setConditions] = useState<Conditions | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const back = () => (router.canGoBack() ? router.back() : router.replace('/profil/ustawienia'));

  const check = useCallback(
    () =>
      loadConditions()
        .then(setConditions)
        .catch((e: unknown) => setError(errorMessage(e))),
    [],
  );

  useEffect(() => {
    void check();
  }, [check]);

  async function remove() {
    setBusy(true);
    setError(null);
    try {
      await api('/me', { method: 'DELETE' });
      // Sesje usuniętego konta nie działają; zapominamy tokeny i wracamy do ekranu startowego.
      await storeTokens(null);
      await reload();
      router.replace('/witaj');
    } catch (e) {
      if (e instanceof ApiError && (e.code === 'USER_HAS_OPEN_RENTAL' || e.code === 'WALLET_BALANCE_NOT_ZERO')) await check();
      else setError(errorMessage(e));
    } finally {
      setBusy(false);
    }
  }

  const blocked = conditions && (conditions.rental !== null || conditions.balance !== 0);
  const rental = conditions?.rental ?? null;
  const riding = isRiding(rental);

  let body;
  let footer;
  if (!conditions) {
    body = error ? <ErrorBox message={error} /> : <ActivityIndicator style={{ marginTop: 80 }} color={theme.accent} />;
  } else if (blocked) {
    const row = (ok: boolean, title: string, detail: string, first?: boolean) => (
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 14, padding: 16, borderTopWidth: first ? 0 : 1, borderColor: theme.line }}>
        <IconBadge icon={ok ? 'check' : 'exclamation'} tone={ok ? 'accent' : 'warning'} size={26} iconSize={14} />
        <View style={{ flex: 1, gap: 2 }}>
          <Text style={{ fontSize: 16, color: theme.ink }}>{title}</Text>
          <Text style={{ fontSize: 14, color: theme.muted }}>{detail}</Text>
        </View>
      </View>
    );
    body = (
      <>
        <View style={{ width: 64, height: 64, borderRadius: 32, backgroundColor: theme.warningTint, alignItems: 'center', justifyContent: 'center', marginTop: 40 }}>
          <Icon name="warning" color={theme.warning} size={28} strokeWidth={2} />
        </View>
        <Text accessibilityRole="header" style={{ marginTop: 28, fontSize: 32, fontWeight: '600', letterSpacing: -1, lineHeight: 36, color: theme.ink }}>
          {t('deleteAccount.blocked.title')}
        </Text>
        <Text style={{ marginTop: 10, fontSize: 16, lineHeight: 24, color: theme.muted }}>
          {rental ? t('deleteAccount.blocked.leadRental') : t('deleteAccount.blocked.leadBalance')}
        </Text>
        <View style={{ marginTop: 28, borderRadius: radius.list, borderWidth: 1, borderColor: theme.line, backgroundColor: theme.surface, overflow: 'hidden' }}>
          {row(
            !rental,
            t('deleteAccount.blocked.noRental'),
            rental
              ? riding
                ? t('deleteAccount.blocked.rideActive', { number: scooterNo(rental.scooter.number) })
                : t('deleteAccount.blocked.reservationActive', { number: scooterNo(rental.scooter.number) })
              : t('deleteAccount.blocked.noneOpen'),
            true,
          )}
          {row(conditions.balance === 0, t('deleteAccount.blocked.zeroBalance'), formatPln(conditions.balance))}
        </View>
      </>
    );
    footer = (
      <>
        {rental && (
          <Button
            label={riding ? t('deleteAccount.blocked.goToRide') : t('deleteAccount.blocked.goToReservation')}
            onPress={() => router.dismissTo(riding ? '/przejazd' : '/mapa')}
          />
        )}
        <Button label={t('deleteAccount.blocked.back')} kind="secondary" onPress={back} />
      </>
    );
  } else {
    body = (
      <>
        <View style={{ width: 64, height: 64, borderRadius: 32, backgroundColor: theme.dangerTint, alignItems: 'center', justifyContent: 'center', marginTop: 40 }}>
          <Icon name="trash" color={theme.danger} size={28} strokeWidth={2} />
        </View>
        <Text accessibilityRole="header" style={{ marginTop: 28, fontSize: 32, fontWeight: '600', letterSpacing: -1, lineHeight: 36, color: theme.ink }}>
          {t('deleteAccount.title')}
        </Text>
        <Text style={{ marginTop: 10, fontSize: 16, lineHeight: 24, color: theme.muted }}>{t('deleteAccount.lead')}</Text>
        <View style={{ marginTop: 28, borderRadius: radius.list, borderWidth: 1, borderColor: theme.line, backgroundColor: theme.surface, padding: 16, gap: 8 }}>
          <View style={{ flexDirection: 'row', justifyContent: 'space-between' }}>
            <Text style={{ fontSize: 16, color: theme.muted }}>{t('deleteAccount.balance')}</Text>
            <Text style={{ fontSize: 16, fontWeight: '500', color: theme.ink }}>{formatPln(conditions.balance)}</Text>
          </View>
          <Text style={{ fontSize: 14, color: theme.muted }}>{t('deleteAccount.balanceRule')}</Text>
        </View>
        <Text style={{ marginTop: 24, fontSize: 14, lineHeight: 20, color: theme.muted }}>{t('deleteAccount.legal')}</Text>
        {error && <ErrorBox message={error} />}
      </>
    );
    footer = (
      <>
        <Button label={t('deleteAccount.confirm')} kind="danger" busy={busy} onPress={() => void remove()} />
        <Button label={t('deleteAccount.cancel')} kind="secondary" onPress={back} />
      </>
    );
  }

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: theme.bg }}>
      <View style={{ flex: 1, paddingHorizontal: 24, paddingTop: 20 }}>
        <RoundButton label={t('common.back')} onPress={back}>
          <Icon name="back" color={theme.ink} />
        </RoundButton>
        {body}
      </View>
      {footer && <View style={{ paddingHorizontal: 24, paddingBottom: 16, gap: 10 }}>{footer}</View>}
    </SafeAreaView>
  );
}
