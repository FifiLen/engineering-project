# ADR 0064: Biblioteka mediów

- **Status:** zaakceptowana
- **Data:** 2026-11-18

## Kontekst

[ADR 0027](0027-tresci-sterowane-z-panelu.md) przewiduje grafiki z kluczem, tekstem alternatywnym i podpisem w `media_assets` (migracja 0002), z plikiem w `files`. Na grafiki wskazują `content_blocks.media_id`, `news.media_id` i `scooter_models.photo_media_id`. Tabela jest pusta.

Pliki działają według [ADR 0057](0057-pliki-zdjecia.md):
- `POST /files` przyjmuje tylko `PARKING_PHOTO` i `TICKET_PHOTO`, do 10 MB;
- typ API rozpoznaje po sygnaturze (`detectImageType` w `packages/core/src/files`);
- odczyt idzie przez adres z podpisem HMAC ważnym 10 min.

Rendery hulajnogi są wkompilowane w aplikację (`apps/mobile/assets/images/rendery`).

Odpowiedzi autora z 18 listopada 2026:
- **pytanie 10:** JPEG, PNG i WebP do 5 MB, bez SVG (skrypty) i GIF. Tekst alternatywny jest wymagany, wymiary zapisują się przy wysyłce. Serwer nie skaluje grafik, a panel ostrzega powyżej 2560 px;
- **D3:** grafiki z biblioteki są publiczne z długim cache, bo podpis na 10 min psuje cache strony i pamięć aplikacji. Zdjęcia klientów i wydruki zostają przy podpisie;
- **pytanie 12:** rendery wariantów pochodzą z mediów, a kopia w paczce służy tylko pierwszemu uruchomieniu bez sieci.

Makiety `tresci-media`, `tresci-media-wysylka` i `tresci-wybor-grafiki` ustalają, że:
- tekst alternatywny należy do grafiki, więc jego zmiana działa wszędzie;
- klucze systemowe (`scooter.*`) są tylko do odczytu i blokują usunięcie;
- „Zastąp plik” zachowuje identyfikator i użycia;
- wysyłka obejmuje do 10 plików naraz, a odrzucone pliki zostają na liście z przyczyną;
- klucz podpowiada nazwa pliku;
- sekcja może wymagać minimalnej szerokości (hero: 1200 px, grafika za wąska jest w oknie wyboru oznaczona „za mała”).

Sprawdzone 18 listopada 2026:
- **`image-size`** 2.1.0 (6 listopada, MIT, bez zależności, wydanie ESM). Funkcja dla bufora nie używa `node:fs`, robi to tylko `image-size/fromFile`.
- **Własny odczyt wymiarów** to kilkadziesiąt wierszy na bazie `detectImageType`:
  - PNG: pole `IHDR` w bajtach 16–23;
  - JPEG: znacznik `SOFn` po przejściu segmentów, także za miniaturą EXIF;
  - WebP: fragment `VP8 `, `VP8L` albo `VP8X`.
- **Fastify:** nagłówki ustawia `reply.header` bez dodatkowej wtyczki. API nie używa `helmet`, więc nie dokłada `Cross-Origin-Resource-Policy`, a `<img>` z innego pochodzenia działa bez CORS.

## Rozważane opcje

Adres grafiki:

1. **Podpis HMAC na 10 min (ADR 0057).** Adres zmienia się co kilka minut, więc strona z cache po 10 min pokazuje zepsute obrazy, a aplikacja bez sieci nie trafi w pamięć dyskową.
2. **Publiczny adres po identyfikatorze grafiki** (`/media/{id}`). Stały, ale „Zastąp plik” zmienia zawartość pod tym samym adresem, więc nie da się go długo trzymać w cache.
3. **Publiczny adres z sumą SHA-256 pliku** (`/media/{id}/{sha256}.{ext}`). Zawartość pod adresem nigdy się nie zmienia (`immutable`), a zastąpienie pliku daje nowy adres, który treści i strona dostają po odświeżeniu.

Odczyt wymiarów:

1. **`image-size`.** Gotowe i obsługuje wiele formatów, ale to zależność dla trzech formatów, które core już rozpoznaje.
2. **Własny odczyt nagłówka w core.** Testowalny w izolacji, bez zależności, zgodny z regułą `packages/core` bez `node:*` ([ADR 0025](0025-logika-biznesowa-packages-core.md)).

