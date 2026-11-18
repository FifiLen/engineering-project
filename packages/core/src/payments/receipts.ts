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
  /** Stawka VAT w procentach (np. 23); `null` to pozycja, która nie podlega VAT (kara umowna, ADR 0061). */
  vatRate: number | null;
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
 * Pozycje paragonu przejazdu z wyceny (ADR 0042): odblokowanie, minuty jazdy i minuty pauzy, gdy były, ze stawką
 * VAT przejazdu oraz opłata za odholowanie, gdy ją pobrano (ADR 0060), jako kara umowna poza VAT (ADR 0061).
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
      vatRate: null,
      amount: price.towingFee,
    });
  }
  return items;
}

/** Kwota brutto pozycji z jej stawką: tyle potrzeba do VAT dokumentu i do podziału korekty. */
export type ReceiptAmount = Pick<ReceiptItem, 'vatRate' | 'amount'>;

export interface ReceiptVatGroup {
  /** Stawka grupy; `null` to pozycje poza VAT. */
  vatRate: number | null;
  /** Suma brutto pozycji grupy w groszach. */
  gross: number;
  /** VAT grupy metodą „w stu” od sumy brutto grupy; 0 dla pozycji poza VAT. */
  vat: number;
}

/**
 * Grupy stawek dokumentu (ADR 0061) w kolejności pierwszego wystąpienia stawki: VAT liczony osobno dla każdej
 * stawki od sumy brutto grupy, tak jak widok `v_receipt_list` w bazie.
 */
export function receiptVatGroups(items: readonly ReceiptAmount[]): ReceiptVatGroup[] {
  const gross = new Map<number | null, number>();
  for (const item of items) gross.set(item.vatRate, (gross.get(item.vatRate) ?? 0) + item.amount);
  return [...gross].map(([vatRate, sum]) => ({
    vatRate,
    gross: sum,
    vat: vatRate === null ? 0 : vatFromGross(sum, vatRate),
  }));
}

/**
 * Korekta po zwrocie (ADR 0052, ADR 0061): kwota zwrotu dzielona między grupy stawek paragonu proporcjonalnie
 * do kwot pozostałych do zwrotu w każdej grupie (pozycje sprzedaży plus wcześniejsze korekty, które mają kwoty
 * ujemne). Udział grupy zaokrąglony do grosza połowa w górę, reszta trafia do ostatniej grupy (kolejność stawek
 * jak na paragonie). Każda grupa z niezerowym udziałem to osobna pozycja `REFUND` ze swoją stawką. Paragon z jedną
 * stawką daje jedną pozycję jak dotąd. Zwrotu ponad pozostałą kwotę nie dzieli: odrzuca go baza
 * (`RECEIPT_CORRECTION_EXCEEDS`).
 */
export function correctionItems(
  refundAmount: number,
  sale: readonly ReceiptAmount[],
  corrected: readonly ReceiptAmount[] = [],
): ReceiptItem[] {
  const refund = (amount: number, vatRate: number | null): ReceiptItem => ({
    description: 'REFUND',
    quantity: 1,
    unitPrice: -amount,
    vatRate,
    amount: -amount,
  });
  const groups = receiptVatGroups([...sale, ...corrected]).filter((g) => g.gross > 0);
  const remaining = groups.reduce((sum, g) => sum + g.gross, 0);
  if (!groups.length) return [refund(refundAmount, sale[0]?.vatRate ?? null)];
  const items: ReceiptItem[] = [];
  let left = refundAmount;
  groups.forEach((group, i) => {
    const share =
      i === groups.length - 1
        ? left
        : Math.min(left, Math.floor((2 * refundAmount * group.gross + remaining) / (2 * remaining)));
    left -= share;
    if (share > 0) items.push(refund(share, group.vatRate));
  });
  return items;
}

export interface ReceiptTotals {
  gross: number;
  vat: number;
  net: number;
}

/** Suma dokumentu: VAT to suma VAT grup stawek (ADR 0061); netto to brutto minus VAT. */
export function receiptTotals(items: readonly ReceiptAmount[]): ReceiptTotals {
  const gross = items.reduce((sum, item) => sum + item.amount, 0);
  const vat = receiptVatGroups(items).reduce((sum, g) => sum + g.vat, 0);
  return { gross, vat, net: gross - vat };
}
