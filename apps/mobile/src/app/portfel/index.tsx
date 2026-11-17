import type { PaymentIntentResponse, WalletEntry, WalletView } from '@hulajnogi/shared';
import { router, useFocusEffect } from 'expo-router';
import { useCallback, useState } from 'react';
import { ActivityIndicator, Pressable, Text, View } from 'react-native';
import { Icon } from '../../components/icons';
import { PageScreen } from '../../components/list';
import { AddRow, CardMini, Group, OptionRow, PillSelect, Radio } from '../../components/payment';
import { Button, ErrorBox, useTheme } from '../../components/ui';
import { t } from '../../i18n';
import { api, errorMessage } from '../../lib/api';
import { confirmAndOpen } from '../../lib/checkout';
import { dayTime, pln, signedPln, wholePln } from '../../lib/format';
import { usePayments } from '../../lib/payments';
import { brandName, cardTitle, preferredCard, usableCards, useWallet, useWalletEvents } from '../../lib/wallet';

const PAGE = 20;
const DEFAULT_PRESET = 5000;

/** Metoda doładowania: zapisana karta albo BLIK. */
type Method = { kind: 'card'; id: string } | { kind: 'blik' };

/**
 * Portfel (makiety flow-portfel, platnosci-portfel-pusty): saldo z kwotami 20/50/100 zł i „Inna kwota”,
 * metoda płatności (karty i BLIK), historia ruchów z wejściem do paragonu. Doładowanie kartą potwierdza
 * się od razu; BLIK i kwota własna prowadzą do ekranu „Doładowanie” (platnosci-blik, doladowanie-kwota).
 */
