# Projekt graficzny

Eksport kanwy „Moodboardy – system hulajnóg” z claude.ai (stan na 2026-11-16). **Repozytorium jest teraz źródłem prawdy**; kanwa zostaje jako archiwum.

Każdy ekran jest w dwóch formach:

- **PNG** do obejrzenia (ekrany telefonu w rozdzielczości 2×, pozostałe 1×),
- **HTML** z dokładnymi wartościami CSS (kolory, rozmiary, odstępy). Otwiera się w przeglądarce bez serwera.

Inne materiały: [design system](design-system.md), [tokeny](tokens.json), [rendery hulajnogi](rendery/), [ikona aplikacji](ikona/), [interaktywny model 3D](model-3d/hulajnoga-3d.html).

Uwagi do eksportu:

- Wartości w nawiasach (`[nazwa]`, `[CENA]` itd.) są do ustalenia.
- Plansze z katalogu `00-eksploracja` używały krojów Space Grotesk, JetBrains Mono, Bricolage Grotesque i DM Sans; na zrzutach zastąpiono je krojem systemowym. Obecny kierunek używa tylko Intera.
- Liczby w makietach (np. 87%, 2,4 km, nazwiska w panelu) są przykładowe.

Ekrany aplikacji i panelu (bez eksploracji, ikon i diagramów): **53**. Do wymagania 14 (minimum 50 widoków) zob. `../wymagania-uczelni.md`.

## Eksploracja kierunku (archiwum)

Odrzucone kierunki i porównanie stylów. Tylko do wglądu: obowiązuje styl produktowy.

| Ekran | Podgląd | Kod | Rozmiar |
|---|---|---|---|
| 01 Miejski minimalizm – moodboard | [PNG](ekrany/00-eksploracja/main.png) | [HTML](ekrany/00-eksploracja/main.html) | 1040×844 |
| 01 Miejski minimalizm – ekran mapy | [PNG](ekrany/00-eksploracja/minimal-app.png) | [HTML](ekrany/00-eksploracja/minimal-app.html) | 390×844 |
| 02 Nocne miasto – moodboard | [PNG](ekrany/00-eksploracja/night.png) | [HTML](ekrany/00-eksploracja/night.html) | 1040×844 |
| 02 Nocne miasto – ekran mapy | [PNG](ekrany/00-eksploracja/night-app.png) | [HTML](ekrany/00-eksploracja/night-app.html) | 390×844 |
| 03 Przyjazny i lekki – moodboard | [PNG](ekrany/00-eksploracja/friendly.png) | [HTML](ekrany/00-eksploracja/friendly.html) | 1040×844 |
| 03 Przyjazny i lekki – ekran mapy | [PNG](ekrany/00-eksploracja/friendly-app.png) | [HTML](ekrany/00-eksploracja/friendly-app.html) | 390×844 |
| Styl A – precyzyjny | [PNG](ekrany/00-eksploracja/styl-a-precyzyjny.png) | [HTML](ekrany/00-eksploracja/styl-a-precyzyjny.html) | 390×844 |
| Styl B – ciemny, techniczny | [PNG](ekrany/00-eksploracja/styl-b-ciemny.png) | [HTML](ekrany/00-eksploracja/styl-b-ciemny.html) | 390×844 |
| Styl C – miękki, wyrazisty | [PNG](ekrany/00-eksploracja/styl-c-miekki.png) | [HTML](ekrany/00-eksploracja/styl-c-miekki.html) | 390×844 |

## Kierunek produktowy

Wzorcowe ekrany stylu i rendery.

| Ekran | Podgląd | Kod | Rozmiar |
|---|---|---|---|
| Produktowy – mapa | [PNG](ekrany/01-kierunek-produktowy/produkt-mapa.png) | [HTML](ekrany/01-kierunek-produktowy/produkt-mapa.html) | 390×844 |
| Produktowy – hulajnoga | [PNG](ekrany/01-kierunek-produktowy/produkt-hulajnoga.png) | [HTML](ekrany/01-kierunek-produktowy/produkt-hulajnoga.html) | 390×844 |
| Produktowy – przejazd | [PNG](ekrany/01-kierunek-produktowy/produkt-przejazd.png) | [HTML](ekrany/01-kierunek-produktowy/produkt-przejazd.html) | 390×844 |
| Rendery hulajnogi | [PNG](ekrany/01-kierunek-produktowy/rendery.png) | [HTML](ekrany/01-kierunek-produktowy/rendery.html) | 1280×1060 |

