# Dziennik prac

## Etap projektowy (listopad 2026)

**Co powstało**
- Architektura systemu i wybór stosu technologicznego (ADR 0001–0020).
- Kierunek wizualny: paleta, styl produktowy, design system, rendery hulajnogi.
- Makiety: aplikacja mobilna (ok. 40 ekranów, w tym tryb ciemny i stany awaryjne), panel operatora (11 ekranów), strona promocyjna (desktop i telefon).
- Mapa przepływów użytkownika, diagram architektury, maszyna stanów przejazdu i sześć diagramów sekwencji.
- Model danych: 24 tabele, schemat SQL sprawdzony na PostgreSQL 16 z PostGIS 3.4.
- Ikona aplikacji i ekran startowy.

**Zmiany względem pierwotnego planu**
- Pierwotna propozycja zakładała Vue i Nuxt na webie oraz współdzielenie kodu między klientami. Zrezygnowano z tego na rzecz Reacta po obu stronach i niezależnych klientów ([ADR 0004](adr/0004-niezalezni-klienci-wspolny-kontrakt.md)).
- Rozważano Capacitor zamiast React Native ([ADR 0005](adr/0005-react-native-expo.md)).
- Strona promocyjna i panel w jednym projekcie Next.js zamiast dwóch ([ADR 0006](adr/0006-jedna-aplikacja-nextjs.md)).

**Otwarte kwestie**
- Nazwa marki i wartości biznesowe w nawiasach kwadratowych (ceny, limity, wiek).
- Strona promocyjna traktowana jako pierwsza iteracja projektu graficznego.
