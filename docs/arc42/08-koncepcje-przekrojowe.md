# 8. Koncepcje przekrojowe

## 8.1. Uwierzytelnianie i autoryzacja
Użytkownicy logują się kodem SMS i dostają krótki token dostępowy (15 min) oraz długi token odświeżający (30 dni), przechowywany w bazie jako skrót; w aplikacji leży w `expo-secure-store`. Każde odświeżenie wydaje nowy token, a ponowne użycie zastąpionego unieważnia całą rodzinę sesji. Operatorzy logują się e-mailem, hasłem (argon2) i kodem TOTP (sekret szyfrowany AES-256-GCM); token odświeżający panelu jest w ciasteczku `httpOnly` `SameSite=Strict`. Uprawnienia operatora wynikają z ról zarządzanych w panelu (RBAC, [ADR 0028](../adr/0028-uzytkownicy-role-uprawnienia.md)); każdy punkt API deklaruje dostęp (`@Public`, `@CustomerAuth`, `@StaffAuth`, `@RequirePermission`), a punkt bez deklaracji jest odrzucany. Każdy zapis operatora trafia do `audit_log` w tej samej transakcji. Szczegóły: [ADR 0019](../adr/0019-uwierzytelnianie.md), [ADR 0035](../adr/0035-sesje-tokeny-i-straznik-uprawnien.md).

**Aktor systemu w dzienniku audytu (od iteracji 6, [ADR 0055](../adr/0055-zgloszenia-i-proces-serwisowy.md)):** zmiany bez operatora zapisuje system z `actor = SYSTEM` i `staff_id = NULL` (`CHECK ((actor = 'STAFF') = (staff_id IS NOT NULL))`). Tak zapisują się:
- zgłoszenia automatyczne i ich automatyczne zamknięcie;
- automatyczne `MAINTENANCE` po przejeździe (wyzwalacz `scooters_status`, wpis `scooter.sent_to_service`);
- powrót do floty po ostatnim zadaniu.

W API wpis systemu idzie przez `AuditScope.system` w tej samej transakcji. Panel pokazuje „System” z pliku tłumaczeń, a dziennik ma filtr po aktorze. Komendy systemu do hulajnóg (`lock` hulajnogi bez przejazdu, `battery_swapped`) nie mają wpisu w dzienniku, tylko wiersz w `scooter_commands`. Bez `users.read` widoki zgłoszeń i powiadomień nie podają imienia ani telefonu klienta (Serwisant widzi „Klient”), a filtr albo sortowanie po tych polach kończy się `403`.

## 8.2. Idempotencja
Każde działanie, które może zostać powtórzone, ma unikalny klucz: `commandId` dla komend MQTT, `idempotency_key` dla płatności, `provider_event_id` dla webhooków. Powtórzenie nie zmienia stanu. Ponowione żądanie startu albo rezerwacji tej samej hulajnogi zwraca otwarty przejazd zamiast drugiego (indeksy jednego otwartego przejazdu, [ADR 0036](../adr/0036-proces-wypozyczenia-w-api.md)). Komenda ma termin `expiresAt` (kontrakt MQTT 1.1.0), po którym hulajnoga jej nie wykona, a potwierdzenie zmienia stan tylko komendy w statusie `SENT` ([ADR 0038](../adr/0038-wygasanie-komend-mqtt.md)). Zadania pg-boss są dostarczane co najmniej raz, więc ich obsługa sprawdza stan po zablokowaniu wiersza ([ADR 0037](../adr/0037-pg-boss-konfiguracja-i-zadania.md)). Od iteracji 6:
- powiadomienie ma unikalny `dedupe_key` (np. `ride_ended:{rentalId}`), więc to samo zdarzenie nie da drugiego powiadomienia;
- zgłoszenie automatyczne wstawia się przez `ON CONFLICT (scooter_id, auto_kind) WHERE status <> 'RESOLVED' DO NOTHING`;
- symulator pamięta wyniki po `commandId` polecenia, bo QoS 1 może je dostarczyć ponownie.

