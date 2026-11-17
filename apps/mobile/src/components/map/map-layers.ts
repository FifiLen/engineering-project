/**
 * Wspólna część mapy (ADR 0040): interfejs komponentu `MapView`, dane GeoJSON i warstwy w specyfikacji
 * stylu MapLibre. Obie implementacje (`map-view.tsx` natywna, `map-view.web.tsx` MapLibre GL JS) dostają te
 * same warstwy, więc wyglądają tak samo; kolory są z tokenów motywu, znaczniki według makiet 04 i 05.
 */
import type { Feature, FeatureCollection, MultiPolygon } from 'geojson';
import type { LayerSpecification } from 'maplibre-gl';
import type { Theme } from '../../theme/tokens';

export type LngLat = [number, number];

export interface MapPoint {
  lat: number;
  lon: number;
}

export interface MapScooter extends MapPoint {
  id: string;
}

export type ZoneType = 'SERVICE_AREA' | 'PARKING' | 'SLOW' | 'NO_RIDE';
/** Właściwości strefy z `GET /zones` (ADR 0046); `anchor` to punkt na etykietę i przybliżenie mapy. */
export interface ZoneProperties {
  code: string;
  name: string;
  type: ZoneType;
  speedLimitKmh: number | null;
  capacity: number | null;
  visibleInApp: boolean;
  anchor: LngLat;
}
export type ZoneCollection = FeatureCollection<MultiPolygon, ZoneProperties>;

/** Polecenie ustawienia widoku; zmiana `key` przesuwa mapę, inne zmiany właściwości jej nie ruszają. */
export interface MapFocus {
  key: string | number;
  center?: LngLat;
  zoom?: number;
  bounds?: [LngLat, LngLat];
}

export interface MapPadding {
  top: number;
  bottom: number;
  left: number;
  right: number;
}

export interface MapViewProps {
  focus: MapFocus;
  zones?: ZoneCollection | null;
  scooters?: MapScooter[];
  selectedId?: string | null;
  /** Pozycja klienta (kropka z poświatą albo pierścień, gdy klient stoi obok zaparkowanej hulajnogi). */
  user?: MapPoint | null;
  userStyle?: 'dot' | 'ring';
  /** Zaparkowana hulajnoga w trakcie pauzy albo poza strefą (czarna kropka). */
  parked?: MapPoint | null;
  /** Trasa przejazdu i jej początek. */
  route?: LngLat[];
  routeMuted?: boolean;
  /** Linia przerywana: trasa piesza do hulajnogi, podgląd dojazdu do strefy albo linia prosta bez OSRM. */
  guide?: LngLat[];
  /** Linia pełna: prowadzenie do strefy parkowania (makieta przejazd-prowadz-do-strefy). */
  drive?: LngLat[];
  /** Cel z wyszukiwania (grafitowa pinezka, makieta szukaj-wynik). */
  destination?: MapPoint | null;
  padding?: MapPadding;
  onScooterPress?: (id: string) => void;
  onPress?: () => void;
  /** Środek widoku po przesunięciu mapy przez klienta (wyszukiwanie bez lokalizacji). */
  onCenterChange?: (center: MapPoint) => void;
}

export const MAP_STYLE = {
  light: 'https://tiles.openfreemap.org/styles/positron',
  dark: 'https://tiles.openfreemap.org/styles/dark',
} as const;

export const DEFAULT_ZOOM = 15;
const EMPTY: FeatureCollection = { type: 'FeatureCollection', features: [] };

const point = (p: MapPoint, properties: Record<string, unknown>): Feature => ({
  type: 'Feature',
  geometry: { type: 'Point', coordinates: [p.lon, p.lat] },
  properties,
});

const line = (coordinates: LngLat[]): FeatureCollection =>
  coordinates.length >= 2
    ? {
        type: 'FeatureCollection',
        features: [{ type: 'Feature', geometry: { type: 'LineString', coordinates }, properties: {} }],
      }
    : EMPTY;

export type MapSourceId = 'zones' | 'route' | 'drive' | 'guide' | 'scooters' | 'points' | 'destination';

/** Źródła w kolejności rysowania (obie implementacje mapy). */
export const MAP_SOURCES: MapSourceId[] = ['zones', 'route', 'drive', 'guide', 'scooters', 'points', 'destination'];