export default function WalletScreen() {
  const theme = useTheme();
  const { summary, cards } = useWallet();
  const payments = usePayments();
  const [entries, setEntries] = useState<WalletEntry[] | null>(null);
  const [more, setMore] = useState(false);
  const [preset, setPreset] = useState(DEFAULT_PRESET);
  const [chosen, setChosen] = useState<Method | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const back = () => (router.canGoBack() ? router.back() : router.replace('/mapa'));

  const load = useCallback(() => {
    api<WalletView>(`/me/wallet?limit=${PAGE}`)
      .then((w) => {
        setEntries(w.entries);
        setMore(w.entries.length === PAGE);
      })
      .catch((e: unknown) => setError(errorMessage(e)));
  }, []);
  useFocusEffect(load);
  useWalletEvents(load);

  const older = () => {
    const last = entries?.at(-1);
    if (!last) return;
    api<WalletView>(`/me/wallet?limit=${PAGE}&before=${last.id}`)
      .then((w) => {
        setEntries((current) => [...(current ?? []), ...w.entries]);
        setMore(w.entries.length === PAGE);
      })
      .catch((e: unknown) => setError(errorMessage(e)));
  };

  const usable = usableCards(cards);
  const fallback = preferredCard(cards);
  const method: Method | null =
    chosen && (chosen.kind === 'blik' ? payments.blik : usable.some((c) => c.id === chosen.id))
      ? chosen
      : fallback
        ? { kind: 'card', id: fallback.id }
        : payments.blik
          ? { kind: 'blik' }
          : null;
  const presets = payments.config?.topup.presets ?? [2000, 5000, 10000];
  const empty = cards !== null && !usable.length;

  async function topup() {
    if (!method) return;
    if (method.kind === 'blik') {
      router.push({ pathname: '/portfel/doladowanie', params: { amount: String(preset), method: 'BLIK' } });
      return;
    }
    if (!payments.actions) return;
    setBusy(true);
    setError(null);
    try {
      const card = usable.find((c) => c.id === method.id) ?? null;
      const intent = await api<PaymentIntentResponse>('/me/wallet/topups', {
        method: 'POST',
        json: { amount: preset, method: 'CARD', paymentMethodId: method.id },
      });
      await confirmAndOpen(payments.actions, intent, { card });
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy(false);
    }
  }

  const otherAmount = () =>
    router.push({
      pathname: '/portfel/doladowanie',
      params: method ? { method: method.kind === 'blik' ? 'BLIK' : method.id } : {},
    });

  const balance = summary?.balance ?? null;
  return (
    <PageScreen title={t('wallet.title')} onBack={back}>
      <View
        style={{
          borderRadius: 28,
          padding: 24,
          gap: 20,
          backgroundColor: theme.scheme === 'dark' ? theme.surface : '#16181D',
          borderWidth: theme.scheme === 'dark' ? 1 : 0,
          borderColor: theme.line,
        }}
      >
        <View style={{ gap: 4 }}>
          <Text style={{ fontSize: 14, color: '#A3A6AD' }}>{t('wallet.balance')}</Text>
          {balance === null ? (
            <ActivityIndicator color="#F6F6F3" style={{ alignSelf: 'flex-start', height: 52 }} />
          ) : (
            <Text
              style={{
                fontSize: 50,
                fontWeight: '500',
                letterSpacing: -1.5,
                lineHeight: 54,
                color: balance < 0 ? '#FF7A70' : '#F6F6F3',
              }}
            >
              {pln(balance)}
            </Text>
          )}
          {summary && balance !== null && balance < summary.minWalletBalance && (
            <Text style={{ fontSize: 14, color: '#A3A6AD' }}>
              {t(balance < 0 ? 'wallet.negative' : 'wallet.belowMinimum', { minimum: pln(summary.minWalletBalance) })}
            </Text>
          )}
        </View>
        {!empty && method && (
          <>
            <View accessibilityRole="radiogroup" style={{ flexDirection: 'row', gap: 6 }}>
              {presets.map((p) => (
                <PillSelect key={p} inverted label={wholePln(p)} selected={preset === p} onPress={() => setPreset(p)} />
              ))}
              <PillSelect inverted flex={2} label={t('wallet.other')} selected={false} onPress={otherAmount} />
            </View>
            <Button
              label={t('wallet.topup', { amount: wholePln(preset) })}
              busy={busy}
              disabled={method.kind === 'card' && !payments.actions}
              onPress={() => void topup()}
            />
          </>
        )}
      </View>

      {error && <ErrorBox message={error} />}

      {empty ? (
        <Group style={{ padding: 24, alignItems: 'center' }}>
          <View
            style={{
              width: 56,
              height: 56,
              borderRadius: 28,
              backgroundColor: theme.line,
              alignItems: 'center',
              justifyContent: 'center',
            }}
          >
            <Icon name="card" color={theme.ink} size={22} />
          </View>
          <Text
            accessibilityRole="header"
            style={{
              marginTop: 16,
              fontSize: 19,
              fontWeight: '600',
              letterSpacing: -0.2,
              color: theme.ink,
              textAlign: 'center',
            }}
          >
            {t('wallet.empty.title')}
          </Text>
          <Text style={{ marginTop: 6, fontSize: 15, lineHeight: 22, color: theme.muted, textAlign: 'center' }}>
            {t('wallet.empty.lead')}
          </Text>
          <View style={{ flexDirection: 'row', gap: 10, marginTop: 20, alignSelf: 'stretch' }}>
            <View style={{ flex: 1 }}>
              <Button label={t('wallet.empty.card')} onPress={() => router.push('/portfel/karta')} />
            </View>
            {payments.blik && (
              <View style={{ flex: 1 }}>
                <Button
                  label={t('wallet.empty.blik')}
                  kind="secondary"
                  onPress={() => router.push({ pathname: '/portfel/doladowanie', params: { method: 'BLIK' } })}
                />
              </View>
            )}
          </View>
        </Group>
      ) : (
        cards !== null && (
          <View style={{ gap: 12 }}>
            <Text style={{ fontSize: 17, fontWeight: '600', color: theme.ink }}>{t('wallet.method')}</Text>
            <Group>
              {usable.map((card, i) => (
                <OptionRow
                  key={card.id}
                  first={i === 0}
                  mini={<CardMini brand={card.brand} />}
                  title={cardTitle(card)}
                  subtitle={brandName(card.brand)}
                  selected={method?.kind === 'card' && method.id === card.id}
                  onPress={() => setChosen({ kind: 'card', id: card.id })}
                  right={<Radio on={method?.kind === 'card' && method.id === card.id} />}
                />
              ))}
              {payments.blik && (
                <OptionRow
                  mini={<CardMini kind="blik" />}
                  title={t('payment.blik')}
                  selected={method?.kind === 'blik'}
                  onPress={() => setChosen({ kind: 'blik' })}
                  right={<Radio on={method?.kind === 'blik'} />}
                />
              )}
              <AddRow label={t('wallet.addMethod')} onPress={() => router.push('/portfel/karta')} />
            </Group>
          </View>
        )
      )}

      <View style={{ gap: 4 }}>
        <Text style={{ fontSize: 17, fontWeight: '600', color: theme.ink }}>{t('wallet.history')}</Text>
        {entries === null ? (
          <ActivityIndicator style={{ marginTop: 16 }} color={theme.accent} />
        ) : !entries.length ? (
          <Text style={{ marginTop: 6, fontSize: 15, lineHeight: 22, color: theme.muted }}>
            {t('wallet.historyEmpty')}
          </Text>
        ) : (
          <>
            {entries.map((entry) => (
              <EntryRow key={entry.id} entry={entry} />
            ))}
            {more && <Button label={t('wallet.older')} kind="plain" onPress={older} />}
          </>
        )}
      </View>
      <Pressable
        accessibilityRole="link"
        onPress={() => router.push('/cennik')}
        style={{ alignSelf: 'center', padding: 8 }}
      >
        <Text style={{ fontSize: 15, fontWeight: '500', color: theme.accent }}>{t('wallet.tariff')}</Text>
      </Pressable>
    </PageScreen>
  );
}

