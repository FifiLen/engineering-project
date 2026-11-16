// MapLibre GL 6 ładuje wątek roboczy jako osobny moduł obok swojego pliku, a bundler Next.js go nie kopiuje.
// Skrypt kopiuje wątek do public/, a mapa wskazuje go przez setWorkerUrl (components/admin/fleet/fleet-map.tsx).
import { copyFileSync, mkdirSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';

const require = createRequire(import.meta.url);
const dist = dirname(require.resolve('maplibre-gl/package.json'));
// public/ nie ma w repozytorium innych plików, więc w czystej kopii katalogu jeszcze nie ma.
const publicDir = join(import.meta.dirname, '..', 'public');
mkdirSync(publicDir, { recursive: true });
copyFileSync(join(dist, 'dist', 'maplibre-gl-worker.mjs'), join(publicDir, 'maplibre-gl-worker.mjs'));
