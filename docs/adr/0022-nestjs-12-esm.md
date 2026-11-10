# ADR 0022: NestJS 12 i moduły ESM w całym repozytorium

- **Status:** zaakceptowana
- **Data:** 2026-11-10
- **Zastępuje:** część [ADR 0009](0009-backend-nestjs-fastify.md) dotyczącą wersji frameworka (NestJS 11). Wybór NestJS z adapterem Fastify pozostaje w mocy.

## Kontekst

ADR 0009 zakładał NestJS 11. W chwili zakładania repozytorium dostępny był już NestJS 12 (wydanie 12.0.0 z 27 sierpnia 2026), którego pakiety są modułami ESM (`"type": "module"` w `@nestjs/core`). Pozostałe pakiety monorepo (`shared`, `db`, `simulator`, `web`) i tak powstawały jako ESM. Mieszanie CommonJS w backendzie z ESM w pakietach wspólnych wymagałoby podwójnego budowania albo obejść przy imporcie.

## Rozważane opcje

1. **NestJS 11 w CommonJS, zgodnie z ADR 0009**. Najwięcej przykładów w sieci, ale backend różniłby się systemem modułów od reszty repozytorium, a pakiety wspólne musiałyby publikować dwie wersje.
2. **NestJS 11 w ESM**. Możliwe, ale przy starszej wersji ESM nie jest ścieżką główną frameworka.
3. **NestJS 12 w ESM**. Jeden system modułów w całym repozytorium, zgodny z kierunkiem frameworka; nowsza wersja oznacza mniej materiałów i możliwe niedojrzałości ekosystemu.

## Decyzja

NestJS 12 z adapterem Fastify, Node 24. Wszystkie pakiety poza aplikacją mobilną mają `"type": "module"` i `module`/`moduleResolution` `nodenext` (wspólny `tsconfig.base.json`). Importy względne zapisujemy z rozszerzeniem `.js`. Aplikacja mobilna zostaje przy domyślnym systemie modułów Expo i Metro.

Dekoratory NestJS wymagają metadanych typów (`emitDecoratorMetadata`). Build robi `nest build` (kompilator TypeScript), testy w Vitest przechodzą przez SWC (`unplugin-swc`), które zachowuje te metadane.

## Konsekwencje

Pozytywne:

- Jeden system modułów; pakiety `shared` i `db` importuje się w backendzie i symulatorze tak samo.
- Brak podwójnego budowania pakietów wspólnych.

Negatywne i ryzyka:

- Część przykładów i bibliotek dla NestJS zakłada CommonJS; przy dodawaniu zależności trzeba sprawdzić, czy działa w ESM.
- Obowiązkowe rozszerzenia `.js` w importach, także w kodzie generowanym (obsługuje to `postprocess-schema.mjs`, [ADR 0021](0021-migracje-sql-schemat-drizzle-z-bazy.md)).
- Dwa kompilatory (tsc w buildzie, SWC w testach); różnice między nimi mogą ujawnić się dopiero w jednym z trybów.

## Powiązane

[ADR 0009](0009-backend-nestjs-fastify.md), [ADR 0008](0008-monorepo-typescript.md), [ADR 0023](0023-typescript-6.md)
