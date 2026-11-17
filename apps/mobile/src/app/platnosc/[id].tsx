import type { PaymentView, RentalView } from '@hulajnogi/shared';
import { router, useLocalSearchParams } from 'expo-router';
import { useCallback, useEffect, useState } from 'react';
import { ActivityIndicator, AppState, View } from 'react-native';
import { BigAmount, Group, Note, StatusScreen, ValueRow } from '../../components/payment';
import { Steps } from '../../components/sheet';
import { Button, ErrorBox, useTheme } from '../../components/ui';
import { t } from '../../i18n';
import { api, errorMessage } from '../../lib/api';
import { clock, dayTime, pln, signedPln } from '../../lib/format';
import { failureText } from '../../lib/payments';
import { useNow } from '../../lib/rental';
import { cardTitle, useWallet, useWalletEvents } from '../../lib/wallet';

/** Czas na potwierdzenie BLIK-u w banku (ADR 0051, dokumentacja Stripe). */
const BLIK_SECONDS = 60;
/** Po 2 min bez webhooka API sprawdza status u operatora (`tech-doladowanie`). */
const SLOW_MS = 120000;
const POLL_MS = 2500;

/**
 * Płatność w toku i jej wynik (makiety doladowanie-oczekiwanie, -sukces, -odmowa): doładowanie albo
 * spłata zaległości kartą. Stan z `GET /payments/{id}` po każdym `wallet.updated`, co kilka sekund i po
 * powrocie aplikacji na pierwszy plan (z aplikacji banku). Parametry: `failure` (odmowa już przy
 * potwierdzeniu), `at` (chwila wysłania kodu BLIK), `card`, `brand` (opis karty).
 */