## Aplikacja: przepływ główny

Od rejestracji do płatności.

| Ekran | Podgląd | Kod | Rozmiar |
|---|---|---|---|
| Start | [PNG](ekrany/02-mobile-przeplyw/flow-start.png) | [HTML](ekrany/02-mobile-przeplyw/flow-start.html) | 390×844 |
| Rejestracja – telefon | [PNG](ekrany/02-mobile-przeplyw/flow-telefon.png) | [HTML](ekrany/02-mobile-przeplyw/flow-telefon.html) | 390×844 |
| Rejestracja – kod SMS | [PNG](ekrany/02-mobile-przeplyw/flow-kod.png) | [HTML](ekrany/02-mobile-przeplyw/flow-kod.html) | 390×844 |
| Skanowanie kodu | [PNG](ekrany/02-mobile-przeplyw/flow-skan.png) | [HTML](ekrany/02-mobile-przeplyw/flow-skan.html) | 390×844 |
| Podsumowanie przejazdu | [PNG](ekrany/02-mobile-przeplyw/flow-podsumowanie.png) | [HTML](ekrany/02-mobile-przeplyw/flow-podsumowanie.html) | 390×844 |
| Portfel | [PNG](ekrany/02-mobile-przeplyw/flow-portfel.png) | [HTML](ekrany/02-mobile-przeplyw/flow-portfel.html) | 390×844 |

## Aplikacja: konto i pierwsze uruchomienie

| Ekran | Podgląd | Kod | Rozmiar |
|---|---|---|---|
| Rejestracja – dane | [PNG](ekrany/03-mobile-konto/konto-dane.png) | [HTML](ekrany/03-mobile-konto/konto-dane.html) | 390×844 |
| Zgoda na lokalizację | [PNG](ekrany/03-mobile-konto/konto-lokalizacja.png) | [HTML](ekrany/03-mobile-konto/konto-lokalizacja.html) | 390×844 |
| Zasady przed pierwszą jazdą | [PNG](ekrany/03-mobile-konto/konto-zasady.png) | [HTML](ekrany/03-mobile-konto/konto-zasady.html) | 390×844 |
| Logowanie | [PNG](ekrany/03-mobile-konto/konto-logowanie.png) | [HTML](ekrany/03-mobile-konto/konto-logowanie.html) | 390×844 |

## Aplikacja: mapa

| Ekran | Podgląd | Kod | Rozmiar |
|---|---|---|---|
| Wyszukiwanie celu | [PNG](ekrany/04-mobile-mapa/mapa-szukaj.png) | [HTML](ekrany/04-mobile-mapa/mapa-szukaj.html) | 390×844 |
| Strefy na mapie | [PNG](ekrany/04-mobile-mapa/mapa-strefy.png) | [HTML](ekrany/04-mobile-mapa/mapa-strefy.html) | 390×844 |
| Rezerwacja | [PNG](ekrany/04-mobile-mapa/mapa-rezerwacja.png) | [HTML](ekrany/04-mobile-mapa/mapa-rezerwacja.html) | 390×844 |

## Aplikacja: przejazd

