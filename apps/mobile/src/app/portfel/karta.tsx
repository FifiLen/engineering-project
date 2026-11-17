import type { PaymentMethodView, SetupIntentResponse } from '@hulajnogi/shared';
import { router } from 'expo-router';
import { useCallback, useEffect, useRef, useState } from 'react';
import { Text, View } from 'react-native';
import { PageScreen } from '../../components/list';
import { Note } from '../../components/payment';
import { Button, ErrorBox, Field } from '../../components/ui';
import { t } from '../../i18n';
import { api, errorMessage } from '../../lib/api';
import {
  CardEntry,
  EMPTY_CARD,
  failureText,
  usePayments,
  type CardEntryHandle,
  type CardEntryState,
} from '../../lib/payments';
import { brandName, useWallet, useWalletEvents } from '../../lib/wallet';

/** Karta pojawia się na liście po webhooku; dłużej czekamy tylko na komunikat „w trakcie weryfikacji”. */
const WAIT_MS = 30000;
const POLL_MS = 1500;

/** Podgląd karty z makiety: cyfry wpisane w atrapie, przy Stripe tylko kropki (numer zna operator). */
function preview(card: CardEntryState): string {
  const digits = (card.digits ?? '').padEnd(16, '•');
  return [0, 4, 8, 12].map((i) => digits.slice(i, i + 4)).join(' ');
}

/**
 * Dodanie karty (makieta platnosci-karta, ADR 0051): SetupIntent z API, potwierdzenie danymi z pola
 * karty u operatora (z 3-D Secure, jeśli bank go wymaga), a karta pojawia się na liście po webhooku.
 */
export default function AddCardScreen() {
  const payments = usePayments();
  const { cards, setCards } = useWallet();
  const entry = useRef<CardEntryHandle | null>(null);
  const known = useRef<Set<string> | null>(null);
  const [card, setCard] = useState<CardEntryState>(EMPTY_CARD);
  const [holder, setHolder] = useState('');
  const [busy, setBusy] = useState(false);
  const [waiting, setWaiting] = useState<number | null>(null);
  const [error, setError] = useState<{ title?: string; message: string } | null>(null);
  const back = useCallback(() => (router.canGoBack() ? router.back() : router.replace('/portfel')), []);

  // Po potwierdzeniu: czekamy, aż webhook zapisze kartę (zdarzenie `wallet.updated` albo odpytywanie).
  const check = useCallback(() => {
    if (waiting === null) return;
    void api<PaymentMethodView[]>('/me/payment-methods')
      .then((list) => {
        setCards(list);
        if (list.some((c) => !known.current?.has(c.id))) back();
      })
      .catch(() => undefined);
  }, [waiting, setCards, back]);
  useWalletEvents(check);
  useEffect(() => {
    if (waiting === null) return;
    const timer = setInterval(check, POLL_MS);
    const timeout = setTimeout(
      () => {
        setWaiting(null);
        setBusy(false);
        setError({ message: t('card.slow') });
      },
      WAIT_MS - (Date.now() - waiting),
    );
    return () => {
      clearInterval(timer);
      clearTimeout(timeout);
    };
  }, [waiting, check]);

  async function submit() {
    if (!entry.current) return;
    setBusy(true);
    setError(null);
    try {
      known.current = new Set((cards ?? []).map((c) => c.id));
      const setup = await api<SetupIntentResponse>('/me/payment-methods/setup', { method: 'POST' });
      const result = await entry.current.collectCard(setup.clientSecret, holder.trim());
      if (result.status === 'failed') {
        const text = failureText(result.failureCode);
        setError({ title: text.title, message: text.reason });
        setBusy(false);
        return;
      }
      setWaiting(Date.now());
    } catch (e) {
      setError({ message: errorMessage(e) });
      setBusy(false);
    }
  }

  return (
    <PageScreen
      title={t('card.title')}
      onBack={back}
      footer={
        <Button
          label={waiting !== null ? t('card.waiting') : t('card.submit')}
          busy={busy}
          disabled={!card.complete || !payments.actions}
          onPress={() => void submit()}
        />
      }
    >
      <View
        accessible
        accessibilityLabel={t('card.preview')}
        style={{
          height: 200,
          borderRadius: 28,
          backgroundColor: '#16181D',
          padding: 22,
          justifyContent: 'space-between',
        }}
      >
        <View style={{ flexDirection: 'row', justifyContent: 'space-between' }}>
          <View style={{ width: 40, height: 30, borderRadius: 7, backgroundColor: '#3A3E46' }} />
          {card.brand && (
            <Text style={{ fontSize: 14, fontWeight: '600', color: '#B9B9B2' }}>{brandName(card.brand)}</Text>
          )}
        </View>
        <View style={{ gap: 14 }}>
          <Text style={{ fontSize: 22, fontWeight: '500', letterSpacing: 2, color: '#F6F6F3' }}>{preview(card)}</Text>
          <View style={{ flexDirection: 'row', justifyContent: 'space-between', gap: 12 }}>
            <Text numberOfLines={1} style={{ flex: 1, fontSize: 14, color: '#B9B9B2' }}>
              {holder.trim().toUpperCase() || t('card.holderPreview')}
            </Text>
            <Text style={{ fontSize: 14, color: '#B9B9B2' }}>{card.expiry ?? t('card.expiryPlaceholder')}</Text>
          </View>
        </View>
      </View>
      <CardEntry ref={entry} onChange={setCard} />
      <Field
        label={t('card.holder')}
        value={holder}
        onChangeText={setHolder}
        autoComplete="cc-name"
        autoCapitalize="words"
      />
      <Note icon="lockClosed">{t('card.secure')}</Note>
      {error && <ErrorBox title={error.title} message={error.message} />}
    </PageScreen>
  );
}
