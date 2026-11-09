# ADR 0006: Strona promocyjna i panel w jednej aplikacji Next.js

- **Status:** zaakceptowana
- **Data:** 2026-11-09

## Kontekst

Potrzebne są strona promocyjna (SEO, szybkość) i panel operatora (za logowaniem, dużo danych na żywo). Rozważano też Nuxt.

## Rozważane opcje

1. **Dwie osobne aplikacje**. Czysty podział, ale dwa projekty do utrzymania i wdrażania.
2. **Jedna aplikacja Next.js z dwiema częściami**. Strona generowana statycznie, `/admin` dynamiczny za logowaniem; jedno wdrożenie.

## Decyzja

Jedna aplikacja Next.js (App Router). Część publiczna jest generowana statycznie, część `/admin` jest chroniona po stronie serwera. Serwer Next.js nie zawiera logiki biznesowej: panel jest takim samym klientem API jak aplikacja mobilna.

## Konsekwencje

Pozytywne:

- Jedno wdrożenie i jedna konfiguracja.
- Grupy tras rozdzielają obie części w kodzie.

Negatywne i ryzyka:

- Panel dziedziczy złożoność Next.js, której sam by nie potrzebował.

## Powiązane

[ADR 0004](0004-niezalezni-klienci-wspolny-kontrakt.md)
