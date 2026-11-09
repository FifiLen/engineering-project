# 2. Ograniczenia

| Ograniczenie | Konsekwencja |
|---|---|
| Projekt realizowany przez jedną osobę | Monolit modularny zamiast mikroserwisów ([ADR 0003](../adr/0003-monolit-modularny.md)); prosta infrastruktura |
| Brak fizycznych hulajnóg | Symulator floty jako klient MQTT ([ADR 0002](../adr/0002-symulacja-floty-zamiast-sprzetu.md)) |
| Język TypeScript w całym projekcie | [ADR 0008](../adr/0008-monorepo-typescript.md) |
| Płatności tylko w trybie testowym | Stripe w trybie testowym ([ADR 0018](../adr/0018-platnosci-stripe.md)) |
| Budżet bliski zeru | Darmowe lub samodzielnie hostowane usługi mapowe ([ADR 0017](../adr/0017-uslugi-mapowe.md)); jeden VPS na demo |
| Obszar działania: Rybnik | Dane OSM i trasy dla województwa śląskiego ([ADR 0020](../adr/0020-obszar-dzialania-rybnik.md)) |
| Zgodność z RODO | Minimalizacja danych, anonimizacja przy usunięciu konta, brak pełnych numerów kart |
