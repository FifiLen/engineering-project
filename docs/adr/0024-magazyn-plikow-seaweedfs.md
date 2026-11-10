# ADR 0024: Magazyn plików zgodny z S3: SeaweedFS

- **Status:** zaakceptowana
- **Data:** 2026-11-10

## Kontekst

System przechowuje zdjęcia: zdjęcie zaparkowanej hulajnogi przy zakończeniu przejazdu i zdjęcia w zgłoszeniach usterek. Aplikacja wysyła plik bezpośrednio do magazynu przez podpisany URL, a backend zapisuje tylko odwołanie ([§6.4](../arc42/06-widok-czasu-dzialania.md)). Potrzebny jest magazyn z API S3, uruchamiany w Docker Compose lokalnie i na VPS z demem.

Pierwotny szkielet infrastruktury używał MinIO. Przy domykaniu iteracji 0 (10 listopada 2026) obrazy `minio/minio` i `minio/mc` nie były już dostępne na Docker Hubie (`pull access denied`, repozytoria nie istnieją), a projekt MinIO przestał publikować darmowe obrazy. Bez zmiany `pnpm infra:up` nie uruchamia środowiska.

## Rozważane opcje

1. **Własny obraz MinIO budowany ze źródeł albo fork społecznościowy**. Ten sam interfejs co wcześniej, ale utrzymanie obrazu lub zaufanie do forka z niepewną przyszłością spada na autora.
2. **RustFS**. Najbardziej podobny do MinIO (także konsola webowa), licencja Apache 2.0, ale projekt jest jeszcze w fazie alfa.
3. **SeaweedFS**. Dojrzały, aktywnie rozwijany (wydania co kilka dni), licencja Apache 2.0, oficjalny obraz `chrislusf/seaweedfs`. Polecenie `weed mini` uruchamia w jednym procesie wszystkie składniki i bramę S3, przeznaczone do małych wdrożeń i środowisk deweloperskich.
4. **Zewnętrzna usługa (AWS S3, Cloudflare R2)**. Brak utrzymania, ale klucze, konto i zależność od sieci także lokalnie; sprzeczne z budżetem bliskim zeru ([§2](../arc42/02-ograniczenia.md)).

## Decyzja

SeaweedFS w trybie `weed mini`, obraz przypięty do konkretnej wersji (`chrislusf/seaweedfs:4.52`). Brama S3 na porcie 8333. Kubełek `hulajnogi` jest tworzony przy starcie (`-bucket`), a klucze dostępu są w `infra/seaweedfs/s3.json` (wartości deweloperskie, te same co w `.env.example`). Interfejs administracyjny i katalog Iceberg są wyłączone, bo nie są potrzebne.

Backend będzie rozmawiał z magazynem wyłącznie przez standardowe API S3 (SDK AWS), więc zamiana magazynu nie wymaga zmian w kodzie, tylko w konfiguracji.

## Konsekwencje

Pozytywne:

- `pnpm infra:up` znowu uruchamia całe środowisko bez kont i kluczy zewnętrznych.
- Jeden kontener zamiast dwóch (MinIO i `minio-init` do utworzenia kubełka).
- Zależność tylko od API S3, nie od konkretnego produktu.

Negatywne i ryzyka:

- SeaweedFS ma inny model działania niż MinIO (master, wolumeny, filer); przy problemach trudniej znaleźć gotowe odpowiedzi.
- Podpisane URL-e do wysyłania zdjęć (PUT) trzeba sprawdzić testem integracyjnym w iteracji, która wprowadza zdjęcia. W iteracji 0 sprawdzono podpisane żądania SigV4: odmowę bez kluczy oraz zapis, odczyt i usunięcie obiektu.
- Brak konsoli do przeglądania plików w domyślnej konfiguracji.

## Powiązane

[§5](../arc42/05-widok-blokow.md), [§6.4](../arc42/06-widok-czasu-dzialania.md), [§7](../arc42/07-widok-wdrozenia.md), [ADR 0017](0017-uslugi-mapowe.md)
