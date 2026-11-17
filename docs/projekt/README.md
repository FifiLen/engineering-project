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

Ekrany aplikacji i panelu (bez eksploracji, ikon i diagramów): **120**. Do wymagania 14 (minimum 50 widoków) zob. `../wymagania-uczelni.md`.

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

## Panel operatora: wzorzec widoku tabeli

Wspólny wzorzec listy i formularza dla wszystkich tabel w panelu ([ADR 0031](../adr/0031-wzorzec-widoku-tabeli-w-panelu.md)), pokazany na zadaniach serwisowych. Plansze powstały w repozytorium (16 listopada 2026), nie na kanwie.

| Ekran | Podgląd | Kod | Rozmiar |
|---|---|---|---|
| Lista: filtry, sortowanie, zaznaczenie | [PNG](ekrany/17-panel-wzorce/wzorzec-lista.png) | [HTML](ekrany/17-panel-wzorce/wzorzec-lista.html) | 1440×900 |
| Panel filtrów | [PNG](ekrany/17-panel-wzorce/wzorzec-filtry.png) | [HTML](ekrany/17-panel-wzorce/wzorzec-filtry.html) | 1440×900 |
| Formularz edycji: błąd pola, konflikt wersji | [PNG](ekrany/17-panel-wzorce/wzorzec-formularz.png) | [HTML](ekrany/17-panel-wzorce/wzorzec-formularz.html) | 1440×900 |
| Stany listy: ładowanie, pusta, brak wyników, błąd | [PNG](ekrany/17-panel-wzorce/wzorzec-stany.png) | [HTML](ekrany/17-panel-wzorce/wzorzec-stany.html) | 1440×900 |

Elementy wzorca:

- **Lista**: wyszukiwarka, szybkie filtry z licznikami (`facets`), przycisk „Filtry” z liczbą aktywnych filtrów, aktywne filtry jako usuwalne etykiety, liczba wyników i opis sortowania, nagłówek sortowanej kolumny ze strzałką (`aria-sort`), zaznaczanie wierszy z polem „część zaznaczona” w nagłówku, pasek operacji grupowych (operacja zamykająca rekordy w kolorze błędu, z potwierdzeniem), stronicowanie z wyborem liczby wierszy.
- **Panel filtrów**: wysuwany z prawej strony, sekcje według typu filtra (lista wartości z licznikami, wybór wielu, wybór jednego, pole wyboru, zakres dat, przełącznik), przycisk z liczbą wyników po zastosowaniu.
- **Formularz**: ścieżka powrotu do listy, numer wersji rekordu, komunikat o konflikcie wersji (blokada optymistyczna, kod `CONFLICT`) z porównaniem i wczytaniem aktualnej wersji, błąd pola pod polem w kolorze błędu, pola opcjonalne oznaczone słowem, historia zmian z dziennika audytu, operacja nieodwracalna w osobnej karcie.
- **Stany**: szkielet wierszy przy ładowaniu, pusta lista z główną akcją, brak wyników z czyszczeniem filtrów, błąd z kodem i ponowieniem. Nagłówki kolumn zostają we wszystkich stanach.

Odstępstwa od plansz panelu z kanwy:

- **Nawigacja boczna** jest pogrupowana (Operacje, Konfiguracja, Klienci i dostęp, Analiza) i ma nowe pozycje z ADR 0027–0030: Serwis, Treści, Operatorzy i role, Raporty, Wydruki. Pozycje niedostępne dla roli operatora są ukryte (ADR 0028). To propozycja nawigacji dla całego panelu; plansze z katalogu `13-panel` pokazują jeszcze starą listę.
- **Eksport** domyślnie do XLSX (wymaganie 18), CSV w menu przycisku; makieta Flota ma tylko „Eksportuj CSV”.

