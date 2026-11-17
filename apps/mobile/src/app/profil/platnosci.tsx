import type { PaymentMethodView } from '@hulajnogi/shared';
import { router, useFocusEffect } from 'expo-router';
import { useCallback, useState } from 'react';
import { Text, View } from 'react-native';
import { Icon } from '../../components/icons';
import { PageScreen } from '../../components/list';
import { AddRow, CardMini, Chip, Group, Note, OptionRow } from '../../components/payment';
import { BottomSheet } from '../../components/sheet';
import { Button, ErrorBox, useTheme } from '../../components/ui';
import { t } from '../../i18n';
import { api, errorMessage } from '../../lib/api';
import { usePayments } from '../../lib/payments';
import { brandName, cardTitle, expiryText, useWallet } from '../../lib/wallet';

/**
 * Metody płatności w profilu (makieta metody-platnosci): karty z domyślną, „Wygasa” (mniej niż 30 dni)
 * i „Wygasła”, dodanie karty, wybór domyślnej i usunięcie z potwierdzeniem; BLIK bez zapisywania (kod przy
 * każdej płatności). Usunięcia karty płacącej za trwający przejazd albo zaległość API odmawia
 * (`PAYMENT_METHOD_IN_USE`).
 */
export default function PaymentMethodsScreen() {
  const theme = useTheme();
  const { cards, setCards, refresh } = useWallet();
  const payments = usePayments();
  const [selected, setSelected] = useState<PaymentMethodView | null>(null);
  const [confirm, setConfirm] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const back = () => (router.canGoBack() ? router.back() : router.replace('/profil'));

  useFocusEffect(
    useCallback(() => {
      void refresh();
    }, [refresh]),
  );

  const close = () => {
    setSelected(null);
    setConfirm(false);
    setError(null);
  };

  async function act(path: string, method: string) {
    setBusy(true);
    setError(null);
    try {
      setCards(await api<PaymentMethodView[]>(path, { method }));
      close();
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy(false);
    }
  }

  const list = (cards ?? []).filter((c) => c.state !== 'REMOVED');
  const expiring = list.filter((c) => c.state === 'EXPIRING');

  return (
    <PageScreen title={t('methods.title')} onBack={back}>
      <View style={{ gap: 12 }}>
        <Text style={{ fontSize: 17, fontWeight: '600', color: theme.ink }}>{t('methods.cards')}</Text>
        <Group>
          {list.map((card, i) => {
            const expired = card.state === 'EXPIRED';
            const warn = card.state === 'EXPIRING';
            return (
              <OptionRow
                key={card.id}
                first={i === 0}
                mini={<CardMini brand={card.brand} />}
                title={cardTitle(card)}
                subtitle={t('methods.subtitle', { brand: brandName(card.brand), expiry: expiryText(card) })}
                subtitleColor={expired ? theme.danger : warn ? theme.warning : undefined}
                onPress={() => setSelected(card)}
                right={
                  expired ? (
                    <Chip tone="danger" label={t('methods.expired')} />
                  ) : warn ? (
                    <Chip tone="warning" label={t('methods.expiring')} />
                  ) : card.isDefault ? (
                    <Chip tone="neutral" label={t('methods.default')} />
                  ) : undefined
                }
              />
            );
          })}
          <AddRow first={!list.length} label={t('methods.add')} onPress={() => router.push('/portfel/karta')} />
        </Group>
        {expiring.map((card) => (
          <View
            key={card.id}
            accessibilityRole="alert"
            style={{
              flexDirection: 'row',
              gap: 12,
              alignItems: 'flex-start',
              paddingVertical: 12,
              paddingHorizontal: 14,
              borderRadius: 16,
              backgroundColor: theme.warningTint,
            }}
          >
            <Icon name="warning" color={theme.warning} size={18} />
            <Text style={{ flex: 1, fontSize: 14, lineHeight: 20, color: theme.warning }}>
              {t('methods.expiringNote', {
                last4: card.last4,
                month: t.dynamic(`dates.monthsGenitive.${card.expMonth - 1}`),
              })}
            </Text>
          </View>
        ))}
      </View>

      {payments.blik && (
        <View style={{ gap: 12 }}>
          <Text style={{ fontSize: 17, fontWeight: '600', color: theme.ink }}>{t('methods.other')}</Text>
          <Group>
            <OptionRow first mini={<CardMini kind="blik" />} title={t('payment.blik')} subtitle={t('methods.blik')} />
          </Group>
        </View>
      )}
      <Note>{t('methods.note')}</Note>

      <BottomSheet visible={!!selected} onClose={close}>
        {selected &&
          (confirm ? (
            <>
              <Text
                accessibilityRole="header"
                style={{ fontSize: 22, fontWeight: '600', letterSpacing: -0.4, color: theme.ink }}
              >
                {t('methods.remove.title', { last4: selected.last4 })}
              </Text>
              <Text style={{ fontSize: 16, lineHeight: 24, color: theme.muted, marginTop: 10 }}>
                {t('methods.remove.lead', { brand: brandName(selected.brand), last4: selected.last4 })}
              </Text>
              {error && <ErrorBox message={error} />}
              <View style={{ gap: 10, marginTop: 24 }}>
                <Button
                  label={t('methods.remove.confirm')}
                  kind="danger"
                  busy={busy}
                  onPress={() => void act(`/me/payment-methods/${selected.id}`, 'DELETE')}
                />
                <Button label={t('methods.remove.keep')} kind="secondary" onPress={close} />
              </View>
            </>
          ) : (
            <>
              <Text
                accessibilityRole="header"
                style={{ fontSize: 22, fontWeight: '600', letterSpacing: -0.4, color: theme.ink }}
              >
                {cardTitle(selected)}
              </Text>
              <Text style={{ fontSize: 16, lineHeight: 24, color: theme.muted, marginTop: 10 }}>
                {t('methods.subtitle', { brand: brandName(selected.brand), expiry: expiryText(selected) })}
              </Text>
              {error && <ErrorBox message={error} />}
              <View style={{ gap: 10, marginTop: 24 }}>
                {!selected.isDefault && selected.state !== 'EXPIRED' && (
                  <Button
                    label={t('methods.makeDefault')}
                    busy={busy}
                    onPress={() => void act(`/me/payment-methods/${selected.id}/default`, 'POST')}
                  />
                )}
                <Button label={t('methods.remove.open')} kind="secondary" onPress={() => setConfirm(true)} />
              </View>
            </>
          ))}
      </BottomSheet>
    </PageScreen>
  );
}