export default function PaymentScreen() {
  const theme = useTheme();
  const params = useLocalSearchParams<{ id: string; failure?: string; at?: string; card?: string; brand?: string }>();
  const { summary } = useWallet();
  const [payment, setPayment] = useState<PaymentView | null>(null);
  const [rental, setRental] = useState<RentalView | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [openedAt] = useState(() => Date.now());

  const load = useCallback(() => {
    api<PaymentView>(`/payments/${params.id}`)
      .then((p) => {
        setPayment(p);
        setError(null);
      })
      .catch((e: unknown) => setError(errorMessage(e)));
  }, [params.id]);

  useEffect(load, [load]);
  useWalletEvents(load);
  const pending = !params.failure && (!payment || payment.status === 'PENDING');
  useEffect(() => {
    if (!pending) return;
    const timer = setInterval(load, POLL_MS);
    const sub = AppState.addEventListener('change', (state) => state === 'active' && load());
    return () => {
      clearInterval(timer);
      sub.remove();
    };
  }, [pending, load]);

  // Spłata zaległości: paragon przejazdu po udanej płatności.
  const rentalId = payment?.purpose === 'RIDE' && payment.status === 'SUCCEEDED' ? payment.rentalId : null;
  useEffect(() => {
    if (!rentalId) return;
    api<RentalView>(`/rentals/${rentalId}`)
      .then(setRental)
      .catch(() => undefined);
  }, [rentalId]);

  const now = useNow(pending);

  if (!payment) {
    return (
      <View style={{ flex: 1, backgroundColor: theme.bg, padding: 24, paddingTop: 80 }}>
        {error ? <ErrorBox message={error} /> : <ActivityIndicator color={theme.accent} />}
      </View>
    );
  }

  const blik = payment.method === 'BLIK';
  const topup = payment.purpose === 'TOPUP';
  const card = params.card ? { last4: params.card, brand: params.brand ?? '' } : null;
  const methodText = blik ? t('payment.blik') : card ? cardTitle(card) : t('payment.cardGeneric');
  const toMap = () => router.dismissTo('/mapa');
  const toWallet = () => router.dismissTo('/portfel');

  const failed = params.failure || payment.status === 'FAILED';
  if (failed) {
    const text = failureText(params.failure ?? payment.failureCode);
    return (
      <StatusScreen
        icon="card"
        tone="danger"
        title={text.title}
        lead={t('payment.failedLead', { reason: text.reason })}
        footer={
          topup ? (
            <>
              <Button
                label={t('payment.retry')}
                onPress={() =>
                  router.replace({
                    pathname: '/portfel/doladowanie',
                    params: { amount: String(payment.amount), ...(blik ? { method: 'BLIK' } : {}) },
                  })
                }
              />
              <Button label={t('payment.changeMethod')} kind="secondary" onPress={toWallet} />
            </>
          ) : (
            <>
              <Button
                label={t('payment.retry')}
                onPress={() =>
                  payment.rentalId
                    ? router.replace({ pathname: '/zaleglosc/[id]', params: { id: payment.rentalId } })
                    : toMap()
                }
              />
              <Button label={t('payment.toMap')} kind="secondary" onPress={toMap} />
            </>
          )
        }
      >
        <Group style={{ marginTop: 28 }}>
          <ValueRow first label={t('payment.amount')} value={pln(payment.amount)} />
          <ValueRow label={t('payment.method')} value={methodText} />
          {summary && <ValueRow label={t('payment.balanceUnchanged')} value={pln(summary.balance)} />}
        </Group>
      </StatusScreen>
    );
  }

  if (payment.status === 'SUCCEEDED' || payment.status === 'REFUNDED') {
    const receiptId = rental?.settlement.receiptId ?? null;
    return (
      <StatusScreen
        icon="check"
        tone="solid"
        title={topup ? t('payment.success.topupTitle') : t('payment.success.rideTitle')}
        lead={
          topup
            ? t('payment.success.topupLead', { amount: pln(payment.amount) })
            : t('payment.success.rideLead', { amount: pln(payment.amount) })
        }
        footer={
          <>
            <Button label={t('payment.toMap')} onPress={toMap} />
            {topup ? (
              <Button label={t('payment.wallet')} kind="secondary" onPress={toWallet} />
            ) : (
              receiptId && (
                <Button
                  label={t('payment.receipt')}
                  kind="secondary"
                  onPress={() => router.replace({ pathname: '/paragon/[id]', params: { id: receiptId } })}
                />
              )
            )}
          </>
        }
      >
        {topup && summary && (
          <View style={{ marginTop: 28 }}>
            <BigAmount label={t('payment.balance')} value={pln(summary.balance)} />
          </View>
        )}
        <Group style={{ marginTop: 28 }}>
          <ValueRow
            first
            label={topup ? t('payment.topup') : t('payment.amount')}
            value={topup ? signedPln(payment.amount) : pln(payment.amount)}
            color={topup ? theme.accentMap : undefined}
          />
          <ValueRow label={t('payment.method')} value={methodText} />
          <ValueRow label={t('payment.date')} value={dayTime(payment.updatedAt)} />
        </Group>
        {topup && <Note style={{ marginTop: 16 }}>{t('payment.success.vat')}</Note>}
      </StatusScreen>
    );
  }

  // Płatność w toku: BLIK z licznikiem czasu na potwierdzenie w banku, karta po 3-D Secure bez licznika.
  const startedAt = params.at ? Number(params.at) : openedAt;
  const left = BLIK_SECONDS - (now - startedAt) / 1000;
  const slow = now - startedAt > SLOW_MS;
  const last = topup ? t('payment.wait.stepTopup') : t('payment.wait.stepRide');
  return (
    <StatusScreen
      icon={blik ? 'phone' : 'card'}
      tone="accent"
      title={blik ? t('payment.wait.blikTitle') : t('payment.wait.cardTitle')}
      lead={blik ? t('payment.wait.blikLead') : t('payment.wait.cardLead')}
      footer={
        <Button
          label={topup ? t('payment.wait.close') : t('payment.toMap')}
          kind="secondary"
          onPress={topup ? toWallet : toMap}
        />
      }
    >
      <Group style={{ marginTop: 24 }}>
        <ValueRow first label={t('payment.amount')} value={pln(payment.amount)} />
        <ValueRow label={t('payment.method')} value={methodText} />
        {blik && (
          <ValueRow label={t('payment.wait.timeLeft')} value={clock(Math.max(0, Math.ceil(left))).replace(/^0/, '')} />
        )}
      </Group>
      <Steps
        steps={[
          { label: blik ? t('payment.wait.blikAccepted') : t('payment.wait.cardAccepted'), state: 'done' },
          { label: blik ? t('payment.wait.bank') : t('payment.wait.bankCard'), state: 'spin' },
          { label: last, state: 'todo' },
        ]}
      />
      {slow && <Note style={{ marginTop: 24 }}>{t('payment.wait.slow')}</Note>}
      {error && <ErrorBox message={error} />}
    </StatusScreen>
  );
}
