# ADR 0075: Dane historyczne do demonstracji

- **Status:** zaakceptowana
- **Data:** 2026-11-19

## Kontekst

Raporty ([ADR 0071](0071-modul-raportow.md)) i wykresy pulpitu potrzebują kilku miesięcy danych, a baza deweloperska ma kilka przejazdów z przeklikania. Autor przyjął pytanie 12: generator historii za 90 dni (ok. 150–250 przejazdów na dobę z rytmem dobowym i tygodniowym, trasy między strefami Rybnika, płatności, paragony, zwroty, zgłoszenia, zadania z częściami, historia stanów), ręczny (`pnpm db:history`), deterministyczny, przez procedury bazy, z danymi do usunięcia i zablokowany w produkcji. Ten sam generator posłuży testom obciążeniowym w iteracji 9 (D8).

Sprawdzone w kodzie 19 listopada 2026:
- `sp_wallet_post` i `sp_issue_receipt` stemplują wpisy czasem `now()`, czyli czasem transakcji, którego nie da się cofnąć. Wpis z datą sprzed 30 dni przez procedurę trzeba by potem przestawić aktualizacją, a wyzwalacz `trg_wallet_ledger_rules` odrzuca każdą aktualizację i usunięcie (`LEDGER_APPEND_ONLY`). Tak samo działają ruchy magazynowe i niezmienne paragony;
- wyzwalacz księgi sprawdza tylko ciągłość salda (`balance_after` = poprzednie saldo + kwota), więc wstawienie wpisów w kolejności czasu z jawnym `created_at` przechodzi przez te same reguły;
- numer paragonu to `PAR/{rok z now()}/` z globalnej sekwencji `receipt_number_seq`;
- seed wstawia pierwszą wersję cennika z `valid_from = now()`, więc przejazd sprzed seeda nie ma obowiązującej wersji;
- seed tworzy flotę o zadanej wielkości (`fleetSize`) w modelu `BASE`.

## Rozważane opcje

1. **Procedury, a potem przestawienie czasów** z wyłączonymi wyzwalaczami (`session_replication_role = replica`). Procedury liczą wszystko same, ale wyłączenie wyzwalaczy wyłącza też klucze obce i reguły, które generator ma sprawdzać, i wymaga superużytkownika.
2. **Wstawianie wierszy z jawnymi czasami, z wartościami z `packages/core`**, w kolejności czasu. Wycena przejazdu, pozycje paragonu z VAT „w stu” i salda liczy ten sam kod co API, a wyzwalacze bazy (ciągłość salda, tylko do dopisywania, geometria, stany) działają bez zmian.
3. **Symulacja w czasie rzeczywistym** przez API i symulator. Najwierniejsza, ale 90 dni trwa 90 dni.

Usuwanie danych:

1. **Oznaczenie i usunięcie wygenerowanych wierszy.** Księga, paragony, ruchy magazynowe i dziennik audytu są tylko do dopisywania, więc usunięcie wymagałoby obchodzenia tych samych reguł, które projekt pokazuje na obronie.
2. **Nowa baza.** Generator działa na świeżej bazie, a „usunięcie” to odtworzenie bazy (migracje i seed).

## Decyzja

Opcja 2 w obu sprawach. Usuwanie przez nową bazę zmienia odpowiedź na pytanie 12 („z oznaczeniem danych do usunięcia”) z powodu reguł tylko do dopisywania.

- **Polecenie:** `pnpm db:history [--days 90] [--rides-per-day 200] [--seed 2026]` w `packages/db/src/cli`.
- **Blokady:**
  - kończy się błędem przy `NODE_ENV=production`;
  - kończy się błędem, gdy w bazie są przejazdy albo paragony spoza danych startowych, bo numery paragonów muszą rosnąć z datą wystawienia;
  - generator jest tylko dla bazy deweloperskiej i bazy demonstracyjnej na obronę.
- **Cennik:** jeśli najstarsza wersja nie ma przejazdów, generator przesuwa jej `valid_from` na początek okna. W przeciwnym razie kończy się błędem. Regułę wyzwalacza wersji cennika sprawdzamy przy implementacji.
- **Losowość:** deterministyczny generator liczb (np. mulberry32) z ziarna, więc ten sam przebieg daje te same dane i te same liczby w raportach na obronie.
- **Rozkład:**
  - rytm dobowy ze szczytami rano i po 15:00, weekend z późniejszym szczytem, różnice tygodniowe;
  - start w pobliżu strefy parkowania, koniec w strefie parkowania (kilka promili poza strefą z odholowaniem);
  - trasa jako łamana między punktami stref Rybnika, dystans z długości łamanej;
  - część przejazdów przez strefę wolnej jazdy i rzadkie wjazdy do strefy zakazu;
  - zdarzenia `rental_events` (stany, wjazdy i wyjazdy ze stref).
- **Pieniądze:**
  - wycena funkcją z core według wersji cennika z chwili startu;
  - płatność z portfela albo kartą;
  - doładowania kartą i BLIK-iem;
  - paragon z pozycjami z core (z jawnym `issued_at`, numer z sekwencji);
  - wpisy księgi w kolejności czasu z `balance_after`;
  - kilka zwrotów, korekt i zaległości.
- **Serwis:**
  - zgłoszenia klientów i automatyczne według kategorii;
  - zadania z częściami (ruchy magazynowe z jawnym czasem);
  - przedziały historii stanów ([ADR 0074](0074-historia-stanow-hulajnogi.md)), spójne z przejazdami i serwisem.
- **Klienci:** wygenerowani klienci z numerami z zakresu niewydawanego w Polsce i zgodami na bieżące wersje dokumentów. Rejestracje są rozłożone w oknie, więc raport kohort ma dane.
- **Czego nie generuje:** telemetrii (partycje i wolumen; raporty jej nie używają), powiadomień i wydruków.
- **Zapis:** partiami po dniu symulacji, jedna transakcja na dzień. Na końcu kontrola spójności: saldo portfeli z księgi, suma paragonów wobec przejazdów i doładowań, jeden otwarty przedział historii na hulajnogę. Cel: 90 dni w mniej niż 2 min (do zmierzenia przy implementacji).
- **Test bazy:** generator na 3 dniach i kontrola spójności w `packages/db`.

## Konsekwencje

Pozytywne:

- Raporty, wykresy pulpitu i historia stanów mają na obronie wiarygodne i powtarzalne dane.
- Te same wyzwalacze i reguły core pilnują danych generatora i danych z API, więc generator jest dodatkowym testem spójności bazy.
- Gotowe dane do testów obciążeniowych w iteracji 9.

Negatywne i ryzyka:

- Generator powiela część przepływów API (kolejność wpisów, stany) poza modułami API; zmiana procesu wymaga zmiany generatora. Kontrola spójności na końcu i test bazy to wychwytują.
- Danych nie da się usunąć selektywnie; potrzebna jest nowa baza (migracje i seed od zera).
- Pomija procedury `sp_wallet_post` i `sp_issue_receipt`, więc ich logika (np. blokada portfela) nie jest w generatorze ćwiczona; testy API i bazy dalej ją pokrywają.

## Powiązane

[ADR 0014](0014-kwoty-w-groszach-portfel-ksiega.md), [ADR 0015](0015-wersjonowany-cennik.md), [ADR 0042](0042-wycena-przejazdu.md), [ADR 0052](0052-paragony.md), [ADR 0071](0071-modul-raportow.md), [ADR 0074](0074-historia-stanow-hulajnogi.md), [plan iteracji 8](../iteracje/iteracja-08-raporty-domkniecie-panelu.md) (pytanie 12, D8)
