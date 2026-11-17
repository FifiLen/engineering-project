# ADR 0040: Mapa, lokalizacja i aparat w aplikacji

- **Status:** zaakceptowana
- **Data:** 2026-11-16

## Kontekst

[ADR 0005](0005-react-native-expo.md) i [ADR 0017](0017-uslugi-mapowe.md) zakładają natywny MapLibre w aplikacji. Natywny moduł mapy nie działa w Expo Go, więc aplikacja potrzebuje development build (`expo run:ios`, `expo run:android` albo EAS Build). Do iteracji 2 aplikacja nie miała modułów natywnych spoza Expo Go, a sprawdzaliśmy ją w przeglądarce (konfiguracja `mobile-web` w `.claude/launch.json`).

Na komputerze autora nie ma dziś Xcode ani Android SDK (sprawdzone 16 listopada 2026: `xcode-select` wskazuje Command Line Tools), więc development build trzeba przygotować osobno. Demo iteracji 3 musi jednak dać się pokazać od ręki. Wersja web aplikacji (react-native-web) nie obsługuje natywnego MapLibre, ale może użyć MapLibre GL JS, którego panel już używa (`maplibre-gl` 6.18.0).

Wersje sprawdzone 16 listopada 2026 (zasada z `CLAUDE.md`: tylko wydane ponad 3 dni temu): `@maplibre/maplibre-react-native` 11.5.1 (29 października 2026, wymaga `expo` ≥ 54 i `react-native` ≥ 0.80), `expo-location` i `expo-camera` z linii SDK 58, instalowane przez `expo install`, które wybiera wersję zgodną z SDK.

## Rozważane opcje

1. **Tylko natywnie** (`@maplibre/maplibre-react-native`, development build). Zgodne z ADR 0005, ale bez Xcode nie da się tego dziś uruchomić ani pokazać, a wersja web przestaje działać.
2. **Mapa jako komponent z dwiema implementacjami:** `map-view.tsx` z natywnym MapLibre i `map-view.web.tsx` z MapLibre GL JS (Metro wybiera plik po platformie). Ten sam styl mapy (OpenFreeMap w palecie projektu) i ten sam interfejs komponentu: hulajnogi, strefy, pozycja klienta, trasa.
3. **`react-native-maps`.** Działa w Expo Go, ale to Apple Maps i Google Maps, czyli inny styl niż panel i klucze API, wbrew ADR 0017.

## Decyzja

Opcja 2.

- **Mapa:** komponent `MapView` w `apps/mobile/src/components/map/` z jednym interfejsem i dwiema implementacjami. Styl mapy i warstwy (strefy według typu, hulajnogi, pozycja klienta) są w kodzie wspólnym dla obu plików. Konfiguracja wtyczki Expo z `@maplibre/maplibre-react-native` w `app.json`.
- **Lokalizacja:** `expo-location` (`requestForegroundPermissionsAsync`, `watchPositionAsync`). W wersji web ta sama biblioteka korzysta z geolokalizacji przeglądarki. Odmowa zgody to stan `stan-brak-lokalizacji`; mapa działa wtedy z widokiem na środek obszaru działania, a lista hulajnóg liczy się od tego punktu.
- **Aparat:** `expo-camera` (`CameraView` z odczytem kodów QR). Odmowa zgody to stan „brak dostępu do aparatu”. Wpisanie numeru hulajnogi jest równorzędną drogą ([ADR 0041](0041-kod-qr-hulajnogi.md)), więc w symulatorze iOS i w przeglądarce bez aparatu da się wypożyczyć hulajnogę.
- **Uruchamianie:** wersja web (`mobile-web`, port 8082) to droga sprawdzania i demo na komputerze bez Xcode. Development build (`pnpm --filter @hulajnogi/mobile exec expo run:ios`) wymaga Xcode z platformą iOS; jego pierwsze zbudowanie i sprawdzenie natywnej mapy zapisujemy jako zadanie w dzienniku, gdy środowisko będzie gotowe. Expo Go przestaje wystarczać od tej iteracji.

## Konsekwencje

Pozytywne:

- Demo działa w przeglądarce bez zmian w środowisku, a natywna mapa zostaje zgodna z ADR 0005 i 0017.
- Panel i aplikacja web używają tej samej biblioteki i tego samego stylu mapy.

Negatywne i ryzyka:

- Dwie implementacje mapy trzeba utrzymywać zgodnie; ryzyko ogranicza wspólny interfejs i wspólne warstwy.
- Natywna implementacja nie jest sprawdzona na urządzeniu ani w symulatorze, dopóki nie będzie Xcode (ryzyko w arc42 §11). Typy i lint ją obejmują, ale błędy uruchomieniowe wyjdą dopiero w development build.
- Development build wydłuża pierwsze uruchomienie aplikacji w porównaniu z Expo Go.

## Powiązane

[ADR 0005](0005-react-native-expo.md), [ADR 0017](0017-uslugi-mapowe.md), [ADR 0041](0041-kod-qr-hulajnogi.md), [plan iteracji 3](../iteracje/iteracja-03-wypozyczenie.md)
