import { describe, expect, it } from 'vitest';
import {
  cardState,
  ensureCanPay,
  ensureCanPayDebt,
  ensureTopupAmount,
  isCardUsable,
  nextPaymentStatus,
  rideCharge,
  shouldRetryRideCharge,
  type PaymentCheck,
} from './payments.js';
import { correctionItems, receiptTotals, rideReceiptItems, vatFromGross } from './receipts.js';
import { decideRefund, ensureAdjustment, planPayout } from './refunds.js';
import { ensureNoScheduledTariff, tariffChanges, validateTariffInput, type TariffInput } from './tariffs.js';

const now = new Date('2026-11-17T12:00:00Z');
const card = { id: 'c1', expMonth: 12, expYear: 2028, removedAt: null };
const check = (over: Partial<PaymentCheck> = {}): PaymentCheck => ({
  source: 'WALLET',
  balance: 5000,
  minWalletBalance: 1000,
  overdueRentalIds: [],
  card: null,
  now,
  ...over,
});

describe('doładowanie', () => {
  it('przyjmuje kwoty z makiety i kwotę własną w pełnych złotych od 10 do 500 zł', () => {
    for (const amount of [1000, 2000, 3500, 50000]) expect(() => ensureTopupAmount(amount)).not.toThrow();
    for (const amount of [900, 50100, 3550, 0, -2000, 20.5]) {
      expect(() => ensureTopupAmount(amount)).toThrow(expect.objectContaining({ code: 'TOPUP_AMOUNT_INVALID' }));
    }
  });
});

describe('karta', () => {
  it('wygasa z końcem miesiąca ważności, „Wygasa” w bieżącym i następnym miesiącu', () => {
    expect(cardState({ ...card, expMonth: 10, expYear: 2026 }, now)).toBe('EXPIRED');
    expect(cardState({ ...card, expMonth: 11, expYear: 2026 }, now)).toBe('EXPIRING');
    expect(cardState({ ...card, expMonth: 12, expYear: 2026 }, now)).toBe('EXPIRING');
    expect(cardState({ ...card, expMonth: 1, expYear: 2027 }, now)).toBe('ACTIVE');
    expect(cardState({ ...card, removedAt: now }, now)).toBe('REMOVED');
    // 30 listopada 23:30 UTC to już 1 grudnia w Polsce: liczy się miesiąc w Polsce.
    expect(cardState({ ...card, expMonth: 11, expYear: 2026 }, new Date('2026-11-30T23:30:00Z'))).toBe('EXPIRED');
    expect(isCardUsable({ ...card, expMonth: 11, expYear: 2026 }, now)).toBe(true);
    expect(isCardUsable(null, now)).toBe(false);
  });
});

describe('reguła rezerwacji i startu (ADR 0049)', () => {
  it('portfel wymaga minimalnego salda, karta ważnej karty', () => {
    expect(() => ensureCanPay(check())).not.toThrow();
    expect(() => ensureCanPay(check({ balance: 999 }))).toThrow(
      expect.objectContaining({
        code: 'INSUFFICIENT_BALANCE',
        details: { reason: 'BELOW_MINIMUM', balance: 999, minimum: 1000, cardAvailable: false },
      }),
    );
    expect(() => ensureCanPay(check({ balance: 0, source: 'CARD', card }))).not.toThrow();
    expect(() => ensureCanPay(check({ balance: 0, source: 'CARD' }))).toThrow(
      expect.objectContaining({ code: 'PAYMENT_METHOD_REQUIRED' }),
    );
    expect(() =>
      ensureCanPay(check({ balance: 0, source: 'CARD', card: { ...card, expMonth: 1, expYear: 2026 } })),
    ).toThrow(expect.objectContaining({ code: 'PAYMENT_METHOD_REQUIRED' }));
  });

  it('zaległość i ujemne saldo blokują także jazdę kartą', () => {
    expect(() => ensureCanPay(check({ source: 'CARD', card, overdueRentalIds: ['r1'] }))).toThrow(
      expect.objectContaining({ code: 'PAYMENT_OVERDUE', details: { rentalIds: ['r1'] } }),
    );
    expect(() => ensureCanPay(check({ source: 'CARD', card, balance: -340 }))).toThrow(
      expect.objectContaining({
        code: 'INSUFFICIENT_BALANCE',
        details: expect.objectContaining({ reason: 'NEGATIVE_BALANCE' }),
      }),
    );
  });
});

