/**
 * Atrapa operatora płatności (ADR 0050, ADR 0051): gdy `GET /payments/config` zwraca `provider: 'fake'`,
 * w obu środowiskach. Formularz karty przyjmuje tylko numery kart testowych i wysyła je do atrapy w API
 * (`/payments/fake/*`); z prawdziwym operatorem te punkty nie istnieją, a numer karty nigdy nie trafia
 * do API (D3). Okno 3-D Secure banku zastępuje arkusz z decyzją klienta.
 */
import type { FakeConfirmResult } from '@hulajnogi/shared';
import {
  createContext,
  useCallback,
  useContext,
  useImperativeHandle,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import { Text, TextInput, View } from 'react-native';
import { CardFieldBox } from '../../components/payment';
import { BottomSheet } from '../../components/sheet';
import { Button, styles as ui, useTheme } from '../../components/ui';
import { t } from '../../i18n';
import { api } from '../api';
import type { CardEntryProps, ConfirmResult, PaymentActions } from './types';

type Authenticate = () => Promise<boolean>;

const FakeAuthContext = createContext<Authenticate>(() => Promise.resolve(false));

/** Arkusz „okna banku” 3-D Secure dla atrapy (akceptacja albo odrzucenie). */
export function FakeRoot({ children }: { children: ReactNode }) {
  const theme = useTheme();
  const [open, setOpen] = useState(false);
  const pending = useRef<((approve: boolean) => void) | null>(null);

  const authenticate = useCallback<Authenticate>(
    () =>
      new Promise<boolean>((resolve) => {
        pending.current?.(false);
        pending.current = resolve;
        setOpen(true);
      }),
    [],
  );
  const decide = (approve: boolean) => {
    pending.current?.(approve);
    pending.current = null;
    setOpen(false);
  };

  return (
    <FakeAuthContext.Provider value={authenticate}>
      {children}
      <BottomSheet visible={open} onClose={() => decide(false)}>
        <Text
          accessibilityRole="header"
          style={{ fontSize: 22, fontWeight: '600', letterSpacing: -0.4, color: theme.ink }}
        >
          {t('payment.threeDs.title')}
        </Text>
        <Text style={{ fontSize: 16, lineHeight: 24, color: theme.muted, marginTop: 10 }}>
          {t('payment.threeDs.lead')}
        </Text>
        <View style={{ gap: 10, marginTop: 24 }}>
          <Button label={t('payment.threeDs.approve')} onPress={() => decide(true)} />
          <Button label={t('payment.threeDs.reject')} kind="secondary" onPress={() => decide(false)} />
        </View>
      </BottomSheet>
    </FakeAuthContext.Provider>
  );
}

const toResult = (r: FakeConfirmResult): ConfirmResult =>
  r.status === 'failed'
    ? { status: 'failed', failureCode: r.failureCode ?? 'card_declined' }
    : { status: r.status === 'succeeded' ? 'succeeded' : 'processing', failureCode: null };

/** Wynik potwierdzenia z ewentualnym oknem 3-D Secure (`requires_action`). */
async function withAuthentication(
  clientSecret: string,
  first: FakeConfirmResult,
  authenticate: Authenticate,
): Promise<ConfirmResult> {
  if (first.status !== 'requires_action') return toResult(first);
  const approve = await authenticate();
  return toResult(
    await api<FakeConfirmResult>('/payments/fake/authenticate', { method: 'POST', json: { clientSecret, approve } }),
  );
}

export function useFakeActions(): PaymentActions {
  const authenticate = useContext(FakeAuthContext);
  return useMemo<PaymentActions>(
    () => ({
      blik: true,
      confirmCardPayment: async (clientSecret) =>
        withAuthentication(
          clientSecret,
          await api<FakeConfirmResult>('/payments/fake/payment-intents/confirm', {
            method: 'POST',
            json: { clientSecret },
          }),
          authenticate,
        ),
      confirmBlik: async (clientSecret, blikCode) =>
        toResult(
          await api<FakeConfirmResult>('/payments/fake/payment-intents/confirm', {
            method: 'POST',
            json: { clientSecret, blikCode },
          }),
        ),
    }),
    [authenticate],
  );
}

const brandOf = (digits: string): string | null =>
  digits.startsWith('4') ? 'visa' : /^5[1-5]/.test(digits) || /^2[2-7]/.test(digits) ? 'mastercard' : null;

/** „MM/RR” → miesiąc i pełny rok; `null`, gdy data jest niepoprawna albo minęła. */
function parseExpiry(text: string, now = new Date()): { month: number; year: number } | null {
  const match = /^(\d{2})\/(\d{2})$/.exec(text);
  if (!match) return null;
  const month = Number(match[1]);
  const year = 2000 + Number(match[2]);
  if (month < 1 || month > 12) return null;
  if (year < now.getFullYear() || (year === now.getFullYear() && month < now.getMonth() + 1)) return null;
  return { month, year };
}

const groupDigits = (digits: string) => digits.replace(/(\d{4})(?=\d)/g, '$1 ');

/** Formularz karty atrapy (numer, ważna do, CVC) w układzie makiety platnosci-karta. */
export function FakeCardEntry({ ref, onChange }: CardEntryProps) {
  const theme = useTheme();
  const authenticate = useContext(FakeAuthContext);
  const [digits, setDigits] = useState('');
  const [expiry, setExpiry] = useState('');
  const [cvc, setCvc] = useState('');
  const [focused, setFocused] = useState<'number' | 'expiry' | 'cvc' | null>(null);

  const parsed = parseExpiry(expiry);
  const complete = digits.length === 16 && !!parsed && cvc.length === 3;

  useImperativeHandle(
    ref,
    () => ({
      collectCard: async (clientSecret) => {
        if (!parsed) return { status: 'failed', failureCode: 'invalid_expiry_year' };
        const first = await api<FakeConfirmResult>('/payments/fake/setup-intents/confirm', {
          method: 'POST',
          json: { clientSecret, cardNumber: digits, expMonth: parsed.month, expYear: parsed.year, cvc },
        });
        return withAuthentication(clientSecret, first, authenticate);
      },
    }),
    [digits, parsed, cvc, authenticate],
  );

  const update = (next: { digits?: string; expiry?: string; cvc?: string }) => {
    const d = next.digits ?? digits;
    const e = next.expiry ?? expiry;
    const c = next.cvc ?? cvc;
    onChange({
      complete: d.length === 16 && !!parseExpiry(e) && c.length === 3,
      brand: brandOf(d),
      digits: d,
      expiry: e || null,
    });
  };

  const input = [ui.fieldInput, { color: theme.ink }];
  return (
    <View style={{ gap: 12 }}>
      <CardFieldBox label={t('card.number')} focused={focused === 'number'}>
        <TextInput
          accessibilityLabel={t('card.number')}
          value={groupDigits(digits)}
          onChangeText={(text) => {
            const d = text.replace(/\D/g, '').slice(0, 16);
            setDigits(d);
            update({ digits: d });
          }}
          onFocus={() => setFocused('number')}
          onBlur={() => setFocused(null)}
          keyboardType="number-pad"
          autoComplete="off"
          placeholder={t('card.numberPlaceholder')}
          placeholderTextColor={theme.muted}
          style={input}
        />
      </CardFieldBox>
      <View style={{ flexDirection: 'row', gap: 12 }}>
        <CardFieldBox
          label={t('card.expiry')}
          focused={focused === 'expiry'}
          invalid={expiry.length === 5 && !parsed}
          flex={1.6}
        >
          <TextInput
            accessibilityLabel={t('card.expiry')}
            value={expiry}
            onChangeText={(text) => {
              const d = text.replace(/\D/g, '').slice(0, 4);
              const e = d.length > 2 ? `${d.slice(0, 2)}/${d.slice(2)}` : d;
              setExpiry(e);
              update({ expiry: e });
            }}
            onFocus={() => setFocused('expiry')}
            onBlur={() => setFocused(null)}
            keyboardType="number-pad"
            placeholder={t('card.expiryPlaceholder')}
            placeholderTextColor={theme.muted}
            style={input}
          />
        </CardFieldBox>
        <CardFieldBox label={t('card.cvc')} focused={focused === 'cvc'}>
          <TextInput
            accessibilityLabel={t('card.cvc')}
            value={cvc}
            onChangeText={(text) => {
              const c = text.replace(/\D/g, '').slice(0, 3);
              setCvc(c);
              update({ cvc: c });
            }}
            onFocus={() => setFocused('cvc')}
            onBlur={() => setFocused(null)}
            keyboardType="number-pad"
            secureTextEntry
            placeholder={t('card.cvcPlaceholder')}
            placeholderTextColor={theme.muted}
            style={input}
          />
        </CardFieldBox>
      </View>
      {!complete && digits.length === 0 && (
        <Text style={{ fontSize: 13, lineHeight: 18, color: theme.muted, marginHorizontal: 4 }}>
          {t('card.fakeHint')}
        </Text>
      )}
    </View>
  );
}
