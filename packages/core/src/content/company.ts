import { ensureNoContentIssues, type ContentIssue } from './content.js';

/**
 * Dane firmy (ADR 0062): jeden wiersz `company_profile` edytowany w panelu (`company.write`). Zasila paragon
 * (kopia w chwili wystawienia), stopkę strony, Pomoc w aplikacji i pola `{company.*}` wydruków. Baza sprawdza
 * format (10 cyfr NIP, kod pocztowy), a core sumy kontrolne NIP i REGON.
 */
export interface CompanyProfile {
  name: string;
  street: string;
  postalCode: string;
  city: string;
  taxId: string;
  supportEmail: string;
  supportPhone: string;
  supportHours: string;
  regon: string | null;
  krs: string | null;
  registryCourt: string | null;
  shareCapitalGrosze: number | null;
}

const NIP_WEIGHTS = [6, 5, 7, 2, 3, 4, 5, 6, 7] as const;
const REGON9_WEIGHTS = [8, 9, 2, 3, 4, 5, 6, 7] as const;
const REGON14_WEIGHTS = [2, 4, 8, 5, 0, 9, 7, 3, 6, 1, 2, 4, 8] as const;

const digits = (value: string): number[] => [...value].map(Number);

/** NIP bez kresek, spacji i przedrostka `PL` (panel przyjmuje `642-290-18-30`). */
export const normalizeTaxId = (value: string): string => value.replace(/^PL/i, '').replace(/[\s-]/g, '');

/** NIP: 10 cyfr, suma ważona mod 11 równa ostatniej cyfrze (wynik 10 jest niepoprawny). */
export function isValidNip(value: string): boolean {
  if (!/^\d{10}$/.test(value)) return false;
  const d = digits(value);
  const sum = NIP_WEIGHTS.reduce((acc, weight, i) => acc + weight * d[i]!, 0) % 11;
  return sum !== 10 && sum === d[9];
}

const regonChecksum = (d: number[], weights: readonly number[]): number =>
  (weights.reduce((acc, weight, i) => acc + weight * d[i]!, 0) % 11) % 10;

/** REGON: 9 cyfr albo 14 cyfr (jednostka lokalna, której pierwsze 9 cyfr to poprawny REGON), suma mod 11 (10 → 0). */
export function isValidRegon(value: string): boolean {
  if (/^\d{9}$/.test(value)) {
    const d = digits(value);
    return regonChecksum(d, REGON9_WEIGHTS) === d[8];
  }
  if (/^\d{14}$/.test(value)) {
    const d = digits(value);
    return isValidRegon(value.slice(0, 9)) && regonChecksum(d, REGON14_WEIGHTS) === d[13];
  }
  return false;
}

/** KRS: 10 cyfr (bez sumy kontrolnej). */
export const isValidKrs = (value: string): boolean => /^\d{10}$/.test(value);

/**
 * Problemy danych firmy po zapisie częściowym. Sprawdza tylko pola zmienione względem `previous`, więc wartości
 * deweloperskie z danych startowych nie blokują zmiany innego pola. KRS wymaga sądu rejestrowego (stopka strony
 * podaje oba razem, art. 206 § 1 KSH; formę spółki ocenia autor).
 */
export function companyProfileIssues(next: CompanyProfile, previous?: CompanyProfile | null): ContentIssue[] {
  const changed = (field: keyof CompanyProfile) => !previous || previous[field] !== next[field];
  const issues: ContentIssue[] = [];
  const issue = (field: keyof CompanyProfile, code: ContentIssue['code']) => issues.push({ item: null, field, code });
  if (changed('taxId') && !isValidNip(next.taxId)) issue('taxId', 'COMPANY_TAX_ID_INVALID');
  if (changed('postalCode') && !/^\d{2}-\d{3}$/.test(next.postalCode))
    issue('postalCode', 'COMPANY_POSTAL_CODE_INVALID');
  if (changed('regon') && next.regon !== null && !isValidRegon(next.regon)) issue('regon', 'COMPANY_REGON_INVALID');
  if (changed('krs') && next.krs !== null && !isValidKrs(next.krs)) issue('krs', 'COMPANY_KRS_INVALID');
  if ((changed('krs') || changed('registryCourt')) && next.krs !== null && !next.registryCourt?.trim()) {
    issue('registryCourt', 'COMPANY_REGISTRY_INCOMPLETE');
  }
  for (const field of ['name', 'street', 'city', 'supportEmail', 'supportPhone', 'supportHours'] as const) {
    if (changed(field) && !next[field].trim()) issue(field, 'CONTENT_FIELD_REQUIRED');
  }
  if (changed('supportHours') && [...next.supportHours].length > 60) issue('supportHours', 'CONTENT_TOO_LONG');
  return issues;
}

export function ensureCompanyProfileValid(next: CompanyProfile, previous?: CompanyProfile | null): void {
  ensureNoContentIssues(companyProfileIssues(next, previous));
}

/** Adres jednym wierszem: „ul. Rynek 1, 44-200 Rybnik”. */
export const companyAddress = (profile: Pick<CompanyProfile, 'street' | 'postalCode' | 'city'>): string =>
  `${profile.street}, ${profile.postalCode} ${profile.city}`;

/**
 * Sprzedawca na paragonie (`receipts.seller`, ADR 0052): nazwa, adres i NIP z danych firmy w chwili wystawienia,
 * zamiast `SELLER_*` z konfiguracji. Paragon nie pokazuje KRS ani REGON.
 */
export const sellerFromCompany = (profile: CompanyProfile): { name: string; address: string; taxId: string } => ({
  name: profile.name,
  address: companyAddress(profile),
  taxId: profile.taxId,
});