## 8.3. Spójność danych
Reguły biznesowe, które muszą być zawsze prawdziwe, są pilnowane przez bazę: indeksy częściowe (jeden otwarty przejazd na hulajnogę i użytkownika, jedno obciążenie za przejazd), klucze obce i ograniczenia `CHECK`. Logika aplikacji ich nie zastępuje, tylko uzupełnia.

## 8.4. Pieniądze
Kwoty to liczby całkowite w groszach. Ruch środków to wpis w księdze portfela ([ADR 0014](../adr/0014-kwoty-w-groszach-portfel-ksiega.md)). Przejazd pamięta wersję cennika z chwili startu ([ADR 0015](../adr/0015-wersjonowany-cennik.md)); wersji nie edytuje się, zmiana cen to nowa wersja od teraz albo od daty ([ADR 0053](../adr/0053-wersje-cennika-w-panelu.md)).

Od iteracji 5:
- **Księga:** każdy wpis przechodzi przez `sp_wallet_post` z blokadą wiersza portfela; wyzwalacz `trg_wallet_ledger_rules` sprawdza, że saldo po operacji to poprzednie saldo z księgi plus kwota, i nie pozwala zmienić ani usunąć wpisu. Typy wpisów: `TOPUP`, `RIDE_CHARGE`, `REFUND`, `ADJUSTMENT` (z powodem z listy), `PAYOUT` (zwrot salda na kartę), od iteracji 6 `TOWING_FEE` (opłata za odholowanie, najwyżej jedna na przejazd, `wallet_ledger_one_fee_per_rental`).
- **Operator płatności:** środki trafiają do portfela tylko po wyniku od operatora (webhook albo sprawdzenie statusu); klucz idempotencji u operatora to identyfikator płatności w bazie ([ADR 0050](../adr/0050-integracja-stripe.md)). Konfiguracja odrzuca klucze `live`, bo projekt nie obsługuje prawdziwych pieniędzy.
- **Paragony:** dokument niefiskalny (potwierdzenie sprzedaży) za rozliczony przejazd, z pozycjami z wyceny i VAT liczonym od sumy brutto metodą „w stu” z zaokrągleniem połowy w górę (`vatFromGross` w core i `fn_vat_from_gross` w bazie). Stawka VAT jest polem wersji cennika (robocza 23%). Zwrot nie zmienia paragonu, tylko dodaje dokument korygujący ([ADR 0052](../adr/0052-paragony.md)).
- **Wiele stawek na paragonie (od migracji 0010, [ADR 0061](../adr/0061-oplata-za-odholowanie-jako-kara-umowna.md)):** pozycja ze stawką `NULL` nie podlega VAT (w dokumencie „np.”). VAT dokumentu to suma VAT liczonego osobno dla każdej stawki od sumy brutto grupy (`receiptVatGroups` i `receiptTotals` w core, `v_receipt_list` w bazie); paragon w panelu i w aplikacji pokazuje VAT każdej stawki i kwotę poza VAT (`vatGroups` w widoku paragonu). Korekta dzieli zwrot między grupy stawek proporcjonalnie do kwot pozostałych do zwrotu po wcześniejszych korektach, zaokrąglenie do grosza, reszta do ostatniej grupy; każda grupa to osobna pozycja `REFUND` ze swoją stawką (`correctionItems`). Baza odrzuca korektę, po której któraś grupa byłaby ujemna (`sp_issue_receipt`).
- **Paragon fiskalny w produkcji:** prawdziwy system musiałby ewidencjonować sprzedaż usług osobom fizycznym zgodnie z przepisami, np. przez kasę fiskalną online (usługę integrowaną przez API), a dokument w aplikacji byłby wtedy potwierdzeniem albo kopią. Wymóg i stawkę VAT sprawdza autor; projekt tego nie rozstrzyga.
- **Zwroty:** suma zwrotów przejazdu albo doładowania nie przekracza zapłaconej kwoty (`sp_record_refund` z blokadą); zwrot z portfela działa od razu, na kartę po wyniku od operatora ([ADR 0054](../adr/0054-zwroty-i-korekty-salda.md)). Od iteracji 6 zwrot może wskazywać zgłoszenie (`refunds.ticket_id`, reklamacja „Rozliczenie”).
- **Opłata za odholowanie (od iteracji 6, [ADR 0060](../adr/0060-oplata-za-odholowanie.md)):** część rozliczenia przejazdu (`rentals.towing_fee`), nie osobna płatność. Portfel dostaje `TOWING_FEE` w tej samej transakcji co `RIDE_CHARGE`, karta jedną płatność na sumę, a paragon `SALE` osobną pozycję. Zapłacona kwota i limit zwrotu obejmują opłatę. Opłata jest karą umowną (art. 483 Kodeksu cywilnego) poza VAT: pozycja paragonu ma stawkę `NULL`, a VAT przejazdu liczy się tylko od usługi ([ADR 0061](../adr/0061-oplata-za-odholowanie-jako-kara-umowna.md), decyzja autora z 18 listopada 2026). Regulamin musi nazywać opłatę karą umowną za pozostawienie hulajnogi poza strefą; ostateczną ocenę podatkową zostawiamy księgowości.

