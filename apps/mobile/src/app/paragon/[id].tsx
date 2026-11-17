import type { ReceiptView, RentalView } from '@hulajnogi/shared';
import { router, useLocalSearchParams } from 'expo-router';
import { Fragment, useEffect, useState, type ReactNode } from 'react';
import { ActivityIndicator, Pressable, Text, View } from 'react-native';
import { PageScreen } from '../../components/list';
import { Group, Note } from '../../components/payment';
import { ErrorBox, useTheme } from '../../components/ui';
import { t } from '../../i18n';
import { api, errorMessage, formatPhone } from '../../lib/api';
import { dateNumeric, km, pln, scooterNo, timeOnly } from '../../lib/format';
import { cardTitle } from '../../lib/wallet';

const vat = new Intl.NumberFormat('pl-PL', { maximumFractionDigits: 2 });

/**
 * Paragon (makieta paragon, ADR 0052): niefiskalne potwierdzenie sprzedaży z pozycjami (tekst z kodu
 * pozycji), stawką VAT, netto, VAT i brutto, sposobem zapłaty, nabywcą i sprzedawcą z chwili wystawienia.
 * Korekta po zwrocie ma odwołanie do paragonu sprzedaży; paragon sprzedaży listę swoich korekt.
 */
export default function ReceiptScreen() {
  const theme = useTheme();
  const { id } = useLocalSearchParams<{ id: string }>();
  const [receipt, setReceipt] = useState<ReceiptView | null>(null);
  const [rental, setRental] = useState<RentalView | null>(null);
  const [error, setError] = useState<string | null>(null);
  const back = () => (router.canGoBack() ? router.back() : router.replace('/portfel'));

  useEffect(() => {
    api<ReceiptView>(`/me/receipts/${id}`)
      .then((r) => {
        setReceipt(r);
        if (r.rentalId) {
          api<RentalView>(`/rentals/${r.rentalId}`)
            .then(setRental)
            .catch(() => undefined);
        }
      })
      .catch((e: unknown) => setError(errorMessage(e)));
  }, [id]);

  const dashed = (key: string) => (
    <View
      key={key}
      style={{ borderTopWidth: 1, borderStyle: 'dashed', borderColor: theme.checkbox, marginVertical: 12 }}
    />
  );
  const sum = (label: string, value: ReactNode, strong?: boolean) => (
    <View
      key={label}
      style={{ flexDirection: 'row', justifyContent: 'space-between', gap: 12, paddingTop: strong ? 8 : 0 }}
    >
      <Text
        style={{
          fontSize: strong ? 17 : 15,
          fontWeight: strong ? '600' : '400',
          color: strong ? theme.ink : theme.muted,
        }}
      >
        {label}
      </Text>
      {typeof value === 'string' ? (
        <Text
          style={{
            flexShrink: 1,
            textAlign: 'right',
            fontSize: strong ? 17 : 15,
            fontWeight: strong ? '600' : '500',
            color: theme.ink,
          }}
        >
          {value}
        </Text>
      ) : (
        value
      )}
    </View>
  );

  if (!receipt) {
    return (
      <PageScreen title={t('receipt.title')} onBack={back}>
        {error ? <ErrorBox message={error} /> : <ActivityIndicator style={{ marginTop: 40 }} color={theme.accent} />}
      </PageScreen>
    );
  }

  const correction = receipt.kind === 'CORRECTION';
  const paidWith =
    receipt.paymentSource === 'CARD'
      ? receipt.card
        ? cardTitle(receipt.card)
        : t('payment.cardGeneric')
      : receipt.paymentSource === 'WALLET'
        ? t('receipt.wallet')
        : null;
  const buyer = [receipt.buyer.name, receipt.buyer.phone ? formatPhone(receipt.buyer.phone) : null]
    .filter(Boolean)
    .join(', ');
  const seller = [
    receipt.seller.name,
    receipt.seller.address,
    receipt.seller.taxId ? t('receipt.taxId', { taxId: receipt.seller.taxId }) : null,
  ]
    .filter(Boolean)
    .join(', ');

  return (
    <PageScreen title={t('receipt.title')} onBack={back}>
      <Group style={{ padding: 20 }}>
        <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start', gap: 12 }}>
          <View style={{ gap: 2, flexShrink: 1 }}>
            <Text style={{ fontSize: 13, color: theme.muted }}>
              {correction ? t('receipt.correction') : t('receipt.kind')}
            </Text>
            <Text style={{ fontSize: 20, fontWeight: '500', letterSpacing: -0.3, color: theme.ink }}>
              {receipt.number}
            </Text>
          </View>
          <Text style={{ fontSize: 13, fontWeight: '500', color: theme.muted, textAlign: 'right' }}>
            {t('receipt.issuedAt', { date: dateNumeric(receipt.issuedAt), time: timeOnly(receipt.issuedAt) })}
          </Text>
        </View>
        {dashed('d1')}
        <View style={{ gap: 8 }}>
          {rental && sum(t('receipt.ride'), t('receipt.scooter', { number: scooterNo(rental.scooter.number) }))}
          {rental?.startedAt &&
            sum(
              t('receipt.time'),
              t('receipt.timeRange', {
                from: timeOnly(rental.startedAt),
                to: timeOnly(rental.endedAt ?? rental.billedUntil ?? rental.asOf),
              }),
            )}
          {rental && sum(t('receipt.distance'), km(rental.distanceM))}
          {receipt.correctsNumber && sum(t('receipt.corrects'), receipt.correctsNumber)}
        </View>
        {dashed('d2')}
        <View>
          {receipt.items.map((item) => (
            <View
              key={item.lineNo}
              style={{
                flexDirection: 'row',
                justifyContent: 'space-between',
                alignItems: 'center',
                gap: 12,
                paddingVertical: 8,
              }}
            >
              <View style={{ gap: 2, flexShrink: 1 }}>
                <Text style={{ fontSize: 15, color: theme.ink }}>{t.dynamic(`receipt.items.${item.description}`)}</Text>
                <Text style={{ fontSize: 13, color: theme.muted }}>
                  {t('receipt.quantity', { quantity: item.quantity, price: pln(item.unitPrice) })}
                </Text>
              </View>
              <Text style={{ fontSize: 15, fontWeight: '500', color: theme.ink }}>{pln(item.amount)}</Text>
            </View>
          ))}
        </View>
        {dashed('d3')}
        <View style={{ gap: 8 }}>
          {sum(t('receipt.net'), pln(receipt.netAmount))}
          {sum(
            receipt.vatRate !== null ? t('receipt.vat', { rate: vat.format(receipt.vatRate) }) : t('receipt.vatNoRate'),
            pln(receipt.vatAmount),
          )}
          {sum(t('receipt.gross'), pln(receipt.totalAmount), true)}
        </View>
        {dashed('d4')}
        <View style={{ gap: 8 }}>
          {paidWith && sum(correction ? t('receipt.refundedTo') : t('receipt.paidWith'), paidWith)}
          {buyer && sum(t('receipt.buyer'), buyer)}
          {seller && sum(t('receipt.seller'), seller)}
        </View>
      </Group>
      {receipt.corrections.length > 0 && (
        <View style={{ gap: 8 }}>
          <Text style={{ fontSize: 17, fontWeight: '600', color: theme.ink }}>{t('receipt.corrections')}</Text>
          <Group>
            {receipt.corrections.map((c, i) => (
              <Fragment key={c.id}>
                <Pressable
                  accessibilityRole="button"
                  onPress={() => router.push({ pathname: '/paragon/[id]', params: { id: c.id } })}
                  style={({ pressed }) => ({
                    flexDirection: 'row',
                    alignItems: 'center',
                    minHeight: 54,
                    paddingHorizontal: 16,
                    gap: 12,
                    borderTopWidth: i ? 1 : 0,
                    borderColor: theme.line,
                    opacity: pressed ? 0.7 : 1,
                  })}
                >
                  <Text style={{ flex: 1, fontSize: 16, color: theme.ink }}>{c.number}</Text>
                  <Text style={{ fontSize: 16, fontWeight: '500', color: theme.ink }}>{pln(c.totalAmount)}</Text>
                </Pressable>
              </Fragment>
            ))}
          </Group>
        </View>
      )}
      <Note>{t('receipt.note')}</Note>
    </PageScreen>
  );
}
