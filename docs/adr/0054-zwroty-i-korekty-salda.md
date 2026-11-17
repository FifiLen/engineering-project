# ADR 0054: Zwroty i korekty salda

- **Status:** zaakceptowana
- **Data:** 2026-11-17

## Kontekst

Operator musi zwrócić pieniądze za przejazd (awaria, błąd naliczenia, reklamacja), poprawić saldo klienta i zwrócić saldo przed usunięciem konta. Makiety: `25-panel-platnosci/przejazd-zwrot`, `korekta-salda`, `klient-portfel`.

Autor przyjął ([plan iteracji 5](../iteracje/iteracja-05-platnosci.md)):
- **zwrot za przejazd:** według źródła płatności (karta u operatora, portfel wpisem `REFUND`), częściowy dozwolony, z powodem (pytanie 11);
- **korekty salda:** tylko Administrator, powód z listy i notatka, bez limitu kwoty (pytanie 10);
- **usunięcie konta:** saldo różne od 0 dalej je blokuje, a zwrot salda robi operator (pytanie 9).

Schemat ma `payments.status = REFUNDED` i typy księgi `REFUND` i `ADJUSTMENT`. Nie ma:
- kwoty zwróconej ani listy zwrotów, więc zwrot częściowy i drugi zwrot są niemożliwe;
- powodu przy wpisie w księdze;
- sposobu na zwrot salda portfela na kartę.

## Rozważane opcje

1. **Kolumna `payments.refunded_amount`.** Prosta, ale tylko dla przejazdów kartą: przejazd z portfela nie ma płatności. Nie ma też historii zwrotów ani powodu.
2. **Tabela zwrotów** dla obu źródeł, z kwotą, powodem, operatorem, stanem i identyfikatorem u operatora płatności; suma zwrotów przejazdu pilnowana w bazie.

## Decyzja

**Opcja 2.** Szczegóły:

- **Tabela `refunds`** (migracja 0007) z kolumnami:
  - `rental_id` albo `payment_id` doładowania;
  - `source` (`WALLET`, `CARD`);
  - `amount` (dodatnia, w groszach);
  - `reason`: zwrot za przejazd `SCOOTER_FAILURE`, `BILLING_ERROR`, `CUSTOMER_COMPLAINT`, `OTHER`; zwrot salda `BALANCE_PAYOUT`;
  - `note` (wymagana przy `OTHER`), `staff_id`;
  - `status` (`PENDING`, `SUCCEEDED`, `FAILED`), `provider_refund_id`, czas.

  Procedura `sp_record_refund` z blokadą przejazdu albo płatności odrzuca sumę zwrotów większą niż zapłacona kwota (`REFUND_EXCEEDS_PAYMENT`).
- **Zwrot za przejazd z portfela:** w jednej transakcji `refunds` (`SUCCEEDED`), wpis `REFUND` z kwotą dodatnią w księdze (`sp_wallet_post`) i korekta paragonu ([ADR 0052](0052-paragony.md)). Klient od razu widzi saldo (`wallet.updated`).
- **Zwrot za przejazd kartą:**
  - `refunds` (`PENDING`) i zwrot u operatora z kluczem idempotencji z identyfikatora zwrotu ([ADR 0050](0050-integracja-stripe.md));
  - webhook `refund.updated` albo `charge.refunded` zmienia stan zwrotu;
  - przy sukcesie: korekta paragonu i `payments.status = REFUNDED`, gdy zwrócono całość (częściowy zwrot zostawia `SUCCEEDED` z sumą zwrotów w widoku).
- **Uprawnienia:**
  - zwrot za przejazd: `rentals.manage` (Dyspozytor i Administrator, jak zdalne zakończenie);
  - korekta salda i zwrot salda: `wallet.adjust` (Administrator).
- **Korekta salda** (`POST /admin/users/{id}/wallet/adjustments`): wpis `ADJUSTMENT` z kwotą ze znakiem, nową kolumną `wallet_ledger.reason` (`COMPLAINT`, `SYSTEM_ERROR`, `GOODWILL`, `OTHER`) i notatką, wymaganą przy `OTHER`.
  - Bez limitu kwoty; saldo po korekcie może być ujemne.
  - Etykieta powodu jest widoczna dla klienta w historii portfela, a notatka tylko w panelu i w dzienniku audytu.
- **Zwrot salda na kartę** (przed usunięciem konta albo na prośbę klienta, `POST /admin/users/{id}/wallet/payout`):
  - zwroty u operatora z ostatnich udanych doładowań, od najnowszego, aż do kwoty salda (każdy najwyżej do kwoty doładowania);
  - wpis w księdze nowego typu `PAYOUT` z kwotą ujemną przy zleceniu;
  - przy odmowie u operatora wpis odwracający `PAYOUT` z kwotą dodatnią i notatką;
  - pozostałą część (doładowania sprzed limitu czasu zwrotu u operatora) operator rozlicza korektą z powodem `OTHER` i notatką.
- **Dziennik audytu:** każda operacja ma wpis w tej samej transakcji: `rental.refunded`, `wallet.adjusted`, `wallet.paid_out`. Wpis zawiera kwotę, powód, notatkę i źródło.
- **Panel** (D5): zwrot tylko ze szczegółów przejazdu, korekta i zwrot salda z karty klienta; listy płatności i księgi tylko do odczytu.

## Konsekwencje

Pozytywne:

- Zwroty częściowe i wielokrotne mają ślad z powodem i operatorem; baza nie pozwala zwrócić więcej, niż zapłacono.
- Saldo zawsze wynika z księgi, także po zwrotach na kartę; usunięcie konta ma drogę do salda 0.
- Klient widzi, dlaczego saldo się zmieniło, a szczegóły wewnętrzne zostają w panelu.

Negatywne i ryzyka:

- Nowy typ księgi `PAYOUT` i wpis odwracający przy nieudanym zwrocie komplikują historię portfela. Dopuszczalne, bo przypadek jest rzadki i jawny.
- Zwrot na kartę zależy od operatora i jego terminów; w trybie testowym działa od razu.

## Powiązane

[ADR 0014](0014-kwoty-w-groszach-portfel-ksiega.md), [ADR 0028](0028-uzytkownicy-role-uprawnienia.md), [ADR 0049](0049-rozliczenie-przejazdu.md), [ADR 0050](0050-integracja-stripe.md), [ADR 0052](0052-paragony.md), makiety `25-panel-platnosci/przejazd-zwrot`, `korekta-salda`, `klient-portfel`, [plan iteracji 5](../iteracje/iteracja-05-platnosci.md) (pytania 9–11, D5)
