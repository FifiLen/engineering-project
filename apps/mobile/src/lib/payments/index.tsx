/**
 * Płatności w aplikacji (ADR 0051): konfiguracja operatora z `GET /payments/config` (atrapa albo Stripe,
 * klucz publiczny bez przebudowy aplikacji) i jeden interfejs dla ekranów (`usePayments`, `CardEntry`).
 * Implementację Stripe wybiera Metro po platformie (`payments.web.tsx` albo `payments.tsx`), atrapę
 * konfiguracja z API. Drzewo komponentów nie zmienia się po pobraniu konfiguracji, więc nawigacja
 * i stan ekranów zostają.
 */
import type { PaymentsConfig } from '@hulajnogi/shared';
import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import { t } from '../../i18n';
import { api } from '../api';
import { FakeCardEntry, FakeRoot, useFakeActions } from './payments.fake';
import { StripeCardEntry, StripeRoot, useStripeActions } from './payments';
import type { CardEntryProps, PaymentActions } from './types';

export type { CardEntryHandle, CardEntryState, ConfirmResult, PaymentActions } from './types';
export { EMPTY_CARD } from './types';

interface PaymentsValue {
  config: PaymentsConfig | null;
  /** Błąd pobrania konfiguracji (`ApiError`). */
  error: unknown;
  reload(): void;
  /** Akcje operatora; `null`, dopóki konfiguracja albo Stripe.js nie są gotowe. */
  actions: PaymentActions | null;
  /** BLIK dostępny u operatora i w tej implementacji (D2). */
  blik: boolean;
}

const PaymentsContext = createContext<PaymentsValue | null>(null);

export function usePayments(): PaymentsValue {
  const value = useContext(PaymentsContext);
  if (!value) throw new Error('usePayments poza PaymentsProvider');
  return value;
}

function Bridge({
  config,
  error,
  reload,
  children,
}: {
  config: PaymentsConfig | null;
  error: unknown;
  reload: () => void;
  children: ReactNode;
}) {
  const fake = useFakeActions();
  const stripe = useStripeActions();
  const actions = !config ? null : config.provider === 'fake' ? fake : stripe;
  const value = useMemo<PaymentsValue>(
    () => ({ config, error, reload, actions, blik: !!config?.blik && !!actions?.blik }),
    [config, error, reload, actions],
  );
  return <PaymentsContext.Provider value={value}>{children}</PaymentsContext.Provider>;
}

export function PaymentsProvider({ children }: { children: ReactNode }) {
  const [config, setConfig] = useState<PaymentsConfig | null>(null);
  const [error, setError] = useState<unknown>(null);

  const fetchConfig = useCallback(
    () =>
      api<PaymentsConfig>('/payments/config')
        .then((next) => {
          setConfig(next);
          setError(null);
        })
        .catch(setError),
    [],
  );
  const reload = useCallback(() => void fetchConfig(), [fetchConfig]);

  useEffect(() => {
    void fetchConfig();
  }, [fetchConfig]);

  const key = config?.provider === 'stripe' ? config.publishableKey : null;
  return (
    <FakeRoot>
      <StripeRoot publishableKey={key}>
        <Bridge config={config} error={error} reload={reload}>
          {children}
        </Bridge>
      </StripeRoot>
    </FakeRoot>
  );
}

/** Pole karty bieżącego operatora (atrapa albo Stripe). */
export function CardEntry(props: CardEntryProps) {
  const { config } = usePayments();
  return config?.provider === 'fake' ? <FakeCardEntry {...props} /> : <StripeCardEntry {...props} />;
}

/** Kody operatora o tym samym znaczeniu dla klienta (Stripe.js, SDK natywny, atrapa). */
const ALIASES: Record<string, string> = {
  payment_intent_authentication_failure: 'authentication_failed',
  setup_intent_authentication_failure: 'authentication_failed',
  expired_card: 'expired',
  card_velocity_exceeded: 'card_declined',
  generic_decline: 'card_declined',
  do_not_honor: 'card_declined',
};

function failureKey(code: string | null | undefined): string {
  const normalized = code ? (ALIASES[code] ?? code) : 'default';
  return t.has(`payment.failure.${normalized}.title`) ? normalized : 'default';
}

/** Tytuł i przyczyna odmowy z kodu operatora; nieznany kod dostaje komunikat domyślny. */
export function failureText(code: string | null | undefined): { title: string; reason: string } {
  const key = failureKey(code);
  return { title: t.dynamic(`payment.failure.${key}.title`), reason: t.dynamic(`payment.failure.${key}.reason`) };
}

/** Krótki opis odmowy do wiersza „Nieudana płatność” („odmowa”, „brak środków”). */
export const failureShort = (code: string | null | undefined): string =>
  t.dynamic(`payment.failure.${failureKey(code)}.short`);