## 8.5. Czas
Czas zapisujemy w UTC (`timestamptz`), prezentujemy w strefie Europe/Warsaw. Czas przejazdu liczymy od potwierdzenia odblokowania przez hulajnogę do żądania zakończenia, z osi czasu przejazdu ([ADR 0042](../adr/0042-wycena-przejazdu.md)); od iteracji 6 każdy odcinek bez łączności liczy się najwyżej 30 min ([ADR 0056](../adr/0056-przejazd-bez-lacznosci-i-niska-bateria.md)). Czas zdarzeń i komend pochodzi z zegara bazy (`now()` transakcji), żeby kolejność na osi czasu była jednoznaczna.

## 8.6. Geometria
Układ WGS 84 (SRID 4326). Pozycje jako `Point`, strefy jako `MultiPolygon` z indeksem GiST; edytor w panelu pracuje na jednym wielokącie (`Polygon`) z dokładnością 6 miejsc po przecinku ([ADR 0047](../adr/0047-edytor-geometrii-w-panelu.md)). Reguły geometrii mają trzy poziomy, a rozstrzyga baza: panel nie pozwala zamknąć wielokąta, który przecina sam siebie; core sprawdza liczbę punktów, samoprzecięcia i najmniejszą powierzchnię 100 m²; baza pilnuje `ST_IsValid`, położenia w jedynym aktywnym obszarze działania, rozłączności stref parkowania i niezmiennego typu (wyzwalacz `zones_rules`, migracja 0006). Strefy w punkcie zwracają funkcje bazy (`fn_zones_at_point`, `fn_zones_near_point` z promieniem histerezy), a reguły pozycji (`canRide`, `canPark`, limit) liczy core (`evaluatePosition`).

## 8.7. Zdarzenia na żywo
Socket.IO z pokojami: `user:{id}` dla aplikacji klienta (dołącza od razu po połączeniu z tokenem klienta), `fleet` i `rentals` dla panelu (po sprawdzeniu uprawnienia). Pokój `rental:{id}` z ADR 0012 okazał się zbędny ([kontrakt Socket.IO 1.1.0](../kontrakty/asyncapi-realtime.yaml)). Format zdarzeń opisuje pakiet `shared` (`realtime.ts`). Od iteracji 3: `rental.updated` (pełny widok przejazdu klienta z licznikami na chwilę `asOf`) i `rentals.changed` (wiersz listy przejazdów w panelu). Od iteracji 1: `fleet.updates` (paczka zmian pozycji, baterii i statusu floty z jednego okna telemetrii) i `fleet.command` (wysłanie i każda zmiana statusu komendy). Panel pobiera stan początkowy przez REST (`GET /admin/fleet/map`) i po każdym ponownym połączeniu pobiera go od nowa. Od iteracji 6 ([kontrakt Socket.IO 1.4.0](../kontrakty/asyncapi-realtime.yaml)):
- pokoje panelu `tickets` (`tickets.read`), `service` (`service.read`) i `simulator` (`simulator.manage`, tylko przy włączonym sterowaniu symulatorem);
- zdarzenia `ticket.updated` (panel i zgłaszający klient), `service-task.updated`, `simulator.status`, `simulator.result`, a w pokoju klienta `notification.created`;
- panel trzyma jedno połączenie na kartę i dołącza do pokoi potrzebnych na ekranie (`apps/web/lib/realtime.ts`).

