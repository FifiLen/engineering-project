# Decyzje architektoniczne (ADR)

Szablon: [0000-szablon.md](0000-szablon.md)

| Nr | Decyzja | Status |
|---|---|---|
| 0001 | [Zapisywanie decyzji architektonicznych](0001-zapisywanie-decyzji.md) | zaakceptowana |
| 0002 | [Symulacja floty zamiast fizycznego sprzętu](0002-symulacja-floty-zamiast-sprzetu.md) | zaakceptowana |
| 0003 | [Monolit modularny zamiast mikroserwisów](0003-monolit-modularny.md) | zaakceptowana |
| 0004 | [Niezależni klienci, wspólny jest tylko kontrakt API](0004-niezalezni-klienci-wspolny-kontrakt.md) | zaakceptowana |
| 0005 | [Aplikacja mobilna w React Native z Expo](0005-react-native-expo.md) | zaakceptowana |
| 0006 | [Strona promocyjna i panel w jednej aplikacji Next.js](0006-jedna-aplikacja-nextjs.md) | zaakceptowana |
| 0007 | [Kierunek wizualny: styl produktowy](0007-kierunek-wizualny.md) | zaakceptowana |
| 0008 | [Monorepo w TypeScript (pnpm i Turborepo)](0008-monorepo-typescript.md) | zaakceptowana |
| 0009 | [Backend w NestJS z adapterem Fastify](0009-backend-nestjs-fastify.md) | zaakceptowana; wersja frameworka zastąpiona przez 0022 |
| 0010 | [PostgreSQL z PostGIS i Drizzle ORM](0010-postgresql-postgis-drizzle.md) | zaakceptowana |
| 0011 | [MQTT do komunikacji z hulajnogami](0011-mqtt-dla-hulajnog.md) | zaakceptowana |
| 0012 | [Aktualizacje na żywo przez Socket.IO](0012-socket-io.md) | zaakceptowana |
| 0013 | [Rezerwacja jako stan przejazdu](0013-rezerwacja-jako-stan-przejazdu.md) | zaakceptowana |
| 0014 | [Kwoty w groszach i portfel jako księga](0014-kwoty-w-groszach-portfel-ksiega.md) | zaakceptowana |
| 0015 | [Wersjonowany cennik](0015-wersjonowany-cennik.md) | zaakceptowana |
| 0016 | [Zadania w tle w pg-boss](0016-zadania-w-tle-pg-boss.md) | zaakceptowana |
| 0017 | [Usługi mapowe: MapLibre, OpenFreeMap, Photon i OSRM](0017-uslugi-mapowe.md) | zaakceptowana |
| 0018 | [Płatności przez Stripe w trybie testowym](0018-platnosci-stripe.md) | zaakceptowana |
| 0019 | [Uwierzytelnianie: kod SMS dla użytkowników, hasło z TOTP dla operatorów](0019-uwierzytelnianie.md) | zaakceptowana |
| 0020 | [Obszar działania: Rybnik](0020-obszar-dzialania-rybnik.md) | zaakceptowana |
| 0021 | [Migracje pisane w SQL, schemat Drizzle generowany z bazy](0021-migracje-sql-schemat-drizzle-z-bazy.md) | zaakceptowana |
| 0022 | [NestJS 12 i moduły ESM w całym repozytorium](0022-nestjs-12-esm.md) | zaakceptowana |
| 0023 | [TypeScript 6.0](0023-typescript-6.md) | zaakceptowana |
| 0024 | [Magazyn plików zgodny z S3: SeaweedFS](0024-magazyn-plikow-seaweedfs.md) | zaakceptowana |
| 0025 | [Osobny projekt logiki biznesowej (`packages/core`) i dostęp do danych tylko przez `packages/db`](0025-logika-biznesowa-packages-core.md) | zaakceptowana |
| 0026 | [Co robi baza: widoki, funkcje i procedury](0026-logika-w-bazie-widoki-funkcje-procedury.md) | zaakceptowana |
| 0027 | [Treści merytoryczne i grafiki sterowane z panelu](0027-tresci-sterowane-z-panelu.md) | zaakceptowana |
| 0028 | [Użytkownicy, role i uprawnienia zarządzane w panelu](0028-uzytkownicy-role-uprawnienia.md) | zaakceptowana |
| 0029 | [Raporty z parametrami i eksportem do PDF i XLSX](0029-raporty-pdf-xlsx.md) | zaakceptowana |
| 0030 | [Wydruki z szablonów DOCX zmienianych przez użytkownika](0030-wydruki-z-szablonow-docx.md) | zaakceptowana |
| 0031 | [Wspólny wzorzec widoku tabeli w panelu i kontrakt list w API](0031-wzorzec-widoku-tabeli-w-panelu.md) | zaakceptowana |
| 0032 | [Etykiety interfejsu: pliki JSON, wspólny tłumacz i reguła lintera](0032-etykiety-w-plikach-tlumaczen.md) | zaakceptowana |
| 0033 | [Przyjmowanie telemetrii partiami i status floty liczony w core i w bazie](0033-telemetria-i-status-floty.md) | zaakceptowana |
| 0034 | [Budowa symulatora floty i przejazdy pokazowe do czasu wypożyczeń](0034-symulator-floty.md) | zaakceptowana |
| 0035 | [Sesje, tokeny i strażnik uprawnień w API](0035-sesje-tokeny-i-straznik-uprawnien.md) | zaakceptowana |
| 0036 | [Proces wypożyczenia w API](0036-proces-wypozyczenia-w-api.md) | zaakceptowana |
| 0037 | [Zadania w tle w pg-boss: konfiguracja i zadania](0037-pg-boss-konfiguracja-i-zadania.md) | zaakceptowana |
| 0038 | [Wygasanie komend MQTT](0038-wygasanie-komend-mqtt.md) | zaakceptowana |
| 0039 | [Symulator w trakcie przejazdu klienta](0039-symulator-w-trakcie-przejazdu.md) | zaakceptowana |
| 0040 | [Mapa, lokalizacja i aparat w aplikacji](0040-mapa-lokalizacja-aparat-w-aplikacji.md) | zaakceptowana |
| 0041 | [Kod QR hulajnogi](0041-kod-qr-hulajnogi.md) | zaakceptowana |
| 0042 | [Wycena przejazdu](0042-wycena-przejazdu.md) | zaakceptowana |
| 0043 | [Wykrywanie zmian stref z telemetrii](0043-wykrywanie-zmian-stref.md) | zaakceptowana |
| 0044 | [Komendy stref dla hulajnogi](0044-komendy-stref-dla-hulajnogi.md) | zaakceptowana |
| 0045 | [Wyszukiwanie miejsc (Photon)](0045-wyszukiwanie-miejsc-photon.md) | zaakceptowana |
| 0046 | [Symulator a strefy](0046-symulator-a-strefy.md) | zaakceptowana |
| 0047 | [Edytor geometrii stref w panelu](0047-edytor-geometrii-w-panelu.md) | zaakceptowana |
| 0048 | [Trasy dla klienta z OSRM](0048-trasy-dla-klienta-z-osrm.md) | zaakceptowana |
| 0049 | [Rozliczenie przejazdu](0049-rozliczenie-przejazdu.md) | zaakceptowana |
| 0050 | [Integracja ze Stripe](0050-integracja-stripe.md) | zaakceptowana |
| 0051 | [Płatności w aplikacji](0051-platnosci-w-aplikacji.md) | zaakceptowana |
| 0052 | [Paragony](0052-paragony.md) | zaakceptowana |
| 0053 | [Wersje cennika w panelu](0053-wersje-cennika-w-panelu.md) | zaakceptowana |
| 0054 | [Zwroty i korekty salda](0054-zwroty-i-korekty-salda.md) | zaakceptowana |
| 0055 | [Zgłoszenia i proces serwisowy](0055-zgloszenia-i-proces-serwisowy.md) | zaakceptowana |
| 0056 | [Przejazd przy utracie łączności i niskiej baterii](0056-przejazd-bez-lacznosci-i-niska-bateria.md) | zaakceptowana |
| 0057 | [Pliki: zdjęcia zgłoszeń i parkowania](0057-pliki-zdjecia.md) | zaakceptowana |
| 0058 | [Powiadomienia push z szablonów](0058-powiadomienia-push-z-szablonow.md) | zaakceptowana |
| 0059 | [Symulator sterowany z panelu](0059-symulator-sterowany-z-panelu.md) | zaakceptowana |
| 0060 | [Opłata za odholowanie](0060-oplata-za-odholowanie.md) | zaakceptowana |
