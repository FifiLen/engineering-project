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
export type ZoneCollection = FeatureCollection<
  MultiPolygon,
  { code: string; name: string; type: ZoneType; speedLimitKmh: number | null }
>;

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
  /** Linia przerywana: dojście do hulajnogi albo dojazd do strefy parkowania. */
  guide?: LngLat[];
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
    ? { type: 'FeatureCollection', features: [{ type: 'Feature', geometry: { type: 'LineString', coordinates }, properties: {} }] }
    : EMPTY;

export type MapSourceId = 'zones' | 'route' | 'guide' | 'scooters' | 'points';

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
    guide: line(props.guide ?? []),
    scooters: {
      type: 'FeatureCollection',
      features: (props.scooters ?? []).map((s) => point(s, { id: s.id, selected: s.id === props.selectedId })),
    },
    points: { type: 'FeatureCollection', features: points },
  };
}

type SourceLayer = Exclude<LayerSpecification, { type: 'background' | 'sky' }> & { source: MapSourceId };

/** Warstwy od dołu do góry; identyfikator warstwy hulajnóg obsługuje dotknięcie. */
export function mapLayers(theme: Theme): SourceLayer[] {
  const zoneColor = ['match', ['get', 'type'], 'PARKING', theme.accentMap, 'SLOW', theme.warning, 'NO_RIDE', theme.danger, theme.muted];
  return [
    {
      id: 'zones-fill',
      type: 'fill',
      source: 'zones',
      filter: ['!=', ['get', 'type'], 'SERVICE_AREA'],
      paint: { 'fill-color': zoneColor as never, 'fill-opacity': ['match', ['get', 'type'], 'PARKING', 0.16, 0.12] as never },
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
        'circle-color': ['match', ['get', 'kind'], 'user', theme.accentMap, 'parked', theme.ink, theme.surface] as never,
        'circle-stroke-color': ['match', ['get', 'kind'], 'start', theme.ink, 'ring', theme.accentMap, theme.surface] as never,
        'circle-stroke-width': ['match', ['get', 'kind'], 'start', 2.5, 3] as never,
      },
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