| Ekran | Podgląd | Kod | Rozmiar |
|---|---|---|---|
| Odblokowywanie | [PNG](ekrany/05-mobile-przejazd/przejazd-odblokowywanie.png) | [HTML](ekrany/05-mobile-przejazd/przejazd-odblokowywanie.html) | 390×844 |
| Pauza | [PNG](ekrany/05-mobile-przejazd/przejazd-pauza.png) | [HTML](ekrany/05-mobile-przejazd/przejazd-pauza.html) | 390×844 |
| Strefa wolnej jazdy | [PNG](ekrany/05-mobile-przejazd/przejazd-strefa.png) | [HTML](ekrany/05-mobile-przejazd/przejazd-strefa.html) | 390×844 |
| Poza strefą parkowania | [PNG](ekrany/05-mobile-przejazd/przejazd-poza-strefa.png) | [HTML](ekrany/05-mobile-przejazd/przejazd-poza-strefa.html) | 390×844 |
| Zdjęcie parkowania | [PNG](ekrany/05-mobile-przejazd/przejazd-zdjecie.png) | [HTML](ekrany/05-mobile-przejazd/przejazd-zdjecie.html) | 390×844 |
| Niska bateria | [PNG](ekrany/05-mobile-przejazd/przejazd-bateria.png) | [HTML](ekrany/05-mobile-przejazd/przejazd-bateria.html) | 390×844 |
| Brak łączności z hulajnogą | [PNG](ekrany/05-mobile-przejazd/przejazd-lacznosc.png) | [HTML](ekrany/05-mobile-przejazd/przejazd-lacznosc.html) | 390×844 |

## Aplikacja: mój profil

| Ekran | Podgląd | Kod | Rozmiar |
|---|---|---|---|
| Profil | [PNG](ekrany/06-mobile-profil/profil.png) | [HTML](ekrany/06-mobile-profil/profil.html) | 390×844 |
| Historia przejazdów | [PNG](ekrany/06-mobile-profil/profil-historia.png) | [HTML](ekrany/06-mobile-profil/profil-historia.html) | 390×844 |
| Historia – pusta | [PNG](ekrany/06-mobile-profil/profil-historia-pusta.png) | [HTML](ekrany/06-mobile-profil/profil-historia-pusta.html) | 390×844 |
| Ustawienia | [PNG](ekrany/06-mobile-profil/profil-ustawienia.png) | [HTML](ekrany/06-mobile-profil/profil-ustawienia.html) | 390×844 |
| Zgłoś usterkę | [PNG](ekrany/06-mobile-profil/profil-usterka.png) | [HTML](ekrany/06-mobile-profil/profil-usterka.html) | 390×844 |
| Usuń konto | [PNG](ekrany/06-mobile-profil/profil-usun-konto.png) | [HTML](ekrany/06-mobile-profil/profil-usun-konto.html) | 390×844 |

## Aplikacja: płatności

| Ekran | Podgląd | Kod | Rozmiar |
|---|---|---|---|
| Dodaj kartę | [PNG](ekrany/07-mobile-platnosci/platnosci-karta.png) | [HTML](ekrany/07-mobile-platnosci/platnosci-karta.html) | 390×844 |
| Płatność BLIK | [PNG](ekrany/07-mobile-platnosci/platnosci-blik.png) | [HTML](ekrany/07-mobile-platnosci/platnosci-blik.html) | 390×844 |
| Cennik | [PNG](ekrany/07-mobile-platnosci/platnosci-cennik.png) | [HTML](ekrany/07-mobile-platnosci/platnosci-cennik.html) | 390×844 |
| Brak środków | [PNG](ekrany/07-mobile-platnosci/platnosci-brak-srodkow.png) | [HTML](ekrany/07-mobile-platnosci/platnosci-brak-srodkow.html) | 390×844 |
| Portfel bez metody płatności | [PNG](ekrany/07-mobile-platnosci/platnosci-portfel-pusty.png) | [HTML](ekrany/07-mobile-platnosci/platnosci-portfel-pusty.html) | 390×844 |

## Aplikacja: stany awaryjne

