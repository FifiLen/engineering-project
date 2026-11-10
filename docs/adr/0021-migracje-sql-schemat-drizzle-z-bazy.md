# ADR 0021: Migracje pisane w SQL, schemat Drizzle generowany z bazy

- **Status:** zaakceptowana
- **Data:** 2026-11-10

## Kontekst

[ADR 0010](0010-postgresql-postgis-drizzle.md) wybrał Drizzle jako warstwę dostępu do danych, ale nie przesądził, co jest źródłem prawdy o schemacie. Model danych korzysta z elementów, których Drizzle nie opisuje deklaratywnie albo opisuje niepełnie: partycjonowanej tabeli telemetrii, indeksów częściowych pilnujących reguł biznesowych (jeden otwarty przejazd na hulajnogę i użytkownika), ograniczeń `CHECK`, typów wyliczeniowych i geometrii PostGIS. Bazowy [schema.sql](../model-danych/schema.sql) był pisany i sprawdzany bezpośrednio w SQL.

## Rozważane opcje

1. **Schemat w TypeScript, migracje generowane przez `drizzle-kit generate`**. Jedno miejsce zmian, ale generator nie obsługuje partycji, a indeksy częściowe i `CHECK` z PostGIS trzeba i tak dopisywać ręcznie. Dwa źródła prawdy, które łatwo rozjechać.
2. **Migracje w SQL, schemat Drizzle pisany ręcznie**. Pełna kontrola nad SQL, ale ręczne przepisywanie 24 tabel do TypeScriptu to pewne źródło rozbieżności.
3. **Migracje w SQL, schemat Drizzle generowany z bazy (`drizzle-kit pull`)**. SQL jest jedynym źródłem prawdy, typy w TypeScript wynikają z faktycznego stanu bazy.

## Decyzja

Opcja 3.

- Migracje piszemy ręcznie w `packages/db/migrations/NNNN_opis.sql`. Wykonuje je własny migrator (`packages/db/src/migrator.ts`): kolejność według nazw plików, każda migracja w osobnej transakcji, blokada doradcza przeciw równoległemu uruchomieniu, tabela `schema_migrations` z sumą SHA-256. Zmiana treści wykonanej migracji kończy się błędem; poprawka to zawsze nowy plik.
- Po każdej migracji `pnpm db:pull` regeneruje `packages/db/src/schema/schema.ts` i `relations.ts`. Skrypt `postprocess-schema.mjs` zamienia znaczniki czasu na `Date`, dodaje rozszerzenia `.js` w importach (ESM) i usuwa pliki migracji tworzone przez drizzle-kit. Wygenerowanych plików nie edytujemy i nie lintujemy.
- Wyjątek: `telemetry.ts` jest utrzymywany ręcznie, bo drizzle-kit nie introspekuje tabel partycjonowanych.

## Konsekwencje

Pozytywne:

- Reguły spójności (indeksy częściowe, `CHECK`, partycje) są zapisane wprost w SQL, który da się pokazać i omówić przy obronie.
- Typy w kodzie odpowiadają faktycznej bazie, a nie zamiarowi autora.
- Migrator jest mały i w pełni przetestowany na prawdziwym PostGIS (`db.test.ts`).

Negatywne i ryzyka:

- Zmiana schematu to dwa kroki (migracja, potem `db:pull`); zapomnienie o drugim kroku wychodzi dopiero przy kompilacji.
- `telemetry.ts` może rozjechać się z migracjami; pilnują tego testy bazy.
- Brak automatycznych migracji wstecz; wycofanie zmiany to nowa migracja.

## Powiązane

[ADR 0010](0010-postgresql-postgis-drizzle.md), [model danych](../model-danych/README.md), [iteracja 0](../iteracje/iteracja-00-fundament.md)
