# ADR 0010: PostgreSQL z PostGIS i Drizzle ORM

- **Status:** zaakceptowana
- **Data:** 2026-11-09

## Kontekst

Dane mają silne powiązania (przejazdy, płatności), wymagają transakcji i ograniczeń integralności, a kluczowe zapytania są przestrzenne (strefy, najbliższe hulajnogi).

## Rozważane opcje

1. **MongoDB**. Elastyczny schemat, ale słabsze transakcje i ograniczenia integralności.
2. **PostgreSQL + Prisma**. Wygodne migracje i dobra dokumentacja, ale brak natywnych typów PostGIS; zapytania przestrzenne i indeksy częściowe jako surowy SQL.
3. **PostgreSQL + Drizzle**. Podejście bliskie SQL, schemat w TypeScript, obsługa geometrii i indeksów częściowych.

## Decyzja

PostgreSQL 16 z PostGIS; dostęp przez Drizzle ORM. Bazowym opisem schematu jest [schema.sql](../model-danych/schema.sql), sprawdzony na PostgreSQL 16 i PostGIS 3.4. Elementy nieobsługiwane deklaratywnie (partycje telemetrii) trafiają do ręcznych migracji SQL.

## Konsekwencje

Pozytywne:

- Zapytania przestrzenne w bazie (`ST_Contains`, `ST_Distance`) z indeksami GiST.
- Reguły biznesowe pilnowane przez bazę.
- Typy wyprowadzane ze schematu bez generowania kodu.

Negatywne i ryzyka:

- Narzędzia migracji Drizzle są młodsze niż w Prismie.
