/**
 * Płatności w wersji web (ADR 0051, D3): Stripe.js i Elements. Numer karty, data i CVC są w polach
 * Stripe (ramki z domeny operatora), więc dane karty nie przechodzą przez aplikację ani przez API.
 * 3-D Secure pokazuje Stripe.js w oknie nad stroną.
 */
import {
  CardCvcElement,
  CardExpiryElement,
  CardNumberElement,
  Elements,
  useElements,
  useStripe,
} from '@stripe/react-stripe-js';
// Wersja `pure` ładuje Stripe.js dopiero przy `loadStripe`, więc z atrapą przeglądarka nie łączy się ze Stripe.
import { loadStripe } from '@stripe/stripe-js/pure';
import type {
  PaymentIntentResult,
  SetupIntentResult,
  StripeElementChangeEvent,
  StripeElementStyle,
  StripeError,
} from '@stripe/stripe-js';
import { useImperativeHandle, useMemo, useState, type ReactNode } from 'react';
import { View } from 'react-native';
import { CardFieldBox } from '../../components/payment';
import { useTheme } from '../../components/ui';
import { t } from '../../i18n';
import type { CardEntryProps, ConfirmResult, PaymentActions } from './types';

const failed = (error: StripeError): ConfirmResult => ({
  status: 'failed',
  failureCode: error.decline_code ?? error.code ?? 'card_declined',
});

function fromIntent(result: PaymentIntentResult): ConfirmResult {
  if (result.error) return failed(result.error);
  const status = result.paymentIntent.status;
  if (status === 'succeeded') return { status: 'succeeded', failureCode: null };
  if (status === 'processing' || status === 'requires_action' || status === 'requires_capture')
    return { status: 'processing', failureCode: null };
  return { status: 'failed', failureCode: result.paymentIntent.last_payment_error?.code ?? 'payment_failed' };
}

function fromSetup(result: SetupIntentResult): ConfirmResult {
  if (result.error) return failed(result.error);
  const status = result.setupIntent.status;
  if (status === 'succeeded') return { status: 'succeeded', failureCode: null };
  if (status === 'processing') return { status: 'processing', failureCode: null };
  return { status: 'failed', failureCode: result.setupIntent.last_setup_error?.code ?? 'card_declined' };
}

const cache = new Map<string, ReturnType<typeof loadStripe>>();

/**
 * Elements z kluczem publicznym z `GET /payments/config` (bez zmiennych budowania). Bez klucza (atrapa,
 * konfiguracja jeszcze niepobrana) Elements dostaje `null` i Stripe.js nie jest ładowany; Elements
 * pozwala raz zmienić `null` na instancję, więc drzewo komponentów się nie zmienia.
 */
export function StripeRoot({ publishableKey, children }: { publishableKey: string | null; children: ReactNode }) {
  let stripe = publishableKey ? cache.get(publishableKey) : null;
  if (publishableKey && !stripe) {
    stripe = loadStripe(publishableKey, { locale: 'pl' });
    cache.set(publishableKey, stripe);
  }
  return <Elements stripe={stripe ?? null}>{children}</Elements>;
}

/** Akcje płatności Stripe.js; `null`, dopóki biblioteka się nie załaduje. */
export function useStripeActions(): PaymentActions | null {
  const stripe = useStripe();
  return useMemo<PaymentActions | null>(
    () =>
      stripe
        ? {
            blik: true,
            confirmCardPayment: async (clientSecret, paymentMethodId) =>
              fromIntent(
                await stripe.confirmCardPayment(
                  clientSecret,
                  paymentMethodId ? { payment_method: paymentMethodId } : undefined,
                ),
              ),
            // Bez `handleActions` Stripe.js czeka na decyzję banku; ekran oczekiwania robi to sam (licznik, odpytywanie).
            confirmBlik: async (clientSecret, code) =>
              fromIntent(
                await stripe.confirmBlikPayment(
                  clientSecret,
                  { payment_method: { blik: {} }, payment_method_options: { blik: { code } } },
                  { handleActions: false },
                ),
              ),
          }
        : null,
    [stripe],
  );
}

type Field = 'number' | 'expiry' | 'cvc';

/** Pola karty Stripe w ramkach 60 px z makiety platnosci-karta (numer, ważna do, CVC). */
export function StripeCardEntry({ ref, onChange }: CardEntryProps) {
  const theme = useTheme();
  const stripe = useStripe();
  const elements = useElements();
  const [focused, setFocused] = useState<Field | null>(null);
  const [state, setState] = useState<Record<Field, { complete: boolean; error: boolean }>>({
    number: { complete: false, error: false },
    expiry: { complete: false, error: false },
    cvc: { complete: false, error: false },
  });
  const [brand, setBrand] = useState<string | null>(null);

  useImperativeHandle(
    ref,
    () => ({
      collectCard: async (clientSecret, holderName) => {
        const card = elements?.getElement(CardNumberElement);
        if (!stripe || !card) return { status: 'failed', failureCode: 'provider_unavailable' };
        return fromSetup(
          await stripe.confirmCardSetup(clientSecret, {
            payment_method: { card, billing_details: holderName ? { name: holderName } : undefined },
          }),
        );
      },
    }),
    [stripe, elements],
  );

  const style: StripeElementStyle = {
    base: {
      color: theme.ink,
      fontSize: '17px',
      fontWeight: '500',
      fontFamily: 'system-ui, -apple-system, "Segoe UI", Roboto, sans-serif',
      '::placeholder': { color: theme.muted },
    },
    invalid: { color: theme.danger },
  };

  const change = (field: Field) => (event: StripeElementChangeEvent & { brand?: string }) => {
    const next = { ...state, [field]: { complete: event.complete, error: !!event.error } };
    setState(next);
    const nextBrand =
      field === 'number' && event.brand && event.brand !== 'unknown' ? event.brand : field === 'number' ? null : brand;
    setBrand(nextBrand);
    onChange({
      complete: next.number.complete && next.expiry.complete && next.cvc.complete,
      brand: nextBrand,
      digits: null,
      expiry: null,
    });
  };
  const focus = (field: Field) => ({ onFocus: () => setFocused(field), onBlur: () => setFocused(null) });

  return (
    <View style={{ gap: 12 }}>
      <CardFieldBox label={t('card.number')} focused={focused === 'number'} invalid={state.number.error}>
        <CardNumberElement options={{ style, showIcon: false }} onChange={change('number')} {...focus('number')} />
      </CardFieldBox>
      <View style={{ flexDirection: 'row', gap: 12 }}>
        <CardFieldBox label={t('card.expiry')} focused={focused === 'expiry'} invalid={state.expiry.error} flex={1.6}>
          <CardExpiryElement
            options={{ style, placeholder: t('card.expiryPlaceholder') }}
            onChange={change('expiry')}
            {...focus('expiry')}
          />
        </CardFieldBox>
        <CardFieldBox label={t('card.cvc')} focused={focused === 'cvc'} invalid={state.cvc.error}>
          <CardCvcElement
            options={{ style, placeholder: t('card.cvcPlaceholder') }}
            onChange={change('cvc')}
            {...focus('cvc')}
          />
        </CardFieldBox>
      </View>
    </View>
  );
}
