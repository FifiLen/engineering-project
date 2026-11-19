# ADR 0070: Minimalna szerokość grafiki hero

- **Status:** zaakceptowana
- **Data:** 2026-11-18

## Kontekst

[ADR 0062](0062-modul-tresci-sekcje-publikacja-dane-firmy.md) i [ADR 0064](0064-biblioteka-mediow.md) wymagają dla grafiki sekcji `web.hero` (i opcjonalnej grafiki Open Graph w `web.meta`) co najmniej 1200 px szerokości. Wartość pochodzi z planszy `tresci-wybor-grafiki`.

Rendery hulajnogi w repozytorium (`docs/projekt/rendery/`) mają 767–922 px szerokości. Dane startowe przypinają do hero render 857 px. Przy progu 1200 px:
- dane startowe łamią regułę rejestru sekcji;
- każdy zapis sekcji hero bez zmiany grafiki kończy się `MEDIA_TOO_NARROW`.

Szerszych renderów nie ma. Serwer nie skaluje grafik (ADR 0064).

Autor zdecydował (18 listopada 2026): minimum 760 px.

## Rozważane opcje

1. **Zostawić 1200 px**, a hero w danych startowych bez grafiki do czasu wgrania szerszego renderu. Reguła zgodna z ADR, ale strona startowa i demo bez obrazu w pierwszym ekranie.
2. **Dostarczyć szerszy render.** Wymaga nowego renderu od autora; do tego czasu jak opcja 1.
3. **Obniżyć próg do 760 px.** Pasują wszystkie istniejące rendery. Grafika hero w układzie strony (`14-strona`) zajmuje około połowy szerokości ekranu 1440 px, więc 760 px wystarcza przy gęstości 1×. Na ekranach 2× obraz będzie mniej ostry.

## Decyzja

**Opcja 3.** `HERO_MIN_WIDTH` w `packages/shared/src/content/sections.ts` wynosi 760 px i dotyczy `web.hero` oraz `web.meta`. Pozostałe ustalenia ADR 0062 i 0064 bez zmian, w tym ostrzeżenie powyżej 2560 px i limit 8000 px.

## Konsekwencje

Pozytywne:

- Dane startowe spełniają reguły rejestru, a hero da się edytować od razu.
- Okno wyboru grafiki oznacza jako „za małe” tylko grafiki węższe niż 760 px.

Negatywne i ryzyka:

- Na ekranach o dużej gęstości hero może być mniej ostre. Gdy powstaną szersze rendery, próg można podnieść kolejnym ADR bez zmiany schematu.
- Grafika Open Graph poniżej 1200 px może być w serwisach społecznościowych pokazywana jako mała miniatura.

## Powiązane

[ADR 0062](0062-modul-tresci-sekcje-publikacja-dane-firmy.md) (zmienia: minimalna szerokość hero), [ADR 0064](0064-biblioteka-mediow.md) (zmienia: minimalna szerokość hero), [plan iteracji 7](../iteracje/iteracja-07-tresci-wydruki.md), plansza `tresci-wybor-grafiki`
