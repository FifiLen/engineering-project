import { TOPUP_MAX, TOPUP_MIN, TOPUP_PRESETS, type PaymentIntentResponse } from '@hulajnogi/shared';
import { router, useLocalSearchParams } from 'expo-router';
import { useState } from 'react';
import { Platform, Text, TextInput, View } from 'react-native';
import { PageScreen } from '../../components/list';
import { Group, Note, PillSelect, ValueRow } from '../../components/payment';
import { Button, CodeInput, ErrorBox, useTheme } from '../../components/ui';
import { t } from '../../i18n';
import { api, errorMessage } from '../../lib/api';
import { confirmAndOpen } from '../../lib/checkout';
import { pln, wholePln } from '../../lib/format';
import { usePayments } from '../../lib/payments';
import { cardTitle, preferredCard, usableCards, useWallet } from '../../lib/wallet';

/**
 * Doładowanie (makiety doladowanie-kwota i platnosci-blik): kwota z portfela albo kwota własna w pełnych
 * złotych 10–500 zł (pytanie 3), wybór karty albo BLIK z kodem, saldo po doładowaniu liczone na bieżąco.
 * Parametry: `amount` (grosze; bez niego pole kwoty), `method` (`BLIK` albo identyfikator karty).
 */
export default function TopupScreen() {
  const theme = useTheme();
  const params = useLocalSearchParams<{ amount?: string; method?: string }>();
  const fixed = params.amount ? Number(params.amount) : null;
  const { summary, cards } = useWallet();
  const payments = usePayments();
  const [text, setText] = useState(fixed ? String(Math.round(fixed / 100)) : '');
  const [chosen, setChosen] = useState<string | null>(params.method ?? null);
  const [code, setCode] = useState('');
  const [focused, setFocused] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const back = () => (router.canGoBack() ? router.back() : router.replace('/portfel'));

  const min = payments.config?.topup.min ?? TOPUP_MIN;
  const max = payments.config?.topup.max ?? TOPUP_MAX;
  const presets = payments.config?.topup.presets ?? [...TOPUP_PRESETS];
  const amount = fixed ?? (text ? Number(text) * 100 : 0);
  const valid = Number.isInteger(amount) && amount >= min && amount <= max && amount % 100 === 0;

  const usable = usableCards(cards);
  const fallback = preferredCard(cards);
  const method =
    chosen === 'BLIK' && payments.blik
      ? 'BLIK'
      : (usable.find((c) => c.id === chosen)?.id ?? fallback?.id ?? (payments.blik ? 'BLIK' : null));
  const card = usable.find((c) => c.id === method) ?? null;
  const blik = method === 'BLIK';
  const ready = valid && !!method && !!payments.actions && (!blik || code.length === 6);

  async function submit() {
    if (!ready || !payments.actions) return;
    setBusy(true);
    setError(null);
    try {
      const intent = await api<PaymentIntentResponse>('/me/wallet/topups', {
        method: 'POST',
        json: blik ? { amount, method: 'BLIK' } : { amount, method: 'CARD', paymentMethodId: card!.id },
      });
      await confirmAndOpen(payments.actions, intent, blik ? { blikCode: code } : { card }, { replace: true });
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy(false);
    }
  }

  const label = !valid
    ? t('topup.submit')
    : blik
      ? t('topup.pay', { amount: pln(amount) })
      : t('wallet.topup', { amount: wholePln(amount) });

  return (
    <PageScreen
      title={t('topup.title')}
      onBack={back}
      footer={
        <>
          {!blik && <Note style={{ marginBottom: 8 }}>{t('topup.note')}</Note>}
          <Button label={label} busy={busy} disabled={!ready} onPress={() => void submit()} />
        </>
      }
    >
      {fixed ? (
        <View style={{ gap: 2, marginTop: 4 }}>
          <Text style={{ fontSize: 14, color: theme.muted }}>{t('topup.amount')}</Text>
          <Text style={{ fontSize: 50, fontWeight: '500', letterSpacing: -1.5, lineHeight: 56, color: theme.ink }}>
            {pln(fixed)}
          </Text>
        </View>
      ) : (
        <View style={{ gap: 8 }}>
          <View
            style={{
              height: 96,
              borderRadius: 20,
              borderWidth: focused ? 1.5 : 1,
              borderColor: text && !valid ? theme.danger : focused ? theme.accent : theme.line,
              backgroundColor: theme.surface,
              paddingHorizontal: 20,
              justifyContent: 'center',
            }}
          >
            <Text style={{ fontSize: 13, color: theme.muted }}>{t('topup.amount')}</Text>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
              <TextInput
                accessibilityLabel={t('topup.amountLabel')}
                autoFocus={!fixed}
                value={text}
                onChangeText={(v) => setText(v.replace(/\D/g, '').replace(/^0+/, '').slice(0, 4))}
                onFocus={() => setFocused(true)}
                onBlur={() => setFocused(false)}
                keyboardType="number-pad"
                placeholder={t('topup.placeholder')}
                placeholderTextColor={theme.muted}
                style={{
                  fontSize: 44,
                  fontWeight: '500',
                  letterSpacing: -1.5,
                  color: theme.ink,
                  padding: 0,
                  minWidth: 28,
                  ...(Platform.OS === 'web'
                    ? { outlineStyle: 'none' as never, width: `${Math.max(1, text.length) + 0.2}ch` }
                    : {}),
                }}
              />
              <Text style={{ fontSize: 44, fontWeight: '500', letterSpacing: -1.5, color: theme.muted }}>
                {t('units.zl')}
              </Text>
            </View>
          </View>
          <Text style={{ marginHorizontal: 4, fontSize: 14, color: text && !valid ? theme.danger : theme.muted }}>
            {t('topup.range', { min: Math.round(min / 100), max: Math.round(max / 100) })}
          </Text>
          <View
            accessibilityRole="radiogroup"
            accessibilityLabel={t('topup.presets')}
            style={{ flexDirection: 'row', gap: 8, marginTop: 8 }}
          >
            {presets.map((p) => (
              <PillSelect
                key={p}
                label={wholePln(p)}
                selected={amount === p}
                onPress={() => setText(String(p / 100))}
              />
            ))}
          </View>
        </View>
      )}

      <View style={{ gap: 10 }}>
        <Text style={{ fontSize: 14, color: theme.muted }}>{t('topup.payWith')}</Text>
        <View accessibilityRole="radiogroup" style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
          {usable.map((c) => (
            <PillSelect
              key={c.id}
              check
              label={cardTitle(c)}
              selected={method === c.id}
              onPress={() => setChosen(c.id)}
            />
          ))}
          {payments.blik && (
            <PillSelect check label={t('payment.blik')} selected={blik} onPress={() => setChosen('BLIK')} />
          )}
          {!usable.length && (
            <PillSelect label={t('topup.addCard')} selected={false} onPress={() => router.push('/portfel/karta')} />
          )}
        </View>
      </View>

      {blik ? (
        <View>
          <Text style={{ fontSize: 17, fontWeight: '600', color: theme.ink }}>{t('topup.blik.title')}</Text>
          <Text style={{ marginTop: 6, fontSize: 16, lineHeight: 24, color: theme.muted }}>{t('topup.blik.lead')}</Text>
          <CodeInput
            value={code}
            onChange={setCode}
            label={t('topup.blik.label')}
            sms={false}
            autoFocus={!!fixed}
            style={{ marginTop: 20 }}
          />
          <Text style={{ marginTop: 14, fontSize: 14, lineHeight: 20, color: theme.muted }}>
            {t('topup.blik.hint')}
          </Text>
        </View>
      ) : (
        summary && (
          <Group>
            <ValueRow first label={t('topup.now')} value={pln(summary.balance)} />
            <ValueRow label={t('topup.after')} value={valid ? pln(summary.balance + amount) : t('topup.dash')} />
          </Group>
        )
      )}
      {error && <ErrorBox message={error} />}
    </PageScreen>
  );
}
