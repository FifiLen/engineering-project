# ADR 0065: Strona promocyjna z treści z bazy

- **Status:** zaakceptowana
- **Data:** 2026-11-18

## Kontekst

Strona promocyjna i panel to jedna aplikacja Next.js ([ADR 0006](0006-jedna-aplikacja-nextjs.md)). Dziś strona jest szkieletem `app/(marketing)/page.tsx` z tekstem z `messages/pl.json`, a panel (`/admin`) czyta dane z API w przeglądarce. CI buduje aplikację (`pnpm build`) bez działającego API.

[ADR 0041](0041-kod-qr-hulajnogi.md) zapowiada stronę `/h/{numer}` pod adresem z kodu QR i odrzuca własny schemat adresu jako treść kodu.

Odpowiedzi autora z 18 listopada 2026:
- **pytanie 11:**
  - sekcje strony z bloków i mediów;
  - cennik z bieżącej wersji (`GET /tariff`), parametry z aktywnego modelu, FAQ i dane firmy;
  - podstrony dokumentów, aktualności i `/h/{numer}`;
  - strona bez ciasteczek i analityki, więc bez banera; „Cookies” prowadzi do dokumentu „Polityka cookies”;
- **D2:** strona czyta treści po stronie serwera z cache z tagiem. API odświeża ją na żądanie (sekret w `.env`), czas zapasowy to 5 min, a build bez API się nie przerywa.

