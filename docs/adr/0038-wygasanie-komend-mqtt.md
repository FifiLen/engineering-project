# ADR 0038: Wygasanie komend MQTT

- **Status:** zaakceptowana
- **Data:** 2026-11-16

## Kontekst

Backend i hulajnogi mają sesje trwałe (`clean: false`) i QoS 1 ([ADR 0011](0011-mqtt-dla-hulajnog.md), [ADR 0034](0034-symulator-floty.md)). Broker przechowuje więc komendę dla hulajnogi, która jest offline, i dostarcza ją po powrocie. Dla `unlock` to niebezpieczne: przejazd po 10 s bez potwierdzenia przechodzi do `UNLOCK_FAILED` bez opłaty, a hulajnoga, która wróci online minutę później, dostaje zaległą komendę i się odblokowuje. Nikt wtedy za jazdę nie płaci, a hulajnoga ma w bazie status `AVAILABLE`. To samo dotyczy `lock` po zdalnym zakończeniu, choć tam spóźnione wykonanie jest nieszkodliwe.

## Rozważane opcje

1. **Pole `expiresAt` w komendzie** (kontrakt 1.1.0). Hulajnoga odrzuca komendę po terminie z powodem `EXPIRED`. Działa niezależnie od brokera i wersji protokołu. Wymaga zegara w urządzeniu; prawdziwe sterowniki mają czas z GPS albo NTP, a symulator czas systemowy.
2. **Wygaśnięcie wiadomości w MQTT 5** (`messageExpiryInterval`). Broker sam usuwa przeterminowaną wiadomość z kolejki sesji. Wymaga przejścia wszystkich połączeń na MQTT 5 (Mosquitto 2 i mqtt.js to obsługują), a komendę już dostarczoną urządzeniu, ale jeszcze niewykonaną, i tak trzeba odrzucić na urządzeniu.
3. **Kompensacja w backendzie:** spóźnione potwierdzenie `ok` dla `unlock`, na które nikt już nie czeka, powoduje natychmiastową komendę `lock`. Nie zapobiega krótkiemu odblokowaniu, ale ogranicza jego skutek.

## Decyzja

Opcja 1 jako reguła kontraktu i opcja 3 jako zabezpieczenie:

- **Kontrakt MQTT 1.1.0:** komenda ma pole `expiresAt` (data i czas ISO 8601). Backend ustawia je zawsze na `issuedAt + 10 s`, czyli na limit potwierdzenia z [ADR 0037](0037-pg-boss-konfiguracja-i-zadania.md). Hulajnoga po terminie nie wykonuje komendy i odpowiada `ok: false` z nowym powodem `EXPIRED`. Pole jest opcjonalne w schemacie, więc urządzenie z kontraktem 1.0.0 dalej działa (bez tej ochrony), a komenda bez `expiresAt` nie wygasa.
- **Kompensacja:** potwierdzenie `ok` dla `unlock` z komendy w statusie `TIMEOUT` albo dla przejazdu, który na nie nie czeka (`UNLOCK_FAILED`, zakończony, inny przejazd), zapisuje zdarzenie na osi czasu przejazdu i wysyła `lock` bez przejazdu. Kompensacja jest widoczna w dzienniku komunikacji hulajnogi w panelu.
- **MQTT 5** zostaje jako możliwe usprawnienie na później, a nie wymóg (opcja 2).
- Symulator porównuje `expiresAt` ze swoim zegarem i w demo nieudanego odblokowania (hulajnoga wstrzymuje potwierdzenia, [ADR 0039](0039-symulator-w-trakcie-przejazdu.md)) pokazuje odrzucenie przeterminowanej komendy po powrocie.

## Konsekwencje

Pozytywne:

- Komenda nie działa dłużej, niż backend na nią czeka, więc stan w bazie i stan hulajnogi się nie rozjeżdżają.
- Zmiana kontraktu jest zgodna wstecz.

Negatywne i ryzyka:

- Rozjazd zegara urządzenia o więcej niż kilka sekund skraca albo wydłuża okno komendy. W projekcie zegary symulatora i backendu są wspólne; dla prawdziwego sprzętu trzeba by dodać tolerancję albo czas względny.
- Kompensacyjne `lock` nie cofa jazdy, która trwała między spóźnionym odblokowaniem a blokadą; wystarcza, bo opcja 1 sprawia, że ten przypadek dotyczy tylko urządzeń bez kontraktu 1.1.0.

## Powiązane

[ADR 0011](0011-mqtt-dla-hulajnog.md), [ADR 0036](0036-proces-wypozyczenia-w-api.md), [ADR 0037](0037-pg-boss-konfiguracja-i-zadania.md), [ADR 0039](0039-symulator-w-trakcie-przejazdu.md), [kontrakt AsyncAPI MQTT](../kontrakty/asyncapi-mqtt.yaml)