/** Dane źródeł GeoJSON z właściwości komponentu. */
export function mapData(props: MapViewProps): Record<MapSourceId, FeatureCollection> {
  const points: Feature[] = [];
  const start = props.route?.[0];
  if (start && props.route!.length >= 2) points.push(point({ lon: start[0], lat: start[1] }, { kind: 'start' }));
  if (props.parked) points.push(point(props.parked, { kind: 'parked' }));
  if (props.user) points.push(point(props.user, { kind: props.userStyle === 'ring' ? 'ring' : 'user' }));
  return {
    zones: props.zones ?? EMPTY,
    route: line(props.route ?? []),
    drive: line(props.drive ?? []),
    guide: line(props.guide ?? []),
    scooters: {
      type: 'FeatureCollection',
      features: (props.scooters ?? []).map((s) => point(s, { id: s.id, selected: s.id === props.selectedId })),
    },
    points: { type: 'FeatureCollection', features: points },
    destination: { type: 'FeatureCollection', features: props.destination ? [point(props.destination, {})] : [] },
  };
}

type SourceLayer = Exclude<LayerSpecification, { type: 'background' | 'sky' }> & { source: MapSourceId };

/** Warstwy od dołu do góry; identyfikator warstwy hulajnóg obsługuje dotknięcie. */
export function mapLayers(theme: Theme): SourceLayer[] {
  const zoneColor = [
    'match',
    ['get', 'type'],
    'PARKING',
    theme.accentMap,
    'SLOW',
    theme.warning,
    'NO_RIDE',
    theme.danger,
    theme.muted,
  ];
  return [
    {
      id: 'zones-fill',
      type: 'fill',
      source: 'zones',
      filter: ['!=', ['get', 'type'], 'SERVICE_AREA'],
      paint: {
        'fill-color': zoneColor as never,
        'fill-opacity': ['match', ['get', 'type'], 'PARKING', 0.16, 0.12] as never,
      },
    },
    {
      id: 'zones-line',
      type: 'line',
      source: 'zones',
      filter: ['in', ['get', 'type'], ['literal', ['PARKING', 'NO_RIDE']]],
      paint: { 'line-color': zoneColor as never, 'line-width': 1.5 },
    },
    {
      id: 'zones-line-dashed',
      type: 'line',
      source: 'zones',
      filter: ['in', ['get', 'type'], ['literal', ['SLOW', 'SERVICE_AREA']]],
      paint: { 'line-color': zoneColor as never, 'line-width': 1.5, 'line-dasharray': [3, 2] },
    },
    {
      id: 'zones-label',
      type: 'symbol',
      source: 'zones',
      filter: ['==', ['get', 'type'], 'PARKING'],
      minzoom: 14,
      layout: { 'text-field': 'P', 'text-font': ['Noto Sans Bold'], 'text-size': 15, 'text-allow-overlap': true },
      paint: { 'text-color': theme.accentMap },
    },
    {
      id: 'route',
      type: 'line',
      source: 'route',
      layout: { 'line-cap': 'round', 'line-join': 'round' },
      paint: { 'line-color': theme.accentMap, 'line-width': 5, 'line-opacity': 1 },
    },
    {
      id: 'drive',
      type: 'line',
      source: 'drive',
      layout: { 'line-cap': 'round', 'line-join': 'round' },
      paint: { 'line-color': theme.accentMap, 'line-width': 5 },
    },
    {
      id: 'guide',
      type: 'line',
      source: 'guide',
      layout: { 'line-cap': 'round' },
      paint: { 'line-color': theme.accentMap, 'line-width': 3, 'line-dasharray': [0.5, 2] },
    },
    {
      id: 'scooters',
      type: 'circle',
      source: 'scooters',
      paint: {
        'circle-radius': 6,
        'circle-color': ['case', ['get', 'selected'], theme.surface, theme.ink] as never,
        'circle-stroke-color': ['case', ['get', 'selected'], theme.accentMap, theme.map] as never,
        'circle-stroke-width': ['case', ['get', 'selected'], 3, 2.5] as never,
      },
    },
    {
      id: 'points-halo',
      type: 'circle',
      source: 'points',
      filter: ['in', ['get', 'kind'], ['literal', ['user', 'ring']]],
      paint: {
        'circle-radius': ['match', ['get', 'kind'], 'ring', 16, 22] as never,
        'circle-color': theme.accentMap,
        'circle-opacity': 0.16,
      },
    },
    {
      id: 'points',
      type: 'circle',
      source: 'points',
      paint: {
        'circle-radius': ['match', ['get', 'kind'], 'user', 10, 'parked', 10, 'ring', 6, 6] as never,
        'circle-color': [
          'match',
          ['get', 'kind'],
          'user',
          theme.accentMap,
          'parked',
          theme.ink,
          theme.surface,
        ] as never,
        'circle-stroke-color': [
          'match',
          ['get', 'kind'],
          'start',
          theme.ink,
          'ring',
          theme.accentMap,
          theme.surface,
        ] as never,
        'circle-stroke-width': ['match', ['get', 'kind'], 'start', 2.5, 3] as never,
      },
    },
    // Pinezka celu z kół (główka z jasnym środkiem nad ostrzem), bez obrazów: tak samo na webie i natywnie.
    {
      id: 'destination-tip',
      type: 'circle',
      source: 'destination',
      paint: {
        'circle-radius': 3,
        'circle-color': theme.ink,
        'circle-stroke-color': theme.map,
        'circle-stroke-width': 1.5,
      },
    },
    {
      id: 'destination-head',
      type: 'circle',
      source: 'destination',
      paint: {
        'circle-radius': 13,
        'circle-color': theme.ink,
        'circle-stroke-color': theme.surface,
        'circle-stroke-width': 2.5,
        'circle-translate': [0, -19],
      },
    },
    {
      id: 'destination-dot',
      type: 'circle',
      source: 'destination',
      paint: { 'circle-radius': 4.5, 'circle-color': theme.surface, 'circle-translate': [0, -19] },
    },
  ];
}

