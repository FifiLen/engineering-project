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

Ekrany aplikacji i panelu (bez eksploracji, ikon i diagramów): **193**. Do wymagania 14 (minimum 50 widoków) zob. `../wymagania-uczelni.md`.

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


## Aplikacja: operacje (iteracja 6)

Brakujące stany z [planu iteracji 6](../iteracje/iteracja-06-operacje-serwis.md) według odpowiedzi autora (18 listopada 2026), na stylach `20-mobile-wypozyczenie`, `22-mobile-strefy` i `24-mobile-platnosci`. Rozwijają `06-mobile-profil/profil-usterka`, `profil-ustawienia`, `05-mobile-przejazd/przejazd-zdjecie` i `przejazd-lacznosc`.

| Ekran | Podgląd | Kod | Rozmiar |
|---|---|---|---|
| Zgłoszenie z przejazdu | [PNG](ekrany/26-mobile-operacje/zgloszenie-z-przejazdu.png) | [HTML](ekrany/26-mobile-operacje/zgloszenie-z-przejazdu.html) | 390×844 |
| Zgłoszenie wysłane | [PNG](ekrany/26-mobile-operacje/zgloszenie-wyslane.png) | [HTML](ekrany/26-mobile-operacje/zgloszenie-wyslane.html) | 390×844 |
| Moje zgłoszenia | [PNG](ekrany/26-mobile-operacje/moje-zgloszenia.png) | [HTML](ekrany/26-mobile-operacje/moje-zgloszenia.html) | 390×844 |
| Zgłoszenie z odpowiedzią | [PNG](ekrany/26-mobile-operacje/zgloszenie-szczegoly.png) | [HTML](ekrany/26-mobile-operacje/zgloszenie-szczegoly.html) | 390×844 |
| Zdjęcie parkowania | [PNG](ekrany/26-mobile-operacje/zdjecie-parkowania.png) | [HTML](ekrany/26-mobile-operacje/zdjecie-parkowania.html) | 390×844 |
| Zdjęcie parkowania: błąd wysyłki | [PNG](ekrany/26-mobile-operacje/zdjecie-parkowania-blad.png) | [HTML](ekrany/26-mobile-operacje/zdjecie-parkowania-blad.html) | 390×844 |
| Zdjęcie parkowania bez aparatu | [PNG](ekrany/26-mobile-operacje/zdjecie-parkowania-bez-aparatu.png) | [HTML](ekrany/26-mobile-operacje/zdjecie-parkowania-bez-aparatu.html) | 390×844 |
| Zgoda na powiadomienia | [PNG](ekrany/26-mobile-operacje/powiadomienia-zgoda.png) | [HTML](ekrany/26-mobile-operacje/powiadomienia-zgoda.html) | 390×844 |
| Ustawienia: powiadomienia wyłączone | [PNG](ekrany/26-mobile-operacje/ustawienia-powiadomienia-wylaczone.png) | [HTML](ekrany/26-mobile-operacje/ustawienia-powiadomienia-wylaczone.html) | 390×844 |
| Zakończenie bez łączności | [PNG](ekrany/26-mobile-operacje/koniec-offline.png) | [HTML](ekrany/26-mobile-operacje/koniec-offline.html) | 390×844 |
| Zakończenie bez łączności poza strefą | [PNG](ekrany/26-mobile-operacje/koniec-offline-poza-strefa.png) | [HTML](ekrany/26-mobile-operacje/koniec-offline-poza-strefa.html) | 390×844 |
| Baner powiadomienia (wersja web) | [PNG](ekrany/26-mobile-operacje/baner-powiadomienia.png) | [HTML](ekrany/26-mobile-operacje/baner-powiadomienia.html) | 390×844 |

Ustalenia z plansz:

