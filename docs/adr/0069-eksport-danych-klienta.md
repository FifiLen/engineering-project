# ADR 0069: Eksport danych klienta

- **Status:** zaakceptowana
- **Data:** 2026-11-18

## Kontekst

„Pobierz moje dane” jest w ustawieniach aplikacji od makiet iteracji 2, ale zostało ukryte (D8 iteracji 3) i obiecane także w iteracji 5. Klient ma prawo dostępu do swoich danych i prawo do ich przenoszenia „w ustrukturyzowanym, powszechnie używanym formacie nadającym się do odczytu maszynowego” (RODO, art. 15 i 20).

Odpowiedź autora na pytanie 14 (18 listopada 2026): eksport w tej iteracji jako plik JSON generowany zadaniem, dostępny przez 7 dni z ustawień aplikacji, najwyżej jedno zlecenie na dobę, bez szablonu DOCX.

Plansze `31-mobile-tresci/moje-dane*` pokazują:
- zawartość: profil, zgody i ustawienia; przejazdy z trasami; portfel, płatności i paragony; zgłoszenia i odpowiedzi; wysłane powiadomienia;
- czas przygotowania „kilka minut”;
- plik `dane-2026-11-18.json` z rozmiarem i datą ważności;
- „Zapisz albo udostępnij”;
- komunikat „Nowy plik zlecisz jutro od 14:32”.

Z ustaleń: limit liczy się 24 h od zlecenia, nieudane zlecenie się nie liczy, a drugie zlecenie daje `DATA_EXPORT_LIMIT`.

Do rozstrzygnięcia zostały:
- kod powiadomienia;
- zdarzenie Socket.IO;
- miejsce w schemacie (`generated_documents.template_version_id` jest `NOT NULL`, a eksport nie ma szablonu);
- czy plik obejmuje zdjęcia.

Stan wyjściowy:
- telemetria (trasy) żyje 90 dni ([ADR 0037](0037-pg-boss-konfiguracja-i-zadania.md));
- zdjęcia parkowania żyją 30 dni ([ADR 0057](0057-pliki-zdjecia.md));
- usunięcie konta anonimizuje klienta (`sp_anonymize_user`, iteracja 3).

## Rozważane opcje

Format:

1. **JSON** z opisanym schematem. Odczytywalny maszynowo i mały, bez silnika dokumentów.
2. **ZIP z JSON i zdjęciami.** Pełniejszy, ale większy plik, rozpakowanie w aplikacji i zdjęcia z magazynu w zadaniu.
3. **PDF albo DOCX z szablonu.** Czytelny dla człowieka, ale nie nadaje się do przeniesienia, a autor go odrzucił.

Miejsce w schemacie:

1. **`generated_documents` z nowym rodzajem.** Jedna lista, ale inna retencja (7 dni zamiast 30), inny limit i brak szablonu, a lista wydruków operatora pokazywałaby dane klientów.
2. **Osobna tabela `data_exports`.** Własne reguły: limit, ważność, jedno zlecenie w toku.

Pobranie:

1. **Strumień z tokenem w nagłówku.** `File.downloadFileAsync` i nowa karta w przeglądarce nie wyślą nagłówka `Authorization`.
2. **Adres z podpisem HMAC na 10 min** wystawiany na żądanie (ADR 0057).

## Decyzja

Opcja 1 dla formatu, opcja 2 dla schematu i opcja 2 dla pobrania.

### Schemat (migracja 0011)

- **Cel pliku:** `ALTER TYPE file_purpose ADD VALUE 'DATA_EXPORT'`, nieużyty w tej samej transakcji.
- **Tabela `data_exports`:**
  - kolumny: `id`, `user_id`, `status` (`job_status`), `file_id`, `size_bytes`, `requested_at`, `started_at`, `finished_at`, `expires_at`, `error_code`, `deleted_at`;
  - `CHECK`: `SUCCEEDED` wymaga pliku i `expires_at`, a `FAILED` wymaga `error_code`;
  - indeks unikalny `(user_id) WHERE status IN ('QUEUED', 'RUNNING')`, czyli jedno zlecenie w toku;
  - indeks `(user_id, requested_at DESC)`.
