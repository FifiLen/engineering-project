/** Kwoty w systemie są liczbami całkowitymi w groszach (ADR 0014). */
export type Grosze = number;

const formatter = new Intl.NumberFormat('pl-PL', { style: 'currency', currency: 'PLN' });

/** 1250 -> "12,50 zł" */
export const formatPln = (amount: Grosze): string => formatter.format(amount / 100);
