# 1. Wprowadzenie i cele

## 1.1. Cel systemu

System umożliwia krótkoterminowe wypożyczanie elektrycznych hulajnóg miejskich na minuty. Użytkownik znajduje hulajnogę na mapie, odblokowuje ją kodem QR, jedzie i kończy przejazd w wyznaczonej strefie parkowania. Operator zarządza flotą, strefami, cennikiem i zgłoszeniami w panelu webowym.

Fizyczne hulajnogi są zastąpione symulatorem, który komunikuje się z backendem tym samym protokołem, którego używałoby prawdziwe urządzenie (zob. [ADR 0002](../adr/0002-symulacja-floty-zamiast-sprzetu.md)).

## 1.2. Główne wymagania funkcjonalne

| Obszar | Wymaganie |
|---|---|
| Konto | Rejestracja i logowanie numerem telefonu z kodem SMS; zgody; usunięcie konta |
| Mapa | Hulajnogi w pobliżu z baterią i zasięgiem; strefy parkowania, wolnej jazdy i zakazu |
| Wypożyczenie | Rezerwacja, odblokowanie kodem QR, pauza, zakończenie w strefie parkowania ze zdjęciem |
| Jazda | Podgląd czasu, dystansu i kosztu na żywo; automatyczne ograniczenie prędkości w strefach |
| Płatności | Portfel doładowywany kartą lub BLIK-iem; płatność kartą za przejazd; historia operacji |
| Operacje | Mapa floty na żywo, komendy zdalne, zgłoszenia usterek, edytor stref, cennik |
| Symulacja | Wirtualna flota z realistycznymi trasami i scenariuszami awarii |

## 1.3. Cele jakościowe

| Priorytet | Cel | Opis |
|---|---|---|
| 1 | Spójność | Brak podwójnych wypożyczeń i podwójnych obciążeń, także przy powtórzonych komunikatach |
| 2 | Responsywność | Odblokowanie i zmiany stanu widoczne w aplikacji w ciągu sekund |
| 3 | Odporność | Utrata łączności z hulajnogą lub usługą zewnętrzną nie psuje danych |
| 4 | Testowalność | Każdy przepływ da się odtworzyć z symulatorem, bez sprzętu |
| 5 | Zrozumiałość | Architektura i decyzje są udokumentowane i możliwe do obrony |

Szczegółowe scenariusze jakości: [§10](10-wymagania-jakosciowe.md).

## 1.4. Interesariusze

| Rola | Oczekiwania |
|---|---|
| Użytkownik | Szybkie znalezienie i odblokowanie hulajnogi, przejrzysty koszt |
| Dyspozytor operatora | Aktualny stan floty, alerty, możliwość zdalnej reakcji |
| Serwisant | Lista zgłoszeń, historia urządzenia |
| Administrator | Konfiguracja stref i cennika |
| Promotor i komisja | Uzasadnione decyzje, działające demo, weryfikacja jakości |