Implementacja w panelu (iteracja 1): mapa floty, Flota i wzorzec listy, filtrów, formularza i stanów; modele hulajnóg na tym samym wzorcu bez osobnej makiety. Odstępstwa od plansz opisuje [dziennik](../dziennik.md#iteracja-1-symulator-telemetria-i-wzorzec-panelu-16-listopada-2026).

## Panel operatora: konta i dostęp

Plansze przed iteracją 2 ([plan](../iteracje/iteracja-02-konta-dostep.md), [ADR 0019](../adr/0019-uwierzytelnianie.md), [ADR 0028](../adr/0028-uzytkownicy-role-uprawnienia.md)). Powstały w repozytorium (16 listopada 2026) na stylach i nawigacji z planszy `17-panel-wzorce/wzorzec-formularz`; logowanie ma lewą kolumnę z `13-panel/admin-logowanie`.

| Ekran | Podgląd | Kod | Rozmiar |
|---|---|---|---|
| Logowanie – kod TOTP (błędny kod) | [PNG](ekrany/18-panel-dostep/dostep-logowanie-totp.png) | [HTML](ekrany/18-panel-dostep/dostep-logowanie-totp.html) | 1440×900 |
| Konfiguracja TOTP | [PNG](ekrany/18-panel-dostep/dostep-totp-konfiguracja.png) | [HTML](ekrany/18-panel-dostep/dostep-totp-konfiguracja.html) | 1440×900 |
| Aktywacja konta z zaproszenia | [PNG](ekrany/18-panel-dostep/dostep-aktywacja.png) | [HTML](ekrany/18-panel-dostep/dostep-aktywacja.html) | 1440×900 |
| Operatorzy – lista | [PNG](ekrany/18-panel-dostep/dostep-operatorzy.png) | [HTML](ekrany/18-panel-dostep/dostep-operatorzy.html) | 1440×900 |
| Operator – formularz | [PNG](ekrany/18-panel-dostep/dostep-operator-formularz.png) | [HTML](ekrany/18-panel-dostep/dostep-operator-formularz.html) | 1440×900 |
| Role – lista | [PNG](ekrany/18-panel-dostep/dostep-role.png) | [HTML](ekrany/18-panel-dostep/dostep-role.html) | 1440×900 |
| Rola – macierz uprawnień | [PNG](ekrany/18-panel-dostep/dostep-rola-uprawnienia.png) | [HTML](ekrany/18-panel-dostep/dostep-rola-uprawnienia.html) | 1440×900 |
| Dziennik audytu ze szczegółami wpisu | [PNG](ekrany/18-panel-dostep/dostep-audyt.png) | [HTML](ekrany/18-panel-dostep/dostep-audyt.html) | 1440×900 |
| Klient – szczegóły | [PNG](ekrany/18-panel-dostep/dostep-klient.png) | [HTML](ekrany/18-panel-dostep/dostep-klient.html) | 1440×900 |
| Klient – blokada konta | [PNG](ekrany/18-panel-dostep/dostep-klient-blokada.png) | [HTML](ekrany/18-panel-dostep/dostep-klient-blokada.html) | 1440×900 |
| Dokumenty prawne – wersje | [PNG](ekrany/18-panel-dostep/dostep-dokumenty.png) | [HTML](ekrany/18-panel-dostep/dostep-dokumenty.html) | 1440×900 |
| Dokument – wersja robocza | [PNG](ekrany/18-panel-dostep/dostep-dokument-wersja.png) | [HTML](ekrany/18-panel-dostep/dostep-dokument-wersja.html) | 1440×900 |

Elementy plansz:

- **Logowanie** w dwóch krokach (hasło z `13-panel/admin-logowanie`, potem kod TOTP w polu kodu z design systemu). Błąd mówi, ile prób zostało; po 5 nieudanych logowanie jest wstrzymane na 15 minut. Zaproszony operator ustawia hasło (krok 1 z 2) i włącza TOTP (krok 2 z 2); ten sam ekran TOTP pojawia się po resecie przez administratora.
- **Operatorzy i role** to jedna pozycja nawigacji z zakładkami Operatorzy, Role i Dziennik audytu. Formularz operatora: role jako lista pól wyboru z liczbą uprawnień, sesje z wylogowaniem wszędzie, reset TOTP, historia zmian i dezaktywacja w osobnej karcie.
- **Macierz uprawnień**: wiersz na moduł z polem „wszystkie” (także stan częściowy) i uprawnieniami jako pola wyboru; niezapisane zmiany są obramowane (dodane kobaltem, odebrane czerwoną przerywaną linią) i podsumowane przy przycisku zapisu. Kod uprawnienia w podpowiedzi.
- **Dziennik audytu** tylko do odczytu: lista z filtrami i panel boczny z polami przed i po zmianie. Klient: zgody z wersją dokumentu i informacją, czy wersja obowiązuje; telefon zmienia tylko klient. Blokada wymaga powodu widocznego dla klienta; notatka zostaje w dzienniku.
- **Dokumenty prawne** to pierwsza zakładka Treści (pozostałe w iteracji 7). Opublikowanej wersji nie można zmienić; publikacja działa od razu, a aplikacja prosi klientów o ponowną akceptację z polem „Najważniejsze zmiany”.
- Blok operatora na dole nawigacji ma przycisk wylogowania.

## Aplikacja: konta i dostęp

| Ekran | Podgląd | Kod | Rozmiar |
|---|---|---|---|
| Nowa wersja regulaminu | [PNG](ekrany/19-mobile-dostep/konto-nowa-wersja.png) | [HTML](ekrany/19-mobile-dostep/konto-nowa-wersja.html) | 390×844 |
| Konto zablokowane | [PNG](ekrany/19-mobile-dostep/konto-zablokowane.png) | [HTML](ekrany/19-mobile-dostep/konto-zablokowane.html) | 390×844 |
| Kod SMS – wyczerpane próby | [PNG](ekrany/19-mobile-dostep/konto-kod-proby.png) | [HTML](ekrany/19-mobile-dostep/konto-kod-proby.html) | 390×844 |

Pozostałe ekrany rejestracji i logowania są w sekcjach „Aplikacja: przepływ główny” i „Aplikacja: konto i pierwsze uruchomienie”.

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

## Aplikacja: wypożyczenie (iteracja 3)

Brakujące stany z [planu iteracji 3](../iteracje/iteracja-03-wypozyczenie.md) według decyzji autora i ADR 0036–0042. Powstały w repozytorium (16 listopada 2026) na stylach plansz `01-kierunek-produktowy`, `04`–`08` i `19-mobile-dostep`.

| Ekran | Podgląd | Kod | Rozmiar |
|---|---|---|---|
| Mapa – karta hulajnogi z rezerwacją | [PNG](ekrany/20-mobile-wypozyczenie/mapa-karta-rezerwuj.png) | [HTML](ekrany/20-mobile-wypozyczenie/mapa-karta-rezerwuj.html) | 390×844 |
| Anulowanie rezerwacji – potwierdzenie | [PNG](ekrany/20-mobile-wypozyczenie/rezerwacja-anuluj.png) | [HTML](ekrany/20-mobile-wypozyczenie/rezerwacja-anuluj.html) | 390×844 |
| Rezerwacja anulowana | [PNG](ekrany/20-mobile-wypozyczenie/rezerwacja-anulowana.png) | [HTML](ekrany/20-mobile-wypozyczenie/rezerwacja-anulowana.html) | 390×844 |
| Rezerwacja wygasła | [PNG](ekrany/20-mobile-wypozyczenie/rezerwacja-wygasla.png) | [HTML](ekrany/20-mobile-wypozyczenie/rezerwacja-wygasla.html) | 390×844 |
| Wpisanie numeru hulajnogi | [PNG](ekrany/20-mobile-wypozyczenie/skan-numer.png) | [HTML](ekrany/20-mobile-wypozyczenie/skan-numer.html) | 390×844 |
| Brak dostępu do aparatu | [PNG](ekrany/20-mobile-wypozyczenie/skan-brak-aparatu.png) | [HTML](ekrany/20-mobile-wypozyczenie/skan-brak-aparatu.html) | 390×844 |
| Odblokowanie nieudane | [PNG](ekrany/20-mobile-wypozyczenie/odblokowanie-nieudane.png) | [HTML](ekrany/20-mobile-wypozyczenie/odblokowanie-nieudane.html) | 390×844 |
| Wznawianie jazdy po pauzie | [PNG](ekrany/20-mobile-wypozyczenie/przejazd-wznawianie.png) | [HTML](ekrany/20-mobile-wypozyczenie/przejazd-wznawianie.html) | 390×844 |
| Kończenie przejazdu – oczekiwanie na blokadę | [PNG](ekrany/20-mobile-wypozyczenie/przejazd-konczenie.png) | [HTML](ekrany/20-mobile-wypozyczenie/przejazd-konczenie.html) | 390×844 |
| Blokada niepotwierdzona | [PNG](ekrany/20-mobile-wypozyczenie/przejazd-blokada-nieudana.png) | [HTML](ekrany/20-mobile-wypozyczenie/przejazd-blokada-nieudana.html) | 390×844 |
| Podsumowanie przejazdu bez obciążenia (D1) | [PNG](ekrany/20-mobile-wypozyczenie/podsumowanie-bez-platnosci.png) | [HTML](ekrany/20-mobile-wypozyczenie/podsumowanie-bez-platnosci.html) | 390×844 |
| Profil – dane osobowe | [PNG](ekrany/20-mobile-wypozyczenie/profil-dane.png) | [HTML](ekrany/20-mobile-wypozyczenie/profil-dane.html) | 390×844 |
| Usunięcie konta niemożliwe | [PNG](ekrany/20-mobile-wypozyczenie/profil-usun-niemozliwe.png) | [HTML](ekrany/20-mobile-wypozyczenie/profil-usun-niemozliwe.html) | 390×844 |

Ustalenia z plansz:

- Numer hulajnogi zawsze w czterech cyfrach (`#0027`), jak w panelu, MQTT i ADR 0041.
- Pasek górny mapy bez wyszukiwarki „Dokąd jedziesz?” (iteracja 4); pigułka strefy na ekranie jazdy ukryta do iteracji 4.
- Anulowanie rezerwacji to przycisk grafitowy, nie czerwony (operacja nieszkodliwa); wygaśnięcie ma odznakę neutralną.
- Kończenie przejazdu nie ma przycisku zamknięcia; po nieudanej blokadzie „Zakończ” zmienia się w „Spróbuj ponownie”, a zakończenie bez blokady zostaje dla operatora (D7).
- Nieudane wznowienie wraca do `przejazd-pauza` z komunikatem, bez osobnej planszy.
- Zmiana numeru telefonu jest ukryta i odsyła do pomocy (otwarta decyzja na później).
- Usunięcie konta pokazuje listę warunków (otwarty przejazd, saldo), zamiast osobnej planszy dla każdej przyczyny.

## Panel operatora: przejazdy (iteracja 3)

Plansze w nawigacji i wzorcu z `17-panel-wzorce` i `18-panel-dostep`; lista zastępuje `13-panel/admin-przejazdy`.

| Ekran | Podgląd | Kod | Rozmiar |
|---|---|---|---|
| Przejazdy – lista z panelem bocznym | [PNG](ekrany/21-panel-przejazdy/przejazdy-lista.png) | [HTML](ekrany/21-panel-przejazdy/przejazdy-lista.html) | 1440×900 |
| Przejazd – szczegóły | [PNG](ekrany/21-panel-przejazdy/przejazd-szczegoly.png) | [HTML](ekrany/21-panel-przejazdy/przejazd-szczegoly.html) | 1440×900 |
| Przejazd – zdalne zakończenie | [PNG](ekrany/21-panel-przejazdy/przejazd-zakoncz-zdalnie.png) | [HTML](ekrany/21-panel-przejazdy/przejazd-zakoncz-zdalnie.html) | 1440×900 |

Ustalenia z plansz:

- Szybkie filtry: W trakcie (`UNLOCKING`, `ACTIVE`, `PAUSED`, `ENDING`), Rezerwacje (`RESERVED`), Zakończone (`ENDED`), Problemy (flaga z widoku: nieudane odblokowanie, nieudana blokada, utrata łączności w otwartym przejeździe); `EXPIRED` tylko w „Wszystkie”.
- Lista bez zaznaczania wierszy i operacji grupowych: przejazdy są tylko do odczytu poza zdalnym zakończeniem.
- Powody zdalnego zakończenia: Hulajnoga nie odpowiada, Prośba klienta, Naruszenie regulaminu, Inny powód (z notatką). Zdalne zakończenie nie czeka na potwierdzenie blokady (ADR 0036).
- Oś czasu bez zdarzeń stref (iteracja 4); eksport XLSX zamiast CSV, bez stanu `UNPAID` do iteracji 5.

## Aplikacja: strefy (iteracja 4)

Brakujące stany z [planu iteracji 4](../iteracje/iteracja-04-strefy.md) według odpowiedzi autora (17 listopada 2026). Powstały w repozytorium na stylach plansz `04-mobile-mapa`, `05-mobile-przejazd` i `20-mobile-wypozyczenie`; legenda (`mapa-strefy`), wolna jazda (`przejazd-strefa`) i wyszukiwanie (`mapa-szukaj`) zostają bez zmian.

| Ekran | Podgląd | Kod | Rozmiar |
|---|---|---|---|
| Strefa zakazu w trakcie jazdy | [PNG](ekrany/22-mobile-strefy/przejazd-zakaz.png) | [HTML](ekrany/22-mobile-strefy/przejazd-zakaz.html) | 390×844 |
| Poza obszarem działania w trakcie jazdy | [PNG](ekrany/22-mobile-strefy/przejazd-poza-obszarem.png) | [HTML](ekrany/22-mobile-strefy/przejazd-poza-obszarem.html) | 390×844 |
| Hulajnoga niedostępna: zakaz albo poza obszarem | [PNG](ekrany/22-mobile-strefy/hulajnoga-niedostepna-strefa.png) | [HTML](ekrany/22-mobile-strefy/hulajnoga-niedostepna-strefa.html) | 390×844 |
| Prowadzenie do strefy parkowania | [PNG](ekrany/22-mobile-strefy/przejazd-prowadz-do-strefy.png) | [HTML](ekrany/22-mobile-strefy/przejazd-prowadz-do-strefy.html) | 390×844 |
| Trasa piesza do hulajnogi | [PNG](ekrany/22-mobile-strefy/hulajnoga-trasa.png) | [HTML](ekrany/22-mobile-strefy/hulajnoga-trasa.html) | 390×844 |
| Wynik wyszukiwania na mapie | [PNG](ekrany/22-mobile-strefy/szukaj-wynik.png) | [HTML](ekrany/22-mobile-strefy/szukaj-wynik.html) | 390×844 |
| Wyszukiwanie bez wyników | [PNG](ekrany/22-mobile-strefy/szukaj-brak-wynikow.png) | [HTML](ekrany/22-mobile-strefy/szukaj-brak-wynikow.html) | 390×844 |

Ustalenia z plansz:

- Komunikat strefy jest u góry ekranu jazdy, jak w `przejazd-strefa`. Zatrzymanie (zakaz, poza obszarem) ma odznakę w kolorze błędu i pigułkę „Silnik zatrzymany” w miejscu pigułki limitu; po wyjeździe ze strefy na chwilę „Silnik znów działa”, bez osobnej planszy.
- „Zakończ” w strefie zakazu i poza obszarem zostaje aktywny, jak w `przejazd-poza-strefa`. Dopisek pod przyciskami uprzedza, że tu nie da się zakończyć, a odmowę `OUTSIDE_PARKING` pokazuje panel „Tu nie zakończysz jazdy” z podtytułem o zakazie albo obszarze. Poza obszarem bez słowa o opłacie (iteracja 5).
- `OUT_OF_AREA` ma jeden tekst dla zakazu i obszaru (klucz `scooter.unavailable.reasons.OUT_OF_AREA`); stan pojawia się tylko po skanie albo numerze, bo takich hulajnóg nie ma na mapie.
- Linie na mapie: pełna kobaltowa to jazda (ślad przejazdu, prowadzenie do strefy), przerywana to trasa piesza. Podczas prowadzenia ślad przejazdu jest ukryty.
- Prowadzenie do strefy kończy się samo po wjeździe do strefy, ✕ wraca do zwykłego ekranu jazdy, komunikat strefy ma pierwszeństwo przed kartą prowadzenia.
- Trasa do hulajnogi rysuje się po rezerwacji i po „Trasa” na ekranie hulajnogi; bez OSRM linia prosta z odległością bez czasu, na profilu rowerowym dopisek „(szacunkowo)” (D6).
- Wynik wyszukiwania: grafitowa pinezka celu (kobalt zostaje dla „Twoje”), bez linii trasy; „Zarezerwuj” i „Skanuj i jedź” jak w `mapa-karta-rezerwuj`; gdy cel leży w wolnej jeździe, notka podaje limit.
- Wyszukiwanie ma tylko „Ostatnio wyszukiwane” z „Wyczyść” (D4). Błąd usługi: ten sam układ co brak wyników, odznaka ostrzeżenia i „Spróbuj ponownie” (opis w komentarzu planszy).

## Panel operatora: strefy (iteracja 4)

Plansze w nawigacji z `21-panel-przejazdy`; ekran „Strefy” zastępuje `13-panel/admin-strefy`.

| Ekran | Podgląd | Kod | Rozmiar |
|---|---|---|---|
| Strefy – lista z edytorem | [PNG](ekrany/23-panel-strefy/strefy-lista.png) | [HTML](ekrany/23-panel-strefy/strefy-lista.html) | 1440×900 |
| Nowa strefa – rysowanie | [PNG](ekrany/23-panel-strefy/strefa-nowa.png) | [HTML](ekrany/23-panel-strefy/strefa-nowa.html) | 1440×900 |
| Strefa wolnej jazdy | [PNG](ekrany/23-panel-strefy/strefa-wolna-jazda.png) | [HTML](ekrany/23-panel-strefy/strefa-wolna-jazda.html) | 1440×900 |
| Strefa zakazu (i wariant obszaru działania) | [PNG](ekrany/23-panel-strefy/strefa-zakaz.png) | [HTML](ekrany/23-panel-strefy/strefa-zakaz.html) | 1440×900 |
| Błąd geometrii | [PNG](ekrany/23-panel-strefy/strefa-blad-geometrii.png) | [HTML](ekrany/23-panel-strefy/strefa-blad-geometrii.html) | 1440×900 |
| Dezaktywacja strefy | [PNG](ekrany/23-panel-strefy/strefa-dezaktywacja.png) | [HTML](ekrany/23-panel-strefy/strefa-dezaktywacja.html) | 1440×900 |
| Zmiana strefy w trakcie przejazdów | [PNG](ekrany/23-panel-strefy/strefa-zmiana-w-trakcie.png) | [HTML](ekrany/23-panel-strefy/strefa-zmiana-w-trakcie.html) | 1440×900 |

Ustalenia z plansz:

- Lista po lewej korzysta z kontraktu list (D2): wyszukiwanie po kodzie i nazwie, szybkie filtry typu z licznikami, filtr Aktywne/Nieaktywne (domyślnie Aktywne), sortowanie i stronicowanie. Filtr „Widoczna w aplikacji” jest tylko w zapytaniu.
- Opis pozycji zależy od typu: parkowanie „N z pojemności hulajnóg” (pełna strefa bursztynem), wolna jazda z limitem, zakaz „Zakaz jazdy i parkowania”, obszar z powierzchnią.
- Karta ma pole „Granica” (liczba punktów, powierzchnia, „Pokaż”), przy którym są błędy geometrii (`ZONE_OUTSIDE_SERVICE_AREA`, `ZONE_INVALID_GEOMETRY`, `ZONE_OVERLAP`, za mało punktów) z wyróżnieniem na mapie i „Przywróć granicę”.
- „Obszar” jest zablokowany w wyborze typu, bo aktywny obszar może być tylko jeden; formularz obszaru jak zakaz, bez przełącznika widoczności i bez dezaktywacji.
- Pojemność z podpowiedzią „Nie blokuje zakończenia przejazdu” (pytanie 5); pole „Obowiązuje” z `admin-strefy` usunięte, bo nie ma go w modelu.
- „Dezaktywuj” zastępuje „Usuń strefę”; „Usuń strefę” tylko dla nieużytej strefy, w tym samym układzie okna. Okno dezaktywacji jest bez powodu i notatki.
- Ostrzeżenie o przejazdach w trakcie ma bursztynową ikonę i kobaltowy „Zapisz i zastosuj”; ten sam układ dla zmiany granicy i typu.
- Pasek narzędzi mapy dostał „Cofnij” (ADR 0047); środki krawędzi to uchwyty dodawania punktu. Nowy wielokąt jest kobaltowy do wyboru typu, nowa strefa jest domyślnie widoczna w aplikacji.
- Nienarysowane, opisane w komentarzach: widok tylko do odczytu dla `zones.read`, karta nieaktywnej strefy z „Przywróć strefę”, konflikt wersji `CONFLICT` jak w `17-panel-wzorce`, okno „Usunąć strefę?”.
- Do rozstrzygnięcia w ADR 0043 i 0047: blokada zmiany typu strefy użytej w przejazdach, uproszczenie okręgów z danych startowych (64 punkty), czas wjazdu do strefy potrzebny w kolumnie „W strefie od”.

## Aplikacja: płatności (iteracja 5)

Brakujące stany z [planu iteracji 5](../iteracje/iteracja-05-platnosci.md) według odpowiedzi autora (17 listopada 2026), na stylach `07-mobile-platnosci`, `20-mobile-wypozyczenie` i `22-mobile-strefy`. Portfel (`flow-portfel`), dodanie karty, BLIK, cennik, brak środków i nieudana płatność zostają z wcześniejszych plansz.

| Ekran | Podgląd | Kod | Rozmiar |
|---|---|---|---|
| Doładowanie z kwotą własną | [PNG](ekrany/24-mobile-platnosci/doladowanie-kwota.png) | [HTML](ekrany/24-mobile-platnosci/doladowanie-kwota.html) | 390×844 |
| Doładowanie: oczekiwanie na bank | [PNG](ekrany/24-mobile-platnosci/doladowanie-oczekiwanie.png) | [HTML](ekrany/24-mobile-platnosci/doladowanie-oczekiwanie.html) | 390×844 |
| Doładowanie udane | [PNG](ekrany/24-mobile-platnosci/doladowanie-sukces.png) | [HTML](ekrany/24-mobile-platnosci/doladowanie-sukces.html) | 390×844 |
| Doładowanie odrzucone | [PNG](ekrany/24-mobile-platnosci/doladowanie-odmowa.png) | [HTML](ekrany/24-mobile-platnosci/doladowanie-odmowa.html) | 390×844 |
| Metody płatności | [PNG](ekrany/24-mobile-platnosci/metody-platnosci.png) | [HTML](ekrany/24-mobile-platnosci/metody-platnosci.html) | 390×844 |
| Paragon (potwierdzenie sprzedaży) | [PNG](ekrany/24-mobile-platnosci/paragon.png) | [HTML](ekrany/24-mobile-platnosci/paragon.html) | 390×844 |
| Podsumowanie: zapłacono z portfela | [PNG](ekrany/24-mobile-platnosci/podsumowanie-portfel.png) | [HTML](ekrany/24-mobile-platnosci/podsumowanie-portfel.html) | 390×844 |
| Podsumowanie: płatność kartą w toku | [PNG](ekrany/24-mobile-platnosci/podsumowanie-karta.png) | [HTML](ekrany/24-mobile-platnosci/podsumowanie-karta.html) | 390×844 |
| Start z płatnością kartą | [PNG](ekrany/24-mobile-platnosci/start-karta.png) | [HTML](ekrany/24-mobile-platnosci/start-karta.html) | 390×844 |
| Zaległość na mapie | [PNG](ekrany/24-mobile-platnosci/mapa-zaleglosc.png) | [HTML](ekrany/24-mobile-platnosci/mapa-zaleglosc.html) | 390×844 |
| Spłata zaległości | [PNG](ekrany/24-mobile-platnosci/zaleglosc-splata.png) | [HTML](ekrany/24-mobile-platnosci/zaleglosc-splata.html) | 390×844 |

Ustalenia z plansz:

- Kwota własna to czwarta pigułka „Inna kwota” w portfelu i ekran „Doładowanie” w układzie `platnosci-blik`: pełne złote 10–500 zł, poza zakresem błąd przy polu i nieaktywny przycisk, saldo po doładowaniu liczone na bieżąco. Bez karty pigułka metody to „+ Dodaj kartę”.
- Oczekiwanie na bank nie ma „wstecz”, tylko „Anuluj”; po powrocie z aplikacji banku ekran pyta API o stan, po 2 min bez webhooka „To trwa dłużej niż zwykle”. 3-D Secure to arkusz biblioteki operatora i ten sam ekran oczekiwania bez licznika.
- Każda odmowa mówi „Nie pobraliśmy pieniędzy.”, tytuł zależy od przyczyny; ponowienie to nowa płatność z nowym kluczem idempotencji. Doładowanie to przedpłata bez VAT (VAT jest na paragonie przejazdu).
- Metody płatności: karta „Domyślna”, „Wygasa” (mniej niż 30 dni) z bursztynowym paskiem, „Wygasła” bez wyboru; usunięcie z czerwonym potwierdzeniem, zablokowane (`PAYMENT_METHOD_REQUIRED`), gdy karta płaci za trwający przejazd albo jest jedyną przy zaległości.
- Paragon jest niefiskalnym potwierdzeniem sprzedaży (pozycje, [VAT]%, netto, VAT, brutto, sposób zapłaty, nabywca, [dane sprzedawcy]); przejazd o kwocie 0 i przejazdy z iteracji 3 i 4 nie mają paragonu.
- Podsumowanie po rozliczeniu ma kwoty w Medium i wiersze „Zapłacono z” i „Saldo po przejeździe”; przy ujemnym saldzie kwota w kolorze błędu i „Doładuj portfel” zamiast „Gotowe”. Przejazd kartą od razu „Przejazd zakończony” i „Płatność w toku” (D4), „Paragon” po sukcesie.
- „Płać kartą za przejazd” tylko przy ważnej karcie; wybór karty w arkuszu „Odblokuj i jedź”, „Zmień” dotyczy tylko tego przejazdu.
- Zaległość na mapie to panel, którego nie można zamknąć; ma pierwszeństwo przed ujemnym saldem, przy kilku zaległościach suma. Spłata z portfela tylko, gdy saldo pokrywa całość; ręczna spłata anuluje automatyczne ponowienie (tą samą kartą po 24 h). Odrzucona karta w makietach to karta testowa •••• 0002.

## Panel operatora: płatności (iteracja 5)

Plansze w nawigacji z `23-panel-strefy`; pozycja „Płatności” w grupie Operacje. „Cennik i zasady” zastępuje `13-panel/admin-cennik`.

| Ekran | Podgląd | Kod | Rozmiar |
|---|---|---|---|
| Cennik: wersje | [PNG](ekrany/25-panel-platnosci/cennik-wersje.png) | [HTML](ekrany/25-panel-platnosci/cennik-wersje.html) | 1440×900 |
| Cennik: nowa wersja | [PNG](ekrany/25-panel-platnosci/cennik-nowa-wersja.png) | [HTML](ekrany/25-panel-platnosci/cennik-nowa-wersja.html) | 1440×900 |
| Płatności z panelem bocznym | [PNG](ekrany/25-panel-platnosci/platnosci-lista.png) | [HTML](ekrany/25-panel-platnosci/platnosci-lista.html) | 1440×900 |
| Paragony | [PNG](ekrany/25-panel-platnosci/paragony-lista.png) | [HTML](ekrany/25-panel-platnosci/paragony-lista.html) | 1440×900 |
| Klient: portfel i księga | [PNG](ekrany/25-panel-platnosci/klient-portfel.png) | [HTML](ekrany/25-panel-platnosci/klient-portfel.html) | 1440×900 |
| Korekta salda | [PNG](ekrany/25-panel-platnosci/korekta-salda.png) | [HTML](ekrany/25-panel-platnosci/korekta-salda.html) | 1440×900 |
| Zwrot za przejazd | [PNG](ekrany/25-panel-platnosci/przejazd-zwrot.png) | [HTML](ekrany/25-panel-platnosci/przejazd-zwrot.html) | 1440×900 |

Ustalenia z plansz:

- Stan wersji cennika (Obowiązuje, Zaplanowana, Archiwalna) wynika z `valid_from`; wersji się nie edytuje, nowa wersja ma „Od teraz” albo „Od daty”, porównanie z obowiązującą i wyróżnione zmienione pola. „Limit w strefie wolnej jazdy” wypadł (D6, odnośnik do Stref), opłata poza strefą opisana jako odholowanie, ceny brutto z [VAT]% VAT.
- Płatność to tylko ruch u operatora (doładowanie albo przejazd kartą); przejazd z portfela to wpis `RIDE_CHARGE` w księdze. Zakładki: Płatności, Księga, Portfele, Paragony, Metody płatności, Webhooki; liczniki na szybkich filtrach (Udane, W toku, Nieudane, Zwrócone).
- Panel boczny płatności ma oś „Zdarzenia operatora” (zlecenie, webhook, przetworzenie, pominięte powtórzenie).
- Zwrot tylko ze szczegółów przejazdu (`rentals.manage`), cel wynika ze źródła płatności, bez wyboru. Korekta i zwrot mają kobaltowy przycisk (nie są destrukcyjne), nieodwracalność jest w podtytule; etykieta powodu widoczna dla klienta, notatka tylko w panelu.
- Powody (propozycja do ADR 0054): korekta — Reklamacja, Błąd systemu, Gest dobrej woli, Inny powód; zwrot — Awaria hulajnogi, Błąd naliczenia, Reklamacja klienta, Inny powód.
- Karta klienta ma liczbę zaległości, ostrzeżenie o saldzie poniżej minimum i metody płatności klienta. „Eksportuj XLSX” na liście płatności to iteracja 8.