Makiety `14-strona` i `30-strona-tresci` ([ustalenia](../projekt/README.md#strona-i-aplikacja-treści-iteracja-7)):
- spis treści dokumentu z `##`; data obowiązywania to `published_at`, a wersja archiwalna jest pod `/regulamin/wersja/{n}`;
- aktualności po 12 na stronie, z datą z `publish_from`; zaplanowana albo wygasła daje 404;
- `/h/{numer}` bez dostępności, baterii i położenia; `/h/7` przekierowuje na `/h/0007`, a zły numer daje 404;
- strona 404.

Do rozstrzygnięcia zostały:
- publiczny odczyt hulajnogi dla `/h/{numer}`;
- cel odnośnika „Mam aplikację, otwórz hulajnogę”;
- publiczna lista wersji dokumentów i osobna data wejścia w życie.

Sprawdzone 18 listopada 2026 w dokumentacji Next.js 16.4.6, dołączonej do pakietu (`apps/web/node_modules/next/dist/docs`):
- **`revalidateTag(tag, profile)`:**
  - forma z jednym argumentem jest przestarzała;
  - `'max'` podaje stare dane, a odświeża je w tle przy następnym żądaniu;
  - `{ expire: 0 }` wygasza dane od razu i to jest zalecane wywołanie z Route Handlera wołanego przez inną usługę;
  - `updateTag` działa tylko w Server Actions.
- **Cache Components:**
  - `cacheTag` i `'use cache'` wymagają `cacheComponents: true` razem z `partialPrefetching`;
  - opcja włącza się dla całej aplikacji: domyślny model renderowania z prerenderem powłoki, zasady dostępu do danych poza `<Suspense>` i nawigację przez `<Activity>`, która zachowuje stan ukrytych tras (także panelu);
  - dane czekające w `'use cache'` w czasie budowania przerywają build po 50 s.
- **Model bez Cache Components** („Caching (Previous Model)”):
  - `fetch` z `next: { tags, revalidate }` trafia do Data Cache;
  - przy dynamicznym renderowaniu strony `fetch` z dodatnim `revalidate` zostaje w cache;
  - `connection()` z `next/server` wyłącza prerender bez Request-time API.
- **`next/image`:**
  - adres zewnętrzny wymaga `images.remotePatterns`;
  - API na `localhost` wymaga `images.dangerouslyAllowLocalIP: true`, przed czym dokumentacja ostrzega (SSRF);
  - `sharp` 0.35.5 jest zależnością opcjonalną `next` i jest zainstalowany.
- **Metadane:** `generateMetadata`, `app/sitemap.ts` i `app/robots.ts` są dostępne w obu modelach.

## Rozważane opcje

1. **Cache Components** (`'use cache'`, `cacheTag`, `cacheLife`). Model zalecany przez Next.js 16 i statyczna powłoka strony. Włącza się jednak dla całej aplikacji, więc zmienia zachowanie panelu (stan ukrytych tras, zasady prerenderu) i wymaga przejrzenia każdego jego ekranu. Strona bez API w buildzie i tak wymaga `connection()` przed danymi.
2. **Data Cache `fetch` z tagami i renderowanie przy żądaniu** (`connection()` w module danych strony). Panel zostaje bez zmian, build nie woła API, a dane są w cache z tagiem i czasem zapasowym.
3. **Statyczna strona z `revalidate` segmentu (ISR).** Szybka, ale build woła API, więc w CI bez API się nie uda.
4. **Pobieranie treści w przeglądarce.** Nie wymaga cache po stronie serwera, ale pierwszy widok jest pusty, a wyszukiwarki nie widzą treści.

## Decyzja

**Opcja 2.** Przejście na Cache Components wymaga osobnej decyzji (nowego ADR) razem z przeglądem panelu.

### Dane i cache

- **Moduł danych `apps/web/lib/site/api.ts`** (tylko serwer, `import 'server-only'`) z funkcją `siteFetch(path, tags)`:
  - woła `await connection()`, więc żadna strona z treścią nie powstaje w buildzie;
  - pobiera dane przez `fetch(API_INTERNAL_URL + path, { next: { revalidate: 300, tags } })` (domyślnie `NEXT_PUBLIC_API_URL`) z limitem 5 s.
- **Tagi:**
  - `content`: `GET /content/web`, `GET /news…`, `GET /legal/…`;
  - `tariff`: `GET /tariff`;
  - `scooters`: `GET /public/scooters/{numer}`.
- **Test przy implementacji:** `pnpm build` bez API kończy się powodzeniem, a dwa żądania strony dają jedno zapytanie do API.
- **Odświeżanie na żądanie:** Route Handler `POST /api/revalidate` w `apps/web`, poza `/admin`:
  - nagłówek `Authorization: Bearer ${SITE_REVALIDATE_SECRET}` (co najmniej 32 znaki, porównanie w stałym czasie);
  - treść `{ tags: string[] }` z białej listy;
  - dla każdego tagu woła `revalidateTag(tag, { expire: 0 })`, więc pierwsze odświeżenie po zapisie w panelu pokazuje zmianę.
- **Zadanie API `site.revalidate`** (pg-boss) jest planowane w transakcji zmiany (`sendInTransaction`, [ADR 0037](0037-pg-boss-konfiguracja-i-zadania.md)), więc rusza po zatwierdzeniu.
  - Zmiany, które je planują: treści, modelu i danych firmy (`content`); publikacja i aktywacja wersji cennika (`tariff`); zmiana stanu `RETIRED` albo modelu hulajnogi (`scooters`).
  - Ma klucz singletonu na tag z oknem 5 s (seria zapisów daje jedno wywołanie) i do 3 ponowień z rosnącym odstępem.
  - Puste `SITE_REVALIDATE_URL` (testy, CI) wyłącza wywołanie.
  - Cennik zaplanowany na przyszłą datę odświeży się na stronie najpóźniej po 5 min.
- **Awaria API:** przy odświeżaniu w tle Next.js zostawia poprzednie dane. Po `expire: 0` i niedostępnym API strona pokazuje `error.tsx` („Strona chwilowo niedostępna” z ponowieniem), a nie pustą treść.

### Strony

- **`/`:** sekcje w kolejności z kodu, z treścią z rejestru ([ADR 0062](0062-modul-tresci-sekcje-publikacja-dane-firmy.md)).
  - Cennik z `GET /tariff`.
  - Parametry `range_km` i `max_speed_kmh` z pierwszego aktywnego modelu (kolejność po kodzie) w `GET /content/web`.
  - FAQ z kategoriami i dane firmy w stopce; KRS, sąd i kapitał, gdy są wypełnione.
  - Nawigacja i etykiety zostają w `messages/pl.json`, a teksty `marketing.*` i `meta.*` przechodzą do bloków.
- **Dokumenty:** `/regulamin`, `/polityka-prywatnosci`, `/zasady-jazdy` i nowy `/polityka-cookies` (strona w `content_pages` bez typu zgody, dodana przez seed).
  - Trasa `app/(marketing)/[slug]/page.tsx` pyta API, a nieznany slug daje `notFound()`.
  - Strona ma spis treści z nagłówków `##` ([ADR 0063](0063-markdown-w-tresciach.md)) i datę „Obowiązuje od” z `published_at`, bez „Pobierz PDF”.
- **Wersje dokumentów (rozstrzygnięcie: w zakresie):** nowe publiczne punkty `GET /legal/{slug}/versions` i `GET /legal/{slug}/versions/{n}`.
  - Lista zawiera tylko wersje opublikowane i archiwalne (numer, tytuł, `published_at`, `change_summary`), nigdy robocze.
  - Strona `/{slug}/wersja/{n}` ma baner „Wersja archiwalna, obowiązywała od … do …”, gdzie data „do” to `published_at` następnej wersji, i odnośnik do bieżącej.
  - Osobnej daty wejścia w życie (zapowiedź zmian) nie ma w tej iteracji: `published_at` jest datą obowiązywania, a zmianę z wyprzedzeniem zapowiada aktualność.
- **Aktualności:**
  - `/aktualnosci` (`GET /news?page=&pageSize=12`, parametr strony `?strona=2`);
  - `/aktualnosci/{slug}` (`GET /news/{slug}` z `v_published_news`): zaplanowana, wygasła albo nieznana daje 404;
  - grafika z podpisem z biblioteki i data z `publish_from` w strefie Europe/Warsaw.
- **`/h/{numer}` (rozstrzygnięcie: publiczny okrojony odczyt):**
  - numer spoza `^\d{1,4}$` daje 404, a krótszy niż 4 cyfry przekierowanie `permanentRedirect` na `/h/0007`;
  - nowy `GET /public/scooters/{number}` (`@Public()`) zwraca tylko `{ number, model: { code, name, photo } }` dla hulajnogi, która nie jest `RETIRED`, a w innym przypadku 404, bez dostępności, baterii i położenia;
  - ceny pochodzą z `GET /tariff`.

  Numer jest i tak wydrukowany na hulajnodze, więc odczyt nie ujawnia nic ponad naklejkę. Model i render z planszy wymagają jednak odczytu po numerze. Sama kontrola formatu pokazałaby render domyślny także dla nieistniejącego numeru.
- **„Mam aplikację, otwórz hulajnogę” (rozstrzygnięcie):**
  - odnośnik z szablonu `APP_SCOOTER_LINK`, domyślnie `hulajnogi://hulajnoga/{numer}`: schemat `hulajnogi` z `apps/mobile/app.json` i istniejąca trasa `src/app/hulajnoga/[number].tsx`;
  - w środowisku deweloperskim z aplikacją w wersji web można ustawić `http://localhost:8082/hulajnoga/{numer}`.

  ADR 0041 odrzucił własny schemat jako treść kodu QR, bo bez aplikacji aparat nic z nim nie zrobi. Tutaj to drugi odnośnik obok przycisków sklepów, a tekst strony mówi, że wystarczy zeskanować kod w aplikacji. Po wyborze domeny uniwersalne łącza na tej samej ścieżce `/h/` otworzą aplikację bez tej strony.
- **404:** `app/not-found.tsx` dla strony według planszy `strona-404`. Panel ma własne stany błędów.

### Grafiki

Zwykłe `<img>` z `width` i `height` z biblioteki (bez przesunięcia układu), z `loading="lazy"` i `decoding="async"`. Hero dostaje `fetchPriority="high"`.

`next/image` odrzucamy, bo:
- przy API na `localhost` wymaga `dangerouslyAllowLocalIP`;
- dokłada drugą warstwę cache i przetwarzanie w `sharp` na serwerze strony;
- grafiki z biblioteki są niezmienne i przygotowane przez operatora ([ADR 0064](0064-biblioteka-mediow.md)).

Panel używa już `<img>` dla zdjęć z API.

### Metadane i mapa strony

- **`generateMetadata`:**
  - strona główna z sekcji `web.meta` (tytuł, opis, grafika Open Graph);
  - aktualność z tytułu, zajawki i grafiki;
  - dokument z tytułu.

  `metadataBase` to `PUBLIC_SITE_URL`, zmienna dodana też do konfiguracji `apps/web`.
- **`app/sitemap.ts`** z `connection()` zawiera `/`, dokumenty, `/aktualnosci` i opublikowane artykuły z `lastModified`. Nie zawiera `/h/{numer}` ani wersji archiwalnych.
- **`app/robots.ts`** wskazuje mapę strony i wyklucza `/admin` oraz `/api`.

### Prywatność (pytanie 11)

Strona nie ustawia ciasteczek i nie ma analityki, więc nie ma banera. Ciasteczko panelu `hj_staff_refresh` należy do API ze ścieżką `/admin/auth` ([ADR 0035](0035-sesje-tokeny-i-straznik-uprawnien.md)) i nie dotyczy odwiedzających stronę. Stopka prowadzi do `/polityka-cookies`.

## Konsekwencje

Pozytywne:

- Zmiana w panelu jest na stronie po odświeżeniu, bez nowego wdrożenia (scenariusz demo, krok 1). Przy zgubionym wywołaniu strona odświeża się sama po 5 min.
- CI buduje aplikację bez API, a panel nie zmienia modelu renderowania.
- Publiczne odczyty (`/content/web`, `/news`, `/legal/…/versions`, `/public/scooters/{numer}`) są wąskie i nie ujawniają stanu floty.

Negatywne i ryzyka:

- Każde żądanie strony renderuje się na serwerze, choć z danych w cache. Przy ruchu strony w produkcji to większe zużycie CPU niż statyczna powłoka z Cache Components.
- Data Cache jest lokalny dla instancji `next start`. Przy kilku instancjach odświeżenie trafi tylko do jednej, a pozostałe pokażą zmianę po 5 min albo wymagają wspólnego `cacheHandler`.
- Model „Previous Model” jest w Next.js 16 drugim wyborem. Przyszła wersja może wymagać przejścia na Cache Components, co opisze nowy ADR.
- Odnośnik `hulajnogi://` nie działa w Expo Go ani bez zainstalowanej aplikacji. Do uniwersalnych łączy z domeną to tylko udogodnienie.

## Powiązane

[ADR 0041](0041-kod-qr-hulajnogi.md) (rozwija: strona `/h/{numer}`, publiczny odczyt modelu i odnośnik do aplikacji), [ADR 0006](0006-jedna-aplikacja-nextjs.md), [ADR 0027](0027-tresci-sterowane-z-panelu.md), [ADR 0035](0035-sesje-tokeny-i-straznik-uprawnien.md), [ADR 0037](0037-pg-boss-konfiguracja-i-zadania.md), [ADR 0062](0062-modul-tresci-sekcje-publikacja-dane-firmy.md), [ADR 0063](0063-markdown-w-tresciach.md), [ADR 0064](0064-biblioteka-mediow.md), [plan iteracji 7](../iteracje/iteracja-07-tresci-wydruki.md) (pytanie 11, D2), makiety `14-strona` i `30-strona-tresci`