- **Limit raz na 24 h:** procedura `sp_data_export_request(p_user_id) RETURNS uuid`.
  - Blokuje wiersz klienta (`FOR UPDATE`) i sprawdza ostatnie zlecenie bez `FAILED` z ostatnich 24 h.
  - Przy przekroczeniu zgłasza błąd z czasem następnego zlecenia, który API zamienia na `429 DATA_EXPORT_LIMIT` z `details.nextAllowedAt`.
  - Tę samą regułę ma core (`dataExportNextAllowedAt`), a test zgodności porównuje obie, jak przy powrocie do floty ([ADR 0055](0055-zgloszenia-i-proces-serwisowy.md)).

### API i zadanie

- **Punkty:**
  - `POST /me/data-exports` (`@CustomerAuth()`) wywołuje procedurę i w tej samej transakcji planuje zadanie `data-export.generate` (`sendInTransaction`, klucz singletonu równy identyfikatorowi zlecenia, do 2 ponowień). Zwraca `202` z widokiem zlecenia;
  - `GET /me/data-exports/latest` zwraca stan, rozmiar, `expiresAt` i `nextAllowedAt`. Przy gotowym i ważnym pliku dodaje adres `GET /files/{id}?exp&sig` z podpisem na 10 min, `Content-Disposition: attachment; filename="dane-RRRR-MM-DD.json"` i `Cache-Control: private, no-store`.
- **Zadanie:**
  - zbiera dane przez porty eksportu modułów (`exportForUser(userId)` w Kontach, Wypożyczeniach, Płatnościach, Operacjach i Powiadomieniach), więc żaden moduł nie czyta cudzych tabel ([ADR 0003](0003-monolit-modularny.md));
  - zapisuje plik `data-export/{rrrr}/{mm}/{uuid}.json` i ustawia `SUCCEEDED` z `expires_at = finished_at + 7 dni`;
  - w tej samej transakcji wstawia powiadomienie i emituje zdarzenie.

  Błąd daje `FAILED` z `error_code`, zdarzenie bez powiadomienia, i nie liczy się do limitu.
- **Powiadomienie `data_export_ready`** (rozstrzygnięcie): nowy kod w `NOTIFICATION_TEMPLATES` ([ADR 0058](0058-powiadomienia-push-z-szablonow.md)).
  - Kanał `PUSH`, parametr `expiresAt` (data sformatowana przez API), cel `/profil/dane`.
  - Zawsze wysyłane, bez preferencji, jak `battery_low`.
  - Wpis `QUEUED` z `dedupe_key = data_export_ready:{id}`, a szablon „Twoje dane są gotowe” w seedzie.
- **Zdarzenie Socket.IO `data-export.ready { id, status, sizeBytes, expiresAt }`** (rozstrzygnięcie, kontrakt 1.5.0) do pokoju `user:{id}`, symetrycznie do `document.ready` ([ADR 0066](0066-silnik-dokumentow-gotenberg-i-zadania.md)). Gdy brak połączenia, aplikacja odpytuje `GET /me/data-exports/latest` co 5 s.

### Zawartość pliku

Schemat `dataExportSchema` (Zod w `packages/shared`, `schemaVersion: 1`):
- czasy w UTC (ISO 8601);
- kwoty w groszach z walutą `PLN`;
- obok sekcji krótki opis po polsku (`about`), żeby plik był zrozumiały bez dokumentacji.

| Sekcja | Zawiera | Nie zawiera |
|---|---|---|
| `profile` | telefon, imię, data rejestracji, stan blokady z powodem widocznym dla klienta, preferencje powiadomień, urządzenia (platforma, ostatnie użycie) i sesje (utworzenie, ostatnie użycie, klient) | wartości tokenów, skróty kodów i tokenów, notatki operatorów |
| `consents` | rodzaj, dokument i wersja, akceptacja, wycofanie | — |
| `rentals` | numer, czasy, hulajnoga i model, strefy i współrzędne początku i końca, dystans, kwoty i pozycje wyceny, wersja cennika, tryb zakończenia, trasa (punkty z telemetrii uproszczone `ST_Simplify`) | trasa starsza niż 90 dni (`route: null` z wyjaśnieniem w `about`) |
| `wallet`, `payments`, `refunds`, `receipts` | saldo, wpisy księgi, płatności (kwota, stan, marka i końcówka karty, jeśli są zapisane), zwroty, paragony z pozycjami i grupami VAT | identyfikatory klienta u operatora płatności |
| `tickets` | numer, kategoria, opis, statusy widoczne dla klienta, odpowiedź | notatki wewnętrzne, nazwiska operatorów, wpisy dziennika audytu |
| `photos` | metadane zdjęć parkowania i zgłoszeń (identyfikator, cel, data, przejazd albo zgłoszenie, stan, data usunięcia) | samych obrazów i adresów do nich |
| `notifications` | kod, tytuł i treść wysłana, czas wysłania i odczytu | — |

