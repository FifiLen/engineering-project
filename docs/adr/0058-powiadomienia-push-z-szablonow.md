# ADR 0058: Powiadomienia push z szablonów

- **Status:** zaakceptowana
- **Data:** 2026-11-18

## Kontekst

Wymaganie 17 mówi, że treści są sterowane z panelu, bez tekstów na sztywno. Wymaganie 12 dotyczy list wszystkich tabel. Od iteracji 0 baza ma `notifications`, `push_tokens` (token Expo, platforma) i `notification_templates`:
- kod i kanał `PUSH|SMS`;
- tytuł i treść ICU;
- wersja.

Nic ich nie używa: kod SMS przy logowaniu ma tekst w API (`LoggingSmsGateway`), a aplikacja nie ma `expo-notifications`. Użytkownik ma preferencje `notify_reservation_end` i `notify_receipts` (migracja 0005).

Iteracja 6 potrzebuje powiadomień:
- koniec rezerwacji;
- przejazd zakończony z paragonem;
- nieudana płatność;
- niska bateria ([ADR 0056](0056-przejazd-bez-lacznosci-i-niska-bateria.md));
- przyjęcie zgłoszenia i odpowiedź na zgłoszenie ([ADR 0055](0055-zgloszenia-i-proces-serwisowy.md)).

D2 autora: bramka za adapterem, jak SMS. W środowisku deweloperskim atrapa zapisuje i loguje powiadomienie, a wersja web pokazuje baner przez Socket.IO. Expo Push działa po skonfigurowaniu projektu przez autora.

Sprawdzone w dokumentacji Expo (18 listopada 2026):
- **token:** `getExpoPushTokenAsync` wymaga `projectId` projektu EAS i działa tylko na Androidzie i iOS, nie w przeglądarce;
- **Expo Go:** na Androidzie od SDK 53 nie obsługuje powiadomień zdalnych, potrzebny jest development build;
- **urządzenia testowe:** telefon, emulator Androida z Google Play albo symulator iOS z Xcode 14+;
- **potwierdzenia:** potwierdzenie dostarczenia (receipt) sprawdza się po około 15 min, a usługa usuwa je po 24 h. Błąd `DeviceNotRegistered` oznacza, że na ten token nie należy już wysyłać;
- **limity:** do 100 wiadomości w żądaniu i 600 na sekundę na projekt;
- **uwierzytelnienie:** token dostępu jest opcjonalny;
- **Android:** kanał powiadomień trzeba utworzyć przed pobraniem tokenu.

Wersje:
- `expo-notifications` ~58.1.8 z `expo install` dla SDK 58 (najnowsza 58.1.9 z 11 listopada);
- `expo-server-sdk` 8.0.0 (22 października, wymaga Node ≥ 22.12, projekt ma 22.20);
- `intl-messageformat` 12.1.5 (8 listopada; najnowsza 12.2.0 jest z 17 listopada, za świeża) z parserem `@formatjs/icu-messageformat-parser` 3.5.23.

## Rozważane opcje

Wysyłka:

1. **Synchronicznie w transakcji zdarzenia.** Prosto, ale błąd albo wolna odpowiedź Expo wydłuża zakończenie przejazdu i płatność.
2. **Wpis `QUEUED` w transakcji zdarzenia i zadanie pg-boss** ([ADR 0037](0037-pg-boss-konfiguracja-i-zadania.md)). Powiadomienie powstaje tylko wtedy, gdy zdarzenie się zapisało, a wysyłka ma ponowienia.

Historia szablonów:

1. **Tylko dziennik audytu** ze starą i nową treścią. Bez tabeli, ale „Przywróć” i „Porównaj” z makiety czytają JSON z dziennika.
2. **Tabela wersji `notification_template_versions`.** Każdy zapis to nowy wiersz, a szablon wskazuje bieżącą wersję. Przywrócenie to nowa wersja z treścią starej.

## Decyzja

Opcja 2 w obu sprawach. Szczegóły:

- **Bramka:** port `PushGateway` z dwoma adapterami. Wybiera je `PUSH_PROVIDER=fake|expo`, domyślnie `fake`, jak `PAYMENT_PROVIDER`.
  - `ExpoPushGateway` używa `expo-server-sdk` z opcjonalnym `EXPO_ACCESS_TOKEN`, partiami do 100 i ponowieniami z wykładniczym odstępem przy 429 i 5xx.
  - `FakePushGateway` zapisuje wynik `SENT` i wypisuje powiadomienie w logu API, jak kod SMS.
- **Kod SMS:** `SmsGateway` też renderuje treść z szablonu (`login_code`, kanał `SMS`), więc znika ostatni tekst klienta na sztywno w API.
- **Zdarzenie → powiadomienie:**
  - moduł zapisuje w swojej transakcji wiersz `notifications` (`QUEUED`) z kodem szablonu, parametrami i kluczem idempotencji, np. `ride_ended:{rentalId}`. Unikalny indeks wyklucza drugie powiadomienie o tym samym zdarzeniu;
  - w tej samej transakcji planuje zadanie `notification.send` przez `sendInTransaction`;
  - zadanie renderuje szablon, sprawdza preferencje i tokeny i wysyła. Wynik to `SENT`, `FAILED` z błędem albo `SKIPPED` (wyłączona preferencja, brak tokenu).