describe('rozliczenie i spłata', () => {
  it('kwota 0 bez obciążenia, portfel i karta według źródła', () => {
    expect(rideCharge(0, 'WALLET')).toEqual({ kind: 'NONE' });
    expect(rideCharge(1260, 'WALLET')).toEqual({ kind: 'WALLET', amount: 1260 });
    expect(rideCharge(1260, 'CARD')).toEqual({ kind: 'CARD', amount: 1260 });
  });

  it('status płatności zmienia się monotonicznie, powtórzone zdarzenie nic nie zmienia', () => {
    expect(nextPaymentStatus('PENDING', 'SUCCEEDED')).toBe('SUCCEEDED');
    expect(nextPaymentStatus('PENDING', 'FAILED')).toBe('FAILED');
    expect(nextPaymentStatus('SUCCEEDED', 'SUCCEEDED')).toBeNull();
    expect(nextPaymentStatus('SUCCEEDED', 'FAILED')).toBeNull();
    expect(nextPaymentStatus('FAILED', 'SUCCEEDED')).toBeNull();
    expect(nextPaymentStatus('SUCCEEDED', 'REFUNDED')).toBe('REFUNDED');
  });

  it('jedno automatyczne ponowienie po pierwszej odmowie', () => {
    expect(shouldRetryRideCharge(1)).toBe(true);
    expect(shouldRetryRideCharge(2)).toBe(false);
  });

  it('spłata z portfela tylko całą kwotą, bez drugiej płatności w toku', () => {
    const debt = { source: 'WALLET' as const, amount: 1260, balance: 1260, card: null, paymentPending: false, now };
    expect(() => ensureCanPayDebt(debt)).not.toThrow();
    expect(() => ensureCanPayDebt({ ...debt, balance: 1259 })).toThrow(
      expect.objectContaining({ code: 'INSUFFICIENT_BALANCE' }),
    );
    expect(() => ensureCanPayDebt({ ...debt, paymentPending: true })).toThrow(
      expect.objectContaining({ code: 'PAYMENT_IN_PROGRESS' }),
    );
    expect(() => ensureCanPayDebt({ ...debt, source: 'CARD' })).toThrow(
      expect.objectContaining({ code: 'PAYMENT_METHOD_REQUIRED' }),
    );
  });
});

describe('paragon (ADR 0052)', () => {
  it('VAT „w stu” od brutto z zaokrągleniem połowy w górę', () => {
    expect(vatFromGross(1230, 23)).toBe(230);
    expect(vatFromGross(1000, 23)).toBe(187); // 186,99…
    expect(vatFromGross(100, 23)).toBe(19); // 18,699…
    expect(vatFromGross(-500, 23)).toBe(-93);
    expect(vatFromGross(1080, 8)).toBe(80);
    expect(vatFromGross(123, 0)).toBe(0);
    // Dokładnie pół grosza (3 gr × 20/120 = 0,5 gr) zaokrągla się w górę.
    expect(vatFromGross(3, 20)).toBe(1);
    expect(vatFromGross(-3, 20)).toBe(-1);
    expect(vatFromGross(215, 7.5)).toBe(15);
  });

  it('pozycje z wyceny, pauza tylko gdy była, suma równa kwocie przejazdu', () => {
    const tariff = { unlockFee: 300, minuteRate: 80, pauseMinuteRate: 30 };
    const price = { unlockFee: 300, rideMinutes: 12, rideAmount: 960, pauseMinutes: 0, pauseAmount: 0, total: 1260 };
    const items = rideReceiptItems(price, tariff, 23);
    expect(items.map((i) => i.description)).toEqual(['UNLOCK', 'RIDE_MINUTES']);
    expect(receiptTotals(items)).toEqual({ gross: 1260, vat: 236, net: 1024 });
    const paused = rideReceiptItems({ ...price, pauseMinutes: 3, pauseAmount: 90, total: 1350 }, tariff, 23);
    expect(paused.at(-1)).toEqual({
      description: 'PAUSE_MINUTES',
      quantity: 3,
      unitPrice: 30,
      vatRate: 23,
      amount: 90,
    });
    expect(correctionItems(500, 23)).toEqual([
      { description: 'REFUND', quantity: 1, unitPrice: -500, vatRate: 23, amount: -500 },
    ]);
  });
});

