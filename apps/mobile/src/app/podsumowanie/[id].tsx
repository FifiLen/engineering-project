import type { PaymentIntentResponse, RentalView, WalletView } from '@hulajnogi/shared';
import { router, useLocalSearchParams } from 'expo-router';
import { useCallback, useEffect, useState } from 'react';
import { ActivityIndicator, ScrollView, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Icon } from '../../components/icons';
import { boundsOf, type LngLat, type MapFocus } from '../../components/map/map-layers';
import { MapView } from '../../components/map/map-view';
import { Group, Lines, Note, StatusScreen } from '../../components/payment';
import { ButtonRow, Stats } from '../../components/sheet';
import { Button, ErrorBox, useTheme } from '../../components/ui';
import { t } from '../../i18n';
import { api, errorMessage } from '../../lib/api';
import { confirmAndOpen } from '../../lib/checkout';
import { clock, dayTime, km, pln, signedPln } from '../../lib/format';
import { usePayments } from '../../lib/payments';
import { useRental } from '../../lib/rental';
import { cardTitle, usableCards, useWallet, useWalletEvents } from '../../lib/wallet';

const POLL_MS = 3000;

/**
 * Podsumowanie przejazdu po rozliczeniu (makiety podsumowanie-portfel, podsumowanie-karta, stan-platnosc,
 * ADR 0049): kwota według cennika z chwili startu, pozycje wyceny, źródło zapłaty i saldo po przejeździe,
 * płatność kartą w toku (D4) albo odmowa karty z przejściem do spłaty. Przy ujemnym saldzie „Doładuj
 * portfel” zamiast „Gotowe”. Ten sam ekran otwiera historia przejazdów i spłata z portfela.
 */