Od iteracji 7 ([kontrakt Socket.IO 1.6.1](../kontrakty/asyncapi-realtime.yaml)):
- `content.updated` do wszystkich połączonych po zatwierdzeniu zmiany treści i na granicy publikacji aktualności; klient po nim zawsze pyta warunkowo (`If-None-Match`), bo o świeżości decyduje skrót treści, nie rewizja;
- pokój operatora `staff:{id}` (dołączenie przy połączeniu, bez subskrypcji) z `document.ready`; ten sam `document.ready` i `data-export.ready` w pokoju `user:{id}`.

## 8.8. Obsługa błędów
API zwraca błędy w jednym formacie: kod maszynowy (np. `OUTSIDE_PARKING`), komunikat i szczegóły. Klienci reagują na kod, nie na treść komunikatu.

## 8.9. Logowanie i obserwowalność
Logi strukturalne w JSON z identyfikatorem żądania, przejazdu i komendy. Metryki symulatora i brokera (wiadomości na sekundę, opóźnienie komend) są widoczne w panelu.

## 8.10. Prywatność
Pełne numery kart nie trafiają do systemu. Usunięcie konta anonimizuje dane osobowe, przejazdy i płatności zostają ze względów księgowych. Telemetria starsza niż 90 dni jest usuwana razem z partycjami, a wygasłe sesje, zaproszenia i kody SMS 30 dni po wygaśnięciu (zadania pg-boss, [ADR 0037](../adr/0037-pg-boss-konfiguracja-i-zadania.md)). Usunięcie konta wymaga braku otwartego przejazdu i salda 0. Od iteracji 6 zdjęcia parkowania są usuwane z magazynu po 30 dniach, chyba że są w zgłoszeniu (§8.12), a tokeny push znikają z sesją klienta (wylogowanie, usunięcie wygasłej rodziny sesji). Od iteracji 7:
- klient pobiera swoje dane jako JSON („Pobierz moje dane”, raz na 24 h, plik ważny 7 dni, zdjęcia tylko jako metadane, [ADR 0069](../adr/0069-eksport-danych-klienta.md));
- grafiki biblioteki tracą przy wysyłce metadane (EXIF z położeniem, XMP, komentarze), bo są publiczne (§8.15);
- pliki wydruków znikają po 30 dniach, a wiersz `generated_documents` zostaje jako ślad (kto, kiedy, z której wersji szablonu).

## 8.11. Język interfejsu
Interfejs po polsku. Etykiety interfejsu (przyciski, pola, menu, komunikaty błędów) są wydzielone do plików tłumaczeń, żeby dodanie kolejnego języka nie wymagało zmian w kodzie; w komponentach są tylko klucze. Mechanizm: wspólny tłumacz z `packages/shared` na `intl-messageformat` (format ICU, polskie liczebniki), pliki `apps/web/messages/pl.json` i `apps/mobile/src/i18n/pl.json`, reguła lintera zakazująca tekstów w JSX ([ADR 0032](../adr/0032-etykiety-w-plikach-tlumaczen.md)). Treści merytoryczne (regulamin, FAQ, aktualności, bloki strony i ekranów powitalnych, szablony powiadomień, grafiki) są w bazie i edytuje je operator w panelu ([ADR 0027](../adr/0027-tresci-sterowane-z-panelu.md)). Od iteracji 6 w bazie są też wszystkie teksty powiadomień push i kodu SMS (§8.13), więc API nie ma tekstów dla klienta na sztywno. Od iteracji 7 z bazy są też bloki strony i ekranów aplikacji (ekran startowy, zasady przed jazdą, Pomoc), FAQ, aktualności, grafiki (także rendery hulajnogi), dane firmy (kontakt pomocy, dane sprzedawcy) i teksty wydruków z szablonów DOCX (§8.14–8.17); w plikach tłumaczeń zostają etykiety.

