# Iteracja 5: płatności

**Status:** plan (17 listopada 2026); decyzje autora przyjęte 17 listopada 2026 ([odpowiedzi](#odpowiedzi-autora-17-listopada-2026)); makiety gotowe 17 listopada 2026; czeka na konto Stripe (autor) i ADR 0049–0054

## Cel
Klient dodaje kartę, doładowuje portfel kartą albo BLIK-iem i płaci za przejazd z portfela albo kartą. Pieniądze trafiają do portfela dopiero po zweryfikowanym webhooku operatora płatności ([ADR 0018](../adr/0018-platnosci-stripe.md)), a każdy ruch środków to wpis w księdze ([ADR 0014](../adr/0014-kwoty-w-groszach-portfel-ksiega.md)). Zakończony przejazd jest obciążany kwotą wyliczoną w iteracji 3 ([ADR 0042](../adr/0042-wycena-przejazdu.md)), a klient dostaje paragon. Nieudana płatność kartą zostawia przejazd w stanie `UNPAID`, co blokuje kolejną jazdę do spłaty. Operator w panelu tworzy nowe wersje cennika ([ADR 0015](../adr/0015-wersjonowany-cennik.md)), przegląda płatności, księgę i paragony, koryguje saldo i zwraca pieniądze za przejazd.

Granice z sąsiednimi iteracjami:
- **Iteracja 6:**
  - powiadomienia push o paragonie i nieudanej płatności (preferencja `notify_receipts` jest w bazie od iteracji 3);
  - opłata za odholowanie hulajnogi przez serwis (według pytania 7);
  - zgłoszenia i reklamacje klientów.
- **Iteracja 7:** paragon jako plik PDF z szablonu i „Pobierz moje dane”.
- **Iteracja 8:** raport przychodów (`v_daily_revenue`) z eksportem PDF i XLSX.

Wymagania uczelni:
- **12:** w panelu `tariffs` (nowa wersja zamiast edycji), `payments`, `wallet_ledger`, `wallets`, `receipts` z pozycjami, `payment_methods` i `payment_webhook_events` według [macierzy operacji](../model-danych/README.md#operacje-w-panelu-dla-każdej-tabeli).
- **13:** proces doładowania i rozliczenia przejazdu domyka proces wypożyczenia.
- **14:** ekrany portfela, metod płatności, cennika i paragonu w aplikacji; cennik, płatności i korekty w panelu.
- **3c:** reguły rozliczenia, minimalnego salda i zwrotów w `packages/core`.

## Stan wyjściowy
- **Baza (migracje 0001, 0002 i 0005):**
  - tabele `tariffs`, `wallets`, `wallet_ledger` (tylko do dopisywania, `balance_after`), `payments` (`idempotency_key`, `provider_payment_id`), `payment_methods` (token, marka, cztery cyfry, jedna domyślna), `payment_webhook_events` (`provider_event_id` unikalny), `receipts` z numeracją `PAR/RRRR/NNNNNN` i `receipt_items` ze stawką VAT;
  - typy `payment_source` (`WALLET`, `CARD`) w przejeździe, `ledger_entry_type` (`TOPUP`, `RIDE_CHARGE`, `REFUND`, `ADJUSTMENT`), `payment_status` (`PENDING`, `SUCCEEDED`, `FAILED`, `REFUNDED`), `payment_method_kind` (`CARD`, `BLIK`);
  - indeks `wallet_ledger_one_charge_per_rental`;
  - widoki `v_wallet_balances` i `v_daily_revenue`, procedura `sp_rebuild_wallet_balances`, funkcja `fn_wallet_balance`;
  - portfel zakładany wyzwalaczem przy rejestracji (0005), saldo różne od 0 blokuje usunięcie konta (0005);
  - uprawnienia `tariffs.read`, `tariffs.write`, `payments.read`, `wallet.adjust`.
- **Stan przejazdu `UNPAID`:** jest w typie `rental_state` i na diagramie arc42 §6.1 (`ENDING → UNPAID`, `UNPAID → ENDED`), ale maszyna stanów w core go nie używa.
- **Core:** wycena `priceRental` i liczniki z osi czasu (ADR 0042). `RentalView.settlement` ma zawsze `PENDING`.
- **Aplikacja i panel:**
  - profil pokazuje saldo, a „Metody płatności” są ukryte;
  - podsumowanie przejazdu pokazuje kwotę bez obciążenia (`podsumowanie-bez-platnosci`);
  - karta klienta w panelu pokazuje saldo bez korekty.
- **Dane startowe:**
  - jedna wersja cennika z wartościami deweloperskimi (`DEV_TARIFF`): odblokowanie 3,00 zł, minuta 0,80 zł, pauza 0,30 zł, poza strefą 20,00 zł, minimalne saldo 10,00 zł;
  - przykładowe przejazdy z kwotą, ale bez obciążenia.
- **Rozjazdy w makietach:**
  - `admin-cennik` ma pole „Limit w strefie wolnej jazdy”, a od iteracji 4 limit należy do strefy;
  - `platnosci-cennik` i `admin-cennik` opisują opłatę „poza strefą” jako doliczaną przy odholowaniu, a plan iteracji 3 (pytanie 6) jako możliwość zakończenia poza strefą za opłatą.

## Warunek wstępny: decyzje, konto testowe i makiety
Zanim zacznie się implementacja:
- autor odpowiada na [pytania](#pytania-do-autora-wartości-biznesowe) i [decyzje](#decyzje-do-potwierdzenia) poniżej;
- autor zakłada konto Stripe w trybie testowym i wpisuje klucze testowe do `.env` (`STRIPE_SECRET_KEY`, `STRIPE_PUBLISHABLE_KEY`, `STRIPE_WEBHOOK_SECRET`). Kluczy nie ma w repozytorium. Do lokalnych webhooków służy Stripe CLI (`stripe listen`), które autor instaluje i loguje sam. Bez kluczy działa atrapa operatora (D1);
- brakujące stany dostają makiety w `docs/projekt/ekrany/` według [design systemu](../projekt/design-system.md). Proponowane katalogi: `24-mobile-platnosci` i `25-panel-platnosci`.

Istniejące makiety, z których korzysta iteracja:

| Obszar | Makiety |
|---|---|
| Aplikacja: portfel | `02-mobile-przeplyw/flow-portfel` (saldo, kwoty 20/50/100, metoda płatności, historia), `07-mobile-platnosci/platnosci-portfel-pusty`, `platnosci-karta`, `platnosci-blik`, `platnosci-cennik` |
| Aplikacja: przejazd | `07-mobile-platnosci/platnosci-brak-srodkow` („Doładuj portfel”, „Płać kartą za przejazd”), `02-mobile-przeplyw/flow-podsumowanie` („Zapłacono z: Portfel”), `08-mobile-stany/stan-platnosc` (nieudana płatność kartą) |
| Panel | `13-panel/admin-cennik` (formularz cennika z podglądem), `18-panel-dostep/dostep-klient` (karta klienta z saldem), `21-panel-przejazdy/przejazd-szczegoly` (kwota i płatność), `17-panel-wzorce/*` |
| Techniczne | `15-techniczne/tech-doladowanie` (doładowanie z webhookiem i sprawdzeniem statusu po 2 min), `tech-koniec` (rozliczenie przy zakończeniu, karta i `UNPAID`) |

Brakujące makiety (gotowe 17 listopada 2026: [`24-mobile-platnosci`, `25-panel-platnosci`](../projekt/README.md#aplikacja-płatności-iteracja-5), 18 plansz):

- [x] **Aplikacja: doładowanie w toku i wynik.** Oczekiwanie na potwierdzenie w banku (BLIK) albo 3-D Secure (karta), sukces z nowym saldem, odmowa i przekroczenie czasu. Kwota własna obok 20/50/100 według pytania 3.
- [x] **Aplikacja: metody płatności w profilu.** Lista kart z domyślną, usunięcie karty, dodanie karty; ostrzeżenie przy karcie wygasającej.
- [x] **Aplikacja: paragon.** Ekran paragonu z pozycjami (odblokowanie, minuty jazdy, minuty pauzy), stawką VAT, numerem i metodą płatności; wejście z podsumowania przejazdu i z historii portfela.
- [x] **Aplikacja: podsumowanie przejazdu po rozliczeniu.** Warianty `flow-podsumowanie`: z portfela, kartą, płatność kartą w toku, ujemne saldo według pytania 4.
- [x] **Aplikacja: zaległość `UNPAID` na mapie.** Karta z kwotą i „Zapłać teraz”, blokada startu (`stan-platnosc` jest ekranem po jeździe, a nie stanem mapy).
- [x] **Aplikacja: wybór źródła płatności przed startem.** Gdy klient ma kartę i za mało środków: „Płać kartą za przejazd” z `platnosci-brak-srodkow` prowadzi do potwierdzenia, a przejazd zapamiętuje źródło.
- [x] **Panel: cennik z wersjami.** Lista wersji z datą obowiązywania i autorem, nowa wersja z datą od teraz albo w przyszłości, porównanie z obowiązującą, bez pola limitu strefy. `admin-cennik` ma tylko jeden formularz.
- [x] **Panel: płatności i księga.** Listy według wzorca: płatności (status, cel, metoda, przejazd, klient), księga portfela klienta z saldem po operacji, paragony; szczegóły płatności z historią webhooków.
- [x] **Panel: korekta salda** na karcie klienta: kwota ze znakiem, powód, notatka, podgląd salda po korekcie, potwierdzenie.
- [x] **Panel: zwrot za przejazd** w szczegółach przejazdu: kwota (całość albo część), cel zwrotu (karta albo portfel według pytania 11), powód.

Stany, które nie wymagają nowych plansz:
- **Cennik w aplikacji:** `platnosci-cennik` z danymi z obowiązującej wersji.
- **Brak środków na start:** `platnosci-brak-srodkow`.
- **Nieudana płatność po jeździe:** `stan-platnosc`.
- **Webhooki w panelu:** tabela techniczna na wzorcu listy.

## Zakres
- [ ] **Migracja 0007** (`0007_payments.sql`, testy w `packages/db/src/db.test.ts`):
  - **rozliczenie przejazdu:**
    - `rentals.payment_id` albo powiązanie przez `payments.rental_id`;
    - stan rozliczenia przejazdu (z portfela, kartą w toku, opłacony, nieudany) w widoku;
    - przejście do `UNPAID` i z powrotem do `ENDED` zgodne z maszyną stanów (ADR 0049);
  - **reguły pilnowane przez bazę:**
    - jedno obciążenie za przejazd (indeks już jest);
    - jedna płatność `RIDE` w toku na przejazd;
    - saldo po operacji równe poprzedniemu plus kwota (wyzwalacz albo procedura zapisu do księgi, ADR 0049);
    - zwrot nie większy niż zapłacona kwota;
  - **procedury:**
    - zapis do księgi z blokadą portfela (`sp_wallet_post`: typ, kwota, przejazd, płatność, operator, notatka), z której korzystają doładowanie, obciążenie, zwrot i korekta;
    - wystawienie paragonu z pozycjami w transakcji obciążenia;
  - **widoki:**
    - lista płatności do panelu (klient, cel, metoda, status, przejazd, paragon);
    - księga z nazwą operatora korekty;
    - lista paragonów;
    - historia portfela w aplikacji (doładowania, przejazdy, zwroty, korekty z opisem);
    - lista wersji cennika z autorem i stanem (obowiązuje, zaplanowana, archiwalna);
  - **cennik:** obowiązująca wersja zależy od `valid_from` (zaplanowana wersja zaczyna obowiązywać sama); limit strefy nie jest polem cennika (D6);
  - **luki w schemacie wykryte przy makietach** (rozstrzyga ADR 0049, 0052 i 0054):
    - zwroty: tabela `payment_refunds` (kwota, powód, operator, identyfikator u operatora) albo `payments.refunded_amount`; bez tego nie ma częściowych i wielokrotnych zwrotów;
    - powód korekty i zwrotu w `wallet_ledger` (typ wyliczeniowy obok `note`);
    - `payment_webhook_events`: powiązanie z płatnością, wynik przetworzenia, licznik powtórzeń;
    - `receipts`: rodzaj dokumentu i korekta (`corrects_receipt_id`), sposób zapłaty dla przejazdu z portfela, dane sprzedawcy;
    - stawka VAT w wersji cennika albo w konfiguracji;
    - sprzeczność w macierzy: `payment_methods` z usunięciem w panelu a D5 (tylko do odczytu) — zostaje D5, macierz do poprawy;
  - **dane startowe:** portfele przykładowych klientów z doładowaniem i przejazdami rozliczonymi z portfela, według pytania 12;
  - po migracji `pnpm db:pull` i aktualizacja liczb w teście bazy oraz w [modelu danych](../model-danych/README.md).
- [ ] **`packages/core`** (`payments`, porty repozytoriów):
  - reguła startu: minimalne saldo z wersji cennika (`INSUFFICIENT_BALANCE` ze szczegółami: saldo, minimum) albo płatność kartą, gdy klient ma kartę i wybrał ją (pytanie 5); zaległość `UNPAID` blokuje start i rezerwację (`PAYMENT_OVERDUE`);
  - rozliczenie przy zakończeniu: obciążenie portfela kwotą z wyceny, saldo niewystarczające według pytania 4, płatność kartą według pytania 6; przejazd zerowy (zdalne zakończenie przed pierwszą minutą) bez obciążenia według ADR 0049;
  - doładowanie: kwoty dozwolone (pytanie 3), przejścia statusu płatności (`PENDING → SUCCEEDED|FAILED`, `SUCCEEDED → REFUNDED`), idempotencja po `provider_event_id` i `idempotency_key`;
  - zwrot i korekta: limity, wymagany powód, zwrot nie większy niż zapłata (pytania 10 i 11);
  - paragon: pozycje z wyceny (odblokowanie, minuty jazdy, minuty pauzy), stawka VAT i kwota netto według pytania 8, zaokrąglenia w groszach;
  - cennik: walidacja nowej wersji (kwoty nieujemne, data obowiązywania nie w przeszłości, minimalne saldo, próg baterii 0–100);
  - usunięcie konta: saldo dodatnie według pytania 9.
- [ ] **`packages/db`:**
  - repozytorium płatności: portfel, księga, płatności, metody płatności, webhooki, paragony;
  - repozytorium cennika: wersje, nowa wersja, obowiązująca na chwilę;
  - `ListSource` dla `tariffs`, `payments`, `wallet_ledger`, `receipts`, `payment_methods`, `payment_webhook_events`.
- [ ] **`packages/shared`:**
  - definicje zasobów panelu dla tabel z wymagania 12;
  - schematy doładowania, metody płatności, zwrotu, korekty i nowej wersji cennika;
  - widok portfela i paragonu dla aplikacji;
  - `RentalView.settlement` z prawdziwym stanem i metodą;
  - zdarzenia Socket.IO portfela (`wallet.updated` w pokoju `user:{id}`).
- [ ] **Kontrakty:**
  - [ ] [OpenAPI](../kontrakty/openapi.json): `pnpm api:openapi`;
  - [ ] [AsyncAPI Socket.IO](../kontrakty/asyncapi-realtime.yaml): `wallet.updated`, stan rozliczenia w `rental.updated`.
- [ ] **API:**
  - [ ] **operator płatności (ADR 0050):**
    - port `PaymentProvider` z implementacją Stripe i atrapą (D1);
    - zapisanie karty (SetupIntent), doładowanie (PaymentIntent kartą albo BLIK-iem), obciążenie zapisanej karty bez klienta przy aplikacji (off-session), zwrot;
    - webhook `POST /payments/webhooks/stripe` z weryfikacją podpisu na surowej treści żądania i zapisem w `payment_webhook_events` przed przetworzeniem;
    - zadanie pg-boss sprawdzające status płatności bez webhooka po 2 min (`tech-doladowanie`);
  - [ ] **klient (`@CustomerAuth`):**
    - portfel (saldo, historia), doładowanie, metody płatności (lista, dodanie, domyślna, usunięcie);
    - cennik (`GET /tariff`);
    - paragony (lista, szczegóły);
    - spłata zaległości (`POST /rentals/{id}/pay`);
    - źródło płatności przy starcie (`paymentSource` w `POST /rentals`);
  - [ ] **przejazd:**
    - rozliczenie w transakcji `ENDED` (portfel) albo zadanie obciążenia karty po `ENDED` (ADR 0049);
    - paragon po udanej płatności;
    - `wallet.updated` i `rental.updated` do klienta;
  - [ ] **panel:**
    - cennik: lista wersji, szczegóły, nowa wersja z `tariffs.write` i wpisem w dzienniku audytu;
    - listy płatności, księgi, paragonów, metod płatności i webhooków (`payments.read`);
    - korekta salda (`wallet.adjust`, `POST /admin/users/{id}/wallet/adjustments`);
    - zwrot (`rentals.manage`, `POST /admin/rentals/{id}/refund`);
    - każda operacja z wpisem w `audit_log` w tej samej transakcji;
  - [ ] **błędy** w formacie `{ code, message, details }`: `INSUFFICIENT_BALANCE`, `PAYMENT_OVERDUE`, `PAYMENT_METHOD_REQUIRED`, `PAYMENT_FAILED` (z powodem od operatora), `PAYMENT_PROVIDER_UNAVAILABLE`, `TOPUP_AMOUNT_INVALID`, `REFUND_EXCEEDS_PAYMENT`, `TARIFF_INVALID`, `WEBHOOK_SIGNATURE_INVALID`.
- [ ] **Panel:**
  - [ ] „Cennik i zasady”: lista wersji i nowa wersja według nowych makiet, podgląd jak w aplikacji, „Historia zmian” z dziennika;
  - [ ] „Płatności”: płatności, księga, paragony, webhooki na wzorcu listy, szczegóły płatności i paragonu;
  - [ ] karta klienta: saldo, księga klienta, korekta salda; szczegóły przejazdu: rozliczenie, paragon, zwrot; lista przejazdów: filtr „Nieopłacone” (`UNPAID`).
- [ ] **Aplikacja** (ADR 0051):
  - [ ] portfel (`flow-portfel`, pusty portfel), doładowanie kartą i BLIK-iem z oczekiwaniem i wynikiem, dodanie karty, metody płatności w profilu (odkrycie ukrytej pozycji z iteracji 3);
  - [ ] cennik (`platnosci-cennik`), brak środków na start, wybór karty za przejazd, zaległość na mapie i spłata, nieudana płatność;
  - [ ] podsumowanie przejazdu z rozliczeniem i paragon; historia portfela.
- [ ] **Dokumentacja:**
  - arc42: §6.4 (rozliczenie przy zakończeniu, karta, `UNPAID`), nowy przebieg doładowania (według `tech-doladowanie`), §5.2 (moduł Płatności), §8.4 (pieniądze, paragony, VAT), §11 (ryzyka: zależność od Stripe, webhooki lokalnie);
  - [model danych](../model-danych/README.md);
  - tabela zgodności w [wymaganiach uczelni](../wymagania-uczelni.md);
  - spis makiet w [`projekt/README.md`](../projekt/README.md).

## ADR-y do napisania
Numery są propozycją, ostatni ADR to 0048. Każdy ADR powstaje przed kodem, którego dotyczy.

| Nr | Temat | Co rozstrzyga |
|---|---|---|
| 0049 | Rozliczenie przejazdu | Moment obciążenia: w transakcji `ENDED` dla portfela, zadanie pg-boss po `ENDED` dla karty. Do tego:<ul><li>stan `UNPAID` w maszynie stanów (z `ENDED` czy z `ENDING`, jak na diagramie §6.1) i spłata;</li><li>saldo niewystarczające (pytanie 4);</li><li>minimalne saldo i wybór źródła przy starcie;</li><li>zapis do księgi przez procedurę z blokadą portfela;</li><li>przejazd o kwocie 0;</li><li>przejazdy z iteracji 3 i 4 bez obciążenia (pytanie 12).</li></ul>Uzupełnia [ADR 0042](../adr/0042-wycena-przejazdu.md). |
| 0050 | Integracja ze Stripe | Uzupełnia [ADR 0018](../adr/0018-platnosci-stripe.md):<ul><li>wersja biblioteki `stripe` (sprawdzona, starsza niż 3 dni);</li><li>SetupIntent i PaymentIntent, obciążenie off-session;</li><li>klucz idempotencji z identyfikatora płatności w bazie;</li><li>webhook z surową treścią żądania w Fastify i weryfikacją podpisu;</li><li>kolejność i powtórzenia zdarzeń;</li><li>sprawdzanie statusu bez webhooka;</li><li>atrapa operatora do testów, CI i demo bez sieci (D1);</li><li>BLIK w trybie testowym (D2);</li><li>klucze w `.env` i Stripe CLI.</li></ul> |
| 0051 | Płatności w aplikacji | Jak przy mapie ([ADR 0040](../adr/0040-mapa-lokalizacja-aparat-w-aplikacji.md)): natywny `@stripe/stripe-react-native` (development build) i Stripe.js w wersji web. Do tego wersje przez `expo install`, 3-D Secure, BLIK z oczekiwaniem na potwierdzenie w banku i powrót do aplikacji po przekierowaniu. |
| 0052 | Paragony | Dokument niefiskalny w projekcie (potwierdzenie sprzedaży) czy opis drogi do kasy fiskalnej online (pytanie 8). Do tego:<ul><li>kiedy powstaje paragon: przejazd z portfela, przejazd kartą, doładowanie;</li><li>stawka VAT i zaokrąglenia;</li><li>numeracja z `receipt_number_seq`;</li><li>dane nabywcy z chwili wystawienia;</li><li>korekta przy zwrocie;</li><li>plik PDF w iteracji 7.</li></ul> |
| 0053 | Wersje cennika w panelu | Nowa wersja zamiast edycji. Do tego:<ul><li>data obowiązywania od teraz albo w przyszłości;</li><li>która wersja obowiązuje przy rezerwacji, a która przy starcie (przejazd zapamiętuje wersję z rezerwacji, ADR 0013);</li><li>usunięcie zaplanowanej wersji;</li><li>podgląd jak w aplikacji;</li><li>limit strefy jako własność strefy (D6).</li></ul> |
| 0054 | Zwroty i korekty salda | Zwrot za przejazd na kartę (refund u operatora) albo do portfela (wpis `REFUND`) według pytania 11. Do tego:<ul><li>częściowy zwrot;</li><li>korekta `ADJUSTMENT` z powodem i limitem (pytanie 10);</li><li>zwrot salda przy usunięciu konta (pytanie 9);</li><li>uprawnienia `wallet.adjust` i `rentals.manage`;</li><li>dziennik audytu;</li><li>stan płatności `REFUNDED` przy częściowym zwrocie.</li></ul> |

## Odpowiedzi autora (17 listopada 2026)
Autor przyjął wszystkie rekomendacje D1–D8 i domyślne odpowiedzi na pytania. Ceny docelowe i marka zostają otwarte w `CLAUDE.md`; stawka VAT to wartość robocza do sprawdzenia przez autora.

| Pytanie | Odpowiedź |
|---|---|
| 1. Ceny | Zostają wartości deweloperskie z `DEV_TARIFF`; ceny docelowe to nowa wersja cennika w panelu. |
| 2. Minimalne saldo | 10,00 zł z wersji cennika, sprawdzane przy rezerwacji i przy starcie. Nie dotyczy przejazdu opłacanego kartą (pytanie 5). |
| 3. Doładowanie | 20, 50 i 100 zł z makiety oraz kwota własna 10–500 zł. |
| 4. Saldo niewystarczające na koniec | Saldo może spaść poniżej zera; ujemne saldo blokuje rezerwację i start do doładowania. |
| 5. Płatność kartą za przejazd | Tak, do wyboru przy starcie, gdy saldo jest poniżej minimum i klient ma kartę; z wystarczającym saldem domyślnie portfel. |
| 6. `UNPAID` | Blokuje rezerwację i start; spłata kartą (tą samą albo inną) albo z portfela; jedno automatyczne ponowienie po 24 h. |
| 7. Opłata „poza strefą” | Zakończenie poza strefą parkowania zostaje zablokowane; opłata dotyczy odholowania przez serwis w iteracji 6. W tej iteracji tylko pozycja w cenniku. |
| 8. Paragony i VAT | Paragon niefiskalny (potwierdzenie sprzedaży) za każdy rozliczony przejazd; doładowanie to przedpłata z potwierdzeniem bez VAT. VAT 23% jako wartość robocza, do sprawdzenia przez autora; w dokumentacji opis drogi do kasy fiskalnej online. |
| 9. Saldo przy usunięciu konta | Saldo różne od 0 dalej blokuje usunięcie; zwrot salda robi operator w panelu. |
| 10. Korekty salda | Tylko Administrator (`wallet.adjust`), powód z listy i notatka, bez limitu kwoty, wpis w dzienniku audytu. |
| 11. Zwrot za przejazd | Według źródła płatności przejazdu (karta u operatora, portfel wpisem `REFUND`), częściowy dozwolony, powód wymagany. |
| 12. Przejazdy z iteracji 3 i 4 | Zostają nierozliczone (stan rozliczenia „brak”), bez obciążenia wstecz; nowe przykładowe przejazdy w danych startowych są rozliczone z portfela. |

| Decyzja | Rozstrzygnięcie |
|---|---|
| D1 | Port `PaymentProvider`: Stripe w trybie testowym i atrapa w procesie (testy, CI, demo bez sieci); domyślnie atrapa, Stripe po wpisaniu kluczy. |
| D2 | BLIK przez Stripe, jeśli działa w trybie testowym dla PLN (sprawdzenie przy ADR 0050); w przeciwnym razie tylko w atrapie. |
| D3 | Stripe.js w wersji web, `@stripe/stripe-react-native` w development build; dane karty nie przechodzą przez nasze API. |
| D4 | Portfel obciążany w transakcji `ENDED`; karta zadaniem pg-boss po `ENDED` z kluczem idempotencji z przejazdu, wynik z webhooka. |
| D5 | Płatności, księga, paragony, metody płatności i webhooki tylko do odczytu; zwrot i korekta jako polecenia z dziennikiem audytu. |
| D6 | Pole „Limit w strefie wolnej jazdy” wypada z cennika (limit należy do strefy). |
| D7 | Paragon jako ekran w aplikacji i panelu; PDF w iteracji 7; bez e-maila. |
| D8 | Push o płatnościach w iteracji 6; teraz Socket.IO i stan w aplikacji. |

## Pytania do autora: wartości biznesowe
Otwarte decyzje z `CLAUDE.md` i nowe pytania tej iteracji. Seed ma wartości deweloperskie, a makiety pokazują nawiasy. Plan ich nie ustala.

1. **Ceny** (odblokowanie, minuta jazdy, minuta pauzy). Czy ustalamy je teraz, czy zostają wartości deweloperskie z `DEV_TARIFF` (3,00 zł, 0,80 zł, 0,30 zł), a ceny docelowe to tylko nowa wersja cennika w panelu?
2. **Minimalne saldo do startu** („[MINIMUM] zł”, seed: 10,00 zł). Czy obowiązuje też przy rezerwacji?
3. **Doładowanie:** kwoty 20, 50 i 100 zł z makiety. Czy dopuszczamy kwotę własną, a jeśli tak, w jakim zakresie? Rekomendacja: 10–500 zł.
4. **Saldo niewystarczające na koniec przejazdu.** Przejazd kosztował więcej, niż było w portfelu. Rekomendacja: saldo może spaść poniżej zera, a ujemne saldo blokuje kolejny start do doładowania. Alternatywa: brakująca część z zapisanej karty, a bez karty `UNPAID`.
5. **Płatność kartą za przejazd** („Płać kartą za przejazd” w `platnosci-brak-srodkow`). Czy klient może jeździć bez portfela, płacąc kartą po każdym przejeździe? Rekomendacja: tak, wybór przy starcie, gdy saldo jest poniżej minimum; z wystarczającym saldem domyślnie portfel.
6. **Nieudana płatność kartą (`UNPAID`).** Rekomendacja:
   - zaległość blokuje rezerwację i start;
   - spłata kartą (tą samą albo inną) albo z portfela;
   - jedno automatyczne ponowienie po 24 h.
7. **Opłata „poza strefą”** (`out_of_zone_fee`, seed: 20,00 zł). Makiety piszą „doliczane przy odholowaniu”, a plan iteracji 3 zakładał zakończenie poza strefą za opłatą. Rekomendacja: zakończenie poza strefą zostaje zablokowane, a opłata dotyczy odholowania przez serwis w iteracji 6. W tej iteracji tylko pokazujemy ją w cenniku.
8. **Paragony i VAT.** Jaka stawka VAT za wypożyczenie hulajnogi (do sprawdzenia przez autora; usługa wypożyczenia zwykle podlega stawce podstawowej)? Rekomendacja:
   - paragon niefiskalny (potwierdzenie sprzedaży) za każdy rozliczony przejazd;
   - doładowanie portfela jako przedpłata z potwierdzeniem bez VAT;
   - w dokumentacji opis drogi do kasy fiskalnej online.
9. **Saldo przy usunięciu konta** (iteracja 3: saldo różne od 0 blokuje usunięcie). Rekomendacja: zostaje blokada; klient zgłasza zwrot salda, a operator robi go w panelu (zwrot na kartę ostatnich doładowań albo korekta).
10. **Korekty salda.** Kto może korygować (dziś `wallet.adjust` ma tylko Administrator)? Czy jest limit kwoty jednej korekty? Rekomendacja: Administrator, powód z listy i notatka, bez limitu kwoty, każda korekta w dzienniku audytu.
11. **Zwrot za przejazd.** Na kartę (u operatora płatności), do portfela, czy według źródła płatności? Rekomendacja: według źródła płatności przejazdu, częściowy zwrot dozwolony, powód wymagany.
12. **Przejazdy z iteracji 3 i 4 bez obciążenia.** Rekomendacja: zostają jako nierozliczone przejazdy deweloperskie (stan rozliczenia „brak”), bez obciążenia wstecz; nowe przykładowe przejazdy w danych startowych są rozliczone z portfela.

## Decyzje do potwierdzenia
Rozstrzygnięcia zakresu z rekomendacją. Autor potwierdza albo zmienia.

- **D1. Atrapa operatora płatności.** Rekomendacja: port `PaymentProvider` z dwiema implementacjami: Stripe w trybie testowym (demo z prawdziwymi webhookami) i atrapa w procesie (testy, CI, demo bez internetu i bez kluczy). Atrapa wysyła te same zdarzenia przez ten sam punkt webhooka z podpisem atrapy, więc logika płatności działa tak samo. Domyślnie atrapa, Stripe po wpisaniu kluczy.
- **D2. BLIK.** Makiety mają BLIK obok karty. Rekomendacja: BLIK przez Stripe, jeśli jest dostępny w trybie testowym dla konta w PLN (sprawdzenie przy ADR 0050). Jeśli nie jest, BLIK zostaje w atrapie, a w wersji ze Stripe jest ukryty.
- **D3. Płatności w aplikacji:** dwie implementacje jak przy mapie (ADR 0040): Stripe.js w wersji web (podgląd w przeglądarce) i `@stripe/stripe-react-native` w development build. Dane karty nie przechodzą przez nasze API.
- **D4. Moment obciążenia:**
  - portfel: w tej samej transakcji co `ENDED` (pieniądze i stan przejazdu nie mogą się rozjechać);
  - karta: zadanie pg-boss po `ENDED` z kluczem idempotencji z przejazdu, wynik z webhooka;
  - przejazd od razu kończy się dla klienta, a podsumowanie pokazuje „płatność w toku”.
- **D5. Panel:** płatności, księga, paragony, metody płatności i webhooki tylko do odczytu na wzorcu listy. Zwrot i korekta to polecenia z kartą skutków i dziennikiem audytu, jak zdalne zakończenie w iteracji 3.
- **D6. Cennik bez limitu strefy:** pole „Limit w strefie wolnej jazdy” z `admin-cennik` wypada, bo od iteracji 4 limit należy do strefy (zakres 5–15 km/h). Pozostałe pola makiety zostają.
- **D7. Paragon w aplikacji i panelu jako ekran**, PDF w iteracji 7 (silnik dokumentów). E-mail z paragonem nie powstaje (brak dostawcy poczty, arc42 §11).
- **D8. Powiadomienia o płatnościach:** push w iteracji 6. W tej iteracji zdarzenia Socket.IO i stan w aplikacji po powrocie.

## Poza zakresem (świadomie)
- Push o paragonie i nieudanej płatności, opłata za odholowanie, reklamacje przez zgłoszenia: iteracja 6.
- Paragon PDF, „Pobierz moje dane”: iteracja 7.
- Raport przychodów z eksportem: iteracja 8.
- Prawdziwe pieniądze, kasa fiskalna, faktury VAT dla firm, subskrypcje i pakiety minut, kody promocyjne.

## Kolejność kroków
1. Odpowiedzi autora na pytania 1–12 i decyzje D1–D8; aktualizacja tego planu i, przy zmianie granic iteracji, [planu iteracji](README.md).
2. Konto Stripe w trybie testowym i klucze w `.env` (autor); do tego czasu praca na atrapie.
3. Makiety brakujących stanów z PNG obejrzanymi przed implementacją i wpisem w [spisie makiet](../projekt/README.md).
4. ADR 0049–0054 zaakceptowane przed kodem; przy ADR 0050 i 0051 sprawdzenie wersji bibliotek Stripe i dostępności BLIK.
5. Migracja 0007, `pnpm db:pull`, testy bazy: księga, jedno obciążenie, zwrot nie większy niż zapłata, paragon, wersje cennika.
6. `packages/core`: rozliczenie, minimalne saldo, zaległość, zwroty, korekty, paragon, cennik z testami jednostkowymi.
7. API: operator płatności (atrapa, potem Stripe), webhooki, doładowanie, metody płatności; testy API na atrapie, w tym powtórzony webhook i brak webhooka.
8. API: rozliczenie przejazdu, `UNPAID` i spłata, paragony; test przejazdu z portfelem, kartą, odmową i spłatą.
9. API panelu: cennik, listy płatności, korekta, zwrot; `pnpm api:openapi`.
10. Panel: cennik, płatności, karta klienta, przejazd.
11. Aplikacja: portfel, karta, doładowanie, cennik, brak środków, zaległość, podsumowanie i paragon.
12. Domknięcie:
    - arc42, model danych, wymagania uczelni, spis makiet, odstępstwa w dzienniku;
    - scenariusz demo przechodzi krok po kroku na atrapie i, jeśli są klucze, na Stripe;
    - `pnpm lint && pnpm typecheck && pnpm test && pnpm build`;
    - zielone CI.

## Scenariusz demo
Wymaga infrastruktury i danych startowych (`pnpm infra:up && pnpm db:migrate && pnpm db:places && pnpm db:seed`), panelu na `WEB_PORT=3002` i aplikacji (wersja web albo development build). Wariant Stripe wymaga kluczy testowych w `.env` i `stripe listen --forward-to localhost:3001/payments/webhooks/stripe`. Wartości w nawiasach zależą od odpowiedzi na pytania.

1. Panel → „Cennik i zasady”: obowiązująca wersja 1. Nowa wersja z minutą jazdy [CENA] zł od jutra; lista pokazuje ją jako zaplanowaną, a aplikacja dalej pokazuje cennik wersji 1.
2. Aplikacja, nowy klient: mapa → hulajnoga → „Odblokuj” → „Za mało środków na start” (saldo 0 zł, minimum [MINIMUM] zł).
3. „Doładuj portfel” → pusty portfel → „Karta” → dodanie karty testowej `4242 4242 4242 4242` → doładowanie 50 zł → oczekiwanie → webhook → saldo 50,00 zł na ekranie bez odświeżania. W panelu: płatność `SUCCEEDED`, wpis `TOPUP` w księdze, zdarzenie w webhookach.
4. Ten sam webhook wysłany drugi raz (Stripe CLI `stripe events resend` albo atrapa) nie zmienia salda.
5. Przejazd jak w iteracji 3, zakończenie w strefie: podsumowanie „Zapłacono z: Portfel”, saldo zmniejszone o kwotę z wyceny, paragon z pozycjami i VAT. W panelu: przejazd z rozliczeniem i paragonem, wpis `RIDE_CHARGE` z saldem po operacji.
6. Przejazd kartą odrzucaną (karta testowa z odmową): po zakończeniu „Płatność nie przeszła”, przejazd `UNPAID`, mapa pokazuje zaległość, a start nowego przejazdu jest odrzucony (`PAYMENT_OVERDUE`). „Zmień metodę płatności” → karta poprawna → spłata → przejazd `ENDED` z paragonem.
7. Panel → klient → „Korekta salda” +10,00 zł z powodem: nowy wpis `ADJUSTMENT` z operatorem, wpis w dzienniku audytu, aplikacja pokazuje nowe saldo.
8. Panel → przejazd z kroku 5 → „Zwrot” części kwoty do portfela (według pytania 11): wpis `REFUND`, saldo w aplikacji rośnie, drugi zwrot ponad zapłaconą kwotę jest odrzucony.
9. Serwisant (rola bez `payments.read`) nie widzi „Płatności”, a API zwraca 403; Dyspozytor widzi listy, ale nie ma korekty salda (`wallet.adjust`).