describe('zwroty i korekty (ADR 0054)', () => {
  const refund = {
    settlement: 'WALLET_PAID' as const,
    paid: 1260,
    refunded: 0,
    amount: 500,
    reason: 'SCOOTER_FAILURE' as const,
    note: null,
  };

  it('zwrot według źródła, częściowy dozwolony, suma nie większa niż zapłata', () => {
    expect(decideRefund(refund)).toEqual({ source: 'WALLET' });
    expect(decideRefund({ ...refund, settlement: 'CARD_PAID' })).toEqual({ source: 'CARD' });
    expect(() => decideRefund({ ...refund, refunded: 800 })).toThrow(
      expect.objectContaining({ code: 'REFUND_EXCEEDS_PAYMENT', details: { remaining: 460 } }),
    );
    expect(() => decideRefund({ ...refund, settlement: 'NONE' })).toThrow(
      expect.objectContaining({ code: 'RENTAL_NOT_REFUNDABLE' }),
    );
    expect(() => decideRefund({ ...refund, reason: 'OTHER', note: ' ' })).toThrow(
      expect.objectContaining({ code: 'VALIDATION_FAILED', details: { field: 'note' } }),
    );
  });

  it('korekta salda ze znakiem, różna od zera, notatka przy „Inny powód”', () => {
    expect(() => ensureAdjustment({ amount: -2500, reason: 'SYSTEM_ERROR', note: null })).not.toThrow();
    expect(() => ensureAdjustment({ amount: 0, reason: 'GOODWILL', note: null })).toThrow(
      expect.objectContaining({ details: { field: 'amount' } }),
    );
    expect(() => ensureAdjustment({ amount: 1000, reason: 'OTHER', note: null })).toThrow(
      expect.objectContaining({ details: { field: 'note' } }),
    );
  });

  it('zwrot salda z najnowszych doładowań do kwoty salda, reszta do korekty', () => {
    const topups = [
      { paymentId: 'p3', amount: 2000, refunded: 0 },
      { paymentId: 'p2', amount: 5000, refunded: 4500 },
      { paymentId: 'p1', amount: 5000, refunded: 0 },
    ];
    expect(planPayout(3000, topups)).toEqual({
      refunds: [
        { paymentId: 'p3', amount: 2000 },
        { paymentId: 'p2', amount: 500 },
        { paymentId: 'p1', amount: 500 },
      ],
      remainder: 0,
    });
    expect(planPayout(1500, [{ paymentId: 'p1', amount: 1000, refunded: 0 }])).toEqual({
      refunds: [{ paymentId: 'p1', amount: 1000 }],
      remainder: 500,
    });
    expect(() => planPayout(0, topups)).toThrow(expect.objectContaining({ code: 'NOTHING_TO_PAY_OUT' }));
  });
});

describe('wersje cennika (ADR 0053)', () => {
  const input: TariffInput = {
    unlockFee: 300,
    minuteRate: 90,
    pauseMinuteRate: 30,
    outOfZoneFee: 2000,
    freeReservationMinutes: 10,
    minWalletBalance: 1000,
    minBatteryPct: 15,
    minUserAge: 18,
    vatRate: 23,
    validFrom: null,
  };

  it('„od teraz” albo w przyszłości, przeszłość i wartości spoza zakresu odrzucone z listą pól', () => {
    expect(validateTariffInput(input, now)).toEqual({ validFrom: now });
    const tomorrow = new Date(now.getTime() + 86_400_000);
    expect(validateTariffInput({ ...input, validFrom: tomorrow }, now)).toEqual({ validFrom: tomorrow });
    expect(validateTariffInput({ ...input, validFrom: new Date(now.getTime() - 3000) }, now)).toEqual({
      validFrom: now,
    });
    expect(() =>
      validateTariffInput(
        {
          ...input,
          minuteRate: -1,
          minBatteryPct: 101,
          vatRate: 23.456,
          validFrom: new Date(now.getTime() - 3600_000),
        },
        now,
      ),
    ).toThrow(
      expect.objectContaining({
        code: 'TARIFF_INVALID',
        details: { fields: ['minuteRate', 'minBatteryPct', 'vatRate', 'validFrom'] },
      }),
    );
    expect(() => validateTariffInput({ ...input, vatRate: 0.07 }, now)).not.toThrow();
  });

  it('najwyżej jedna zaplanowana wersja i różnica do dziennika audytu', () => {
    expect(() => ensureNoScheduledTariff({ version: 4 })).toThrow(
      expect.objectContaining({ code: 'TARIFF_ALREADY_SCHEDULED', details: { version: 4 } }),
    );
    expect(() => ensureNoScheduledTariff(null)).not.toThrow();
    const values = {
      unlockFee: 300,
      minuteRate: 90,
      pauseMinuteRate: 30,
      outOfZoneFee: 2000,
      freeReservationMinutes: 10,
      minWalletBalance: 1000,
      minBatteryPct: 15,
      minUserAge: 18,
      vatRate: 23,
    };
    expect(tariffChanges({ ...values, minuteRate: 80 }, values)).toEqual({ minuteRate: { from: 80, to: 90 } });
  });
});