| Ekran | Podgląd | Kod | Rozmiar |
|---|---|---|---|
| Brak internetu | [PNG](ekrany/08-mobile-stany/stan-offline.png) | [HTML](ekrany/08-mobile-stany/stan-offline.html) | 390×844 |
| Brak zgody na lokalizację | [PNG](ekrany/08-mobile-stany/stan-brak-lokalizacji.png) | [HTML](ekrany/08-mobile-stany/stan-brak-lokalizacji.html) | 390×844 |
| Brak hulajnóg w pobliżu | [PNG](ekrany/08-mobile-stany/stan-brak-hulajnog.png) | [HTML](ekrany/08-mobile-stany/stan-brak-hulajnog.html) | 390×844 |
| Hulajnoga niedostępna | [PNG](ekrany/08-mobile-stany/stan-niedostepna.png) | [HTML](ekrany/08-mobile-stany/stan-niedostepna.html) | 390×844 |
| Nieudana płatność | [PNG](ekrany/08-mobile-stany/stan-platnosc.png) | [HTML](ekrany/08-mobile-stany/stan-platnosc.html) | 390×844 |

## Aplikacja: tryb ciemny

| Ekran | Podgląd | Kod | Rozmiar |
|---|---|---|---|
| Tryb ciemny – mapa | [PNG](ekrany/09-mobile-ciemny/ciemny-mapa.png) | [HTML](ekrany/09-mobile-ciemny/ciemny-mapa.html) | 390×844 |
| Tryb ciemny – hulajnoga | [PNG](ekrany/09-mobile-ciemny/ciemny-hulajnoga.png) | [HTML](ekrany/09-mobile-ciemny/ciemny-hulajnoga.html) | 390×844 |
| Tryb ciemny – przejazd | [PNG](ekrany/09-mobile-ciemny/ciemny-przejazd.png) | [HTML](ekrany/09-mobile-ciemny/ciemny-przejazd.html) | 390×844 |
| Tryb ciemny – profil | [PNG](ekrany/09-mobile-ciemny/ciemny-profil.png) | [HTML](ekrany/09-mobile-ciemny/ciemny-profil.html) | 390×844 |

## Ikona, ekran startowy i powiadomienia

| Ekran | Podgląd | Kod | Rozmiar |
|---|---|---|---|
| Ikona aplikacji | [PNG](ekrany/10-ikona-powiadomienia/ikona.png) | [HTML](ekrany/10-ikona-powiadomienia/ikona.html) | 1100×844 |
| Ekran startowy | [PNG](ekrany/10-ikona-powiadomienia/ekran-startowy.png) | [HTML](ekrany/10-ikona-powiadomienia/ekran-startowy.html) | 390×844 |
| Powiadomienia | [PNG](ekrany/10-ikona-powiadomienia/powiadomienia.png) | [HTML](ekrany/10-ikona-powiadomienia/powiadomienia.html) | 1280×920 |

## Design system

Źródło tokenów: zob. ../design-system.md i ../tokens.json.

| Ekran | Podgląd | Kod | Rozmiar |
|---|---|---|---|
| Design system | [PNG](ekrany/11-design-system/design-system.png) | [HTML](ekrany/11-design-system/design-system.html) | 1440×2320 |

## Mapa przepływów użytkownika

| Ekran | Podgląd | Kod | Rozmiar |
|---|---|---|---|
| Mapa przepływów | [PNG](ekrany/12-mapa-przeplywow/mapa-przeplywow.png) | [HTML](ekrany/12-mapa-przeplywow/mapa-przeplywow.html) | 2000×1100 |

## Panel operatora (web)

