# ADR 0041: Kod QR hulajnogi

- **Status:** zaakceptowana
- **Data:** 2026-11-16

## Kontekst

Klient zaczyna przejazd bez rezerwacji, skanując kod na kierownicy (`flow-skan`), albo wpisując numer z naklejki. Trzeba ustalić, co zawiera kod, jak aplikacja go czyta i kto go drukuje. Numer hulajnogi jest liczbą (w tematach MQTT cztery cyfry z zerami wiodącymi, np. `0142`), a nazwa marki i domena są dalej otwarte (`CLAUDE.md`).

## Rozważane opcje

1. **Sam numer** (`0142`). Najprostszy, ale aparat systemowy pokaże tylko liczbę, bez możliwości otwarcia aplikacji.
2. **Własny schemat adresu** (`hulajnogi://s/0142`). Otwiera aplikację, ale bez zainstalowanej aplikacji aparat systemowy nic z nim nie zrobi.
3. **Adres HTTPS strony** (`https://<domena>/h/0142`). Aparat systemowy otwiera stronę z odnośnikiem do sklepu albo, po skonfigurowaniu uniwersalnych łączy, aplikację. Skaner w aplikacji wyciąga numer z adresu.

## Decyzja

Opcja 3.

- **Treść kodu:** `${PUBLIC_SITE_URL}/h/{numer}`, numer jako cztery cyfry. `PUBLIC_SITE_URL` jest w konfiguracji, bo domena zależy od nazwy marki. Strona `/h/{numer}` w `apps/web` (od iteracji 7, razem ze stroną promocyjną) pokaże numer i odnośniki do aplikacji.
- **Odczyt w aplikacji:** funkcja `parseScooterCode` w `packages/shared` przyjmuje adres w tym formacie (dowolna domena, ścieżka `/h/`) albo sam numer (1–4 cyfry) i zwraca numer albo `null`. Z tej samej funkcji korzysta pole „Wpisz numer hulajnogi”. Kod spoza formatu daje komunikat „To nie jest kod naszej hulajnogi” bez zapytania do API.
- **API:** `GET /scooters/by-number/{number}` zwraca widok hulajnogi dla klienta z dostępnością i przyczyną niedostępności (`SCOOTER_UNAVAILABLE` z `reason`). Kod nie zawiera identyfikatora UUID ani podpisu, bo numer jest i tak wydrukowany na hulajnodze, a dostęp chroni logowanie klienta.
- **Wydruk:** naklejka z kodem i numerem na karcie hulajnogi w panelu jako wydruk z szablonu ([ADR 0030](0030-wydruki-z-szablonow-docx.md)) w iteracji 7. W tej iteracji kody do demo generuje polecenie deweloperskie albo dowolny generator QR.

## Konsekwencje

Pozytywne:

- Ten sam kod działa w aplikacji, w aparacie systemowym i po zmianie domeny (skaner nie sprawdza domeny).
- Wpisanie numeru i skan to jedna ścieżka w kodzie, więc da się ją przetestować bez aparatu.

Negatywne i ryzyka:

- Kod bez podpisu da się podrobić (naklejka z innym numerem); skutkiem jest najwyżej próba wypożyczenia innej hulajnogi, a aplikacja pokazuje numer przed odblokowaniem.
- Uniwersalne łącza (Apple App Site Association, Android App Links) wymagają domeny; do tego czasu adres z aparatu systemowego otwiera tylko stronę.

## Powiązane

[ADR 0040](0040-mapa-lokalizacja-aparat-w-aplikacji.md), [ADR 0030](0030-wydruki-z-szablonow-docx.md), [ADR 0036](0036-proces-wypozyczenia-w-api.md)
