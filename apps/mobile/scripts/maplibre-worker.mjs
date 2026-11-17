// MapLibre GL 6 ładuje wątek roboczy jako osobny moduł obok swojego pliku, a Metro go nie kopiuje.
// Skrypt kopiuje wątek do public/ (Expo serwuje ten katalog w wersji web), a mapa wskazuje go przez
// setWorkerUrl (src/components/map/map-view.web.tsx). Ten sam mechanizm co w apps/web.
import { copyFileSync, mkdirSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';

const require = createRequire(import.meta.url);
const dist = dirname(require.resolve('maplibre-gl/package.json'));
const publicDir = join(import.meta.dirname, '..', 'public');
mkdirSync(publicDir, { recursive: true });
copyFileSync(join(dist, 'dist', 'maplibre-gl-worker.mjs'), join(publicDir, 'maplibre-gl-worker.mjs'));
