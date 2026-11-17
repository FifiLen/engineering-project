import type { PaymentIntentResponse, RentalView } from '@hulajnogi/shared';
import { router, useLocalSearchParams } from 'expo-router';
import { useEffect, useState } from 'react';
import { ActivityIndicator, Text, View } from 'react-native';
import { PageScreen } from '../../components/list';
import { AddRow, BigAmount, CardMini, Group, Lines, Note, OptionRow, Radio } from '../../components/payment';
import { Button, ErrorBox, useTheme } from '../../components/ui';
import { t } from '../../i18n';
import { api, errorMessage } from '../../lib/api';
import { confirmAndOpen } from '../../lib/checkout';
import { around, dayTime, pln, scooterNo } from '../../lib/format';
import { failureShort, usePayments } from '../../lib/payments';
import { brandName, cardTitle, preferredCard, usableCards, useWallet } from '../../lib/wallet';

type Source = { kind: 'card'; id: string } | { kind: 'wallet' };

/**
 * Spłata zaległości (makieta zaleglosc-splata, ADR 0049, pytanie 6): przejazd `UNPAID` po odmowie karty.
 * Zapłata kartą (tą samą albo inną, z potwierdzeniem w aplikacji) albo z portfela, gdy saldo pokrywa
 * całą kwotę. Ręczna spłata anuluje automatyczne ponowienie.
 */
export default function DebtScreen() {
  const theme = useTheme();
  const { id } = useLocalSearchParams<{ id: string }>();
  const { summary, cards } = useWallet();
  const payments = usePayments();
  const [rental, setRental] = useState<RentalView | null>(null);
  const [chosen, setChosen] = useState<Source | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const back = () => (router.canGoBack() ? router.back() : router.replace('/mapa'));

  useEffect(() => {
    api<RentalView>(`/rentals/${id}`)
      .then(setRental)
      .catch((e: unknown) => setError(errorMessage(e)));
  }, [id]);

  const debt = summary?.overdue.find((o) => o.rentalId === id) ?? null;

  if (!summary || !rental) {
    return (
      <PageScreen title={t('debt.title')} onBack={back}>
        {error ? <ErrorBox message={error} /> : <ActivityIndicator style={{ marginTop: 40 }} color={theme.accent} />}
      </PageScreen>
    );
  }

  if (!debt || rental.state !== 'UNPAID') {
    return (
      <PageScreen
        title={t('debt.title')}
        onBack={back}
        footer={<Button label={t('payment.toMap')} onPress={() => router.dismissTo('/mapa')} />}
      >
        <Text style={{ fontSize: 16, lineHeight: 24, color: theme.muted }}>{t('debt.settled')}</Text>
      </PageScreen>
    );
  }

  const usable = usableCards(cards);
  const walletCovers = summary.balance >= debt.amount;
  const fallback = preferredCard(cards);
  const source: Source | null =
    chosen && (chosen.kind === 'wallet' ? walletCovers : usable.some((c) => c.id === chosen.id))
      ? chosen
      : fallback
        ? { kind: 'card', id: fallback.id }
        : walletCovers
          ? { kind: 'wallet' }
          : null;
  const when = debt.endedAt ?? rental.endedAt ?? rental.asOf;

  async function pay() {
    if (!source) return;
    setBusy(true);
    setError(null);
    try {
      const body = source.kind === 'wallet' ? { source: 'WALLET' } : { source: 'CARD', paymentMethodId: source.id };
      const { payment } = await api<{ payment: PaymentIntentResponse | null }>(`/rentals/${id}/pay`, {
        method: 'POST',
        json: body,
      });
      if (!payment) {
        // Z portfela od razu: przejazd jest opłacony, podsumowanie pokazuje rozliczenie i paragon.
        router.replace({ pathname: '/podsumowanie/[id]', params: { id } });
        return;
      }
      if (!payments.actions) throw new Error('payments');
      const card = usable.find((c) => source.kind === 'card' && c.id === source.id) ?? null;
      await confirmAndOpen(payments.actions, payment, { card }, { replace: true });
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <PageScreen
      title={t('debt.title')}
      onBack={back}
      footer={
        <>
          {debt.retryAt && debt.card && (
            <Note icon="clock" style={{ marginBottom: 8, paddingHorizontal: 4 }}>
              {t('debt.retry', { when: around(debt.retryAt), last4: debt.card.last4 })}
            </Note>
          )}
          <Button
            label={t('debt.pay', { amount: pln(debt.amount) })}
            busy={busy}
            disabled={!source || debt.paymentPending || (source.kind === 'card' && !payments.actions)}
            onPress={() => void pay()}
          />
        </>
      }
    >
      <BigAmount label={t('debt.due')} value={pln(debt.amount)} />
      <Lines
        rows={[
          {
            label: t('debt.ride'),
            value: t('debt.rideValue', { when: dayTime(when), number: scooterNo(rental.scooter.number) }),
          },
          ...(debt.card
            ? [
                {
                  label: t('debt.failed'),
                  value: t('debt.failedValue', { card: cardTitle(debt.card), reason: failureShort(debt.failureCode) }),
                },
              ]
            : []),
        ]}
      />
      {debt.paymentPending && <Note icon="clock">{t('debt.pending')}</Note>}
      <View style={{ gap: 12 }}>
        <Text style={{ fontSize: 17, fontWeight: '600', color: theme.ink }}>{t('debt.payFrom')}</Text>
        <Group>
          {usable.map((card, i) => {
            const on = source?.kind === 'card' && source.id === card.id;
            return (
              <OptionRow
                key={card.id}
                first={i === 0}
                mini={<CardMini brand={card.brand} />}
                title={cardTitle(card)}
                subtitle={card.isDefault ? t('methods.default') : brandName(card.brand)}
                selected={on}
                onPress={() => setChosen({ kind: 'card', id: card.id })}
                right={<Radio on={on} />}
              />
            );
          })}
          <OptionRow
            first={!usable.length}
            mini={<CardMini kind="wallet" />}
            title={t('debt.wallet')}
            subtitle={
              walletCovers
                ? t('debt.walletBalance', { balance: pln(summary.balance) })
                : t('debt.walletShort', { balance: pln(summary.balance) })
            }
            selected={source?.kind === 'wallet'}
            disabled={!walletCovers}
            onPress={() => setChosen({ kind: 'wallet' })}
            right={<Radio on={source?.kind === 'wallet'} disabled={!walletCovers} />}
          />
          <AddRow label={t('methods.add')} onPress={() => router.push('/portfel/karta')} />
        </Group>
      </View>
      {error && <ErrorBox message={error} />}
    </PageScreen>
  );
}
