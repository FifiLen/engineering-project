# ADR 0023: TypeScript 6.0

- **Status:** zaakceptowana
- **Data:** 2026-11-10

## Kontekst

[ADR 0008](0008-monorepo-typescript.md) przyjął TypeScript w całym projekcie, bez wskazania wersji. W listopadzie 2026 dostępne są dwie linie: TypeScript 6.0 (ostatnie wydanie 6.0.3 z kwietnia 2026), czyli ostatnia wersja kompilatora napisanego w JavaScripcie, oraz TypeScript 7 (7.0.2 z lipca 2026), kompilator przepisany na Go. Wersja musi być jedna dla całego monorepo i zgodna z narzędziami: typescript-eslint, NestJS CLI, Next.js i Expo.

## Rozważane opcje

1. **TypeScript 5.x**. Najszerzej wspierany, ale bez zmian domyślnych ustawień i ostrzeżeń o przestarzałych opcjach, które przygotowują projekt do wersji 7.
2. **TypeScript 6.0**. Zgodny z obecnymi narzędziami, a przy tym ostrzega o opcjach usuwanych w wersji 7, więc późniejsze przejście będzie prostsze.
3. **TypeScript 7**. Znacznie szybsza kompilacja, ale typescript-eslint 8.72 obsługuje tylko TypeScript `>=4.8.4 <6.1.0`, więc lint całego repozytorium przestałby działać. Narzędzia korzystające z API kompilatora (NestJS CLI) nie są jeszcze z nim sprawdzone.

## Decyzja

TypeScript `~6.0.3` we wszystkich pakietach, łącznie z aplikacją mobilną. Wspólne ustawienia w `tsconfig.base.json`: `strict`, `noUncheckedIndexedAccess`, `noImplicitOverride`, `module`/`moduleResolution` `nodenext`, cel `ES2023`. Zakres `~` dopuszcza tylko poprawki w obrębie 6.0.

## Konsekwencje

Pozytywne:

- Wszystkie narzędzia (lint, build NestJS, Next.js, Expo) działają na jednej wersji kompilatora.
- Ostrzeżenia wersji 6.0 wskazują, co trzeba zmienić przed przejściem na 7.

Negatywne i ryzyka:

- Wolniejsza kompilacja niż w TypeScript 7; w skali projektu do zaakceptowania.
- Przejście na 7 będzie osobną decyzją, gdy typescript-eslint i NestJS CLI zaczną go wspierać.

## Powiązane

[ADR 0008](0008-monorepo-typescript.md), [ADR 0022](0022-nestjs-12-esm.md)
