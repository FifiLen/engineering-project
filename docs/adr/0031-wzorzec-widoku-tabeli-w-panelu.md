# ADR 0031: Wspólny wzorzec widoku tabeli w panelu i kontrakt list w API

- **Status:** proponowana
- **Data:** 2026-11-16

## Kontekst

Punkt 12 wymagań uczelni: dodawanie, edycja, usuwanie, wyświetlanie, filtrowanie i sortowanie dla wszystkich tabel. Po migracji 0002 baza będzie miała ok. 38 tabel ([ADR 0026](0026-logika-w-bazie-widoki-funkcje-procedury.md)). Pisanie każdej listy, filtrów, sortowania i formularza od zera to dużo powtórzonego kodu i ryzyko, że ekrany będą działały różnie.

Siły przeciwne:

- Nie każda tabela może mieć zwykłe „edytuj” i „usuń”. Księga portfela jest tylko do dopisywania ([ADR 0014](0014-kwoty-w-groszach-portfel-ksiega.md)), cennik jest wersjonowany ([ADR 0015](0015-wersjonowany-cennik.md)), przejazd zmienia się tylko przez przejścia maszyny stanów ([ADR 0013](0013-rezerwacja-jako-stan-przejazdu.md)), a hulajnogi i strefy są wskazywane przez historię przejazdów.
- Zapis musi przechodzić przez reguły z `packages/core` ([ADR 0025](0025-logika-biznesowa-packages-core.md)), a moduł nie czyta tabel innego modułu ([ADR 0003](0003-monolit-modularny.md)).
- Niektóre kolumny nie mogą trafić do panelu (`staff.password_hash`, `staff.totp_secret_enc`, skróty kodów i tokenów).
- Makiety panelu (np. [Flota](../projekt/ekrany/13-panel/admin-flota.png)) mają już ustalony układ: wyszukiwarka, szybkie filtry statusu z licznikami, filtr dodatkowy, zaznaczanie wierszy, stronicowanie „1–10 z 240” i eksport.

Pytanie 4 do prowadzącego dotyczy tego, czy tabele tylko do dopisywania mogą mieć ograniczone operacje.

## Rozważane opcje

1. **Osobne ekrany i punkty API pisane ręcznie dla każdej tabeli**. Pełna swoboda, ale kilkadziesiąt kopii tej samej logiki filtrowania i stronicowania.
2. **Generyczny CRUD na tabelach** (panel administracyjny generowany ze schematu, np. AdminJS albo własny mechanizm na Drizzle). Szybko pokrywa wszystkie tabele, ale zapisuje z pominięciem core, łamie granice modułów, domyślnie pokazuje wszystkie kolumny i nie zna reguł (księga, wersje cennika, stany przejazdu).
3. **Deklaratywne definicje zasobów**. Każdy moduł opisuje zasób panelu: kolumny listy, dozwolone filtry i sortowania, schemat formularza i dozwolone operacje. Wspólny mechanizm obsługuje odczyt list, a zapisy idą przez polecenia modułu w core.

## Decyzja

Opcja 3.

**Definicja zasobu** w `packages/shared` (część kontraktu API, [ADR 0004](0004-niezalezni-klienci-wspolny-kontrakt.md)): nazwa, źródło listy (widok `v_*` lub tabela), lista kolumn z typami, filtry z dozwolonymi operatorami, klucze sortowania, sortowanie domyślne, schematy Zod formularzy tworzenia i edycji, tryb usuwania i wymagane uprawnienia. Kolumny spoza definicji nie istnieją dla panelu, więc nowa kolumna z wrażliwymi danymi nie wycieknie sama. Etykiety i opisy pól pochodzą z katalogu tekstów pod kluczami `resource.<zasób>.<pole>` ([ADR 0027](0027-tresci-sterowane-z-panelu.md)).

**Kontrakt listy**: `GET /admin/<zasób>`

| Parametr | Przykład | Znaczenie |
|---|---|---|
| `q` | `q=0142` | wyszukiwanie po polach wskazanych w definicji |
| `<pole>` | `status=AVAILABLE,IN_USE` | równość lub lista wartości |
| `<pole>.gte`, `<pole>.lte` | `createdAt.gte=2026-11-01` | zakres dat i liczb |
| `<pole>.contains` | `name.contains=kow` | fragment tekstu bez względu na wielkość liter |
| `sort` | `sort=-lastSeenAt,number` | klucze rosnąco, `-` malejąco |
| `page`, `pageSize` | `page=2&pageSize=25` | stronicowanie, `pageSize` najwyżej 100 |
| `facets` | `facets=status` | liczniki dla szybkich filtrów |

Odpowiedź: `{ items, page, pageSize, total, facets }`. Parametry są płaskie, więc nie potrzeba parsera nawiasów w zapytaniu. Nieznany filtr, operator lub klucz sortowania kończy się błędem `VALIDATION_ERROR` w formacie z [§8.8](../arc42/08-koncepcje-przekrojowe.md). Do każdego sortowania dodawany jest identyfikator, żeby kolejność stron była stabilna. Zapytanie buduje wspólny mechanizm w `packages/db` z białej listy z definicji, a nie z nazw przesłanych przez klienta.

Tabele bardzo duże i rosnące w czasie (`telemetry`, `audit_log`, `rental_events`) mają stronicowanie kursorem i obowiązkowy zakres czasu; liczba wszystkich wierszy nie jest tam liczona.

