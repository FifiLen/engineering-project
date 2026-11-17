/**
 * Reguła płatności przy rezerwacji i starcie (ADR 0049) w aplikacji: arkusz „Za mało środków na start”
 * (makieta platnosci-brak-srodkow) z wariantami ujemnego salda, zaległości i braku karty oraz arkusz
 * „Płatność kartą” (makieta start-karta) z wyborem karty tylko dla tego przejazdu.
 */
import type { PaymentMethodView, TariffView } from '@hulajnogi/shared';
import { router } from 'expo-router';
import { useState, type ReactNode } from 'react';
import { Modal, Pressable, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { t } from '../i18n';
import { errorMessage } from '../lib/api';
import { pln } from '../lib/format';
import type { PaymentChoice } from '../lib/rental';
import { brandName, cardTitle, paymentBlock, usableCards, useWallet, type PaymentBlock } from '../lib/wallet';
import { radius } from '../theme/tokens';
import { CardMini, Group, Lines, OptionRow, Radio } from './payment';
import { AlertHeader, BottomSheet, glass, SheetText } from './sheet';
import { Button, useTheme } from './ui';

/** Karta „glass” nad przyciemnionym tłem (makieta platnosci-brak-srodkow). */
function FloatingModal({ visible, onClose, children }: { visible: boolean; onClose: () => void; children: ReactNode }) {
  const theme = useTheme();
  const insets = useSafeAreaInsets();
  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose}>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={t('common.scrim')}
        style={[StyleSheet.absoluteFill, { backgroundColor: theme.scrim }]}
        onPress={onClose}
      />
      <View
        style={[
          {
            position: 'absolute',
            left: 12,
            right: 12,
            bottom: 12 + insets.bottom,
            borderRadius: radius.sheet,
            padding: 24,
            gap: 16,
          },
          glass(theme),
          { backgroundColor: theme.scheme === 'dark' ? theme.surface : '#EFEFEC' },
        ]}
      >
        {children}
      </View>
    </Modal>
  );
}

export function FundsSheet({
  block,
  onClose,
  onTopup,
  onCard,
  onDebt,
  onAddCard,
}: {
  block: PaymentBlock | null;
  onClose: () => void;
  onTopup: () => void;
  onCard: () => void;
  onDebt: (rentalId: string | null) => void;
  onAddCard: () => void;
}) {
  let content: ReactNode = null;
  if (block?.kind === 'below') {
    content = (
      <>
        <AlertHeader
          icon="wallet"
          tone="neutral"
          title={t('funds.below.title')}
          subtitle={t('funds.balance', { balance: pln(block.balance) })}
        />
        <SheetText>{t('funds.below.lead', { minimum: pln(block.minimum) })}</SheetText>
        <View style={{ gap: 10 }}>
          <Button label={t('funds.topup')} onPress={onTopup} />
          {block.cardAvailable && <Button label={t('funds.payByCard')} kind="secondary" onPress={onCard} />}
        </View>
      </>
    );
  } else if (block?.kind === 'negative') {
    content = (
      <>
        <AlertHeader
          icon="wallet"
          tone="danger"
          title={t('funds.negative.title')}
          subtitle={t('funds.balance', { balance: pln(block.balance) })}
        />
        <SheetText>{t('funds.negative.lead')}</SheetText>
        <Button label={t('funds.topup')} onPress={onTopup} />
      </>
    );
  } else if (block?.kind === 'overdue') {
    content = (
      <>
        <AlertHeader icon="card" tone="danger" title={t('funds.overdue.title')} />
        <SheetText>{t('funds.overdue.lead')}</SheetText>
        <Button label={t('funds.overdue.pay')} onPress={() => onDebt(block.rentalId)} />
      </>
    );
  } else if (block?.kind === 'cardRequired') {
    content = (
      <>
        <AlertHeader icon="card" tone="neutral" title={t('funds.cardRequired.title')} />
        <SheetText>{t('funds.cardRequired.lead')}</SheetText>
        <Button label={t('funds.cardRequired.add')} onPress={onAddCard} />
      </>
    );
  }
  return (
    <FloatingModal visible={!!block} onClose={onClose}>
      {content}
    </FloatingModal>
  );
}

/**
 * Potwierdzenie jazdy kartą (makieta start-karta): karta domyślna z „Zmień” (wybór tylko dla tego
 * przejazdu), stawki z cennika i przycisk startu albo rezerwacji.
 */
