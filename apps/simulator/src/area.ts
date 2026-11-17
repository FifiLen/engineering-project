import { readFileSync } from 'node:fs';
import { distanceM, mulberry32, project, type Point } from './geo.js';

interface PlacesFile {
  serviceArea: { centerPlace: string; radiusM: number };
  places: Array<{ code: string; type: string; radiusM: number; lat?: number; lon?: number }>;
}

/** Obszar, po którym jeżdżą wirtualne hulajnogi: środek, promień i punkty postoju (strefy parkowania). */
export interface Area {
  center: Point;
  radiusM: number;
  hubs: Array<Point & { code: string; radiusM: number }>;
}

/**
 * Symulator czyta te same, sprawdzone współrzędne co dane startowe bazy (`pnpm db:places`), ale nie
 * łączy się z bazą: hulajnoga zna tylko swoją pozycję i broker MQTT.
 */
export function loadArea(path: string): Area {
  const file = JSON.parse(readFileSync(path, 'utf8')) as PlacesFile;
  const hubs = file.places
    .filter((p) => p.type === 'PARKING' && p.lat !== undefined && p.lon !== undefined)
    .map((p) => ({ code: p.code, lat: p.lat!, lon: p.lon!, radiusM: p.radiusM }));
  const center = file.places.find((p) => p.code === file.serviceArea.centerPlace);
  if (!center?.lat || !center.lon || !hubs.length) {
    throw new Error(`Plik ${path} nie ma współrzędnych środka obszaru lub stref parkowania. Uruchom: pnpm db:places`);
  }
  return { center: { lat: center.lat, lon: center.lon }, radiusM: file.serviceArea.radiusM, hubs };
}

/**
 * Pozycja i bateria hulajnogi przy pierwszym uruchomieniu: ten sam algorytm co w `seedDatabase`
 * (packages/db), więc pierwsza telemetria zgadza się z danymi startowymi.
 */
export function initialState(area: Area, number: number): { position: Point; batteryPct: number } {
  const rand = mulberry32(number * 7919);
  const hub = area.hubs[number % area.hubs.length]!;
  const distance = 20 + rand() * 180;
  const azimuth = rand() * 2 * Math.PI;
  const batteryPct = number % 9 === 0 ? 8 + Math.floor(rand() * 10) : 35 + Math.floor(rand() * 65);
  return { position: project(hub, distance, azimuth), batteryPct };
}

/** Cel przejazdu pokazowego: zwykle okolica strefy parkowania, czasem dowolny punkt w obszarze. */
export function randomDestination(area: Area, random: () => number): Point {
  if (random() < 0.7) {
    const hub = area.hubs[Math.floor(random() * area.hubs.length)]!;
    return project(hub, random() * hub.radiusM * 0.8, random() * 2 * Math.PI);
  }
  return project(area.center, Math.sqrt(random()) * area.radiusM * 0.8, random() * 2 * Math.PI);
}

/**
 * Cel jazdy po odblokowaniu komendą (ADR 0039): środek losowej strefy parkowania, innej niż ta, w której
 * hulajnoga stoi, żeby jazda była widoczna na mapie, a próba zakończenia w drodze trafiała poza strefę.
 */
export function rideDestinationHub(area: Area, from: Point, random: () => number): Area['hubs'][number] {
  const elsewhere = area.hubs.filter((h) => distanceM(h, from) > h.radiusM);
  const hubs = elsewhere.length ? elsewhere : area.hubs;
  return hubs[Math.floor(random() * hubs.length)]!;
}
