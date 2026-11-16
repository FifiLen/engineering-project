# Iteracja 2: konta i dostęp

**Status:** zaplanowana (16 listopada 2026)

## Cel
Klient zakłada konto w aplikacji kodem SMS i akceptuje obowiązującą wersję regulaminu i polityki prywatności. Operator loguje się do panelu hasłem i kodem TOTP; dostęp do każdego punktu API i każdej pozycji panelu wynika z jego ról ([ADR 0019](../adr/0019-uwierzytelnianie.md), [ADR 0028](../adr/0028-uzytkownicy-role-uprawnienia.md)). Role, operatorzy i klienci są zarządzani w panelu, a każdy zapis operatora (także zapisy floty i modeli z iteracji 1) trafia do `audit_log` i jest widoczny jako historia zmian w formularzu.

Wymagania uczelni: 10 (logowanie klientów i operatorów, jeden moduł uwierzytelniania), 11 (operatorzy, role i macierz uprawnień w panelu), 12 (nowe tabele w panelu: operatorzy, role, klienci, dziennik audytu, dokumenty), 13 (domknięty proces konta klienta: rejestracja, zgody, blokada i odblokowanie).

## Warunek wstępny: makiety
Zrobione 16 listopada 2026: 12 plansz panelu w [`18-panel-dostep`](../projekt/README.md#panel-operatora-konta-i-dostęp) i 3 plansze aplikacji w [`19-mobile-dostep`](../projekt/README.md#aplikacja-konta-i-dostęp) (HTML i PNG), według [design systemu](../projekt/design-system.md) i [wzorca widoku tabeli](../projekt/README.md#panel-operatora-wzorzec-widoku-tabeli).

- [x] Logowanie operatora, drugi krok: kod TOTP z błędem i liczbą pozostałych prób (pierwszy krok jest w `13-panel/admin-logowanie`)
- [x] Konfiguracja TOTP (kod QR, klucz do przepisania, potwierdzenie kodem)
- [x] Aktywacja konta z zaproszenia (ustawienie hasła)
- [x] Operatorzy: lista oraz formularz (dane, role, sesje, reset TOTP, historia zmian, dezaktywacja)
- [x] Role: lista oraz edycja roli jako macierz uprawnień pogrupowanych według modułów
- [x] Klient: szczegóły (zgody z wersjami dokumentów, dane, sesje, historia zmian) i blokada z powodem; lista klientów jest w `13-panel/admin-uzytkownicy`
- [x] Dziennik audytu: lista z filtrami i szczegóły wpisu (pola przed i po)
- [x] Dokumenty prawne: lista wersji z liczbą akceptacji, edycja wersji roboczej z podglądem
- [x] Aplikacja: ponowna akceptacja nowej wersji dokumentu, konto zablokowane, wyczerpane próby kodu SMS

Wnioski z makiet dla zakresu:
- Wersja dokumentu ma pole „Najważniejsze zmiany” (`content_page_versions.change_summary`), które aplikacja pokazuje przy ponownej akceptacji.
- Publikacja wersji działa od razu (jedna opublikowana wersja na dokument, indeks `content_page_versions_one_published`); publikacji z datą w przyszłości nie ma.
- Powód blokady to kategoria widoczna dla klienta (`users.blocked_reason`: naruszenie regulaminu, zaległa płatność, podejrzenie nadużycia), a notatka operatora trafia tylko do dziennika audytu.
- Historia zmian klienta pokazuje działania operatorów (`audit_log`); zgody klienta są w osobnej karcie z `consents`.
- Klient bez akceptacji obowiązującej wersji widzi mapę, ale nie zarezerwuje hulajnogi (reguła w `packages/core`, sprawdzana od iteracji 3).

## Zakres
- [x] **Migracja 0004** ([`0004_accounts_access.sql`](../../packages/db/migrations/0004_accounts_access.sql), testy w `packages/db/src/db.test.ts`):
  - `staff_sessions` (token odświeżający operatora jako skrót, urządzenie, wygaśnięcie, unieważnienie), `staff_invitations` (skrót tokenu, wygaśnięcie, przyjęcie);
  - `staff`: `password_hash` opcjonalne do przyjęcia zaproszenia, `totp_confirmed_at`, `failed_logins`, `locked_until`, `last_login_at` (`updated_at` i `version` są od migracji 0002);
  - `users`: `blocked_at`, `blocked_reason` (kategoria); `content_page_versions`: `change_summary`; `sessions`: `last_used_at`, `replaced_by` (wykrywanie ponownego użycia tokenu);
  - widoki `v_audit_log` (z nazwą operatora), `v_roles_overview` (liczba uprawnień i operatorów), `v_user_consents` (zgody z wersją i informacją, czy wersja obowiązuje), rozszerzone `v_staff_overview` i `v_user_activity`; funkcja `fn_user_pending_documents(user_id)`; procedury `sp_revoke_user_sessions(user_id)` i `sp_revoke_staff_sessions(staff_id)`;
  - strażnik ostatniego operatora z `roles.manage` w bazie (odroczone wyzwalacze ograniczeń, `fn_check_role_manager`), uzupełniający regułę z core;
  - indeksy dziennika audytu (historia rekordu, lista według czasu i operatora).
- [x] **`packages/core`** (`access/roles`, nowe `accounts` i `audit`; porty repozytoriów razem z repozytoriami w `packages/db`):
  - kod SMS: 6 cyfr, ważny 5 min, 5 prób, ponowne wysłanie po 60 s, limit kodów na numer na godzinę;
  - sesje: rotacja tokenu odświeżającego, ponowne użycie starego tokenu unieważnia całą rodzinę sesji;
  - logowanie operatora: blokada po 5 nieudanych próbach na 15 min, TOTP z oknem ±1 krok, zaproszenie ważne 72 h;
  - RBAC: ostatni aktywny operator z `roles.manage` (nie można mu odebrać uprawnienia ani go dezaktywować), rola systemowa, operator nie zmienia własnych ról;
  - konto klienta: blokada z powodem i odblokowanie, wymagane zgody i wiek z cennika (`min_user_age`), porównanie zaakceptowanych wersji z obowiązującymi;
  - wpis dziennika audytu: różnica pól przed i po, bez sekretów.
- [x] **`packages/db`**: repozytoria kont, sesji, kodów, operatorów, zaproszeń, ról, audytu i dokumentów; `ListSource` dla `staff`, `roles`, `users`, `audit-log`, `legal-documents`; dane startowe: operatorzy deweloperscy z rolami startowymi, regulamin i polityka prywatności w wersji 1; polecenie tworzące pierwszego administratora (`pnpm db:staff:create`).
- [x] **`packages/shared`**: schematy żądań i odpowiedzi uwierzytelniania, definicje zasobów panelu `staff`, `roles`, `users`, `audit-log` (dokumenty prawne bez wspólnego mechanizmu list: trzy dokumenty po kilka wersji, pełny moduł treści w iteracji 7).
- [x] **API** ([ADR 0035](../adr/0035-sesje-tokeny-i-straznik-uprawnien.md)):
  - [x] moduł `auth` (klienci): `POST /auth/otp`, `POST /auth/otp/verify`, `POST /auth/refresh`, `POST /auth/logout`, `GET/PATCH /me`, `POST /me/registration`, `POST /me/consents`, `GET /legal/{slug}`; bramka SMS za adapterem (w środowisku deweloperskim kod w logach);
  - [x] moduł `staff-auth` (operatorzy): `POST /admin/auth/login`, `POST /admin/auth/totp` (kod albo konfiguracja TOTP), zaproszenie (`GET /admin/auth/invitations/{token}`, `POST …/accept`), `POST /admin/auth/refresh` i `logout` z ciasteczkiem `httpOnly`, `GET /admin/auth/me`;
  - [x] globalny strażnik: `@Public`, `@CustomerAuth`, `@RequirePermission` na każdym punkcie, także z iteracji 1; punkt bez deklaracji odrzucany; uprawnienia z `v_staff_permissions` z pamięcią podręczną 10 s; uwierzytelnienie Socket.IO i pokoju `fleet`;
  - [x] zapisy do `audit_log` w tej samej transakcji co zmiana (`AuditedTransaction`): flota, modele, komendy, operatorzy, role, klienci, dokumenty, logowanie operatora; historia rekordu `GET …/{id}/history` z uprawnieniem odczytu zasobu;
  - [x] zasoby panelu: `/admin/staff` (zaproszenie, role, dezaktywacja, ponowne zaproszenie, reset TOTP, wylogowanie), `/admin/roles` z macierzą, `/admin/permissions`, `/admin/users` (dane, blokada, odblokowanie, wylogowanie), `/admin/audit-log`, `/admin/legal-documents` (wersja robocza, edycja, publikacja, usunięcie wersji roboczej);
  - [x] błędy `UNAUTHENTICATED` (401), `FORBIDDEN` (403), `RATE_LIMITED` i `ACCOUNT_LOCKED` (429 z `Retry-After`) w formacie `{ code, message, details }`.
- [x] **Panel**:
  - [x] logowanie z TOTP, konfiguracja TOTP z kodem QR, aktywacja z zaproszenia (`/admin/logowanie`, `/admin/aktywacja`), wylogowanie, odtwarzanie sesji z ciasteczka i odświeżanie tokenu, adres powrotu po logowaniu;
  - [x] nawigacja i przyciski według uprawnień (formularz tylko do odczytu bez `…write`), blok operatora z wylogowaniem; Socket.IO z tokenem i ponownym połączeniem po odświeżeniu;
  - [x] Operatorzy (lista, zaproszenie z linkiem, karta z rolami, sesjami, resetem TOTP i dezaktywacją), Role z macierzą uprawnień, Użytkownicy (lista, karta ze zgodami i sesjami, blokada z powodem), Dziennik audytu (lista i wpis), Treści → Dokumenty prawne (wersje, edytor wersji roboczej z podglądem, publikacja); karta „Historia zmian” w formularzach, także floty i modeli z iteracji 1.
- [x] **Aplikacja** (trasy `/witaj`, `/telefon`, `/kod`, `/dane`, `/zasady`, `/zgody`, `/zablokowane`, `/konto`, `/dokument/{slug}`): start, numer telefonu ze zgodą na regulamin i politykę, kod SMS z odliczaniem, dane (imię, e-mail, wiek, zgoda marketingowa), zasady przed pierwszą jazdą, logowanie; tokeny w `expo-secure-store`, odświeżanie przy 401, ponowna akceptacja nowej wersji dokumentu, ekran konta zablokowanego; ekran po zalogowaniu jako zaślepka z wylogowaniem do iteracji 3.
- [ ] **Kontrakty i dokumentacja**: OpenAPI dla punktów `/auth`, `/me`, `/legal` (pierwszy klient API spoza panelu), diagram rejestracji i logowania w arc42 §6, model danych, ADR-y nowych decyzji (sesje operatorów w ciasteczku, dziennik audytu w transakcji, uwierzytelnianie Socket.IO), tabela zgodności w [wymaganiach uczelni](../wymagania-uczelni.md).

## Poza zakresem (świadomie)
- Korekta salda na karcie klienta: iteracja 5 (portfel i księga). Karta pokazuje saldo z `v_user_activity`.
- Logowanie e-mailem w aplikacji (link „Użyj adresu e-mail” na makietach): ADR 0019 przewiduje tylko kod SMS; link ukryty, odstępstwo w dzienniku.
- Prawdziwa bramka SMS i wysyłka zaproszeń e-mailem: adaptery z implementacją deweloperską (kod i link w logach API oraz jednorazowo w panelu po utworzeniu zaproszenia).
- Profil, ustawienia i usunięcie konta w aplikacji (`sp_anonymize_user`): razem z nawigacją aplikacji w iteracji 3.
- Pełny moduł treści (bloki, FAQ, aktualności, media): iteracja 7. Tu tylko dokumenty z wersjami potrzebne do zgód.
- Czyszczenie kodów SMS i sesji zadaniem pg-boss: iteracja 3 (razem z partycjami telemetrii).

## Decyzje do potwierdzenia
Potwierdzone przez autora 16 listopada 2026:

1. Kod SMS ma 6 cyfr, tak jak pole kodu w design systemie i na makiecie `flow-kod` (6 komórek, 4 wypełnione w trakcie wpisywania). Przy 5 próbach szansa zgadnięcia to 1:200 000.
2. Operator dostaje zaproszenie i sam ustawia hasło oraz TOTP; pierwszego administratora tworzy polecenie w terminalu, nie formularz w panelu.
3. Minimalny wiek klienta pochodzi z obowiązującej wersji cennika (`tariffs.min_user_age`, w seedzie wartość deweloperska), więc zmiana wieku to nowa wersja cennika.

## Scenariusz demo
Do uzupełnienia po implementacji (kroki: rejestracja w aplikacji z kodem z logów API, logowanie operatora z TOTP, odebranie uprawnienia na żywo i 403 w panelu, blokada klienta i wylogowanie jego sesji, publikacja nowej wersji regulaminu i ponowna akceptacja w aplikacji, historia zmian hulajnogi z dziennika audytu, próba odebrania `roles.manage` ostatniemu administratorowi).

## Wynik
Do uzupełnienia po zakończeniu iteracji ([dziennik](../dziennik.md)).
