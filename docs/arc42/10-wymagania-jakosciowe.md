# 10. Wymagania jakościowe

Wartości docelowe są propozycją do potwierdzenia w testach (iteracja 8). Pomiary wykonujemy z symulatorem floty.

| ID | Cecha | Scenariusz | Cel |
|---|---|---|---|
| Q1 | Spójność | Dwóch użytkowników jednocześnie próbuje wypożyczyć tę samą hulajnogę | Dokładnie jeden przejazd zostaje utworzony |
| Q2 | Spójność | Stripe dostarcza ten sam webhook trzy razy | Saldo zwiększone tylko raz |
| Q3 | Responsywność | Użytkownik zatwierdza odblokowanie | Stan `ACTIVE` w aplikacji w czasie poniżej 2 s (p95) |
| Q4 | Responsywność | Hulajnoga zmienia pozycję | Pozycja widoczna na mapie panelu w czasie poniżej 2 s |
| Q5 | Wydajność | 500 hulajnóg wysyła telemetrię co 5 s | Brak rosnącego opóźnienia przetwarzania przez 30 min |
| Q6 | Wydajność | Główne zapytania REST | Czas odpowiedzi poniżej 300 ms (p95) |
| Q7 | Odporność | Hulajnoga traci łączność w trakcie jazdy | Status offline w panelu w czasie poniżej 30 s, trasa uzupełniona po powrocie |
| Q8 | Odporność | Hulajnoga nie potwierdza odblokowania | Przejazd przechodzi do `UNLOCK_FAILED` po 10 s, bez opłaty |
| Q9 | Bezpieczeństwo | Próba zgadywania kodu SMS | Blokada po 5 nieudanych próbach |
