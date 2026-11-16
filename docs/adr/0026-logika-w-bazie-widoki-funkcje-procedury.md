# ADR 0026: Co robi baza: widoki, funkcje i procedury

- **Status:** proponowana
- **Data:** 2026-11-16

## Kontekst

Punkt 8 wymagań uczelni wymaga co najmniej 30 tabel oraz widoków, procedur, funkcji i indeksów. Po iteracji 0 baza ma 24 tabele i indeksy (GiST, częściowe), ale żadnych widoków, funkcji ani procedur.

Jednocześnie [ADR 0025](0025-logika-biznesowa-packages-core.md) umieszcza reguły biznesowe w `packages/core`. Jeśli ta sama reguła (np. wycena przejazdu) trafi i do core, i do funkcji SQL, dwie implementacje szybko się rozjadą. Potrzebna jest zasada, co należy do bazy, a co do core.

## Rozważane opcje

1. **Logika w procedurach składowanych**. Typowe dla systemów na SQL Server lub Oracle, ale dubluje core albo go zastępuje, a procedury trudniej testować i wersjonować niż TypeScript.
2. **Obiekty bazy tylko dla spełnienia wymagania**. Kilka widoków, z których nic nie korzysta. Łatwe, ale nie do obrony przy pytaniach z kodu.
3. **Podział według rodzaju pracy**. Baza robi to, co robi lepiej niż aplikacja: integralność, odczyty łączące wiele tabel, zapytania przestrzenne i operacje na zbiorach wierszy. Decyzje biznesowe podejmuje core.

## Decyzja

Opcja 3. Każda reguła ma jedno miejsce.

| Obiekt | Zastosowanie | Przykłady |
|---|---|---|
| Ograniczenia i indeksy (bez zmian) | Spójność, której nie może złamać żaden kod | jeden otwarty przejazd na hulajnogę i użytkownika, `CHECK` na kwotach, GiST na geometriach |
| Widoki `v_*` | Modele odczytu dla list w panelu, raportów i wydruków | `v_fleet_status` (hulajnoga, ostatnia telemetria, bieżący przejazd), `v_rental_details`, `v_wallet_balances`, `v_daily_revenue`, `v_ticket_queue`, `v_staff_permissions`, `v_zone_usage` |
| Funkcje `fn_*` | Obliczenia na danych bez efektów ubocznych | `fn_zones_at_point(lon, lat)`, `fn_nearest_scooters(lon, lat, radius_m, limit)`, `fn_wallet_balance(user_id)`, `fn_staff_has_permission(staff_id, code)`, `fn_rental_distance_m(rental_id)` |
| Procedury `sp_*` (`CALL`) | Operacje na wielu wierszach w jednej transakcji, uruchamiane przez zadania pg-boss lub z panelu | `sp_expire_reservations()`, `sp_anonymize_user(user_id)`, `sp_ensure_telemetry_partitions(months_ahead)`, `sp_purge_expired_otp()` |

Zasady:

- Wycena, przejścia stanów przejazdu, reguły stref i uprawnienia są w core. Baza ich nie liczy, najwyżej pilnuje niezmienników (np. dozwolone wartości stanu).
- `sp_expire_reservations()` wykonuje tylko przejście `RESERVED → EXPIRED` zadeklarowane w maszynie stanów w core. Test sprawdza, że każde przejście wykonywane przez procedury jest dozwolone w core.
- Wszystkie obiekty powstają w ręcznych migracjach SQL ([ADR 0021](0021-migracje-sql-schemat-drizzle-z-bazy.md)) i mają testy na prawdziwym PostGIS. Zmiana obiektu to nowa migracja z `CREATE OR REPLACE`.
- Aplikacja korzysta z nich przez Drizzle: widoki jako `pgView` ze schematu generowanego przez `drizzle-kit pull` (do sprawdzenia przy migracji 0002, w razie braku obsługi widok opisujemy ręcznie jak `telemetry.ts`), funkcje i procedury przez `sql` w repozytoriach `packages/db`.
- Nazwy z przedrostkami `v_`, `fn_`, `sp_`, żeby przy obronie od razu było widać rodzaj obiektu.

Nowe tabele wynikają z nowych obszarów, a nie z dzielenia istniejących: uprawnienia ([ADR 0028](0028-uzytkownicy-role-uprawnienia.md)), treści i media ([ADR 0027](0027-tresci-sterowane-z-panelu.md)), raporty ([ADR 0029](0029-raporty-pdf-xlsx.md)), szablony wydruków ([ADR 0030](0030-wydruki-z-szablonow-docx.md)) oraz domena serwisu (modele hulajnóg, zadania serwisowe, paragony). Szacunek po migracji 0002: ok. 38 tabel bez partycji telemetrii.

## Konsekwencje

Pozytywne:

- Punkt 8 jest spełniony obiektami, z których system naprawdę korzysta i które da się uzasadnić.
- Listy w panelu i raporty czytają gotowe widoki zamiast budować złączenia w kodzie.
- Operacje na zbiorach (wygaszanie rezerwacji, anonimizacja, partycje) działają w jednej instrukcji i jednej transakcji.

Negatywne i ryzyka:

- Część logiki odczytu jest w SQL, więc zmiana kolumny wymaga też zmiany widoku. Testy bazy wykrywają takie błędy przy migracji.
- Granica „obliczenie na danych” i „decyzja biznesowa” wymaga oceny w konkretnych przypadkach; wątpliwe przypadki rozstrzygamy na korzyść core.

## Powiązane

[ADR 0010](0010-postgresql-postgis-drizzle.md), [ADR 0013](0013-rezerwacja-jako-stan-przejazdu.md), [ADR 0016](0016-zadania-w-tle-pg-boss.md), [ADR 0021](0021-migracje-sql-schemat-drizzle-z-bazy.md), [ADR 0025](0025-logika-biznesowa-packages-core.md), [model danych](../model-danych/README.md), [wymagania uczelni](../wymagania-uczelni.md) (punkt 8)