export default function SummaryScreen() {
  const theme = useTheme();
  const insets = useSafeAreaInsets();
  const { id, from } = useLocalSearchParams<{ id: string; from?: string }>();
  const { outcome, clearOutcome } = useRental();
  const { cards } = useWallet();
  const payments = usePayments();
  const fromOutcome = outcome?.view.id === id ? outcome.view : null;
  const [fetched, setView] = useState<RentalView | null>(null);
  // Zdarzenie `rental.updated` po rozliczeniu (np. wynik płatności kartą) wygrywa, jeśli jest nowsze.
  const view =
    fromOutcome && (!fetched || Date.parse(fromOutcome.asOf) > Date.parse(fetched.asOf)) ? fromOutcome : fetched;
  const [balanceAfter, setBalanceAfter] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  // Widok ze zdarzenia może nie mieć jeszcze trasy i dystansu z zakończenia: zawsze pobieramy szczegóły.
  const load = useCallback(() => {
    api<RentalView>(`/rentals/${id}`)
      .then(setView)
      .catch((e: unknown) => setError(errorMessage(e)));
  }, [id]);
  useEffect(load, [load]);
  useWalletEvents(load);

  const settlement = view?.settlement.state;
  // Karta w toku: odpytywanie jako zabezpieczenie, gdyby zdarzenie nie dotarło.
  useEffect(() => {
    if (settlement !== 'CARD_PENDING') return;
    const timer = setInterval(load, POLL_MS);
    return () => clearInterval(timer);
  }, [settlement, load]);

  // Saldo po przejeździe z wpisu obciążenia w historii portfela.
  useEffect(() => {
    if (settlement !== 'WALLET_PAID') return;
    api<WalletView>('/me/wallet?limit=50')
      .then((w) => {
        const charge = w.entries.find((e) => e.type === 'RIDE_CHARGE' && e.rentalId === id);
        setBalanceAfter(charge ? charge.balanceAfter : w.balance);
      })
      .catch(() => undefined);
  }, [settlement, id]);

  const done = () => {
    clearOutcome();
    if (from === 'historia' && router.canGoBack()) router.back();
    else router.dismissTo('/mapa');
  };

  if (!view) {
    return (
      <View style={{ flex: 1, backgroundColor: theme.bg, padding: 24, paddingTop: insets.top + 24 }}>
        {error ? <ErrorBox message={error} /> : <ActivityIndicator style={{ marginTop: 80 }} color={theme.accent} />}
      </View>
    );
  }

  const s = view.settlement;
  const finishedAt = view.endedAt ?? view.billedUntil ?? view.asOf;

  // Odmowa karty (makieta stan-platnosc): przejazd `UNPAID`, spłata tą samą albo inną kartą.
  if (s.state === 'FAILED' || (view.state === 'UNPAID' && s.state !== 'CARD_PENDING')) {
    const sameCard = s.card
      ? (usableCards(cards).find((c) => c.last4 === s.card!.last4 && c.brand === s.card!.brand) ?? null)
      : null;
    const retry = async () => {
      if (!sameCard || !payments.actions) return;
      setBusy(true);
      setError(null);
      try {
        const { payment } = await api<{ payment: PaymentIntentResponse | null }>(`/rentals/${id}/pay`, {
          method: 'POST',
          json: { source: 'CARD', paymentMethodId: sameCard.id },
        });
        if (payment) await confirmAndOpen(payments.actions, payment, { card: sameCard }, { replace: true });
        else load();
      } catch (e) {
        setError(errorMessage(e));
      } finally {
        setBusy(false);
      }
    };
    return (
      <StatusScreen
        icon="card"
        tone="danger"
        title={t('summary.failed.title')}
        lead={
          s.card
            ? t('summary.failed.leadCard', {
                amount: pln(view.price.total),
                when: dayTime(finishedAt).toLocaleLowerCase('pl-PL'),
                card: cardTitle(s.card),
              })
            : t('summary.failed.lead', {
                amount: pln(view.price.total),
                when: dayTime(finishedAt).toLocaleLowerCase('pl-PL'),
              })
        }
        footer={
          <>
            <Button
              label={t('summary.failed.change')}
              onPress={() => router.replace({ pathname: '/zaleglosc/[id]', params: { id } })}
            />
            {sameCard && (
              <Button label={t('summary.failed.retry')} kind="secondary" busy={busy} onPress={() => void retry()} />
            )}
            <Button label={t('payment.toMap')} kind="plain" onPress={done} />
          </>
        }
      >
        {error && <ErrorBox message={error} />}
      </StatusScreen>
    );
  }

  const end: LngLat | null =
    view.scooter.lat !== null && view.scooter.lon !== null ? [view.scooter.lon, view.scooter.lat] : null;
  // Trasa z telemetrii przejazdu (`route` w widoku), także po otwarciu z historii.
  const route = view.route;
  const bounds = route.length ? boundsOf(route) : null;
  const focus: MapFocus | null = bounds ? { key: 'route', bounds } : end ? { key: 'end', center: end, zoom: 15 } : null;
  const totalSeconds = view.rideSeconds + view.pauseSeconds;
  const avgKmh = view.rideSeconds > 0 ? Math.round(view.distanceM / 1000 / (view.rideSeconds / 3600)) : 0;
  const subtitle = view.endZone
    ? t('summary.subtitle', { date: dayTime(finishedAt), zone: `${view.endZone.code} ${view.endZone.name}` })
    : dayTime(finishedAt);
  const remote = view.notice === 'ENDED_REMOTELY';
  const negative = s.state === 'WALLET_PAID' && balanceAfter !== null && balanceAfter < 0;

  const rows: Parameters<typeof Lines>[0]['rows'] = [
    { label: t('summary.unlock'), value: pln(view.price.unlockFee) },
    { label: t('summary.ride', { minutes: view.price.rideMinutes }), value: pln(view.price.rideAmount) },
  ];
  if (view.price.pauseMinutes > 0)
    rows.push({ label: t('summary.pause', { minutes: view.price.pauseMinutes }), value: pln(view.price.pauseAmount) });
  if (s.state === 'WALLET_PAID' || s.state === 'CARD_PAID') {
    rows.push({
      label: t('summary.paidWith'),
      value: (
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
          <Icon name={s.state === 'WALLET_PAID' ? 'wallet' : 'card'} color={theme.ink} size={18} />
          <Text style={{ fontSize: 15, color: theme.ink }}>
            {s.state === 'WALLET_PAID' ? t('summary.wallet') : s.card ? cardTitle(s.card) : t('payment.cardGeneric')}
          </Text>
        </View>
      ),
    });
  }
  if (s.refundedAmount > 0)
    rows.push({ label: t('summary.refunded'), value: signedPln(s.refundedAmount), color: theme.accentMap });
  if (s.state === 'WALLET_PAID' && balanceAfter !== null)
    rows.push({
      label: t('summary.balanceAfter'),
      value: pln(balanceAfter),
      color: negative ? theme.danger : undefined,
    });
  if (s.state === 'NONE') rows.push({ label: t('summary.total'), value: pln(view.price.total), strong: true });

  const note =
    s.state === 'CARD_PENDING'
      ? t('summary.cardPendingNote')
      : s.state === 'NONE'
        ? view.price.total === 0
          ? t('summary.free')
          : t('summary.note')
        : null;
  const notes = [remote ? t('summary.remote') : null, note].filter(Boolean).join(' ');
  const receiptId = s.receiptId;
  const finish = negative ? (
    <Button label={t('summary.topup')} onPress={() => router.replace('/portfel')} />
  ) : (
    <Button label={t('summary.done')} kind="dark" onPress={done} />
  );

  return (
    <View style={{ flex: 1, backgroundColor: theme.map }}>
      <View style={{ height: 300 }} accessibilityLabel={t('summary.map')}>
        {focus && (
          <MapView
            focus={focus}
            route={route}
            parked={end ? { lon: end[0], lat: end[1] } : null}
            padding={{ top: insets.top + 24, bottom: 64, left: 40, right: 40 }}
          />
        )}
      </View>
      <View
        style={{
          flex: 1,
          marginTop: -44,
          backgroundColor: theme.scheme === 'dark' ? theme.surface : theme.bg,
          borderTopLeftRadius: 32,
          borderTopRightRadius: 32,
        }}
      >
        <ScrollView contentContainerStyle={{ padding: 24, paddingBottom: 16 }}>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 14 }}>
            <View
              style={{
                width: 44,
                height: 44,
                borderRadius: 22,
                backgroundColor: theme.accent,
                alignItems: 'center',
                justifyContent: 'center',
              }}
            >
              <Icon name="check" color="#FFFFFF" size={22} strokeWidth={2.6} />
            </View>
            <View style={{ flex: 1, gap: 2 }}>
              <Text
                accessibilityRole="header"
                style={{ fontSize: 22, fontWeight: '600', letterSpacing: -0.4, color: theme.ink }}
              >
                {t('summary.title')}
              </Text>
              <Text style={{ fontSize: 14, color: theme.muted }}>{subtitle}</Text>
            </View>
          </View>
          <Text
            style={{
              marginTop: 18,
              fontSize: 46,
              fontWeight: '500',
              letterSpacing: -1.6,
              lineHeight: 48,
              color: theme.ink,
            }}
          >
            {pln(view.price.total)}
          </Text>
          <View style={{ marginTop: 18 }}>
            <Stats
              size={18}
              align="left"
              items={[
                { value: clock(totalSeconds), label: t('summary.time') },
                { value: km(view.distanceM), label: t('summary.distance') },
                { value: t('units.kmh', { value: avgKmh }), label: t('summary.avg') },
              ]}
            />
          </View>
          <View style={{ marginTop: 18 }}>
            <Lines rows={rows} />
          </View>
          {s.state === 'CARD_PENDING' && (
            <Group style={{ marginTop: 20 }}>
              <View
                accessibilityRole="progressbar"
                style={{ flexDirection: 'row', alignItems: 'center', gap: 14, minHeight: 68, paddingHorizontal: 16 }}
              >
                <ActivityIndicator color={theme.accent} />
                <View style={{ flex: 1, gap: 2, paddingVertical: 10 }}>
                  <Text style={{ fontSize: 16, fontWeight: '600', color: theme.ink }}>{t('summary.cardPending')}</Text>
                  <Text style={{ fontSize: 13, color: theme.muted }}>
                    {s.card
                      ? t('summary.cardPendingLead', { amount: pln(view.price.total), card: cardTitle(s.card) })
                      : t('summary.cardPendingLeadShort', { amount: pln(view.price.total) })}
                  </Text>
                </View>
              </View>
            </Group>
          )}
          {notes ? <Note style={{ marginTop: 16 }}>{notes}</Note> : null}
        </ScrollView>
        <View style={{ paddingHorizontal: 24, paddingBottom: 16 + insets.bottom }}>
          {receiptId ? (
            <ButtonRow split>
              <Button
                label={t('summary.receipt')}
                kind="secondary"
                onPress={() => router.push({ pathname: '/paragon/[id]', params: { id: receiptId } })}
              />
              {finish}
            </ButtonRow>
          ) : (
            finish
          )}
        </View>
      </View>
    </View>
  );
}