**Zdjęcia (rozstrzygnięcie): plik zawiera tylko metadane, bez obrazów i adresów.** Powody:
- autor wybrał plik JSON;
- zdjęcia przedstawiają hulajnogę i miejsce parkowania, a nie klienta, i i tak znikają po 30 dniach;
- adres z podpisem w pliku ważnym 7 dni wygasałby albo wymagał długiego podpisu, który działa także po przekazaniu pliku.

Rozszerzenie do ZIP ze zdjęciami opisze nowy ADR, jeśli prowadzący albo autor uzna metadane za za mało.

### Retencja i usunięcie konta

- **Zadanie dobowe `data-exports.purge`** (03:45) usuwa z magazynu pliki po `expires_at`. Ustawia `files.status = DELETED` i `data_exports.deleted_at`, a wiersz zostaje jako ślad zlecenia.
- **Usunięcie konta** w tej samej transakcji anulowuje zlecenie w toku, a pliki eksportu usuwa zadanie od razu po zatwierdzeniu.

### Aplikacja i panel

- **Aplikacja:** Ustawienia → „Pobierz moje dane” (przycisk przestaje być ukryty), stany według plansz:
  - opis zawartości;
  - przygotowanie, z którego można wyjść;
  - plik gotowy z rozmiarem i datą ważności;
  - limit z czasem z `nextAllowedAt`.

  Wersja natywna pobiera plik przez `File.downloadFileAsync` do `Paths.cache` i udostępnia go (`Sharing.shareAsync`, `mimeType: application/json`), a wersja web otwiera adres w nowej karcie, jak paragon PDF ([ADR 0068](0068-wydruki-w-procesach.md)).
- **Panel:** zasób listy `data-exports` tylko do odczytu (`users.read`), z klientem, stanem, datami i rozmiarem, bez pobierania pliku. Operator widzi, że zlecenie było, ale nie dostaje danych klienta w jednym pliku.

## Konsekwencje

Pozytywne:

- Klient dostaje swoje dane w formacie nadającym się do przeniesienia, z opisem sekcji, bez udziału operatora.
- Limit i jedno zlecenie w toku pilnuje baza, więc podwójne kliknięcie ani dwa urządzenia nie obciążą zadań.
- Każdy moduł oddaje swoją część przez port, więc nowa tabela z danymi klienta w przyszłości oznacza rozszerzenie portu, a nie zapytanie z obcego modułu.
- Plik żyje 7 dni i nie powiela danych na stałe.

Negatywne i ryzyka:

- Zakres eksportu trzeba utrzymywać przy każdej nowej tabeli z danymi klienta. Test sprawdza, że eksport ma wszystkie sekcje ze schematu, ale nie wykryje nowej tabeli bez sekcji.
- Plik bez zdjęć może nie wyczerpywać prawa do przenoszenia danych dostarczonych przez klienta. To ocena prawna dla autora, a rozszerzenie jest możliwe bez zmiany tabeli.
- Klient z długą historią i trasami dostanie większy plik. Uproszczenie trasy i 90 dni telemetrii ograniczają rozmiar, a zadanie składa plik w pamięci.
- Pobranie i udostępnienie w wersji natywnej sprawdzimy w pełni dopiero w development build.

## Powiązane

[ADR 0058](0058-powiadomienia-push-z-szablonow.md) (nowy kod `data_export_ready`), [ADR 0057](0057-pliki-zdjecia.md) (adres z podpisem, nowy cel pliku), [ADR 0003](0003-monolit-modularny.md), [ADR 0012](0012-socket-io.md), [ADR 0054](0054-zwroty-i-korekty-salda.md) i [plan iteracji 3](../iteracje/iteracja-03-wypozyczenie.md) (usunięcie konta), [ADR 0037](0037-pg-boss-konfiguracja-i-zadania.md), [ADR 0055](0055-zgloszenia-i-proces-serwisowy.md), [ADR 0066](0066-silnik-dokumentow-gotenberg-i-zadania.md), [ADR 0068](0068-wydruki-w-procesach.md), [kontrakt realtime](../kontrakty/asyncapi-realtime.yaml), [plan iteracji 7](../iteracje/iteracja-07-tresci-wydruki.md) (pytanie 14), makiety `31-mobile-tresci/moje-dane*`