/** Opis ruchu w portfelu: rodzaj, a w podpisie data i metoda albo powód korekty. */
function entryText(entry: WalletEntry): { title: string; subtitle: string } {
  const when = dayTime(entry.createdAt);
  switch (entry.type) {
    case 'TOPUP': {
      const how = entry.paymentMethod === 'BLIK' ? t('payment.blik') : entry.card ? cardTitle(entry.card) : null;
      return { title: t('wallet.entries.TOPUP'), subtitle: how ? t('wallet.entries.with', { when, how }) : when };
    }
    case 'ADJUSTMENT':
      return {
        title: t('wallet.entries.ADJUSTMENT'),
        subtitle: entry.reason
          ? t('wallet.entries.with', { when, how: t.dynamic(`wallet.reasons.${entry.reason}`) })
          : when,
      };
    default:
      return { title: t.dynamic(`wallet.entries.${entry.type}`), subtitle: when };
  }
}

function EntryRow({ entry }: { entry: WalletEntry }) {
  const theme = useTheme();
  const { title, subtitle } = entryText(entry);
  const receiptId = entry.receiptId;
  const content = (
    <>
      <View style={{ flex: 1, gap: 2 }}>
        <Text style={{ fontSize: 16, color: theme.ink }}>{title}</Text>
        <Text style={{ fontSize: 14, color: theme.muted }}>{subtitle}</Text>
      </View>
      <Text style={{ fontSize: 16, fontWeight: '500', color: entry.amount > 0 ? theme.accentMap : theme.ink }}>
        {signedPln(entry.amount)}
      </Text>
      {receiptId && <Icon name="chevron" color={theme.checkbox} size={18} />}
    </>
  );
  const style = {
    flexDirection: 'row' as const,
    alignItems: 'center' as const,
    gap: 12,
    paddingVertical: 14,
    borderBottomWidth: 1,
    borderColor: theme.line,
  };
  return receiptId ? (
    <Pressable
      accessibilityRole="button"
      accessibilityHint={t('wallet.receiptHint')}
      onPress={() => router.push({ pathname: '/paragon/[id]', params: { id: receiptId } })}
      style={({ pressed }) => [style, { opacity: pressed ? 0.7 : 1 }]}
    >
      {content}
    </Pressable>
  ) : (
    <View style={style} accessible>
      {content}
    </View>
  );
}
