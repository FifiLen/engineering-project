# Design system

Wizualna wersja: [`ekrany/11-design-system/design-system.png`](ekrany/11-design-system/design-system.png). Wartości maszynowe: [`tokens.json`](tokens.json). Decyzja: [ADR 0007](../adr/0007-kierunek-wizualny.md).

## Zasady

1. **Styl produktowy** (Apple, Tesla): produkt w centrum, duże liczby, panele szklane nad mapą, monochrom.
2. **Jeden kolor akcji.** Kobalt `#2B3FF5` oznacza główną akcję albo „Twoje” (wybrana hulajnoga, Twoja trasa, Twoja pozycja). Wszystko inne jest w grafitach i betonach.
3. **Kolory funkcyjne** tylko dla ostrzeżeń (bursztyn `#8F5500`) i błędów (czerwień `#C62F2F`), zawsze z jaśniejszym tłem pod ikoną.
4. **Liczby zawsze w Medium (500)**, duże i ciasne; etykiety pod nimi małe, Regular, szare.
5. **Tryb ciemny:** kobalt zostaje na przyciskach, ale linie, trasy i tekst w kolorze akcji używają `#7A88FF`. Na ciemnym tle render hulajnogi w wariancie Beton.
6. **Dostępność:** kontrast tekstu co najmniej 4.5:1, cele dotykowe co najmniej 44 px, prawdziwe przyciski i pola z etykietami, ruch wyłączany przy ograniczeniu ruchu w systemie.

## Komponenty (z makiet)

| Komponent | Wygląd | Gdzie zobaczyć |
|---|---|---|
| Przycisk główny | 56 px, pełne zaokrąglenie, kobalt, tekst 17/600 biały | `02-mobile-przeplyw/flow-start.png` |
| Przycisk drugorzędny | jak główny, tło `line`, tekst `ink` | `02-mobile-przeplyw/flow-start.png` |
| Przycisk „Zakończ” | grafitowy, biały tekst | `01-kierunek-produktowy/produkt-przejazd.png` |
| Przycisk niebezpieczny | czerwień, biały tekst | `06-mobile-profil/profil-usun-konto.png` |
| Suwak odblokowania | 64 px, tor `line`, uchwyt kobaltowy 56 px ze strzałką | `01-kierunek-produktowy/produkt-hulajnoga.png` |
| Pole tekstowe | 60 px, promień 16, etykieta 12 nad wartością 17/500; aktywne: obramowanie 1.5 px kobalt | `03-mobile-konto/konto-dane.png` |
| Pole kodu | 6 komórek 64 px, promień 16, cyfry 26/500 | `02-mobile-przeplyw/flow-kod.png` |
| Panel szklany | tło 84%, rozmycie 28 px, promień 32, cień | `01-kierunek-produktowy/produkt-mapa.png` |
| Arkusz dolny | tło `bg`, promień 32 u góry | `01-kierunek-produktowy/produkt-przejazd.png` |
| Lista grupowana | biała karta, promień 20, wiersze 54 px z kreską | `06-mobile-profil/profil.png` |
| Statystyki w trzech kolumnach | liczba 20–27/500, etykieta 13, pionowe kreski | `01-kierunek-produktowy/produkt-hulajnoga.png` |
| Przełącznik | 51×31, włączony kobalt | `06-mobile-profil/profil-ustawienia.png` |
| Odznaka ostrzeżenia | koło z jasnym tłem i ikoną w kolorze funkcyjnym | `05-mobile-przejazd/przejazd-strefa.png` |
| Pasek postępu kroków | 3 segmenty 4 px, wypełnione kobaltem | `03-mobile-konto/konto-dane.png` |
| Panel: nawigacja boczna | 232 px, aktywna pozycja z tłem `accentTint` | `13-panel/admin-pulpit.png` |
| Panel: tabela | wiersze 50 px, nagłówki 12/600 szare, statusy jako pigułki | `13-panel/admin-flota.png` |

## Mapa

- Tło `#EFEFEC`, ulice białe, woda `#DFE3E8`, zieleń `#E5E8E1`.
- Hulajnogi: grafitowe kropki z białą obwódką. Wybrana lub Twoja: kobalt z poświatą. Pozycja użytkownika: biała kropka z kobaltową obwódką.
- Strefy: parkowanie kobaltem (wypełnienie 16%, litera P), wolna jazda bursztynem z linią przerywaną, zakaz czerwienią z linią ciągłą, obszar działania grafitową linią przerywaną.
- Ten sam styl w aplikacji (MapLibre Native) i w panelu (MapLibre GL JS).

## Teksty

Po polsku, zdania od wielkiej litery, strona czynna, przyciski mówią dokładnie, co się stanie („Skanuj i jedź”, „Zakończ”). Wartości jeszcze nieustalone są w nawiasach: `[nazwa]`, `[CENA]`, `[LIMIT]`. Zgodnie z wymaganiem 17 teksty interfejsu będą pochodzić z modułu treści, a nie z kodu (zob. `../wymagania-uczelni.md`).
