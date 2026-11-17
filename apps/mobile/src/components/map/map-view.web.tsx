/**
 * Mapa w wersji web (ADR 0040): MapLibre GL JS, ta sama biblioteka co mapa floty w panelu. Biblioteka
 * ładuje się dynamicznie w przeglądarce (renderowanie statyczne Expo Router działa bez `window`), a wątek
 * roboczy kopiuje do `public/` skrypt `scripts/maplibre-worker.mjs`.
 */
import type { GeoJSONSource, Map as MapLibreMap, MapLayerMouseEvent } from 'maplibre-gl';
import 'maplibre-gl/dist/maplibre-gl.css';
import { useEffect, useRef } from 'react';
import { View } from 'react-native';
import { useTheme } from '../ui';
import {
  DEFAULT_ZOOM,
  MAP_SOURCES,
  MAP_STYLE,
  mapData,
  mapLayers,
  routeOpacity,
  type MapViewProps,
} from './map-layers';

const WORKER_URL = '/maplibre-gl-worker.mjs';
const SOURCES = MAP_SOURCES;

export function MapView(props: MapViewProps) {
  const theme = useTheme();
  const container = useRef<HTMLDivElement | null>(null);
  const mapRef = useRef<MapLibreMap | null>(null);
  const ready = useRef(false);
  // Najnowsze właściwości dla obsługi zdarzeń mapy (mapa powstaje raz).
  const latest = useRef(props);
  const themeRef = useRef(theme);
  useEffect(() => {
    latest.current = props;
    themeRef.current = theme;
  });

  const pushData = () => {
    const map = mapRef.current;
    if (!map || !ready.current) return;
    const data = mapData(latest.current);
    for (const id of SOURCES) (map.getSource(id) as GeoJSONSource | undefined)?.setData(data[id]);
    if (map.getLayer('route')) map.setPaintProperty('route', 'line-opacity', routeOpacity(latest.current.routeMuted));
  };

  const addLayers = (map: MapLibreMap) => {
    for (const id of SOURCES) {
      if (!map.getSource(id)) map.addSource(id, { type: 'geojson', data: { type: 'FeatureCollection', features: [] } });
    }
    for (const layer of mapLayers(themeRef.current)) if (!map.getLayer(layer.id)) map.addLayer(layer);
    ready.current = true;
    pushData();
  };

  useEffect(() => {
    let disposed = false;
    let map: MapLibreMap | null = null;
    void import('maplibre-gl').then(({ Map: MapLibre, setWorkerUrl }) => {
      if (disposed || !container.current) return;
      setWorkerUrl(WORKER_URL);
      const { focus, padding } = latest.current;
      map = new MapLibre({
        container: container.current,
        style: MAP_STYLE[themeRef.current.scheme],
        center: focus.center ?? [0, 0],
        zoom: focus.center ? (focus.zoom ?? DEFAULT_ZOOM) : 1,
        attributionControl: { compact: true },
      });
      if (padding) map.setPadding(padding);
      if (focus.bounds) map.fitBounds(focus.bounds, { padding: 48, maxZoom: 16, duration: 0 });
      mapRef.current = map;
      map.on('style.load', () => addLayers(map!));
      map.on('click', 'scooters', (e: MapLayerMouseEvent) => {
        const id = e.features?.[0]?.properties?.id as string | undefined;
        if (id) latest.current.onScooterPress?.(id);
      });
      map.on('click', (e) => {
        const hit = map!.getLayer('scooters') ? map!.queryRenderedFeatures(e.point, { layers: ['scooters'] }) : [];
        if (!hit.length) latest.current.onPress?.();
      });
      map.on('mouseenter', 'scooters', () => (map!.getCanvas().style.cursor = 'pointer'));
      map.on('mouseleave', 'scooters', () => (map!.getCanvas().style.cursor = ''));
      map.on('moveend', (e) => {
        // Tylko ruch wywołany przez klienta (przeciągnięcie, przybliżenie), nie przez `focus`.
        if (!(e as { originalEvent?: unknown }).originalEvent) return;
        const c = map!.getCenter();
        latest.current.onCenterChange?.({ lat: c.lat, lon: c.lng });
      });
    });
    return () => {
      disposed = true;
      ready.current = false;
      map?.remove();
      mapRef.current = null;
    };
    // Mapa powstaje raz; zmiany właściwości obsługują efekty niżej.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Zmiana motywu: nowy styl podkładu, warstwy dodaje ponownie obsługa `style.load`.
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    ready.current = false;
    map.setStyle(MAP_STYLE[theme.scheme]);
  }, [theme.scheme]);

  useEffect(pushData);

  const { focus, padding } = props;
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    if (padding) map.setPadding(padding);
    if (focus.bounds) map.fitBounds(focus.bounds, { padding: 48, maxZoom: 16, duration: 600 });
    else if (focus.center)
      map.easeTo({
        center: focus.center,
        zoom: focus.zoom ?? Math.max(map.getZoom(), DEFAULT_ZOOM - 1),
        duration: 600,
      });
    // Widok zmienia się tylko po nowym kluczu.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [focus.key]);

  return (
    <View style={{ flex: 1, backgroundColor: theme.map }}>
      <div ref={container} style={{ position: 'absolute', inset: 0 }} />
    </View>
  );
}
