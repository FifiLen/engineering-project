# ADR 0074: Historia stanów hulajnogi

- **Status:** zaakceptowana
- **Data:** 2026-11-19

## Kontekst

`scooters.status` i `scooters.online` mają tylko bieżącą wartość. Raport wykorzystania floty ([ADR 0071](0071-modul-raportow.md)), pulpit i karta hulajnogi potrzebują czasu w każdym stanie: w przejeździe, w rezerwacji, dostępna, w serwisie, bez łączności. Dziennik audytu ma tylko część zmian stanu (wpisy operatora i systemu z iteracji 6), a przestój bez łączności widać tylko w lukach telemetrii.

Odpowiedzi autora z 19 listopada 2026: pytanie 13 (nowa tabela, czasy od wdrożenia migracji) i D4 (tabela tylko do dopisywania wypełniana wyzwalaczem `AFTER UPDATE OF status, online`).

Plansze:
- `34-panel-domkniecie/hulajnoga-historia-stanow`: zakładka „Historia stanów” z osią czasu na 7 dni, udziałami i listą przedziałów z przyczyną (przejazd, zadanie, zgłoszenie automatyczne, operator, brak telemetrii);
- `32-panel-raporty/raport-pdf`: tabela wykorzystania według hulajnogi.

Obie liczą wskaźniki różnie. Raport: wykorzystanie = przejazd ÷ (przejazd + rezerwacja + dostępna). Karta: wykorzystanie = przejazd ÷ czas okresu.

Sprawdzone w kodzie 19 listopada 2026:
- `online` zmienia tylko `setConnection` w `telemetry.repository.ts` przy wiadomości `status` (z flagą retained i Last Will). Partie telemetrii aktualizują pozycję, baterię, `last_seen_at` i przebieg, ale nie `status` ani `online`, więc wyzwalacz na tych kolumnach nie zadziała przy każdej partii;
- `setConnection` zapisuje także powtórzony stan po restarcie API, więc wyzwalacz musi porównać starą i nową wartość;
- wyzwalacz `scooters_status` z iteracji 6 (`BEFORE UPDATE OF status`) może zamienić `AVAILABLE` na `MAINTENANCE`, więc historia musi zapisywać stan po wyzwalaczach `BEFORE`, czyli w `AFTER`.

## Rozważane opcje

1. **Liczyć przestoje z dziennika audytu, zadań, przejazdów i luk telemetrii.** Bez nowej tabeli, ale niepełne (nie każda zmiana ma wpis) i drogie przy raporcie za rok.
2. **Tabela przedziałów wypełniana wyzwalaczem** (D4). Każda zmiana stanu albo łączności zamyka przedział i otwiera nowy; raport sumuje przedziały przycięte do okresu.
3. **Kolumna przyczyny w tabeli** zapisywana przez kod przy każdej zmianie. Dokładna przyczyna, ale wymaga zmian we wszystkich miejscach, które zmieniają stan (przejazdy, serwis, strefy, symulator), i wyzwalacz jej nie zna.

## Decyzja

Opcja 2, a przyczyna przedziału z widoku zamiast kolumny.

- **Tabela** `scooter_status_history`: `id bigint` z tożsamości, `scooter_id`, `status scooter_status`, `online boolean`, `valid_from timestamptz`, `valid_to timestamptz NULL`. Indeks unikalny częściowy: jeden otwarty przedział na hulajnogę (`WHERE valid_to IS NULL`); indeks `(scooter_id, valid_from)`.
- **Wyzwalacze:** `AFTER INSERT ON scooters` otwiera pierwszy przedział; `AFTER UPDATE OF status, online ON scooters` z `WHEN (OLD.status IS DISTINCT FROM NEW.status OR OLD.online IS DISTINCT FROM NEW.online)` zamyka otwarty przedział (`valid_to = now()`) i otwiera nowy. Czas transakcji jak w procedurach. Migracja otwiera przedział dla istniejących hulajnóg od chwili migracji.
- **Tylko do dopisywania:** wyzwalacz `BEFORE UPDATE OR DELETE` pozwala tylko na jednorazowe ustawienie `valid_to` w otwartym przedziale, z wartością nie wcześniejszą niż `valid_from`.
- **Przyczyna** w widoku `v_scooter_status_history`: przejazd nakładający się na przedział (`IN_USE`, `RESERVED`), zadanie serwisowe i zgłoszenie (`MAINTENANCE`), zgłoszenie automatyczne `OFFLINE` (bez łączności), wpis operatora w dzienniku audytu w chwili `valid_from`; bez dopasowania „Brak telemetrii” albo „System”.
- **Kategorie czasu** (rozłączne, suma równa czasowi okresu poza `RETIRED`):
  - w przejeździe: `IN_USE`, także bez łączności (przejazd trwa i jest rozliczany, [ADR 0056](0056-przejazd-bez-lacznosci-i-niska-bateria.md));
  - serwis: `MAINTENANCE`, także bez łączności;
  - rezerwacja: `RESERVED` z łącznością;
  - dostępna: `AVAILABLE` z łącznością;
  - bez łączności: `AVAILABLE` albo `RESERVED` bez łączności.
- **Wskaźniki** jedną funkcją w core dla pulpitu, karty hulajnogi i raportu:
  - wykorzystanie = w przejeździe ÷ czas okresu;
  - dostępność = (dostępna + rezerwacja + w przejeździe) ÷ czas okresu.

  Czas okresu liczy się w strefie Europe/Warsaw (październik 2026 ma 745 h). Tabela wykorzystania na planszy `raport-pdf` przyjmie te definicje (odstępstwo od planszy).
- **Panel:** zakładka „Historia stanów” na karcie hulajnogi i lista przedziałów z filtrami (`scooters.read`); niska bateria nie jest stanem i nie trafia do historii.
- **Retencja:** bez retencji. Około 3–5 przedziałów na hulajnogę na dobę to przy 240 hulajnogach poniżej 0,5 mln wierszy rocznie, a raport z porównaniem sięga do 732 dni wstecz.

## Konsekwencje

Pozytywne:

- Wykorzystanie, dostępność i przestoje liczone z jednego źródła i jedną definicją w pulpicie, na karcie i w raporcie.
- Zmiana stanu z dowolnego miejsca (API, procedura, wyzwalacz serwisu, symulator przez API) trafia do historii bez zmian w kodzie modułów.
- Nowa tabela, wyzwalacze i widok (punkt 8).

Negatywne i ryzyka:

- Historia zaczyna się od migracji 0013; wcześniejsze okresy raport pokazuje tylko z czasem w przejeździe (pytanie 13), a dane do demonstracji daje generator ([ADR 0075](0075-dane-historyczne-do-demonstracji.md)).
- Przyczyna z widoku jest dopasowaniem w czasie, a nie zapisem faktu; przy nakładających się zdarzeniach widok pokazuje pierwsze dopasowanie.
- Utrata łączności wykryta z opóźnieniem (Last Will brokera) przesuwa początek przedziału o czas wykrycia.

## Powiązane

[ADR 0033](0033-telemetria-i-status-floty.md), [ADR 0055](0055-zgloszenia-i-proces-serwisowy.md), [ADR 0056](0056-przejazd-bez-lacznosci-i-niska-bateria.md), [ADR 0071](0071-modul-raportow.md), [ADR 0072](0072-wykresy-w-panelu-i-w-pdf.md), makiety `34-panel-domkniecie/hulajnoga-historia-stanow`, `32-panel-raporty/raport-pdf`
