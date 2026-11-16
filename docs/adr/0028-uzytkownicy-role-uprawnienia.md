# ADR 0028: Użytkownicy, role i uprawnienia zarządzane w panelu

- **Status:** zaakceptowana
- **Data:** 2026-11-16

## Kontekst

Punkt 11 wymagań uczelni wymaga modułu zarządzania użytkownikami i grupami uprawnień dostępnego z interfejsu. Obecnie rola operatora to typ wyliczeniowy `staff_role` (`ADMIN`, `DISPATCHER`, `SERVICE`) w kolumnie `staff.role`. Zmiana zakresu uprawnień wymaga więc nowej migracji i wdrożenia, a panel nie ma czym zarządzać.

W systemie są dwa rodzaje kont z różnym logowaniem ([ADR 0019](0019-uwierzytelnianie.md)): klienci (`users`, kod SMS) i operatorzy (`staff`, hasło z TOTP).

## Rozważane opcje

1. **Zostawić role na sztywno**. Nie spełnia punktu 11.
2. **Jedna tabela kont dla klientów i operatorów z rolami**. Jedno pojęcie konta i jedno logowanie, ale klient i operator mają inne ryzyko, inne logowanie i inne dane; przypadkowe nadanie uprawnień operatora kontu klienta byłoby groźne.
3. **Kontrola dostępu oparta na rolach (RBAC) dla operatorów, osobne zarządzanie kontami klientów**. Uprawnienia zdefiniowane w kodzie, role i przypisania edytowane w panelu.

## Decyzja

Opcja 3.

**Dane** (migracja 0002):

- `permissions`: kod uprawnienia (np. `scooters.read`, `scooters.command`, `zones.write`, `users.block`, `content.write`, `reports.run`, `templates.write`, `roles.manage`), moduł i opis. Lista uprawnień jest katalogiem w `packages/core`, bo to kod sprawdza uprawnienia; migracja i dane startowe synchronizują go z tabelą.
- `roles`: nazwa, opis, znacznik roli systemowej (nie można jej usunąć).
- `role_permissions` i `staff_roles`: wiele-do-wielu; operator może mieć kilka ról.
- Migracja zamienia `staff.role` na przypisania do ról startowych Administrator, Dyspozytor i Serwisant, a następnie usuwa kolumnę i typ `staff_role`.

**Reguły** (polityka uprawnień w `packages/core`, [ADR 0025](0025-logika-biznesowa-packages-core.md)):

- Uprawnienie wynika z sumy ról operatora.
- Nie można odebrać uprawnienia `roles.manage` ostatniemu aktywnemu operatorowi, który je ma, ani dezaktywować go.
- Każda zmiana ról, przypisań i kont trafia do `audit_log`.

**API i panel**:

- Strażnik NestJS z dekoratorem `@RequirePermission('zones.write')` na każdym punkcie panelu. Uprawnienia operatora czytane z widoku `v_staff_permissions` ([ADR 0026](0026-logika-w-bazie-widoki-funkcje-procedury.md)) z krótką pamięcią podręczną unieważnianą przy zmianie ról, więc zmiana działa od razu, bez czekania na wygaśnięcie tokenu.
- Panel ukrywa pozycje menu i przyciski bez uprawnień, ale decyzję zawsze podejmuje API.
- Ekrany: lista operatorów (zaproszenie, dezaktywacja, reset TOTP), lista ról, edycja roli jako macierz uprawnień pogrupowanych według modułów, lista klientów (szczegóły, blokada i odblokowanie, korekta salda jako nowy wpis w księdze, [ADR 0014](0014-kwoty-w-groszach-portfel-ksiega.md)).

Klienci nie mają ról: ich możliwości wynikają z reguł domeny (np. minimalne saldo), a nie z konfiguracji.

## Konsekwencje

Pozytywne:

- Punkt 11 spełniony; uprawnienia można zmieniać na żywo podczas obrony.
- Cztery nowe tabele i kilka ekranów panelu (punkty 8, 12 i 14).
- Zachowany podział logowania z [ADR 0019](0019-uwierzytelnianie.md).

Negatywne i ryzyka:

- Katalog uprawnień w kodzie i tabela `permissions` mogą się rozjechać; test porównuje je przy każdym przebiegu.
- Źle skonfigurowane role mogą zablokować panel; chroni przed tym reguła ostatniego administratora i rola systemowa.

## Powiązane

[ADR 0014](0014-kwoty-w-groszach-portfel-ksiega.md), [ADR 0019](0019-uwierzytelnianie.md), [ADR 0025](0025-logika-biznesowa-packages-core.md), [ADR 0026](0026-logika-w-bazie-widoki-funkcje-procedury.md), [wymagania uczelni](../wymagania-uczelni.md) (punkty 10, 11)