## 8.12. Pliki
Od iteracji 6 ([ADR 0057](../adr/0057-pliki-zdjecia.md), zmienia podpisany adres z [ADR 0024](../adr/0024-magazyn-plikow-seaweedfs.md)):
- **Wysyłka przez API:** `POST /files` (`multipart/form-data`, pole `purpose`: `PARKING_PHOTO` albo `TICKET_PHOTO`) wysyła klient albo operator z uprawnieniem celu (`rentals.manage`, `tickets.manage`). API rozpoznaje JPEG, PNG i WebP po sygnaturze (`FILE_TYPE_NOT_ALLOWED`, 415), pilnuje 10 MB (`FILE_TOO_LARGE`, 413), liczy SHA-256 i wybiera klucz obiektu.
- **Magazyn za portem `FileStorage`:** SeaweedFS przez API S3 (`FILE_STORAGE=s3`, `forcePathStyle`) albo pamięć procesu w testach (`memory`, w produkcji zatrzymuje start). Magazyn jest tylko w sieci wewnętrznej, bez CORS.
- **Przypięcie:** plik `READY` jest niczyj, dopóki nie trafi do przejazdu (`POST /rentals/{id}/parking-photo`) albo zgłoszenia (`photoIds`, najwyżej 3, `ticket_photos.position`). API sprawdza właściciela, cel i to, że plik nie jest przypięty gdzie indziej.
- **Odczyt:** widoki API podają adres `/files/{id}?exp=…&sig=…` z podpisem HMAC na 10 min, wystawiony tylko temu, kto ma dostęp do rekordu (właściciel, `rentals.read`, `tickets.read`). Klienci doklejają adres API; `<img>` i `Image` działają bez nagłówków.
- **Wyjątek od iteracji 7:** grafiki biblioteki (`MEDIA`) mają publiczny adres z sumą SHA-256 (§8.15); szablony, wydruki i eksport danych zostają przy podpisie, z nazwą pliku w `Content-Disposition`.
- **Retencja:** `files.cleanup` co godzinę usuwa pliki nieprzypięte po 24 h, a `files.retention` raz na dobę zdjęcia parkowania po 30 dniach spoza zgłoszeń. Wiersz zostaje ze stanem `DELETED`, więc klucze obce przejazdów i zgłoszeń są nienaruszone.

## 8.13. Powiadomienia
Od iteracji 6 ([ADR 0058](../adr/0058-powiadomienia-push-z-szablonow.md)):
- **Szablony:** kody, kanały i parametry wyznacza rejestr `NOTIFICATION_TEMPLATES` w `packages/shared`; panel tylko edytuje treść (`content.write`, podgląd `content.read`). Walidacja ICU w core przy każdej zmianie i zapisie (`TEMPLATE_SYNTAX_ERROR` z wierszem i znakiem, `TEMPLATE_UNKNOWN_PARAM`, `TEMPLATE_TOO_LONG`: tytuł 50, push 240, SMS 160 znaków). Każdy zapis to nowa wersja w `notification_template_versions` (wyzwalacz), przywrócenie też.
- **Wysyłka:** wpis `QUEUED` i zadanie `notification.send` w transakcji zdarzenia (§6.10). Kwoty i daty formatuje API przed renderowaniem (`formatPln` z `packages/shared`), a renderuje `intl-messageformat` z lokalizacją `pl`.
- **Bramka:** port `PushGateway`; `PUSH_PROVIDER=fake` (domyślnie) zapisuje `SENT` i wypisuje treść w logu API, `expo` używa `expo-server-sdk` z opcjonalnym `EXPO_ACCESS_TOKEN`, partiami do 100.
- **Preferencje:** `notify_reservation_end` dotyczy `reservation_ending`, `notify_receipts` dotyczy `ride_ended`; niska bateria, nieudana płatność i zgłoszenia idą zawsze. Wynik bez wysyłki to `SKIPPED` z powodem.
- **Tokeny:** `POST /me/push-tokens` robi upsert po tokenie z sesją i `last_seen_at` (token z innego konta przechodzi do nowego), wylogowanie usuwa tokeny rodziny sesji, `DeviceNotRegistered` usuwa token.
- **Aplikacja:** zgoda raz, przy pierwszej rezerwacji albo starcie; dotknięcie otwiera ekran z `data.path` (także po zimnym starcie); na ekranie jazdy powiadomienie jest ukryte. Wersja web nie ma tokenu, więc pokazuje baner z `notification.created`.

