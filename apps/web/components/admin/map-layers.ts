/** Wspólne ustawienia map panelu (mapa floty, trasa przejazdu): styl, wątek roboczy i warstwy stref (ADR 0017). */
import type { FeatureCollection, MultiPolygon } from 'geojson';
import type { Map as MapLibreMap } from 'maplibre-gl';

export const MAP_STYLE = 'https://tiles.openfreemap.org/styles/positron';
/** Wątek roboczy MapLibre kopiowany do public/ przez scripts/maplibre-worker.mjs. */
export const MAP_WORKER_URL = '/maplibre-gl-worker.mjs';

export type ZoneCollection = FeatureCollection<MultiPolygon, { code: string; type: string; name: string }>;

/** Źródło `zones` i warstwy stref: wypełnienie (bez obszaru działania) i przerywany obrys. */
export function addZoneLayers(map: MapLibreMap): void {
  map.addSource('zones', { type: 'geojson', data: { type: 'FeatureCollection', features: [] } });
  map.addLayer({
    id: 'zones-fill',
    type: 'fill',
    source: 'zones',
    filter: ['!=', ['get', 'type'], 'SERVICE_AREA'],
    paint: {
      'fill-color': ['match', ['get', 'type'], 'NO_RIDE', '#C62F2F', 'SLOW', '#2B3FF5', '#8F5500'],
      'fill-opacity': ['match', ['get', 'type'], 'SLOW', 0.06, 0.14],
    },
  });
  map.addLayer({
    id: 'zones-line',
    type: 'line',
    source: 'zones',
    paint: {
      'line-color': [
        'match',
        ['get', 'type'],
        'NO_RIDE',
        '#C62F2F',
        'SLOW',
        '#2B3FF5',
        'SERVICE_AREA',
        '#6B6E75',
        '#8F5500',
      ],
      'line-width': 1.5,
      'line-dasharray': [3, 2],
    },
  });
}

/** Obszar działania (albo pierwsza strefa) jako prostokąt widoku, gdy nie ma pozycji do pokazania. */
export function serviceAreaBounds(zones: ZoneCollection): [[number, number], [number, number]] | null {
  const area = zones.features.find((f) => f.properties.type === 'SERVICE_AREA') ?? zones.features[0];
  const points = area?.geometry.coordinates.flat(2);
  return points?.length ? boundsOf(points as Array<[number, number]>) : null;
}

export function boundsOf(points: ReadonlyArray<readonly [number, number]>): [[number, number], [number, number]] {
  const lons = points.map((p) => p[0]);
  const lats = points.map((p) => p[1]);
  return [
    [Math.min(...lons), Math.min(...lats)],
    [Math.max(...lons), Math.max(...lats)],
  ];
}