/** Przyciemniona trasa w trakcie pauzy (makieta przejazd-pauza). */
export const routeOpacity = (muted?: boolean): number => (muted ? 0.5 : 1);

/** Prostokąt obejmujący punkty (do widoku całej trasy albo hulajnogi i strefy). */
export function boundsOf(points: LngLat[]): [LngLat, LngLat] | null {
  if (!points.length) return null;
  const lons = points.map((p) => p[0]);
  const lats = points.map((p) => p[1]);
  return [
    [Math.min(...lons), Math.min(...lats)],
    [Math.max(...lons), Math.max(...lats)],
  ];
}

/** Środek obszaru działania z `GET /zones`; mapa nie ma wpisanych na sztywno współrzędnych miasta. */
export function serviceAreaCenter(zones: ZoneCollection | null): MapPoint | null {
  const area = zones?.features.find((f) => f.properties.type === 'SERVICE_AREA');
  const b = area ? boundsOf(area.geometry.coordinates.flat(2) as LngLat[]) : null;
  return b ? { lon: (b[0][0] + b[1][0]) / 2, lat: (b[0][1] + b[1][1]) / 2 } : null;
}

/** Odległość w metrach (wzór haversine) do opisu „120 m stąd”; reguły stref liczy API. */
export function metersBetween(a: MapPoint, b: MapPoint): number {
  const R = 6371000;
  const rad = Math.PI / 180;
  const dLat = (b.lat - a.lat) * rad;
  const dLon = (b.lon - a.lon) * rad;
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(a.lat * rad) * Math.cos(b.lat * rad) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}

/**
 * Postęp na trasie (ADR 0048): odległość punktu od linii i długość pozostałej części od najbliższego
 * punktu linii, w metrach (rzut lokalny, wystarczający na odcinkach miejskich). Służy do odliczania
 * odległości między zapytaniami i do decyzji o nowej trasie po zejściu z niej.
 */
export function routeProgress(p: MapPoint, line: LngLat[]): { offRouteM: number; remainingM: number; totalM: number } {
  if (line.length < 2) return { offRouteM: 0, remainingM: 0, totalM: 0 };
  const rad = Math.PI / 180;
  const kx = 111320 * Math.cos(p.lat * rad);
  const ky = 110540;
  const xy = ([lon, lat]: LngLat): [number, number] => [(lon - p.lon) * kx, (lat - p.lat) * ky];
  const pts = line.map(xy);
  const lengths = pts.slice(1).map((b, i) => Math.hypot(b[0] - pts[i]![0], b[1] - pts[i]![1]));
  const totalM = lengths.reduce((a, b) => a + b, 0);
  let best = { d: Infinity, rest: 0 };
  let after = totalM;
  for (let i = 0; i < lengths.length; i++) {
    const [ax, ay] = pts[i]!;
    const [bx, by] = pts[i + 1]!;
    const len = lengths[i]!;
    after -= len;
    // Punkt `p` jest początkiem układu, więc rzut liczymy dla wektora (-a).
    const tt = len ? Math.min(1, Math.max(0, (-ax * (bx - ax) - ay * (by - ay)) / (len * len))) : 0;
    const d = Math.hypot(ax + tt * (bx - ax), ay + tt * (by - ay));
    if (d < best.d) best = { d, rest: (1 - tt) * len + after };
  }
  return { offRouteM: best.d, remainingM: best.rest, totalM };
}