## 8.14. Treści i Markdown
Od iteracji 7 ([ADR 0062](../adr/0062-modul-tresci-sekcje-publikacja-dane-firmy.md), [ADR 0063](../adr/0063-markdown-w-tresciach.md)):
- **Rejestr sekcji** (`CONTENT_SECTIONS` w `packages/shared`, 16 sekcji) wyznacza klucze, klienta, rodzaj (blok albo sekcja-lista z limitem elementów), profil Markdown i minimalną szerokość grafiki (hero 760 px, [ADR 0070](../adr/0070-minimalna-szerokosc-grafiki-hero.md)). Panel edytuje treść i elementy, nie tworzy sekcji, bo kod renderuje konkretne miejsca.
- **Publikacja:** bloki, FAQ i aktualności mają szkic, publikację i archiwum; zmiana opublikowanego wpisu działa od zapisu, a historia jest w dzienniku audytu (pełny stan przed i po) z „Przywróć”. Stan aktualności (zaplanowana, opublikowana, wygasła) liczą core (`newsState`) i baza (`fn_news_state`) tą samą regułą.
- **Markdown bez HTML:** jeden własny parser podzbioru (`parseMarkdown` w `packages/shared`, profile `inline`, `faq`, `document`) daje drzewo węzłów, a panel, strona i aplikacja renderują je komponentami React i React Native, bez `dangerouslySetInnerHTML`, więc bez sanityzacji. HTML, obrazy, tabele, kod i zagnieżdżone listy to błąd zapisu z wierszem i kolumną.
- **Odnośniki** tylko `https:`, `mailto:`, `tel:`, ścieżka `/…` i kotwica `#…` (`isAllowedHref`); baza ma ten sam wzorzec w `CHECK` adresu przycisku, a strona pokazuje przycisk tylko przy `isAllowedHref`.
- **Odczyt:** `GET /content/{client}` zwraca wszystkie opublikowane treści klienta jedną odpowiedzią (sekcje, FAQ, dane firmy, grafiki systemowe, na stronie modele) z `ETag` ze skrótu SHA-256 i `Cache-Control: no-cache`. Strona trzyma ją w Data Cache Next.js z tagami (`content`, `tariff`, `scooters`), a aplikacja w Async Storage; bez sieci przy pierwszym uruchomieniu aplikacja pokazuje „Brak internetu”, a rendery hulajnogi bierze z kopii w paczce.

## 8.15. Media publiczne
Od iteracji 7 ([ADR 0064](../adr/0064-biblioteka-mediow.md), zmienia [ADR 0057](../adr/0057-pliki-zdjecia.md) dla celu `MEDIA`):
- wysyłka `POST /files` z celem `MEDIA` tylko z `content.write`: JPEG, PNG, WebP do 5 MB i 8000 px (ostrzeżenie powyżej 2560 px), wymiary z nagłówka w core, bez skalowania na serwerze; core usuwa metadane (`stripImageMetadata`), a suma SHA-256 i rozmiar liczą się z oczyszczonego pliku;
- adres `GET /media/{id}/{sha256}.{ext}` z `Cache-Control: public, max-age=31536000, immutable`; „Zastąp plik” zachowuje identyfikator grafiki i jej użycia, ale daje nowy adres, a starszy skrót odpowiada `308` na bieżący;
- grafiki systemowe (`scooter.*`) są tylko do odczytu i nie da się ich usunąć; użytą grafikę chronią klucze obce `RESTRICT` (`MEDIA_IN_USE` z listą miejsc z `v_media_usages`);
- grafiki są dostępne dla każdego, kto zna adres, bo są publikowane na stronie; w bibliotece nie trzyma się materiałów wewnętrznych.