export function CardStartSheet({
  visible,
  caption,
  cards,
  tariff,
  action,
  busy,
  error,
  onClose,
  onConfirm,
}: {
  visible: boolean;
  caption: string;
  cards: PaymentMethodView[];
  tariff: Pick<TariffView, 'unlockFee' | 'minuteRate' | 'pauseMinuteRate'>;
  /** Etykieta przycisku: „Odblokuj i jedź” albo „Zarezerwuj”. */
  action: string;
  busy: boolean;
  error: string | null;
  onClose: () => void;
  onConfirm: (card: PaymentMethodView) => void;
}) {
  const theme = useTheme();
  const [chosenId, setChosenId] = useState<string | null>(null);
  const [picking, setPicking] = useState(false);
  const card = cards.find((c) => c.id === chosenId) ?? cards.find((c) => c.isDefault) ?? cards[0] ?? null;
  if (!card) return null;
  const subtitle = (c: PaymentMethodView) => (c.isDefault ? t('methods.default') : brandName(c.brand));
  return (
    <BottomSheet
      visible={visible}
      onClose={() => {
        setPicking(false);
        onClose();
      }}
    >
      <Text style={{ fontSize: 13, fontWeight: '500', color: theme.muted }}>{caption}</Text>
      <Text
        accessibilityRole="header"
        style={{ marginTop: 4, fontSize: 22, fontWeight: '600', letterSpacing: -0.4, color: theme.ink }}
      >
        {t('cardStart.title')}
      </Text>
      <Text style={{ marginTop: 10, fontSize: 16, lineHeight: 24, color: theme.muted }}>
        {t('cardStart.lead', { last4: card.last4 })}
      </Text>
      <Group style={{ marginTop: 20 }}>
        {picking ? (
          cards.map((c, i) => (
            <OptionRow
              key={c.id}
              first={i === 0}
              mini={<CardMini brand={c.brand} />}
              title={cardTitle(c)}
              subtitle={subtitle(c)}
              selected={c.id === card.id}
              onPress={() => {
                setChosenId(c.id);
                setPicking(false);
              }}
              right={<Radio on={c.id === card.id} />}
            />
          ))
        ) : (
          <OptionRow
            first
            mini={<CardMini brand={card.brand} />}
            title={cardTitle(card)}
            subtitle={subtitle(card)}
            right={
              cards.length > 1 ? (
                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel={t('cardStart.changeLabel')}
                  onPress={() => setPicking(true)}
                  hitSlop={8}
                >
                  <Text style={{ fontSize: 15, fontWeight: '500', color: theme.accent }}>{t('cardStart.change')}</Text>
                </Pressable>
              ) : undefined
            }
          />
        )}
      </Group>
      <View style={{ marginTop: 16 }}>
        <Lines
          rows={[
            { label: t('cardStart.unlock'), value: pln(tariff.unlockFee) },
            { label: t('cardStart.minute'), value: pln(tariff.minuteRate) },
            { label: t('cardStart.pause'), value: pln(tariff.pauseMinuteRate) },
          ]}
        />
      </View>
      <Text style={{ marginTop: 12, fontSize: 14, lineHeight: 20, color: theme.muted }}>{t('cardStart.note')}</Text>
      {error && <Text style={{ marginTop: 12, fontSize: 14, color: theme.danger }}>{error}</Text>}
      <View style={{ marginTop: 20 }}>
        <Button label={action} busy={busy} onPress={() => onConfirm(card)} />
      </View>
    </BottomSheet>
  );
}

/** Hulajnoga, której dotyczy rezerwacja albo start (opis i stawki w arkuszu płatności kartą). */
export interface GateTarget {
  scooterId: string;
  caption: string;
  tariff: Pick<TariffView, 'unlockFee' | 'minuteRate' | 'pauseMinuteRate'>;
}

/**
 * Obsługa odmowy rezerwacji albo startu przez regułę płatności: `handle` pokazuje arkusz (brak środków,
 * ujemne saldo, zaległość, brak karty) i zwraca `true`; „Płać kartą za przejazd” ponawia operację ze
 * źródłem `CARD` i wybraną kartą (pytanie 5).
 */
export function usePaymentGate({
  action,
  perform,
}: {
  /** Etykieta przycisku w arkuszu karty. */
  action: string;
  perform: (scooterId: string, payment: PaymentChoice) => Promise<void>;
}): { handle: (target: GateTarget, error: unknown) => boolean; sheets: ReactNode } {
  const { cards, refresh } = useWallet();
  const [target, setTarget] = useState<GateTarget | null>(null);
  const [block, setBlock] = useState<PaymentBlock | null>(null);
  const [cardOpen, setCardOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handle = (next: GateTarget, e: unknown) => {
    const found = paymentBlock(e);
    if (!found) return false;
    setTarget(next);
    setBlock(found);
    if (found.kind === 'below' && found.cardAvailable) void refresh();
    return true;
  };
  const close = () => {
    setBlock(null);
    setCardOpen(false);
    setError(null);
  };
  const go = (to: () => void) => {
    close();
    to();
  };

  async function confirm(card: PaymentMethodView) {
    if (!target) return;
    setBusy(true);
    setError(null);
    try {
      await perform(target.scooterId, { paymentSource: 'CARD', paymentMethodId: card.id });
      close();
    } catch (e) {
      const found = paymentBlock(e);
      if (found) {
        setCardOpen(false);
        setBlock(found);
      } else setError(errorMessage(e));
    } finally {
      setBusy(false);
    }
  }

  const sheets = (
    <>
      <FundsSheet
        block={block}
        onClose={close}
        onTopup={() => go(() => router.push('/portfel'))}
        onCard={() => {
          setBlock(null);
          setCardOpen(true);
        }}
        onDebt={(rentalId) =>
          go(() =>
            rentalId ? router.push({ pathname: '/zaleglosc/[id]', params: { id: rentalId } }) : router.push('/portfel'),
          )
        }
        onAddCard={() => go(() => router.push('/portfel/karta'))}
      />
      {target && (
        <CardStartSheet
          visible={cardOpen}
          caption={target.caption}
          cards={usableCards(cards)}
          tariff={target.tariff}
          action={action}
          busy={busy}
          error={error}
          onClose={close}
          onConfirm={(card) => void confirm(card)}
        />
      )}
    </>
  );
  return { handle, sheets };
}