- Formularz nazywa się „Zgłoś problem”, bo obejmuje też reklamację opłaty; ten sam tytuł dostaje wejście z profilu (`profil-usterka`). Z podsumowania przejazdu i z karty hulajnogi hulajnoga jest podstawiona bez wyboru; z karty hulajnogi nie ma „Rozliczenie” (brak przejazdu). Wybór hulajnogi zostaje tylko przy wejściu z profilu.
- Kategorie wielokrotnego wyboru; kategoria łączności jest ukryta przed klientem (zgłoszenia automatyczne). Opis wymagany przy „Rozliczenie” i „Inne”, do [3] zdjęć. Kategorie pilne (hamulce, koło, kierownica) mają notkę już w formularzu, a potwierdzenie pokazuje kartę „wyłączona z ruchu” (w trakcie przejazdu: „po zakończeniu przejazdu” i „Prowadź do strefy”, D5).
- Numer zgłoszenia dla klienta ma format Z-1042. Statusy dla klienta: Przyjęte, W toku, W serwisie, Rozwiązane; pilności i zgłoszeń automatycznych ani założonych przez operatora klient nie widzi. Kropka w kolorze akcji oznacza nieprzeczytaną odpowiedź.
- Odpowiedź to jedno pole bez czatu (D7); historia pokazuje tylko zmiany statusu, bez nazwisk i notatek wewnętrznych. Zwrot z reklamacji jest w kolorze akcji z odnośnikiem do korekty paragonu.
- Kolejność po zakończeniu: `przejazd-konczenie` → aparat (`przejazd-zdjecie` z „Pomiń”) → podgląd → podsumowanie. Przejazd jest już `ENDED`, więc zdjęcie niczego nie blokuje; „Wyślij ponownie” wysyła ten sam plik, bez kolejki w tle. Po zakończeniu bez łączności zdjęcie jest wymagane i nie ma „Pomiń”.
- Bez aparatu główną akcją jest wybór pliku (JPG, PNG albo HEIC, do [10] MB); w wersji web bez „Otwórz ustawienia telefonu” i z tytułem „Dodaj zdjęcie z pliku”.
- Prośba o powiadomienia pojawia się raz, przy pierwszej rezerwacji albo pierwszym starcie, nie przy rejestracji; „Nie teraz” jej nie ponawia, wersja web jej nie pokazuje. Preferencje w ustawieniach zostają edytowalne mimo blokady w systemie; niska bateria, nieudana płatność i odpowiedź na zgłoszenie nie mają przełącznika, „Promocje” to zgoda marketingowa.
- Zakończenie bez łączności (pytanie 1): „Zakończ” w `przejazd-lacznosc` jest aktywny, gdy ostatnia pozycja nie starsza niż 2 min leży w strefie parkowania. Naliczanie kończy się przy żądaniu, blokada czeka do 10 min, a klient nie musi czekać, ale nie zacznie nowego przejazdu, dopóki ten jest w `ENDING`. Gdy pozycja jest poza strefą albo starsza niż 2 min, zakończenia nie ma, a prowadzenie do strefy liczy trasę od telefonu.
- Baner w wersji web (D2) jest widoczny [6] s, nowy zastępuje poprzedni, dotknięcie otwiera ekran według rodzaju powiadomienia. Niska bateria w jeździe nie ma banera, bo ekran jazdy ma własny komunikat.