## 8.16. Wydruki i dane klienta
Od iteracji 7 ([ADR 0068](../adr/0068-wydruki-w-procesach.md)):
- **Dane wydruku** pochodzą z widoków `v_doc_*` (wiersz na obiekt, kwoty w groszach, czas UTC), a buduje je katalog rodzajów w core (`DOCUMENT_CATALOG`, `buildDocumentData`) z formatowaniem kwot i dat przed wstawieniem. Stopka `{document.footer}` podaje identyfikator wydruku, szablon z wersją, datę i operatora; dokument nosi numer obiektu, bez własnej numeracji.
- **Maskowanie:** zlecający bez `users.read` dostaje w pliku „Klient” zamiast imienia, nazwiska i telefonu. Maskowanie jest wypalone w pliku, więc wiersz pamięta `customer_data_visible` (migracja 0012). Szczegóły z adresami plików, pobranie i ponowienie takiego wiersza wymagają `users.read` od każdego operatora, także zlecającego; lista pokazuje go bez „Pobierz”.
- **Klient** pobiera tylko własny paragon (`POST /me/receipts/{id}/pdf`, `GET /me/documents/{id}`); gotowy PDF tej samej wersji szablonu jest używany ponownie.
- **Widoczność:** „Wydruki” w panelu z `templates.read` albo `documents.generate`; bez `templates.read` operator widzi tylko Wygenerowane i rodzaje, które może drukować.

## 8.17. Szablony DOCX
Od iteracji 7 ([ADR 0067](../adr/0067-szablony-wydrukow-docx.md)):
- **Składnia:** docxtemplater 3.71.1 z `paragraphLoop` i własnym parserem ścieżek z kropką bez wyrażeń: pola `{task.number}`, pętle `{#parts}…{/parts}`, warunki `{#hasParts}…{/hasParts}` i `{^…}`. Nowa potrzeba formatowania to zmiana katalogu w core, nie wyrażenie w szablonie.
- **Wgranie:** core rozpoznaje DOCX po zawartości (ZIP z `word/document.xml`, bez `.docm` i makr), pilnuje rozmiaru pliku i rozmiaru po rozpakowaniu (API rozpakowuje z `maxOutputLength`, ochrona przed bombą ZIP). Inspekcja czyta wszystkie części, które docxtemplater szablonuje (także komentarze, ustawienia, `docProps`, diagramy), i wszystkie elementy tekstu (`w:t`, `m:t`, `a:t`…), a znaczniki porównuje z katalogiem pól (nieznane pole, pętla, pole poza pętlą, zły typ).
- **Ochrona przy wypełnianiu:** `{@…}` (surowy XML) i zmiana ograniczników są zabronione także przy wydruku: moduł `templateGuardModule` kończy wydruk błędem `TEMPLATE_RENDER_FAILED`, a zmiana ograniczników jest wyłączona, więc i wersja wgrana wcześniej nie wstawi surowego XML.
- **Wersje:** wersji się nie zmienia; stany `PENDING` (do aktywacji, można usunąć), `ACTIVE` i `ARCHIVED` (kiedyś aktywna). Aktywacja i „Przywróć” to `sp_document_template_activate` z blokadą szablonu, bez kopiowania pliku; wydruki wskazują swoją wersję.
- **Szablony startowe** (`packages/db/seed/templates/*.docx`) odtwarza powtarzalnie `build.mjs`, a `manifest.json` zapisuje pola w tym samym formacie co inspekcja API (`parts[].sku`). Seed podmienia aktywną wersję startową, gdy suma pliku się zmieni, a wersji wgranych przez operatora nie rusza. Nota firmy jest w stopce, żeby wydruk z danymi przykładowymi mieścił się na jednej stronie.