- **Preferencje:**
  - `notify_reservation_end` dotyczy `reservation_ending`, a `notify_receipts` dotyczy `ride_ended`;
  - `battery_low`, `payment_failed`, `ticket_received` i `ticket_status_changed` idą zawsze (makieta `ustawienia-powiadomienia-wylaczone`);
  - promocje to zgoda `MARKETING` i nie są w zakresie.
- **Tokeny:**
  - `POST /me/push-tokens { token, platform }` robi upsert po tokenie. Token zalogowany na innym koncie przechodzi do nowego. Zapis obejmuje `session_id` i `last_seen_at`;
  - wylogowanie usuwa tokeny sesji;
  - `DeviceNotRegistered` z wyniku wysyłki albo z potwierdzenia usuwa token;
  - zadanie `notification.receipts` sprawdza potwierdzenia 15 min po wysyłce.
- **Schemat (migracja 0008):**
  - `notifications`: `template_code`, `channel`, `status` (`QUEUED`, `SENT`, `FAILED`, `SKIPPED`), `error`, `dedupe_key` (unikalny), `provider_ref`, `read_at`, `created_at`;
  - `sent_at` staje się opcjonalne;
  - `push_tokens`: `session_id`, `last_seen_at`;
  - `notification_template_versions` (szablon, wersja, tytuł, treść, operator, czas).
- **Szablony:**
  - **Kody** wyznacza rejestr w `packages/shared` (kod, kanał, parametry z typami, cel otwarcia aplikacji). Panel nie dodaje ani nie usuwa kodów, tylko edytuje treść. Dane startowe zakładają polskie szablony wszystkich kodów.
  - **Walidacja** (core, przy każdej zmianie w edytorze i przy zapisie) parsuje treść `@formatjs/icu-messageformat-parser`:
    - błąd składni daje `TEMPLATE_SYNTAX_ERROR` z wierszem i znakiem;
    - parametr spoza rejestru daje `TEMPLATE_UNKNOWN_PARAM`;
    - limity to tytuł 50 i treść 240 znaków (SMS 160).
  - **Renderowanie** robi `intl-messageformat` z lokalizacją `pl`. Kwoty i daty formatuje API przed renderowaniem (formatowanie kwot z `packages/shared`), więc szablon nie zależy od danych ICU w Node.
  - **Uprawnienia:** edycja wymaga `content.write`, podgląd `content.read`. Zapis tworzy nową wersję, a przywrócenie tworzy wersję z treścią starej.
- **Aplikacja:**
  - przed pobraniem tokenu tworzy kanał Androida `default`;
  - pyta o zgodę raz, przy pierwszej rezerwacji albo pierwszym starcie (makieta `powiadomienia-zgoda`);
  - `projectId` czyta z konfiguracji EAS;
  - dotknięcie powiadomienia otwiera ekran z `data.path` (Expo Router) przez `addNotificationResponseReceivedListener` i ostatnią odpowiedź po zimnym starcie;
  - na pierwszym planie powiadomienie przy ekranie jazdy jest ukryte.
- **Wersja web i atrapa:** zadanie po wysyłce emituje `notification.created` do pokoju klienta w Socket.IO ([kontrakt realtime](../kontrakty/asyncapi-realtime.yaml)). Wersja web pokazuje baner (makieta `baner-powiadomienia`), a aplikacja natywna to zdarzenie pomija, żeby nie dublować powiadomienia systemowego.
- **Panel:** zakładki „Szablony”, „Wysłane” (`notifications`) i „Tokeny push” (`push_tokens`) jako zasoby listy (wymaganie 12).

## Konsekwencje

Pozytywne:

- Wszystkie teksty powiadomień i SMS edytuje się w panelu z walidacją i historią wersji (wymaganie 17).
- Wysyłka nie spowalnia przejazdu ani płatności i nie wysyła nic o zdarzeniu, które się wycofało.
- Demo działa bez konta Expo, urządzenia i sieci: atrapa, log i baner w wersji web.

Negatywne i ryzyka:

- Prawdziwy push wymaga od autora projektu EAS, poświadczeń FCM i APNs (płatne konto Apple Developer dla iOS) oraz development build. Do tego czasu ścieżka Expo jest sprawdzona tylko testami z atrapą klienta HTTP.
- Atrapa oznacza `SENT` bez dostarczenia, więc lista „Wysłane” w demo pokazuje stan bramki, nie telefonu.
- Zmiana szablonu działa od następnej wysyłki, a powiadomienie w kolejce renderuje się z wersji z chwili wysyłki, nie z chwili zdarzenia.

## Powiązane

[ADR 0035](0035-sesje-tokeny-i-straznik-uprawnien.md) (bramka SMS), [ADR 0037](0037-pg-boss-konfiguracja-i-zadania.md), [ADR 0050](0050-integracja-stripe.md) (wzór adaptera z atrapą), [ADR 0055](0055-zgloszenia-i-proces-serwisowy.md), [ADR 0056](0056-przejazd-bez-lacznosci-i-niska-bateria.md), arc42 §8, [wymagania uczelni](../wymagania-uczelni.md) 12 i 17, [plan iteracji 6](../iteracje/iteracja-06-operacje-serwis.md) (D2), makiety `powiadomienia-zgoda`, `ustawienia-powiadomienia-wylaczone`, `baner-powiadomienia`, `szablony-powiadomien`