| Ekran | Podgląd | Kod | Rozmiar |
|---|---|---|---|
| Panel – logowanie | [PNG](ekrany/13-panel/admin-logowanie.png) | [HTML](ekrany/13-panel/admin-logowanie.html) | 1440×900 |
| Panel – pulpit | [PNG](ekrany/13-panel/admin-pulpit.png) | [HTML](ekrany/13-panel/admin-pulpit.html) | 1440×900 |
| Panel – mapa floty | [PNG](ekrany/13-panel/admin-mapa.png) | [HTML](ekrany/13-panel/admin-mapa.html) | 1440×900 |
| Panel – flota | [PNG](ekrany/13-panel/admin-flota.png) | [HTML](ekrany/13-panel/admin-flota.html) | 1440×900 |
| Panel – hulajnoga | [PNG](ekrany/13-panel/admin-hulajnoga.png) | [HTML](ekrany/13-panel/admin-hulajnoga.html) | 1440×900 |
| Panel – przejazdy | [PNG](ekrany/13-panel/admin-przejazdy.png) | [HTML](ekrany/13-panel/admin-przejazdy.html) | 1440×900 |
| Panel – strefy | [PNG](ekrany/13-panel/admin-strefy.png) | [HTML](ekrany/13-panel/admin-strefy.html) | 1440×900 |
| Panel – zgłoszenia | [PNG](ekrany/13-panel/admin-zgloszenia.png) | [HTML](ekrany/13-panel/admin-zgloszenia.html) | 1440×900 |
| Panel – użytkownicy | [PNG](ekrany/13-panel/admin-uzytkownicy.png) | [HTML](ekrany/13-panel/admin-uzytkownicy.html) | 1440×900 |
| Panel – cennik i zasady | [PNG](ekrany/13-panel/admin-cennik.png) | [HTML](ekrany/13-panel/admin-cennik.html) | 1440×900 |
| Panel – symulator | [PNG](ekrany/13-panel/admin-symulator.png) | [HTML](ekrany/13-panel/admin-symulator.html) | 1440×900 |

## Strona promocyjna (pierwsza iteracja)

| Ekran | Podgląd | Kod | Rozmiar |
|---|---|---|---|
| Strona promocyjna – desktop | [PNG](ekrany/14-strona/strona-desktop.png) | [HTML](ekrany/14-strona/strona-desktop.html) | 1440×5320 |
| Strona promocyjna – telefon | [PNG](ekrany/14-strona/strona-mobile.png) | [HTML](ekrany/14-strona/strona-mobile.html) | 390×4760 |

## Diagramy techniczne

Wersje Mermaid są w docs/arc42/06-widok-czasu-dzialania.md.

| Ekran | Podgląd | Kod | Rozmiar |
|---|---|---|---|
| Architektura techniczna | [PNG](ekrany/15-techniczne/tech-architektura.png) | [HTML](ekrany/15-techniczne/tech-architektura.html) | 1440×900 |
| Maszyna stanów przejazdu | [PNG](ekrany/15-techniczne/tech-stany.png) | [HTML](ekrany/15-techniczne/tech-stany.html) | 1440×720 |
| Rozpoczęcie przejazdu | [PNG](ekrany/15-techniczne/tech-start.png) | [HTML](ekrany/15-techniczne/tech-start.html) | 1440×1150 |
| W trakcie jazdy: telemetria i strefy | [PNG](ekrany/15-techniczne/tech-jazda.png) | [HTML](ekrany/15-techniczne/tech-jazda.html) | 1440×1171 |
| Zakończenie przejazdu i rozliczenie | [PNG](ekrany/15-techniczne/tech-koniec.png) | [HTML](ekrany/15-techniczne/tech-koniec.html) | 1440×1235 |
| Rejestracja i logowanie | [PNG](ekrany/15-techniczne/tech-logowanie.png) | [HTML](ekrany/15-techniczne/tech-logowanie.html) | 1440×948 |
| Doładowanie portfela | [PNG](ekrany/15-techniczne/tech-doladowanie.png) | [HTML](ekrany/15-techniczne/tech-doladowanie.html) | 1440×1013 |
| Utrata i odzyskanie łączności | [PNG](ekrany/15-techniczne/tech-lacznosc.png) | [HTML](ekrany/15-techniczne/tech-lacznosc.html) | 1440×1013 |

## Model danych

Źródło prawdy: packages/db/migrations.

| Ekran | Podgląd | Kod | Rozmiar |
|---|---|---|---|
| Model danych | [PNG](ekrany/16-model-danych/dane-model.png) | [HTML](ekrany/16-model-danych/dane-model.html) | 2480×1940 |
| Kluczowe decyzje modelu | [PNG](ekrany/16-model-danych/dane-decyzje.png) | [HTML](ekrany/16-model-danych/dane-decyzje.html) | 1440×1020 |
