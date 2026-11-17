import type { TariffDetailsView } from '@hulajnogi/shared';
import { router } from 'expo-router';
import { useEffect, useState } from 'react';
import { ActivityIndicator, Text, View } from 'react-native';
import { PageScreen } from '../components/list';
import { ScooterRender } from '../components/scooter';
import { ErrorBox, useTheme } from '../components/ui';
import { t } from '../i18n';
import { api, errorMessage } from '../lib/api';
import { pln } from '../lib/format';

/**
 * Cennik (makieta platnosci-cennik): obowiązująca wersja z `GET /tariff` (ADR 0015, ADR 0053). Opłata
 * „poza strefą” dotyczy odholowania przez serwis (pytanie 7); ceny brutto z VAT.
 */
export default function TariffScreen() {
  const theme = useTheme();
  const [tariff, setTariff] = useState<TariffDetailsView | null>(null);
  const [error, setError] = useState<string | null>(null);
  const back = () => (router.canGoBack() ? router.back() : router.replace('/mapa'));

  useEffect(() => {
    api<TariffDetailsView>('/tariff')
      .then(setTariff)
      .catch((e: unknown) => setError(errorMessage(e)));
  }, []);

  const row = (label: string, value: string, hint?: string) => (
    <View
      key={label}
      style={{
        flexDirection: 'row',
        alignItems: 'center',
        gap: 16,
        paddingVertical: 18,
        borderBottomWidth: 1,
        borderColor: theme.line,
      }}
    >
      <View style={{ flex: 1, gap: 2 }}>
        <Text style={{ fontSize: 17, color: theme.ink }}>{label}</Text>
        {hint ? <Text style={{ fontSize: 14, lineHeight: 18, color: theme.muted }}>{hint}</Text> : null}
      </View>
      <Text style={{ fontSize: 19, fontWeight: '500', color: theme.ink }}>{value}</Text>
    </View>
  );

  return (
    <PageScreen
      title={t('tariff.title')}
      onBack={back}
      footer={<Text style={{ textAlign: 'center', fontSize: 14, color: theme.muted }}>{t('tariff.footer')}</Text>}
    >
      <ScooterRender
        variant="GRAFIT"
        side
        style={{ height: 170, width: '100%' }}
        label={t('variants.render', { variant: t('variants.GRAFIT') })}
      />
      {error && <ErrorBox message={error} />}
      {!tariff && !error && <ActivityIndicator color={theme.accent} />}
      {tariff && (
        <View>
          {row(t('tariff.unlock'), pln(tariff.unlockFee), t('tariff.unlockHint'))}
          {row(t('tariff.minute'), pln(tariff.minuteRate))}
          {row(t('tariff.pause'), pln(tariff.pauseMinuteRate), t('tariff.pauseHint'))}
          {row(
            t('tariff.reservation'),
            t('tariff.free'),
            t('tariff.reservationHint', { minutes: tariff.freeReservationMinutes }),
          )}
          {row(t('tariff.outOfZone'), pln(tariff.outOfZoneFee), t('tariff.outOfZoneHint'))}
          <Text style={{ marginTop: 16, fontSize: 14, lineHeight: 20, color: theme.muted }}>
            {t('tariff.vat', { rate: tariff.vatRate, minimum: pln(tariff.minWalletBalance) })}
          </Text>
        </View>
      )}
    </PageScreen>
  );
}
