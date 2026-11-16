# ADR 0035: Sesje, tokeny i strażnik uprawnień w API

- **Status:** zaakceptowana
- **Data:** 2026-11-16

## Kontekst

[ADR 0019](0019-uwierzytelnianie.md) ustala sposób logowania (kod SMS dla klientów, hasło z TOTP dla operatorów, JWT na 15 min i token odświeżający jako skrót w bazie), a [ADR 0028](0028-uzytkownicy-role-uprawnienia.md) ustala `@RequirePermission` na każdym punkcie panelu. Do rozstrzygnięcia zostało:

- gdzie klienci przechowują tokeny: aplikacja mobilna nie ma ciasteczek przeglądarki, panel działa w przeglądarce na innym porcie niż API (ten sam host w środowisku deweloperskim);
- jak długo żyje sesja panelu i co robi „Zapamiętaj to urządzenie” z [makiety logowania](../projekt/ekrany/13-panel/admin-logowanie.png);
- jak przechować stan między hasłem a kodem TOTP;
- jak wykryć kradzież tokenu odświeżającego;
- jak strażnik ma traktować punkt panelu, któremu ktoś zapomniał nadać uprawnienie;
- jak uwierzytelnić połączenie Socket.IO z pokojem `fleet` ([ADR 0012](0012-socket-io.md)).

## Rozważane opcje

1. **Oba klienty z tokenem w nagłówku `Authorization`, token odświeżający w pamięci trwałej** (panel: `localStorage`). Jeden mechanizm, ale token odświeżający panelu jest dostępny dla każdego skryptu na stronie (XSS) i żyje do 7 dni.
2. **Sesja panelu w ciasteczku z tokenem dostępowym**. Ciasteczko wysyłane automatycznie wymaga ochrony przed CSRF przy każdym zapisie, a połączenie Socket.IO i tak potrzebuje tokenu.
3. **Token dostępowy w nagłówku dla obu klientów; token odświeżający panelu w ciasteczku `httpOnly`, aplikacji w bezpiecznym magazynie telefonu**. Skrypt w panelu nie odczyta tokenu odświeżającego, a token dostępowy w nagłówku nie jest wysyłany automatycznie, więc zapisy nie potrzebują osobnej ochrony przed CSRF.

## Decyzja

Opcja 3.

**Tokeny dostępowe.** JWT HS256 (`JWT_SECRET`, w produkcji wymagany, co najmniej 32 znaki) z polami `sub`, `typ` (`customer` albo `staff`), `sid` (sesja) i `exp` (15 min). Uprawnienia operatora nie są w tokenie: strażnik czyta je z `v_staff_permissions` z pamięcią podręczną na 10 s, czyszczoną przy zmianie ról i uprawnień w tej instancji API. Zmiana ról działa więc od następnego żądania, a dezaktywacja operatora odcina go od razu, bo widok pomija nieaktywnych.

**Tokeny odświeżające.** 256 bitów losowości, w bazie tylko skrót SHA-256. Każde odświeżenie wydaje nowy token (rotacja w tej samej rodzinie). Użycie tokenu już zastąpionego unieważnia całą rodzinę (ktoś go przechwycił); wyjątek to 10 s po rotacji, bo aplikacja może wysłać dwa odświeżenia naraz ([`sessions.ts`](../../packages/core/src/accounts/sessions.ts)).

- Aplikacja: token odświeżający w treści odpowiedzi, przechowywany w `expo-secure-store`; ważny 30 dni.
- Panel: ciasteczko `hj_staff_refresh` (`httpOnly`, `SameSite=Strict`, `Path=/admin/auth`, `Secure` w produkcji). Sesja trwa 12 h (jedna zmiana), a z „Zapamiętaj to urządzenie” 7 dni. Kod TOTP jest wymagany przy każdym logowaniu; zapamiętanie wydłuża tylko sesję. Token dostępowy panel trzyma w pamięci i odnawia przez `POST /admin/auth/refresh`.

**Drugi krok logowania.** Po poprawnym haśle API zwraca krótki token `mfaToken` (JWT `typ=staff_mfa`, 5 min, z flagą zapamiętania i krokiem `TOTP` albo `TOTP_SETUP`). Nie ma tabeli stanu pośredniego; nieudane próby hasła i kodu liczą się razem w `staff.failed_logins`. Sekret TOTP jest szyfrowany AES-256-GCM kluczem `TOTP_ENCRYPTION_KEY` i potwierdzany pierwszym kodem; ostatni użyty krok TOTP jest zapisany, więc ten sam kod nie zadziała drugi raz.

**Strażnik.** Jeden globalny strażnik (`APP_GUARD`) i trzy dekoratory: `@Public()`, `@CustomerAuth()` i `@RequirePermission('…')`. Punkt bez żadnego z nich jest odrzucany (`403 PERMISSION_NOT_DECLARED`), więc zapomniane uprawnienie widać w testach, a nie po wdrożeniu. Błędy: `401 UNAUTHENTICATED` (brak albo nieważny token), `403 FORBIDDEN` z nazwą brakującego uprawnienia.

**Socket.IO.** Klient podaje token dostępowy w `auth.token` przy połączeniu; dołączenie do pokoju `fleet` wymaga operatora z `scooters.read`. Po wygaśnięciu tokenu panel łączy się ponownie z nowym.

**Bramka SMS.** Interfejs `SmsGateway`; w środowisku deweloperskim i w testach implementacja zapisuje wiadomość w logu API (kod widać w terminalu), w produkcji potrzebny jest dostawca.

## Konsekwencje

Pozytywne:

- Token odświeżający panelu jest niedostępny dla skryptów; zapisy w panelu nie potrzebują tokenu CSRF.
- Wylogowanie, blokada konta i dezaktywacja operatora unieważniają sesje w bazie; skradziony token odświeżający zdradza się przy pierwszym użyciu przez prawowitego właściciela.
- Zapomniane `@RequirePermission` kończy się błędem, a nie otwartym punktem.

Negatywne i ryzyka:

- Token dostępowy klienta działa do 15 min po wylogowaniu albo blokadzie; operacje z regułami (rezerwacja od iteracji 3) sprawdzają stan konta w bazie.
- Pamięć podręczna uprawnień jest lokalna dla instancji API; przy kilku instancjach zmiana ról dociera do pozostałych po 10 s.
- `SameSite=Strict` wymaga, żeby panel i API były w tej samej witrynie (ta sama domena nadrzędna); przy innym układzie wdrożenia potrzebny jest nowy ADR.

## Powiązane

[ADR 0012](0012-socket-io.md), [ADR 0019](0019-uwierzytelnianie.md), [ADR 0025](0025-logika-biznesowa-packages-core.md), [ADR 0028](0028-uzytkownicy-role-uprawnienia.md), [plan iteracji 2](../iteracje/iteracja-02-konta-dostep.md), arc42 §8 (bezpieczeństwo).
