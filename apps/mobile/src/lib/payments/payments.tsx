/**
 * Płatności natywne (ADR 0051, D3): `@stripe/stripe-react-native` w development build. Pole karty
 * (`CardField`) jest widokiem natywnym SDK, więc numer karty nie trafia do kodu aplikacji. 3-D Secure
 * pokazuje SDK, a powrót z przeglądarki banku obsługuje schemat aplikacji (`hulajnogi://`).
 *
 * Niesprawdzone do czasu development build (ten sam dług co natywna mapa, ADR 0040): typy i lint.
 * SDK 0.81 nie obsługuje BLIK-u w `confirmPayment`, więc przy Stripe BLIK jest tylko w wersji web
 * i w atrapie (D2).
 */
import {
  CardField,
  confirmPayment,
  confirmSetupIntent,
  PaymentIntent,
  SetupIntent,
  initStripe,
  type ConfirmPaymentResult,
  type ConfirmSetupIntentResult,
} from '@stripe/stripe-react-native';
import { useEffect, useImperativeHandle, useMemo, useState, type ReactNode } from 'react';
import { View } from 'react-native';
import { CardFieldBox } from '../../components/payment';
import { useTheme } from '../../components/ui';
import { t } from '../../i18n';
import type { CardEntryProps, ConfirmResult, PaymentActions } from './types';

/** Schemat z `app.json`: powrót do aplikacji po 3-D Secure w przeglądarce banku. */
const URL_SCHEME = 'hulajnogi';

function failure(error: { code: string; declineCode?: string; stripeErrorCode?: string }): ConfirmResult {
  if (error.code === 'Canceled') return { status: 'failed', failureCode: 'canceled' };
  return { status: 'failed', failureCode: error.declineCode ?? error.stripeErrorCode ?? 'card_declined' };
}

function fromIntent(result: ConfirmPaymentResult): ConfirmResult {
  if (result.error) return failure(result.error);
  switch (result.paymentIntent.status) {
    case PaymentIntent.Status.Succeeded:
      return { status: 'succeeded', failureCode: null };
    case PaymentIntent.Status.Processing:
    case PaymentIntent.Status.RequiresAction:
    case PaymentIntent.Status.RequiresCapture:
      return { status: 'processing', failureCode: null };
    default:
      return { status: 'failed', failureCode: result.paymentIntent.lastPaymentError?.code ?? 'payment_failed' };
  }
}

function fromSetup(result: ConfirmSetupIntentResult): ConfirmResult {
  if (result.error) return failure(result.error);
  if (result.setupIntent.status === SetupIntent.Status.Succeeded) return { status: 'succeeded', failureCode: null };
  if (result.setupIntent.status === SetupIntent.Status.Processing) return { status: 'processing', failureCode: null };
  return { status: 'failed', failureCode: result.setupIntent.lastSetupError?.code ?? 'card_declined' };
}

/**
 * Inicjalizacja SDK kluczem publicznym z `GET /payments/config` (to samo co `StripeProvider`, ale bez
 * zmiany drzewa komponentów po pobraniu konfiguracji). Bez klucza (atrapa) SDK nie startuje.
 */
export function StripeRoot({ publishableKey, children }: { publishableKey: string | null; children: ReactNode }) {
  useEffect(() => {
    if (publishableKey) void initStripe({ publishableKey, urlScheme: URL_SCHEME });
  }, [publishableKey]);
  return children;
}

export function useStripeActions(): PaymentActions | null {
  return useMemo<PaymentActions>(
    () => ({
      blik: false,
      confirmCardPayment: async (clientSecret, paymentMethodId) =>
        fromIntent(
          await confirmPayment(
            clientSecret,
            paymentMethodId
              ? { paymentMethodType: 'Card', paymentMethodData: { paymentMethodId } }
              : { paymentMethodType: 'Card' },
          ),
        ),
      confirmBlik: () => Promise.resolve({ status: 'failed', failureCode: 'blik_unsupported' }),
    }),
    [],
  );
}

/** Natywne pole karty SDK (jedna linia: numer, data, CVC) w ramce z makiety platnosci-karta. */
export function StripeCardEntry({ ref, onChange }: CardEntryProps) {
  const theme = useTheme();
  const [focused, setFocused] = useState(false);

  useImperativeHandle(
    ref,
    () => ({
      collectCard: async (clientSecret, holderName) =>
        fromSetup(
          await confirmSetupIntent(clientSecret, {
            paymentMethodType: 'Card',
            paymentMethodData: holderName ? { billingDetails: { name: holderName } } : undefined,
          }),
        ),
    }),
    [],
  );

  return (
    <View>
      <CardFieldBox label={t('card.number')} focused={focused}>
        <CardField
          postalCodeEnabled={false}
          placeholders={{
            number: t('card.numberPlaceholder'),
            expiration: t('card.expiryPlaceholder'),
            cvc: t('card.cvcPlaceholder'),
          }}
          cardStyle={{
            backgroundColor: theme.surface,
            textColor: theme.ink,
            placeholderColor: theme.muted,
            fontSize: 17,
            borderWidth: 0,
          }}
          style={{ height: 28, width: '100%' }}
          onFocus={(field) => setFocused(field !== null)}
          onCardChange={(card) =>
            onChange({
              complete: card.complete,
              brand: card.brand ? card.brand.toLowerCase() : null,
              digits: null,
              expiry: null,
            })
          }
        />
      </CardFieldBox>
    </View>
  );
}