**Zapisy**: `POST /admin/<zasób>`, `PATCH /admin/<zasób>/:id`, `DELETE /admin/<zasób>/:id` oraz polecenia domenowe `POST /admin/<zasób>/:id/<polecenie>` (np. `scooters/:id/commands`, `rentals/:id/end`). Kontroler waliduje dane schematem z definicji, a następnie wywołuje polecenie modułu z core; nie ma generycznego zapisu do tabeli. Tabele edytowalne dostają w migracji 0002 kolumnę `version`; edycja wymaga zgodnej wersji, a konflikt dwóch operatorów kończy się błędem `CONFLICT`. Każdy zapis trafia do `audit_log`.

**Klasy tabel i operacje** (odpowiedź na punkt 12 przy założeniu z pytania 4):

| Klasa | Przykłady | Dodaj | Edytuj | Usuń |
|---|---|---|---|---|
| Słowniki i konfiguracja | `zones`, `roles`, `ui_texts`, `faq_items`, `news`, `document_templates`, `report_definitions` | tak | tak | tak, jeśli nic się nie odwołuje; inaczej archiwizacja |
| Wersjonowane | `tariffs`, `content_pages`, `document_template_versions` | nowa wersja | nowa wersja | wycofanie wersji |
| Encje operacyjne | `scooters`, `staff`, `users`, `tickets` | tak | tak, przez reguły core | archiwizacja lub dezaktywacja |
| Procesy | `rentals`, `payments`, `scooter_commands` | przez proces | polecenia domenowe (np. zakończenie przejazdu, zwrot) | nie |
| Tylko do dopisywania | `wallet_ledger`, `audit_log`, `telemetry`, `rental_events`, `payment_webhook_events` | korekta jako nowy wpis (`wallet_ledger`) albo tylko system | nie | nie; telemetria wygasa z partycjami |
| Techniczne | `sessions`, `push_tokens`, `otp_codes` | nie | nie | unieważnienie |

Wszystkie tabele mają listę z filtrowaniem i sortowaniem oraz widok szczegółów. Pełna macierz zasobów, operacji i uprawnień powstanie razem z migracją 0002 w dokumentacji modelu danych. Tabele infrastruktury (`schema_migrations`, tabele pg-boss) nie są danymi biznesowymi i nie mają ekranów.

**Panel**: jeden komponent listy i jeden komponent formularza sterowane definicją zasobu, zgodne z makietą Flota:

- wyszukiwarka, szybkie filtry z licznikami (`facets`), panel filtrów dodatkowych, nagłówki z sortowaniem (`aria-sort`), stronicowanie;
- stan listy (filtry, sortowanie, strona) zapisany w adresie URL, więc działa „wstecz”, odświeżenie i udostępnienie odnośnika;
- zaznaczanie wierszy i operacje grupowe z potwierdzeniem;
- stany: ładowanie, pusta lista, brak wyników dla filtrów, błąd;
- eksport bieżącego widoku do XLSX i CSV przez mechanizm z [ADR 0029](0029-raporty-pdf-xlsx.md);
- formularz walidowany tym samym schematem Zod co API, błędy przy polach;
- przyciski operacji widoczne według uprawnień `<zasób>.read`, `.write`, `.delete` ([ADR 0028](0028-uzytkownicy-role-uprawnienia.md)).

Ekrany z makiet (np. karta hulajnogi, mapa floty, edytor stref) zostają indywidualne; wzorzec obsługuje ich listy i formularze, a nie zastępuje ekranów szczegółów.

## Konsekwencje

Pozytywne:

- Punkt 12 spełniony dla wszystkich tabel jednym, przetestowanym mechanizmem; każda tabela ma działającą listę, filtry i sortowanie.
- Zapisy dalej przechodzą przez reguły domeny, więc ograniczenia z wcześniejszych ADR-ów zostają zachowane.
- Spójne zachowanie wszystkich list ułatwia spełnienie punktów 15 i 16; każdy zasób to co najmniej lista, szczegóły i formularz (punkt 14).
- Biała lista kolumn, filtrów i sortowań chroni przed wyciekiem danych i wstrzyknięciem SQL.

Negatywne i ryzyka:

- Definicja zasobu jest dodatkowym kodem dla każdej tabeli, choć krótszym niż ręczny ekran.
- Mechanizm generyczny może nie pasować do nietypowych list; wtedy zasób dostaje własny ekran, a kontrakt listy zostaje ten sam.
- Filtry i sortowania po kolumnach bez indeksów mogą być wolne; każdą definicję sprawdzamy `EXPLAIN` na danych startowych i dodajemy indeksy w migracjach.
- Makieta Flota pokazuje eksport tylko do CSV; dodanie XLSX to odstępstwo, które zapiszemy w dzienniku przy implementacji.
- Klasy tabel zależą od odpowiedzi na pytanie 4; jeśli prowadzący wymaga pełnej edycji wszędzie, decyzję zmieni nowy ADR.

## Powiązane

[ADR 0003](0003-monolit-modularny.md), [ADR 0004](0004-niezalezni-klienci-wspolny-kontrakt.md), [ADR 0013](0013-rezerwacja-jako-stan-przejazdu.md), [ADR 0014](0014-kwoty-w-groszach-portfel-ksiega.md), [ADR 0015](0015-wersjonowany-cennik.md), [ADR 0025](0025-logika-biznesowa-packages-core.md), [ADR 0026](0026-logika-w-bazie-widoki-funkcje-procedury.md), [ADR 0027](0027-tresci-sterowane-z-panelu.md), [ADR 0028](0028-uzytkownicy-role-uprawnienia.md), [ADR 0029](0029-raporty-pdf-xlsx.md), [§8.8](../arc42/08-koncepcje-przekrojowe.md), [wymagania uczelni](../wymagania-uczelni.md) (punkty 12, 14, 16, pytanie 4)