Implementacja (18 listopada 2026) odchodzi od plansz w kilku miejscach: szczegóły zgłoszenia bez „Zwrot do portfela” i „Korekta paragonu”, baner bez zamykania gestem i oznaczania odczytu, niska bateria w procentach zamiast kilometrów, aparat bez latarki, bez wejścia „zgłoś w trakcie jazdy”, a arkusz „Zmień”, panel kończenia bez łączności na mapie i wybór aparat albo galeria powstały bez makiety. Pełna lista: [dziennik, iteracja 6](../dziennik.md#iteracja-6-implementacja-18-listopada-2026).

## Panel operatora: serwis (iteracja 6)

Plansze w nawigacji z `25-panel-platnosci` z nową grupą Serwis (Zgłoszenia z liczbą nowych, Zadania, Części) i pozycją „Powiadomienia” w Konfiguracji. Zastępują `13-panel/admin-zgloszenia` (tablica), `admin-symulator` (suwaki, generowanie przejazdów, wykres) i `admin-pulpit` (wykresy i mapa wracają w iteracji 8), a `przejazd-zakoncz-odholowanie` zmienia zdanie „bez opłaty za parkowanie poza strefą” z `21-panel-przejazdy/przejazd-zakoncz-zdalnie` (pytanie 7).

| Ekran | Podgląd | Kod | Rozmiar |
|---|---|---|---|
| Zgłoszenia z panelem bocznym | [PNG](ekrany/27-panel-serwis/zgloszenia-lista.png) | [HTML](ekrany/27-panel-serwis/zgloszenia-lista.html) | 1440×900 |
| Zgłoszenie: reklamacja i odpowiedź | [PNG](ekrany/27-panel-serwis/zgloszenie-szczegoly.png) | [HTML](ekrany/27-panel-serwis/zgloszenie-szczegoly.html) | 1440×900 |
| Zadania serwisowe | [PNG](ekrany/27-panel-serwis/zadania-lista.png) | [HTML](ekrany/27-panel-serwis/zadania-lista.html) | 1440×900 |
| Zakończenie zadania | [PNG](ekrany/27-panel-serwis/zadanie-zakoncz.png) | [HTML](ekrany/27-panel-serwis/zadanie-zakoncz.html) | 1440×900 |
| Magazyn części: przyjęcie dostawy | [PNG](ekrany/27-panel-serwis/czesci-magazyn.png) | [HTML](ekrany/27-panel-serwis/czesci-magazyn.html) | 1440×900 |
| Hulajnoga: serwis i „Wyślij do serwisu” | [PNG](ekrany/27-panel-serwis/hulajnoga-serwis.png) | [HTML](ekrany/27-panel-serwis/hulajnoga-serwis.html) | 1440×900 |
| Szablony powiadomień | [PNG](ekrany/27-panel-serwis/szablony-powiadomien.png) | [HTML](ekrany/27-panel-serwis/szablony-powiadomien.html) | 1440×900 |
| Symulator | [PNG](ekrany/27-panel-serwis/symulator.png) | [HTML](ekrany/27-panel-serwis/symulator.html) | 1440×900 |
| Zdalne zakończenie z opłatą za odholowanie | [PNG](ekrany/27-panel-serwis/przejazd-zakoncz-odholowanie.png) | [HTML](ekrany/27-panel-serwis/przejazd-zakoncz-odholowanie.html) | 1440×900 |
| Pulpit: wymaga uwagi | [PNG](ekrany/27-panel-serwis/pulpit-uwaga.png) | [HTML](ekrany/27-panel-serwis/pulpit-uwaga.html) | 1440×900 |

Ustalenia z plansz:

- Pozycje bez uprawnienia są ukryte, a pusta grupa znika (ADR 0028): Serwisant nie widzi Przejazdów, Płatności, Cennika, Treści, Powiadomień ani grupy Klienci i dostęp; Dyspozytor nie widzi Operatorów ani Symulatora. Pozycje nawigacji mają 36 px, żeby pełna nawigacja Administratora zmieściła się w 900 px.
- Zgłoszenia: szybkie filtry Otwarte (domyślnie), Nowe, W trakcie, W serwisie, Rozwiązane; pilność i źródło (Klient, Automatyczne, Operator) jako przełączniki z licznikami. Ręcznie ustawia się tylko Nowe, W trakcie i Rozwiązane; „W serwisie” ustawia utworzenie zadania, a zdejmuje zakończenie ostatniego. Pilna kategoria od razu pokazuje hulajnogę jako Serwis.
- „Odpowiedź dla klienta” jest wymagana przy Rozwiązane; nowa zastępuje poprzednią, a poprzednie zostają na osi czasu (D6, D7). Reklamacja nie zwraca pieniędzy sama: „Zwrot za przejazd” otwiera okno `25-panel-platnosci/przejazd-zwrot`, a zwrot pojawia się na osi zgłoszenia.
- „Utwórz zadanie” i „Wyślij do serwisu” to jedno okno: rodzaj podpowiada kategoria (Bateria → Wymiana baterii, Poza strefą → Przewiezienie, reszta → Naprawa), rodzaj już otwarty na hulajnodze jest nieaktywny, hulajnoga w przejeździe przechodzi do serwisu po jego zakończeniu.
- „Moje zadania” to karty zadań otwartych i w toku przypisanych do zalogowanego; „Rozpocznij” przypisuje nieprzypisane zadanie do siebie. Stan części maleje przy dodaniu do zadania, usunięcie pozycji albo anulowanie zadania zwraca części.
- Zakończenie zadania wymaga notatki i pokazuje skutek liczony z trzech warunków pytania 5 (brak innych otwartych zadań, online, bateria co najmniej [15]%); przy baterii poniżej progu proponuje zadanie Wymiana baterii. Zakończenie `BATTERY_SWAP` wysyła `battery_swapped` (pytanie 8). „Przywróć do floty” na karcie hulajnogi sprawdza tę samą regułę.
- Magazyn: przyjęcie dostawy (ilość, opcjonalna nowa cena dla kolejnych użyć, dokument) albo korekta stanu z powodem, w jednej transakcji z blokadą wiersza i wpisem w dzienniku audytu.
- Szablony: kodów nie dodaje się ani nie usuwa (wyznacza je rejestr zdarzeń w API); walidacja ICU przy każdej zmianie i przy zapisie (błąd z wierszem i znakiem, nieznany parametr), podgląd z ostatniej poprawnej wersji, zapis tworzy nową wersję, przywrócenie też. Kwoty formatuje API przed renderowaniem.
- Symulator: strona i API tylko w środowisku deweloperskim, jedna aktywna operacja na hulajnogę, liczba hulajnóg i tempo tylko do odczytu; po 30 s bez `simulator/status` panel pokazuje „Symulator nie odpowiada”.
- Odholowanie: pole tylko, gdy ostatnia pozycja jest poza strefą parkowania, domyślnie zaznaczone, kwota z wersji cennika przejazdu; po odznaczeniu zadanie `RELOCATION` powstaje i tak. Ten sam układ służy zakończeniu przy utracie łączności.
- Pulpit: cztery grupy „Wymaga uwagi” z liczbą i najwyżej czterema pozycjami, odnośnik do listy z tym samym filtrem; każda grupa wymaga uprawnienia listy docelowej, przy zerze „Nic nie czeka”.

Implementacja (18 listopada 2026) odchodzi od plansz w kilku miejscach: bez „Eksportuj XLSX”, Raportów i Wydruków w nawigacji, karta hulajnogi tylko z zakładkami Przegląd i Serwis, cel przewiezienia tylko jako strefa parkowania, szablony bez „Porównaj”, symulator bez tempa i numeru przejazdu, odholowanie bez ulicy, odległości i stawki VAT, a zgłoszenie ma dodatkowe pole „Notatka wewnętrzna”. Pełna lista: [dziennik, iteracja 6](../dziennik.md#iteracja-6-implementacja-18-listopada-2026).

## Panel operatora: treści i wydruki (iteracja 7)

Plansze według odpowiedzi autora do [planu iteracji 7](../iteracje/iteracja-07-tresci-wydruki.md) (18 listopada 2026), w nawigacji z `27-panel-serwis`: „Treści” w Konfiguracji z sześcioma zakładkami (Dokumenty prawne, Bloki treści, FAQ, Aktualności, Media, Dane firmy) i „Wydruki” w Analizie (Szablony, Wygenerowane). Zastępują zakładki z `18-panel-dostep/dostep-dokumenty`.

| Ekran | Podgląd | Kod | Rozmiar |
|---|---|---|---|
| Bloki treści | [PNG](ekrany/28-panel-tresci/tresci-bloki.png) | [HTML](ekrany/28-panel-tresci/tresci-bloki.html) | 1440×900 |
| Edycja bloku z Markdownem i historią | [PNG](ekrany/28-panel-tresci/tresci-blok-edycja.png) | [HTML](ekrany/28-panel-tresci/tresci-blok-edycja.html) | 1440×900 |
| Sekcja-lista (zasady przed jazdą) | [PNG](ekrany/28-panel-tresci/tresci-sekcja-lista.png) | [HTML](ekrany/28-panel-tresci/tresci-sekcja-lista.html) | 1440×900 |
| FAQ z kolejnością i edycją | [PNG](ekrany/28-panel-tresci/tresci-faq.png) | [HTML](ekrany/28-panel-tresci/tresci-faq.html) | 1440×900 |
| Aktualności z planowaniem | [PNG](ekrany/28-panel-tresci/tresci-aktualnosci.png) | [HTML](ekrany/28-panel-tresci/tresci-aktualnosci.html) | 1440×900 |
| Biblioteka mediów | [PNG](ekrany/28-panel-tresci/tresci-media.png) | [HTML](ekrany/28-panel-tresci/tresci-media.html) | 1440×900 |
| Wysyłka grafik z walidacją | [PNG](ekrany/28-panel-tresci/tresci-media-wysylka.png) | [HTML](ekrany/28-panel-tresci/tresci-media-wysylka.html) | 1440×900 |
| Wybór grafiki | [PNG](ekrany/28-panel-tresci/tresci-wybor-grafiki.png) | [HTML](ekrany/28-panel-tresci/tresci-wybor-grafiki.html) | 1440×900 |
| Dane firmy | [PNG](ekrany/28-panel-tresci/tresci-dane-firmy.png) | [HTML](ekrany/28-panel-tresci/tresci-dane-firmy.html) | 1440×900 |
| Szablony wydruków | [PNG](ekrany/29-panel-wydruki/wydruki-szablony.png) | [HTML](ekrany/29-panel-wydruki/wydruki-szablony.html) | 1440×900 |
| Szablon: wersje, walidacja, podgląd | [PNG](ekrany/29-panel-wydruki/wydruki-szablon-wersja.png) | [HTML](ekrany/29-panel-wydruki/wydruki-szablon-wersja.html) | 1440×900 |
| Wgranie szablonu z błędami | [PNG](ekrany/29-panel-wydruki/wydruki-wgranie-bledy.png) | [HTML](ekrany/29-panel-wydruki/wydruki-wgranie-bledy.html) | 1440×900 |
| Okno „Drukuj” ze stanami | [PNG](ekrany/29-panel-wydruki/wydruki-drukuj.png) | [HTML](ekrany/29-panel-wydruki/wydruki-drukuj.html) | 1440×900 |
| Wygenerowane dokumenty | [PNG](ekrany/29-panel-wydruki/wydruki-wygenerowane.png) | [HTML](ekrany/29-panel-wydruki/wydruki-wygenerowane.html) | 1440×900 |
| Naklejka z kodem QR | [PNG](ekrany/29-panel-wydruki/wydruki-naklejka-qr.png) | [HTML](ekrany/29-panel-wydruki/wydruki-naklejka-qr.html) | 1440×900 |

Ustalenia z plansz:

- Sekcji nie dodaje się w panelu (D1); sekcja-lista to nagłówek i elementy z kolejnością zapisywaną razem z sekcją, przy limicie „Dodaj element” jest nieaktywny, a sekcja wymagana (hero) nie schodzi do szkicu ani archiwum. Rejestr sekcji zawęża też składnię Markdown (np. w hero bez nagłówków); błąd podaje wiersz i blokuje zapis, jak w szablonach powiadomień.
- Zmiana opublikowanego wpisu działa od zapisu; „Przywróć” z historii (dziennik audytu) wczytuje treść do edytora, a zapis tworzy nową wersję z blokadą optymistyczną. FAQ: kolejność zapisywana jawnie („Zapisz kolejność”, „Cofnij”), archiwum zamiast usuwania, osobne przełączniki strona i aplikacja. Aktualności: stan liczony ze statusu i dat, „Zaplanuj” albo „Opublikuj teraz”, daty w czasie polskim.
- Media: tekst alternatywny należy do grafiki (zmiana działa wszędzie), klucze systemowe (`scooter.*`) tylko do odczytu i blokują usunięcie, „Zastąp plik” zachowuje identyfikator i użycia; wysyłka wielu plików, odrzucone zostają na liście z przyczyną; sekcja może wymagać minimalnej szerokości grafiki (hero: 1200 px).
- Dane firmy: paragon kopiuje dane w chwili wystawienia; marka [nazwa] nie jest daną firmy.
- Szablony: wersja z błędem nie powstaje, nieużyte pola katalogu to ostrzeżenie; aktywacja i przywrócenie wymagają `templates.write`; rodzaj bez szablonu nie pokazuje „Drukuj”. Miejsce błędu w DOCX to tabela, wiersz, kolumna albo akapit; numer strony z planszy `wydruki-wgranie-bledy` jest do sprawdzenia przy ADR 0067 (podział na strony powstaje dopiero przy renderowaniu).
- Drukowanie: zawsze powstaje DOCX, PDF przez Gotenberga; przy błędzie PDF zostaje DOCX, „Spróbuj ponownie” tworzy nowy wiersz; stopka „Wydruk {id} · {szablon} v{n} · data · operator · strona”. Naklejka QR (60 × 80 mm albo arkusz A4 z sześcioma, propozycja) to PDF z HTML poza szablonami, zapisany w Wygenerowanych jako układ wbudowany.

Implementacja (19 listopada 2026) odchodzi od plansz w kilku miejscach: minimalna szerokość grafiki hero to 760 px zamiast 1200 px ([ADR 0070](../adr/0070-minimalna-szerokosc-grafiki-hero.md)), dane firmy mają sekcję „Dane rejestrowe” spoza planszy, stany okna „Drukuj” są w miejscu formularza zamiast kart obok, wyszukiwarka Wygenerowanych jest w pasku filtrów z domyślnym filtrem „Zlecający”, okno wgrania ma pole „Co się zmieniło”, błąd szablonu nie ma numeru strony, „W dokumencie” ma liczby tylko dla zadania, a podgląd naklejki w panelu różni się od PDF. Wydruk z danymi klienta bez `users.read` pokazuje w Wygenerowanych „Dane klienta” zamiast „Pobierz” (poprawka po przeglądzie). Pełna lista: [dziennik, iteracja 7](../dziennik.md#iteracja-7-implementacja-19-listopada-2026).

## Strona i aplikacja: treści (iteracja 7)

Podstrony strony promocyjnej w stylu `14-strona` (nagłówek z pozycją „Aktualności”, stopka z danymi firmy) i ekrany aplikacji w stylu `26-mobile-operacje`.

| Ekran | Podgląd | Kod | Rozmiar |
|---|---|---|---|
| Dokument (regulamin) | [PNG](ekrany/30-strona-tresci/strona-dokument.png) | [HTML](ekrany/30-strona-tresci/strona-dokument.html) | 1440×900 |
| Aktualności | [PNG](ekrany/30-strona-tresci/strona-aktualnosci.png) | [HTML](ekrany/30-strona-tresci/strona-aktualnosci.html) | 1440×900 |
| Artykuł | [PNG](ekrany/30-strona-tresci/strona-aktualnosc.png) | [HTML](ekrany/30-strona-tresci/strona-aktualnosc.html) | 1440×900 |
| Strona hulajnogi `/h/{numer}` | [PNG](ekrany/30-strona-tresci/strona-hulajnoga.png) | [HTML](ekrany/30-strona-tresci/strona-hulajnoga.html) | 1440×900 |
| Strona 404 | [PNG](ekrany/30-strona-tresci/strona-404.png) | [HTML](ekrany/30-strona-tresci/strona-404.html) | 1440×900 |
| Dokument (telefon) | [PNG](ekrany/30-strona-tresci/strona-dokument-mobile.png) | [HTML](ekrany/30-strona-tresci/strona-dokument-mobile.html) | 390×844 |
| Strona hulajnogi (telefon) | [PNG](ekrany/30-strona-tresci/strona-hulajnoga-mobile.png) | [HTML](ekrany/30-strona-tresci/strona-hulajnoga-mobile.html) | 390×844 |
| Pomoc | [PNG](ekrany/31-mobile-tresci/pomoc.png) | [HTML](ekrany/31-mobile-tresci/pomoc.html) | 390×844 |
| Pomoc bez sieci | [PNG](ekrany/31-mobile-tresci/pomoc-offline.png) | [HTML](ekrany/31-mobile-tresci/pomoc-offline.html) | 390×844 |
| Paragon: przygotowanie PDF | [PNG](ekrany/31-mobile-tresci/paragon-pdf.png) | [HTML](ekrany/31-mobile-tresci/paragon-pdf.html) | 390×844 |
| Paragon: PDF gotowy | [PNG](ekrany/31-mobile-tresci/paragon-pdf-gotowy.png) | [HTML](ekrany/31-mobile-tresci/paragon-pdf-gotowy.html) | 390×844 |
| Paragon: błąd PDF | [PNG](ekrany/31-mobile-tresci/paragon-pdf-blad.png) | [HTML](ekrany/31-mobile-tresci/paragon-pdf-blad.html) | 390×844 |
| Pobierz moje dane | [PNG](ekrany/31-mobile-tresci/moje-dane.png) | [HTML](ekrany/31-mobile-tresci/moje-dane.html) | 390×844 |
| Moje dane: przygotowanie | [PNG](ekrany/31-mobile-tresci/moje-dane-przygotowanie.png) | [HTML](ekrany/31-mobile-tresci/moje-dane-przygotowanie.html) | 390×844 |
| Moje dane: plik gotowy | [PNG](ekrany/31-mobile-tresci/moje-dane-gotowe.png) | [HTML](ekrany/31-mobile-tresci/moje-dane-gotowe.html) | 390×844 |

Ustalenia z plansz:

- Strona: przyciski grafitowe jak „Pobierz aplikację”, kobalt dla odnośników i liczb. Spis treści dokumentu z nagłówków `##` (kotwice bez znaków diakrytycznych); data obowiązywania to `published_at`, wersja archiwalna pod `/regulamin/wersja/{n}`; dokumenty prawne bez „Pobierz PDF”.
- Aktualności: data z `publish_from`, zajawka wymagana, podpis grafiki z biblioteki, zaplanowana albo wygasła daje 404, stronicowanie co [12].
- `/h/{numer}`: bez dostępności, baterii i położenia (cache strony), `/h/7` przekierowuje na `/h/0007`, zły numer daje 404; dokąd prowadzi „Mam aplikację, otwórz hulajnogę” rozstrzyga ADR 0065.
- Pomoc: kilka pytań otwartych naraz, bez sieci treść z pamięci telefonu z czasem ostatniego pobrania, „Moje zgłoszenia” nieaktywne, kontakt działa. „Pomoc i zgłoszenia” w profilu otwiera Pomoc.
- Paragon PDF: przycisk u dołu ekranu, zadanie trwa po wyjściu z ekranu, aplikacja czeka na `document.ready` (odpytywanie co [2] s, błąd po [30] s), wersja web otwiera PDF w nowej karcie. „Pobierz moje dane”: limit 24 h od zlecenia (nieudane się nie liczy), plik ważny 7 dni, drugie zlecenie daje `DATA_EXPORT_LIMIT`.

Implementacja (19 listopada 2026) odchodzi od plansz w kilku miejscach. Strona: sekcja stref bez grafiki (rysunek ozdobny), sekcja aplikacji bez makiety telefonu, aktualność bez grafiki na szarym tle, lista aktualności na wspólnym wzorcu, `/h/{numer}` na telefonie z renderem nad numerem i bez „Jak ruszyć”, a 404 spoza tras ma stopkę bez danych firmy. Aplikacja: ikony zasad z planszy panelu zamiast `konto-zasady`, wstęp Pomocy między zgłoszeniami a FAQ, komunikat `mobile.notice` niewyświetlany, przycisk paragonu w stopce ekranu bez gradientu, karty błędu i wygaśnięcia eksportu bez plansz, a wersja web przy zablokowanym oknie pokazuje arkusz z „Otwórz”. Powiadomienie o gotowym eksporcie otwiera `/profil/moje-dane`. Pełna lista: [dziennik, iteracja 7](../dziennik.md#iteracja-7-implementacja-19-listopada-2026).

## Panel operatora: raporty, pulpit i domknięcie (iteracja 8)

Plansze według odpowiedzi autora do [planu iteracji 8](../iteracje/iteracja-08-raporty-domkniecie-panelu.md) (19 listopada 2026), w nawigacji z `29-panel-wydruki` z nową pozycją „Raporty” w Analizie (zakładki Raporty, Historia, Definicje). Nowe listy są zakładkami obszarów domenowych (D7): Flota (Hulajnogi, Telemetria, Komendy), Użytkownicy (Klienci, Zgody, Sesje, Kody SMS), Operatorzy i role (Operatorzy, Zaproszenia, Sesje, Role, Uprawnienia, Dziennik audytu). `33-panel-pulpit` zastępuje `13-panel/admin-pulpit` i `27-panel-serwis/pulpit-uwaga`; okno eksportu zastępuje „Eksportuj XLSX ▾” z `17-panel-wzorce` i `21-panel-przejazdy`.

| Ekran | Podgląd | Kod | Rozmiar |
|---|---|---|---|
| Katalog raportów | [PNG](ekrany/32-panel-raporty/raporty-katalog.png) | [HTML](ekrany/32-panel-raporty/raporty-katalog.html) | 1440×900 |
| Raport: przychody z podglądem | [PNG](ekrany/32-panel-raporty/raport-przychody.png) | [HTML](ekrany/32-panel-raporty/raport-przychody.html) | 1440×900 |
| Raport: przejazdy według stref i godzin | [PNG](ekrany/32-panel-raporty/raport-strefy-godziny.png) | [HTML](ekrany/32-panel-raporty/raport-strefy-godziny.html) | 1440×900 |
| Raport: stany podglądu | [PNG](ekrany/32-panel-raporty/raport-stany.png) | [HTML](ekrany/32-panel-raporty/raport-stany.html) | 1440×900 |
| Eksport raportu ze stanami | [PNG](ekrany/32-panel-raporty/raport-eksport.png) | [HTML](ekrany/32-panel-raporty/raport-eksport.html) | 1440×900 |
| Historia uruchomień | [PNG](ekrany/32-panel-raporty/raporty-historia.png) | [HTML](ekrany/32-panel-raporty/raporty-historia.html) | 1440×900 |
| Definicja raportu | [PNG](ekrany/32-panel-raporty/raport-definicja.png) | [HTML](ekrany/32-panel-raporty/raport-definicja.html) | 1440×900 |
| PDF raportu (A4 pionowo i poziomo) | [PNG](ekrany/32-panel-raporty/raport-pdf.png) | [HTML](ekrany/32-panel-raporty/raport-pdf.html) | 1440×900 |
| Pulpit: Administrator | [PNG](ekrany/33-panel-pulpit/pulpit-administrator.png) | [HTML](ekrany/33-panel-pulpit/pulpit-administrator.html) | 1440×900 |
| Pulpit: Serwisant | [PNG](ekrany/33-panel-pulpit/pulpit-serwisant.png) | [HTML](ekrany/33-panel-pulpit/pulpit-serwisant.html) | 1440×900 |
| Pulpit: Redaktor | [PNG](ekrany/33-panel-pulpit/pulpit-redaktor.png) | [HTML](ekrany/33-panel-pulpit/pulpit-redaktor.html) | 1440×900 |
| Eksport listy (XLSX, CSV) | [PNG](ekrany/34-panel-domkniecie/lista-eksport.png) | [HTML](ekrany/34-panel-domkniecie/lista-eksport.html) | 1440×900 |
| Flota: telemetria | [PNG](ekrany/34-panel-domkniecie/flota-telemetria.png) | [HTML](ekrany/34-panel-domkniecie/flota-telemetria.html) | 1440×900 |
| Flota: komendy | [PNG](ekrany/34-panel-domkniecie/flota-komendy.png) | [HTML](ekrany/34-panel-domkniecie/flota-komendy.html) | 1440×900 |
| Karta hulajnogi: historia stanów | [PNG](ekrany/34-panel-domkniecie/hulajnoga-historia-stanow.png) | [HTML](ekrany/34-panel-domkniecie/hulajnoga-historia-stanow.html) | 1440×900 |
| Użytkownicy: zgody z wycofaniem | [PNG](ekrany/34-panel-domkniecie/klienci-zgody.png) | [HTML](ekrany/34-panel-domkniecie/klienci-zgody.html) | 1440×900 |
| Użytkownicy: sesje z unieważnieniem | [PNG](ekrany/34-panel-domkniecie/klienci-sesje.png) | [HTML](ekrany/34-panel-domkniecie/klienci-sesje.html) | 1440×900 |
| Użytkownicy: kody SMS | [PNG](ekrany/34-panel-domkniecie/klienci-kody-sms.png) | [HTML](ekrany/34-panel-domkniecie/klienci-kody-sms.html) | 1440×900 |
| Operatorzy: zaproszenia i sesje | [PNG](ekrany/34-panel-domkniecie/operatorzy-sesje-zaproszenia.png) | [HTML](ekrany/34-panel-domkniecie/operatorzy-sesje-zaproszenia.html) | 1440×900 |
| Role: uprawnienia z opisem | [PNG](ekrany/34-panel-domkniecie/role-uprawnienia.png) | [HTML](ekrany/34-panel-domkniecie/role-uprawnienia.html) | 1440×900 |
| Wydruki: edycja i dezaktywacja szablonu | [PNG](ekrany/34-panel-domkniecie/wydruki-szablon-edycja.png) | [HTML](ekrany/34-panel-domkniecie/wydruki-szablon-edycja.html) | 1440×900 |

Ustalenia z plansz:

- Wykresy: słupki w szarości `#6B6E75` (kontrast 5,1:1), poprzedni okres w betonie, kobalt tylko dla bieżącej albo zaznaczonej wartości (w PDF zamkniętego okresu bez kobaltu), zmiana wobec poprzedniego okresu strzałką w kolorze tekstu, bez zieleni i czerwieni; przy każdym wykresie „Pokaż jako tabelę”. Mapa ciepła ma 5 stałych progów i pokazuje średnią na wystąpienie dnia tygodnia.
- Raporty: dane na chwilę zapytania w nagłówku, porównanie z poprzednim miesiącem kalendarzowym albo okresem tej samej długości, granulacja do 62 dni dzień, do 182 tydzień, dalej miesiąc; limit podglądu [15] s, renderu [60] s, PDF skraca tabele do [50] wierszy; pustego raportu nie da się eksportować; „Uruchom ponownie z tymi parametrami” liczy ten sam okres z danymi na teraz.
- Pulpit: katalog 7 kafelków w stałej kolejności, rola widzi pierwsze 5 dozwolonych; Serwisant zamiast wykresu godzin ma „Twoje zadania”, Redaktor grupę „Treści” (zaplanowane, wygasające, szkice, nieużywane grafiki).
- Eksport listy: limit 50 000 wierszy sprawdza panel i API (`LIST_EXPORT_LIMIT`), ostrzeżenie o danych osobowych tylko przy kolumnach oznaczonych w definicji zasobu, bez `users.read` kolumna klienta ma wartość „Klient”; CSV w UTF-8 z BOM, średnik i przecinek dziesiętny.
- Historia stanów: brak łączności przykrywa stan, rezerwacja w jasnym kobalcie, niska bateria nie jest stanem; przyczyna przedziału (przejazd, zadanie, zgłoszenie, operator, brak telemetrii) z widoku albo z nowej kolumny (ADR 0074).
- Telemetria: hulajnoga i zakres czasu wymagane (najwyżej [24 h]), stronicowanie kursorem bez liczby wszystkich odczytów, przerwy z `lag()`; tabela `telemetry` nie zapisuje `locked` ani `buffered` z kontraktu MQTT.
- Sesje klientów i operatorów: jeden wiersz na rodzinę tokenów; unieważnienie wylogowuje najpóźniej po 15 min (token dostępu). Kody SMS bez kodu i z numerem z trzema ostatnimi cyframi. Wycofanie zgody tylko marketingowej, z powodem w dzienniku audytu.
- Szablon wydruku: domyślnego szablonu z aktywną wersją nie da się dezaktywować (najpierw inny domyślny), nieaktywny jest wyszarzony z „Aktywuj ponownie”.
- Luki w schemacie i definicje do rozstrzygnięcia w ADR 0071–0076 zebrane w [planie iteracji 8](../iteracje/iteracja-08-raporty-domkniecie-panelu.md#do-rozstrzygnięcia-w-adr-00710076-z-makiet-19-listopada-2026).
