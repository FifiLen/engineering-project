# ADR 0057: Pliki: zdjęcia zgłoszeń i parkowania

- **Status:** zaakceptowana
- **Data:** 2026-11-18

## Kontekst

Iteracja 6 wprowadza pierwsze pliki: zdjęcie parkowania po zakończeniu przejazdu (pytanie 9) i zdjęcia w zgłoszeniu, najwyżej 3 ([ADR 0055](0055-zgloszenia-i-proces-serwisowy.md)). Odpowiedź autora na pytanie 9:
- zdjęcie parkowania jest opcjonalne, a wymagane po zakończeniu bez łączności ([ADR 0056](0056-przejazd-bez-lacznosci-i-niska-bateria.md));
- przechowujemy je 30 dni, chyba że trafiło do zgłoszenia.

[ADR 0024](0024-magazyn-plikow-seaweedfs.md) wybrał SeaweedFS z bramą S3 i założył wysyłkę z aplikacji bezpośrednio do magazynu przez podpisany adres (arc42 §6.4). Podpisanego PUT nie sprawdzono jeszcze w działaniu. Tabela `files` ma klucz, cel, typ i rozmiar, ale nie ma stanu, sumy kontrolnej ani znacznika usunięcia. `rentals.parking_photo_id` to klucz obcy do `files`.

Ograniczenia:
- aplikacja działa też w przeglądarce (wersja web bez aparatu, wybór pliku);
- telefon w sieci lokalnej nie widzi `localhost:8333`;
- panel wyświetla zdjęcia w `<img>`, który nie wysyła nagłówka `Authorization`.

## Rozważane opcje

1. **Podpisany adres S3 do wysyłki i odczytu** (pierwotne założenie). Pliki omijają API. Ma jednak wady:
   - magazyn musi być osiągalny z telefonu i przeglądarki;
   - przeglądarka potrzebuje CORS w SeaweedFS;
   - limit rozmiaru trzeba podpisać nagłówkiem;
   - po wysyłce API musi i tak sprawdzić obiekt.
2. **Wysyłka i odczyt przez API**, które strumieniuje do S3. API sprawdza typ po zawartości, rozmiar i uprawnienia, a magazyn zostaje w sieci wewnętrznej. Kosztem jest ruch przez API. Przy zdjęciach po kompresji (kilkaset KB) jest pomijalny.

## Decyzja

**Opcja 2.** Zmienia założenie z ADR 0024 i arc42 §6.4 w części o podpisanym adresie; wybór SeaweedFS i API S3 zostaje.

- **Biblioteki:**
  - `@aws-sdk/client-s3` 3.1169.0 (najnowsza starsza niż 3 dni), z `forcePathStyle` i `S3_ENDPOINT`;
  - `@fastify/multipart` 10.1.8 (Fastify 5.x, w projekcie 5.12.7).

  Port `FileStorage` (`put`, `get`, `delete`) ma adapter S3 i adapter w pamięci do testów API. Jeden test integracyjny działa na SeaweedFS, gdy `S3_ENDPOINT` jest dostępny.
- **Wysyłka:** `POST /files` (`multipart/form-data`, jedno pole `file`, pole `purpose`). Wysyła klient (`@CustomerAuth`) albo operator z uprawnieniem do celu. Zasady:
  - limit 10 MB;
  - API przyjmuje JPEG, PNG i WebP rozpoznane po sygnaturze pliku, nie po nagłówku;
  - API liczy SHA-256;
  - klucz `{cel}/{rrrr}/{mm}/{uuid}.{rozszerzenie}` wybiera API.

  Plik dostaje stan `READY` i właściciela, ale nie jest jeszcze przypięty do niczego.
- **Aplikacja przed wysyłką** zmniejsza zdjęcie do 1600 px dłuższego boku i koduje jako JPEG (jakość 0,7) przez `expo-image-manipulator`. Zdjęcie z galerii (HEIC na iOS) też przechodzi tę konwersję, więc makieta może mówić „JPG, PNG albo HEIC”. Wersja web wybiera plik przez `expo-image-picker`. Wersje modułów daje `expo install` (SDK 58: `expo-image-picker` ~58.0.10, `expo-image-manipulator` ~58.0.16).
- **Przypięcie:**
  - `POST /rentals/{id}/parking-photo { fileId }` po zakończeniu przejazdu;
  - `photoIds` przy tworzeniu zgłoszenia.

  API sprawdza właściciela, cel i to, że plik nie jest przypięty gdzie indziej. Nieprzypięte pliki starsze niż 24 h usuwa zadanie `files.cleanup`.
- **Odczyt:** `GET /files/{id}?exp=…&sig=…` strumieniuje plik z `Cache-Control: private`. Widoki API (przejazd, zgłoszenie) podają gotowy adres z podpisem HMAC (sekret API) ważnym 10 min, wystawiony tylko temu, kto ma dostęp do rekordu:
  - właścicielowi;
  - operatorowi z `rentals.read` dla zdjęcia parkowania;
  - operatorowi z `tickets.read` dla zdjęcia zgłoszenia.

  `<img>` w panelu i `Image` w aplikacji działają bez nagłówków.
- **Schemat (migracja 0008):**
  - `files`: `status` (`READY`, `DELETED`), `sha256`, `deleted_at`;
  - `ticket_photos.position`.

  Wiersz pliku zostaje po usunięciu obiektu, więc klucze obce z `rentals` i `ticket_photos` są nienaruszone.
- **Retencja:** zadanie `files.retention` raz na dobę usuwa z magazynu zdjęcia parkowania starsze niż 30 dni, które nie są w żadnym zgłoszeniu, i ustawia `DELETED`. Widok przejazdu pokazuje „Zdjęcie usunięte po 30 dniach”. Zdjęcia zgłoszeń zostają razem ze zgłoszeniem.

## Konsekwencje

Pozytywne:

- Jedna ścieżka wysyłki dla telefonu, przeglądarki i panelu, bez CORS i bez wystawiania magazynu na zewnątrz.
- Typ, rozmiar i uprawnienia sprawdza API, więc magazyn nie przyjmie pliku, którego baza nie zna.
- Usunięcie po 30 dniach nie łamie kluczy obcych ani historii przejazdu.

Negatywne i ryzyka:

- Pliki przechodzą przez proces API. Przy wielu jednoczesnych wysyłkach to obciążenie, które podpisany adres by ominął. W skali projektu nieistotne, a do opcji 1 można wrócić bez zmiany modelu danych.
- Podpisany adres odczytu działa przez 10 min także po przekazaniu komuś innemu. Akceptowane przy krótkim czasie i braku danych osobowych na zdjęciach hulajnóg.
- Moduły aparatu i wyboru zdjęć wymagają development build do pełnego sprawdzenia na telefonie (otwarte zadanie w `CLAUDE.md`).

## Powiązane

[ADR 0024](0024-magazyn-plikow-seaweedfs.md) (zmienia w części o podpisanym adresie wysyłki), [ADR 0040](0040-mapa-lokalizacja-aparat-w-aplikacji.md), [ADR 0055](0055-zgloszenia-i-proces-serwisowy.md), [ADR 0056](0056-przejazd-bez-lacznosci-i-niska-bateria.md), arc42 §6.4 i §8, [plan iteracji 6](../iteracje/iteracja-06-operacje-serwis.md) (pytanie 9), makiety `zdjecie-parkowania*`