## Decyzja

Opcja 3 dla adresu i opcja 2 dla wymiarów.

### Wysyłka

- **`POST /files` z `purpose=MEDIA`** wymaga `content.write` (core `uploadPermission`). Limit dla `MEDIA` wynosi 5 MB, a zdjęcia klientów zostają przy 10 MB (core `uploadLimit(purpose)`).
- **Typ** po sygnaturze: JPEG, PNG albo WebP. SVG i GIF nie mają pasującej sygnatury, więc dostają `FILE_TYPE_NOT_ALLOWED` („SVG może zawierać skrypty”).
- **Wymiary:** core `readImageInfo(bytes)` czyta je z nagłówka całego pliku (do 5 MB w pamięci).
  - Brak wymiarów daje `IMAGE_UNREADABLE`.
  - Powyżej 8000 px w którymkolwiek wymiarze grafika dostaje `IMAGE_DIMENSIONS_TOO_LARGE`, żeby przeglądarka i telefon nie dekodowały ogromnej bitmapy.
  - Powyżej 2560 px jest tylko ostrzeżenie w panelu („możesz dodać mimo to”).
- **Utworzenie grafiki:** `POST /admin/media { fileId, key, altText, caption? }` w transakcji z dziennikiem audytu.
  - Klucz podpowiada nazwa pliku (`aktualnosc-kampus-2`), z przyrostkiem przy kolizji.
  - Tekst alternatywny ma 3–250 znaków, a podpis do 200.
  - Wysyłka wielu plików to w panelu seria takich par żądań. Odrzucone pliki zostają na liście z przyczyną z kodu błędu.

### Schemat (migracja 0011)

- **`files`:** kolumny `width` i `height` (`CHECK` obie puste albo obie dodatnie), wypełniane dla obrazów.
- **`media_assets`:**
  - `name` (nazwa wyświetlana, z nazwy pliku);
  - `is_system` (klucze z rejestru `SYSTEM_MEDIA_KEYS` w `packages/shared`, np. `scooter.grafit.trzy`, `scooter.kobalt.trzy`, `scooter.beton.trzy`, `scooter.grafit.bok`);
  - `CHECK` długości tekstu alternatywnego.

  Klucz zostaje unikalny i nie zmienia się po utworzeniu.
- **Widoki:**
  - `v_media_list` z liczbą użyć (bloki, aktualności, modele) i flagą systemową;
  - `v_media_usages` z miejscami użycia (rodzaj, identyfikator, nazwa sekcji, aktualności albo modelu) do szczegółów i komunikatu blokady.
- **Usunięcie** (`DELETE /admin/media/{id}`, `content.write`) jest możliwe tylko dla grafiki nieużytej i niesystemowej.
  - Klucze obce z bloków, aktualności i modeli są `RESTRICT`, a wyzwalacz odrzuca usunięcie grafiki systemowej.
  - API zwraca `MEDIA_IN_USE` z listą miejsc.
  - Po usunięciu wiersza plik dostaje `DELETED`, a obiekt znika z magazynu.

### Zastąpienie pliku i minimalna szerokość

- **`POST /admin/media/{id}/file { fileId, version }`** podmienia `file_id` z blokadą optymistyczną. Identyfikator i użycia zostają, a adres zmienia się razem z sumą SHA-256.
- **Stary plik** nie jest już wskazywany przez `media_assets`, więc usuwa go `files.cleanup` po 24 h. Rozszerzamy tę regułę o pliki `MEDIA` i `DOCUMENT_TEMPLATE`, których nic nie wskazuje.
- **Minimalna szerokość** pochodzi z rejestru sekcji ([ADR 0062](0062-modul-tresci-sekcje-publikacja-dane-firmy.md)). Core sprawdza ją przy przypięciu grafiki do bloku i przy zastąpieniu pliku grafiki, która jest już gdzieś użyta. Za wąska grafika daje `MEDIA_TOO_NARROW` z sekcją i wymaganą szerokością.

### Publiczny odczyt (zmienia ADR 0057 dla celu `MEDIA`)

`GET /media/{id}/{sha256}.{ext}` z `@Public()` strumieniuje obiekt z magazynu.

