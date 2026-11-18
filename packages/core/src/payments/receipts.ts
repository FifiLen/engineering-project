import type { RentalPrice } from '../rentals/pricing.js';

/**
 * Kody pozycji paragonu (`receipt_items.description`); tekst pozycji pochodzi z plików tłumaczeń
 * klienta i z szablonu wydruku (ADR 0032, ADR 0052).
 */
export const RECEIPT_ITEM_CODES = ['UNLOCK', 'RIDE_MINUTES', 'PAUSE_MINUTES', 'TOWING_FEE', 'REFUND'] as const;
export type ReceiptItemCode = (typeof RECEIPT_ITEM_CODES)[number];

export interface ReceiptItem {
  description: ReceiptItemCode;
  quantity: number;
  /** Cena jednostkowa brutto w groszach. */
  unitPrice: number;
  /** Stawka VAT w procentach (np. 23). */
  vatRate: number;
  /** Kwota brutto w groszach; ujemna w korekcie. */
  amount: number;
}

/**
 * VAT od sumy brutto metodą „w stu” (ADR 0052): `round(brutto × stawka / (100 + stawka))`, zaokrąglenie
 * do grosza połowa w górę, znak jak brutto. Liczone na liczbach całkowitych (stawka w setnych procenta),
 * tak samo jak `fn_vat_from_gross` w bazie.
 */
export function vatFromGross(gross: number, vatRate: number): number {
  const rate = Math.round(vatRate * 100);
  const base = 10_000 + rate;
  const vat = Math.floor((2 * Math.abs(gross) * rate + base) / (2 * base));
  return gross < 0 ? -vat : vat;
}

/**
 * Pozycje paragonu przejazdu z wyceny (ADR 0042): odblokowanie, minuty jazdy, minuty pauzy, gdy były, i opłata
 * za odholowanie ze stawką VAT przejazdu, gdy ją pobrano (ADR 0060).
 */
export function rideReceiptItems(
  price: Omit<RentalPrice, 'towingFee'> & { towingFee?: number },
  tariff: { unlockFee: number; minuteRate: number; pauseMinuteRate: number },
  vatRate: number,
): ReceiptItem[] {
  const items: ReceiptItem[] = [
    { description: 'UNLOCK', quantity: 1, unitPrice: tariff.unlockFee, vatRate, amount: price.unlockFee },
    {
      description: 'RIDE_MINUTES',
      quantity: price.rideMinutes,
      unitPrice: tariff.minuteRate,
      vatRate,
      amount: price.rideAmount,
    },
  ];
  if (price.pauseMinutes > 0) {
    items.push({
      description: 'PAUSE_MINUTES',
      quantity: price.pauseMinutes,
      unitPrice: tariff.pauseMinuteRate,
      vatRate,
      amount: price.pauseAmount,
    });
  }
  if (price.towingFee) {
    items.push({
      description: 'TOWING_FEE',
      quantity: 1,
      unitPrice: price.towingFee,
      vatRate,
      amount: price.towingFee,
    });
  }
  return items;
}

/** Korekta po zwrocie (ADR 0052): jedna pozycja z kwotą ujemną i stawką paragonu pierwotnego. */
export function correctionItems(refundAmount: number, vatRate: number): ReceiptItem[] {
  return [{ description: 'REFUND', quantity: 1, unitPrice: -refundAmount, vatRate, amount: -refundAmount }];
}

export interface ReceiptTotals {
  gross: number;
  vat: number;
  net: number;
}

/** Suma dokumentu z jedną stawką VAT; netto to brutto minus VAT. */
export function receiptTotals(items: readonly ReceiptItem[]): ReceiptTotals {
  const gross = items.reduce((sum, item) => sum + item.amount, 0);
  const vat = items.length ? vatFromGross(gross, items[0]!.vatRate) : 0;
  return { gross, vat, net: gross - vat };
}
