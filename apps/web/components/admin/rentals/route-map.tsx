'use client';

/**
 * Trasa przejazdu na mapie (makiety przejazdy-lista i przejazd-szczegoly): linia z telemetrii przejazdu,
 * start, bieżąca pozycja hulajnogi albo koniec przejazdu i strefy z `GET /zones` (ADR 0017).
 */
import type { FeatureCollection } from 'geojson';
import type { GeoJSONSource, Map as MapLibreMap } from 'maplibre-gl';
import 'maplibre-gl/dist/maplibre-gl.css';
import { useEffect, useRef, useState } from 'react';
import { api } from '../../../lib/api';
import { t } from '../../../lib/i18n';
import { addZoneLayers, boundsOf, MAP_STYLE, MAP_WORKER_URL, serviceAreaBounds, type ZoneCollection } from '../map-layers';

interface RouteMapProps {
  /** Punkty [lon, lat] w kolejności jazdy. */
  route: Array<[number, number]>;
  /** Bieżąca pozycja hulajnogi (otwarty przejazd) albo koniec trasy (zakończony). */
  position: [number, number] | null;
  ended: boolean;
  /** Mapa w panelu bocznym jest tylko podglądem, bez przesuwania i przybliżania. */
  interactive?: boolean;
  label: string;
}

// Strefy są wspólne dla wszystkich map przejazdów; wczytujemy je raz na sesję karty.
let zonesRequest: Promise<ZoneCollection | null> | null = null;
const loadZones = () => (zonesRequest ??= api<ZoneCollection>('/zones').catch(() => null));

const EMPTY: FeatureCollection = { type: 'FeatureCollection', features: [] };

function points(route: Array<[number, number]>, position: [number, number] | null) {
  const start = route[0];
  return {
    line: {
      type: 'FeatureCollection',
      features: route.length >= 2 ? [{ type: 'Feature', geometry: { type: 'LineString', coordinates: route }, properties: {} }] : [],
    } satisfies FeatureCollection,
    start: {
      type: 'FeatureCollection',
      features: start ? [{ type: 'Feature', geometry: { type: 'Point', coordinates: start }, properties: {} }] : [],
    } satisfies FeatureCollection,
    now: {
      type: 'FeatureCollection',
      features: position ? [{ type: 'Feature', geometry: { type: 'Point', coordinates: position }, properties: {} }] : [],
    } satisfies FeatureCollection,
  };
}

export function RouteMap({ route, position, ended, interactive = true, label }: RouteMapProps) {
  const container = useRef<HTMLDivElement>(null);
  const mapRef = useRef<MapLibreMap | null>(null);
  const [ready, setReady] = useState(false);
  const [zones, setZones] = useState<ZoneCollection | null>(null);
  const [zonesLoaded, setZonesLoaded] = useState(false);

  useEffect(() => {
    void loadZones().then((z) => {
      setZones(z);
      setZonesLoaded(true);
    });
  }, []);

  // Pierwszy widok: trasa z bieżącą pozycją, a bez nich obszar działania. Później widok zostaje operatorowi.
  const located = [...route, ...(position ? [position] : [])];
  const initial = located.length ? boundsOf(located) : zones ? serviceAreaBounds(zones) : null;
  const canCreate = zonesLoaded && initial !== null;
  const initialRef = useRef(initial);
  initialRef.current = initial;

  useEffect(() => {
    if (!canCreate) return;
    let disposed = false;
    void import('maplibre-gl').then(({ Map: MapLibre, NavigationControl, setWorkerUrl }) => {
      if (disposed || !container.current || !initialRef.current) return;
      setWorkerUrl(MAP_WORKER_URL);
      const map = new MapLibre({
        container: container.current,
        style: MAP_STYLE,
        bounds: initialRef.current,
        // Na dużej mapie dół zajmują liczniki, a górę opis i legenda.
        fitBoundsOptions: {
          padding: interactive ? { top: 70, bottom: 110, left: 60, right: 60 } : 28,
          maxZoom: 16,
        },
        interactive,
        attributionControl: { compact: true },
      });
      if (interactive) map.addControl(new NavigationControl({ showCompass: false }), 'bottom-right');
      // Podpis źródeł zwinięty do przycisku „i”, żeby nie zasłaniał małej mapy.
      map.once('load', () =>
        container.current?.querySelector('.maplibregl-ctrl-attrib')?.classList.remove('maplibregl-compact-show'),
      );
      map.once('style.load', () => {
        addZoneLayers(map);
        map.addSource('route', { type: 'geojson', data: EMPTY });
        map.addSource('start', { type: 'geojson', data: EMPTY });
        map.addSource('now', { type: 'geojson', data: EMPTY });
        map.addLayer({
          id: 'route',
          type: 'line',
          source: 'route',
          layout: { 'line-join': 'round', 'line-cap': 'round' },
          paint: { 'line-color': '#2B3FF5', 'line-width': 4 },
        });
        map.addLayer({
          id: 'start',
          type: 'circle',
          source: 'start',
          paint: { 'circle-radius': 5, 'circle-color': '#FFFFFF', 'circle-stroke-color': '#16181D', 'circle-stroke-width': 3 },
        });
        map.addLayer({
          id: 'now-halo',
          type: 'circle',
          source: 'now',
          paint: { 'circle-radius': 13, 'circle-color': ended ? '#16181D' : '#2B3FF5', 'circle-opacity': 0.16 },
        });
        map.addLayer({
          id: 'now',
          type: 'circle',
          source: 'now',
          paint: {
            'circle-radius': 6.5,
            'circle-color': ended ? '#16181D' : '#2B3FF5',
            'circle-stroke-color': '#FFFFFF',
            'circle-stroke-width': 2.5,
          },
        });
        mapRef.current = map;
        setReady(true);
      });
    });
    return () => {
      disposed = true;
      mapRef.current?.remove();
      mapRef.current = null;
      setReady(false);
    };
  }, [canCreate, interactive, ended]);

  useEffect(() => {
    const map = mapRef.current;
    if (!ready || !map || !zones) return;
    (map.getSource('zones') as GeoJSONSource).setData(zones);
  }, [ready, zones]);

  useEffect(() => {
    const map = mapRef.current;
    if (!ready || !map) return;
    const data = points(route, position);
    (map.getSource('route') as GeoJSONSource).setData(data.line);
    (map.getSource('start') as GeoJSONSource).setData(data.start);
    (map.getSource('now') as GeoJSONSource).setData(data.now);
  }, [ready, route, position]);

  return (
    <div className="route-map">
      <div ref={container} className="route-canvas" role="img" aria-label={label} />
      {zonesLoaded && located.length === 0 && <div className="route-empty">{t('rentals.map.noRoute')}</div>}
    </div>
  );
}