- **Zgodna suma:**
  - `Cache-Control: public, max-age=31536000, immutable`;
  - `ETag: "{sha256}"` (`If-None-Match` daje `304`);
  - `Content-Type`, `Content-Length`, `Content-Disposition: inline`, `X-Content-Type-Options: nosniff`.
- **Suma starszej wersji:** `308` na bieżący adres z `Cache-Control: public, max-age=300`, więc nieodświeżony klient nadal dostaje obraz.
- **Nieznany identyfikator** daje `404`.

Widoki API podają adres względny (`/media/…`), który klienci doklejają do adresu API, jak przy plikach. Publiczny jest tylko cel `MEDIA`. Zdjęcia parkowania i zgłoszeń, szablony, wydruki i eksport danych zostają przy podpisie HMAC (ADR 0057). Grafiki nie podlegają retencji 30 dni.

### Rendery w aplikacji (wyjątek z pytania 12)

- **Komponent renderu** (`components/scooter.tsx`) bierze grafikę z treści (`GET /content/mobile`, klucze `scooter.*`), a pokazuje ją `expo-image` z pamięcią dyskową. Kopia w `assets/images/rendery` służy tylko wtedy, gdy aplikacja nie ma jeszcze treści w pamięci (pierwsze uruchomienie bez sieci).
- **Wyjątek** opisujemy w pracy obok ikony i ekranu startowego (ADR 0027). Kopie w paczce aktualizuje się ręcznie przy zmianie renderu; po pierwszym pobraniu aplikacja i tak pokazuje grafikę z biblioteki.
- **Dane startowe:** seed wgrywa rendery z `docs/projekt/rendery/` do SeaweedFS jako grafiki systemowe, więc wymaga `pnpm infra:up`. Testy API używają `FILE_STORAGE=memory`.

### Panel

- Siatka z wyszukiwaniem po nazwie, kluczu i tekście alternatywnym oraz z filtrami „Używane” i „Nieużywane”.
- Szczegóły z miejscami użycia, edycją tekstu i podpisu, „Zastąp plik” i usunięciem.
- Okno wyboru grafiki w blokach, aktualnościach i formularzu modelu (`scooter_models.photo_media_id`) z oznaczeniem „za mała” według sekcji.
- Uprawnienia: podgląd `content.read`, zmiany `content.write`.

## Konsekwencje

Pozytywne:

- Strona z cache i aplikacja bez sieci mają stałe adresy grafik. Przeglądarka i `expo-image` trzymają je bez ponownego pobierania.
- Zastąpienie pliku nie wymaga zmian w blokach, aktualnościach ani modelach, a stary adres nadal prowadzi do obrazu.
- Typ i wymiary sprawdza core bez nowej zależności, z testami na prawdziwych nagłówkach trzech formatów.

Negatywne i ryzyka:

- Grafiki z biblioteki są dostępne dla każdego, kto zna adres. To świadome: są publikowane na stronie. W bibliotece nie wolno trzymać materiałów wewnętrznych, co opisuje podpowiedź w panelu.
- Grafiki przechodzą przez proces API, bez CDN. Przy ruchu strony w produkcji potrzebny byłby serwer pośredniczący z cache przed API.
- Bez skalowania na serwerze strona i aplikacja pobierają pełny plik, dlatego panel ostrzega powyżej 2560 px.
- Kopie renderów w paczce mogą się różnić od biblioteki do pierwszego pobrania treści.

## Powiązane

[ADR 0057](0057-pliki-zdjecia.md) (zmienia: odczyt plików celu `MEDIA` publicznym adresem z SHA-256 zamiast podpisu HMAC), [ADR 0027](0027-tresci-sterowane-z-panelu.md) (wyjątek dla renderów w paczce), [ADR 0024](0024-magazyn-plikow-seaweedfs.md), [ADR 0025](0025-logika-biznesowa-packages-core.md), [ADR 0062](0062-modul-tresci-sekcje-publikacja-dane-firmy.md), [ADR 0065](0065-strona-promocyjna-z-tresci.md), [plan iteracji 7](../iteracje/iteracja-07-tresci-wydruki.md) (pytania 10 i 12, D3), makiety `tresci-media`, `tresci-media-wysylka`, `tresci-wybor-grafiki`
