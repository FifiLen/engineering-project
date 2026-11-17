'use client';

/**
 * Mapa edytora stref (ADR 0047, makiety 23-panel-strefy): warstwy stref, hulajnogi floty i edytor
 * geometrii Terra Draw z adapterem MapLibre. Edytowany wielokąt jest kontrolowany przez rodzica
 * (`polygon`): każda zakończona operacja Terra Draw wraca przez `onPolygonChange`, a cofnięcie zmienia
 * `polygon`, który mapa przenosi z powrotem do Terra Draw.
 */
import type { FleetMapScooter, ZonePolygon, ZoneType } from '@hulajnogi/shared';
import type { Feature, FeatureCollection, MultiPolygon, Point, Polygon, Position } from 'geojson';
import type { ExpressionSpecification, GeoJSONSource, Map as MapLibreMap, Marker, PointLike } from 'maplibre-gl';
import 'maplibre-gl/dist/maplibre-gl.css';
import { useEffect, useRef, useState, type RefObject } from 'react';
import type {
  GeoJSONStoreFeatures,
  SnappableContext,
  TerraDraw,
  TerraDrawMouseEvent,
  TerraDrawPolygonMode,
  TerraDrawSelectMode,
} from 'terra-draw';
import { t } from '../../../lib/i18n';
import { MinusIcon, PlusIcon } from '../icons';
import { MAP_STYLE, MAP_WORKER_URL } from '../map-layers';
import { ZONE_COLOR, zoneMapLabel } from './zone-format';
import {
  boundsOfPositions,
  outerRings,
  pointInRing,
  removeVertex,
  ringOf,
  samePolygon,
  toZonePolygon,
} from './zone-geometry';

export interface ZoneFeatureProperties {
  code: string;
  name: string;
  type: ZoneType;
  speedLimitKmh: number | null;
  capacity: number | null;
  visibleInApp: boolean;
  anchor: [number, number];
}
/** `GET /zones`: aktywne strefy z identyfikatorem rekordu w `id` obiektu. */
export type ZonesGeoJson = FeatureCollection<MultiPolygon, ZoneFeatureProperties>;

export type EditorTool = 'draw' | 'edit' | 'delete';

export interface ZoneMapApi {
  /** Cofnięcie ostatniego punktu rysowanego wielokąta; `false`, gdy nic się nie rysuje. */
  undoDrawing(): boolean;
  /** Mapa pokazuje podane punkty (np. „Pokaż” przy polu „Granica”). */
  fit(points: ReadonlyArray<Position>): void;
}

export interface ZoneHighlights {
  /** Punkty granicy do poprawy (np. poza obszarem działania). */
  points: Array<[number, number]>;
  /** Strefa, z którą jest konflikt (ZONE_OVERLAP), wyróżniona kolorem błędu. */
  zoneId: string | null;
  /** Edytowana granica ma błąd: obrys w kolorze błędu. */
  invalid: boolean;
}

interface ZoneMapProps {
  zones: ZonesGeoJson | null;
  scooters: FleetMapScooter[];
  /** Wybrana zapisana strefa: znika z warstwy stref, bo rysuje ją edytor albo warstwa podglądu. */
  selectedId: string | null;
  /** Granica wybranej strefy bez edycji (tylko do odczytu, strefa wieloczęściowa). */
  readonlyGeometry: MultiPolygon | null;
  /** Edytowany wielokąt (szkic); `null` przed narysowaniem nowej strefy. */
  polygon: ZonePolygon | null;
  /** Zapisana granica pokazywana cienką linią, gdy szkic się od niej różni. */
  previousPolygon: ZonePolygon | null;
  editable: boolean;
  tool: EditorTool;
  zoneType: ZoneType | null;
  highlights: ZoneHighlights;
  apiRef: RefObject<ZoneMapApi | null>;
  onSelect(id: string): void;
  onPolygonChange(polygon: ZonePolygon, kind: 'draw' | 'edit'): void;
  onDrawingProgress(points: number): void;
  onInvalidEdit(reason: 'SELF_INTERSECTION' | 'TOO_FEW_POINTS'): void;
}

/** Stały identyfikator edytowanego wielokąta w magazynie Terra Draw. */
const EDIT_ID = 'zone-edit';
const SNAP_VERTEX_PX = 10;
const SNAP_EDGE_PX = 8;
const DELETE_HIT_PX = 12;
const FIT_PADDING = { top: 90, bottom: 110, left: 60, right: 400 };
const EMPTY: FeatureCollection = { type: 'FeatureCollection', features: [] };
/** Kolor bieżącej akcji operatora (nowy wielokąt przed wyborem typu). */
const DRAFT_COLOR = '#2B3FF5';

const typeMatch = (values: Record<ZoneType, string | number>, fallback: string | number) =>
  ['match', ['get', 'type'], ...Object.entries(values).flat(), fallback] as unknown as ExpressionSpecification;

const FILL_COLOR = typeMatch(ZONE_COLOR, '#16181D');
const FILL_OPACITY = typeMatch({ PARKING: 0.16, SLOW: 0.08, NO_RIDE: 0.12, SERVICE_AREA: 0 }, 0.1);

/** Wygląd edytora w kolorze typu; obszar działania prawie bez wypełnienia, bo zakrywa całe miasto. */
function editorStyles(color: `#${string}`, fillOpacity = 0.18) {
  return {
    polygon: {
      fillColor: color,
      fillOpacity,
      outlineColor: color,
      outlineWidth: 2,
      closingPointColor: '#FFFFFF' as const,
      closingPointWidth: 6,
      closingPointOutlineColor: color,
      closingPointOutlineWidth: 2,
      coordinatePointColor: '#FFFFFF' as const,
      coordinatePointWidth: 4,
      coordinatePointOutlineColor: color,
      coordinatePointOutlineWidth: 2,
      snappingPointColor: color,
      snappingPointWidth: 5,
      snappingPointOutlineColor: '#FFFFFF' as const,
      snappingPointOutlineWidth: 2,
    },
    select: {
      selectedPolygonColor: color,
      selectedPolygonFillOpacity: fillOpacity,
      selectedPolygonOutlineColor: color,
      selectedPolygonOutlineWidth: 2,
      selectionPointColor: '#FFFFFF' as const,
      selectionPointWidth: 5,
      selectionPointOutlineColor: color,
      selectionPointOutlineWidth: 2,
      midPointColor: '#FFFFFF' as const,
      midPointOpacity: 0.9,
      midPointWidth: 3.5,
      midPointOutlineColor: color,
      midPointOutlineWidth: 1.5,
      midPointOutlineOpacity: 0.55,
    },
  };
}

type Px = { x: number; y: number };

function closestOnSegment(p: Px, a: Px, b: Px): Px {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const len = dx * dx + dy * dy;
  const k = len === 0 ? 0 : Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / len));
  return { x: a.x + k * dx, y: a.y + k * dy };
}

const distance = (a: Px, b: Px) => Math.hypot(a.x - b.x, a.y - b.y);

/** Odległość w pikselach od punktu do pierścienia (wierzchołki i krawędzie). */
function pixelDistanceToRing(map: MapLibreMap, point: Px, ring: ReadonlyArray<Position>): number {
  let best = Infinity;
  for (let i = 0; i < ring.length - 1; i++) {
    const a = map.project(ring[i] as [number, number]);
    const b = map.project(ring[i + 1] as [number, number]);
    best = Math.min(best, distance(point, closestOnSegment(point, a, b)));
  }
  return best;
}

export function ZoneMap(props: ZoneMapProps) {
  const {
    zones,
    scooters,
    selectedId,
    readonlyGeometry,
    polygon,
    previousPolygon,
    editable,
    tool,
    zoneType,
    highlights,
  } = props;
  const container = useRef<HTMLDivElement>(null);
  const mapRef = useRef<MapLibreMap | null>(null);
  const drawRef = useRef<TerraDraw | null>(null);
  const markerClass = useRef<typeof Marker | null>(null);
  const markers = useRef<Marker[]>([]);
  // Najnowsze właściwości dla obsługi zdarzeń mapy i Terra Draw (rejestrowanej raz).
  const latest = useRef(props);
  latest.current = props;
  const [ready, setReady] = useState(false);
  // Dopasowanie widoku zamówione przed wczytaniem mapy (np. strefa z adresu URL).
  const pendingFit = useRef<ReadonlyArray<Position> | null>(null);
  const [initialBounds, setInitialBounds] = useState<[[number, number], [number, number]] | null>(null);

  // Pierwszy widok: obszar działania (bez współrzędnych miasta wpisanych na sztywno).
  useEffect(() => {
    if (initialBounds || !zones) return;
    // Strefy w mieście (bez obszaru działania), a gdy ich nie ma, cały obszar działania.
    const inner = zones.features.filter((f) => f.properties.type !== 'SERVICE_AREA');
    const source = inner.length ? inner : zones.features;
    const points = source.flatMap((f) => outerRings(f.geometry).flat());
    setInitialBounds(
      points.length
        ? boundsOfPositions(points)
        : [
            [-10, 35],
            [30, 60],
          ],
    );
  }, [zones, initialBounds]);

  useEffect(() => {
    if (!initialBounds) return;
    let disposed = false;
    void Promise.all([import('maplibre-gl'), import('terra-draw'), import('terra-draw-maplibre-gl-adapter')]).then(
      ([maplibre, terra, { TerraDrawMapLibreGLAdapter }]) => {
        if (disposed || !container.current) return;
        maplibre.setWorkerUrl(MAP_WORKER_URL);
        markerClass.current = maplibre.Marker;
        const map = new maplibre.Map({
          container: container.current,
          style: MAP_STYLE,
          bounds: initialBounds,
          fitBoundsOptions: { padding: FIT_PADDING, maxZoom: 16 },
          attributionControl: { compact: true },
        });
        map.once('style.load', () => {
          addLayers(map);

          // Przyciąganie do punktów i krawędzi innych stref (ADR 0047); obszar działania pomijamy, bo punkt
          // na jego granicy łatwo wychodzi poza obszar przy zaokrągleniu.
          const snap = (event: TerraDrawMouseEvent, context: SnappableContext): Position | undefined => {
            const { zones: current, selectedId: own } = latest.current;
            const cursor = { x: event.containerX, y: event.containerY };
            let vertex: Position | undefined;
            let vertexDistance = SNAP_VERTEX_PX;
            let edge: Px | undefined;
            let edgeDistance = SNAP_EDGE_PX;
            for (const feature of current?.features ?? []) {
              if (feature.id === own || feature.properties.type === 'SERVICE_AREA') continue;
              for (const ring of outerRings(feature.geometry)) {
                for (let i = 0; i < ring.length - 1; i++) {
                  const a = context.project(ring[i]![0]!, ring[i]![1]!);
                  const b = context.project(ring[i + 1]![0]!, ring[i + 1]![1]!);
                  const d = distance(cursor, a);
                  if (d < vertexDistance) {
                    vertexDistance = d;
                    vertex = ring[i];
                  }
                  const onEdge = closestOnSegment(cursor, a, b);
                  const e = distance(cursor, onEdge);
                  if (e < edgeDistance) {
                    edgeDistance = e;
                    edge = onEdge;
                  }
                }
              }
            }
            if (vertex) return vertex;
            if (!edge) return undefined;
            const { lng, lat } = context.unproject(edge.x, edge.y);
            return [lng, lat];
          };

          // Walidacja Terra Draw: wielokąt nie może przecinać sam siebie (rysowanie i przeciąganie punktów).
          const validation = (feature: GeoJSONStoreFeatures, context: { updateType: string }) => {
            const result = terra.ValidateNotSelfIntersecting(feature);
            if (!result.valid && context.updateType !== 'provisional')
              latest.current.onInvalidEdit('SELF_INTERSECTION');
            return result;
          };

          const styles = editorStyles(DRAFT_COLOR);
          const draw = new terra.TerraDraw({
            // Sześć miejsc po przecinku (około 0,1 m), jak w API (ADR 0047).
            adapter: new TerraDrawMapLibreGLAdapter({ map, coordinatePrecision: 6 }),
            idStrategy: {
              isValidId: (id) => typeof id === 'string' && id.length > 0,
              getId: (() => {
                let n = 0;
                return () => `drawn-${++n}`;
              })(),
            },
            modes: [
              new terra.TerraDrawPolygonMode({ validation, snapping: { toCustom: snap }, styles: styles.polygon }),
              new terra.TerraDrawSelectMode({
                allowManualDeselection: false,
                styles: styles.select,
                flags: {
                  polygon: {
                    feature: {
                      draggable: false,
                      validation,
                      coordinates: { draggable: true, midpoints: true, deletable: true, snappable: { toCustom: snap } },
                    },
                  },
                },
              }),
            ],
            // Cofanie punktów w trakcie rysowania; resztę cofa własny stos kopii wielokąta (ADR 0047).
            undoRedo: { modeLevel: new terra.TerraDrawModeUndoRedo() },
          });
          draw.start();
          draw.on('finish', (id, context) => {
            const feature = draw.getSnapshotFeature(id);
            if (feature?.geometry.type !== 'Polygon') return;
            const next = toZonePolygon(feature.geometry);
            if (context.mode === 'polygon' && context.action === 'draw') {
              // Narysowany wielokąt staje się edytowanym (stały identyfikator); usuwamy go po zakończeniu obsługi.
              setTimeout(() => draw.hasFeature(id) && draw.removeFeatures([id]), 0);
              latest.current.onDrawingProgress(0);
              latest.current.onPolygonChange(next, 'draw');
              return;
            }
            if (id === EDIT_ID) latest.current.onPolygonChange(next, 'edit');
          });
          draw.on('change', () => {
            if (draw.getMode() !== 'polygon') return;
            const drawing = draw
              .getSnapshot()
              .find((f) => f.id !== EDIT_ID && f.geometry.type === 'Polygon' && f.properties.mode === 'polygon');
            // Rysowany pierścień: punkty, kursor i powtórzony pierwszy punkt.
            const ring = drawing ? ((drawing.geometry as Polygon).coordinates[0] ?? []) : [];
            latest.current.onDrawingProgress(
              drawing && draw.getModeState() === 'drawing' ? Math.max(0, ring.length - 2) : 0,
            );
          });
          drawRef.current = draw;

          map.on('click', (e) => {
            const p = latest.current;
            const ring = p.polygon ? ringOf(p.polygon) : null;
            if (p.editable && p.tool === 'delete' && p.polygon && ring) {
              let index = -1;
              let best = DELETE_HIT_PX;
              ring.slice(0, -1).forEach((v, i) => {
                const d = distance(map.project(v), e.point);
                if (d < best) {
                  best = d;
                  index = i;
                }
              });
              if (index < 0) return;
              const next = removeVertex(p.polygon, index);
              if (next) p.onPolygonChange(next, 'edit');
              else p.onInvalidEdit('TOO_FEW_POINTS');
              return;
            }
            if (p.editable && p.tool === 'draw') return;
            // Kliknięcie w edytowany wielokąt albo jego uchwyty nie zmienia wybranej strefy.
            if (
              ring &&
              (pointInRing([e.lngLat.lng, e.lngLat.lat], ring) || pixelDistanceToRing(map, e.point, ring) < 14)
            )
              return;
            const hits = map.queryRenderedFeatures(e.point as PointLike, { layers: ['zones-fill'] });
            const order: ZoneType[] = ['PARKING', 'NO_RIDE', 'SLOW'];
            const hit = hits.sort(
              (a, b) => order.indexOf(a.properties.type as ZoneType) - order.indexOf(b.properties.type as ZoneType),
            )[0];
            if (hit) p.onSelect(hit.properties.id as string);
          });
          map.on('mousemove', 'zones-fill', () => {
            if (latest.current.tool === 'draw' && latest.current.editable) return;
            map.getCanvas().style.cursor = 'pointer';
          });
          map.on('mouseleave', 'zones-fill', () => (map.getCanvas().style.cursor = ''));

          mapRef.current = map;
          setReady(true);
        });
      },
    );
    return () => {
      disposed = true;
      try {
        drawRef.current?.stop();
      } catch {
        // Mapa mogła już zniknąć razem z warstwami edytora.
      }
      drawRef.current = null;
      mapRef.current?.remove();
      mapRef.current = null;
    };
  }, [initialBounds]);

  // Interfejs dla rodzica: cofnięcie punktu w trakcie rysowania i dopasowanie widoku.
  useEffect(() => {
    props.apiRef.current = {
      undoDrawing: () => {
        const draw = drawRef.current;
        if (!draw || draw.getMode() !== 'polygon' || draw.getModeState() !== 'drawing') return false;
        if (draw.canUndo()) draw.undo();
        return true;
      },
      fit: (points) => {
        if (points.length === 0) return;
        if (!mapRef.current) pendingFit.current = points;
        else
          mapRef.current.fitBounds(boundsOfPositions(points), { padding: FIT_PADDING, maxZoom: 17.5, duration: 400 });
      },
    };
  });

  useEffect(() => {
    if (!ready || !mapRef.current || !pendingFit.current) return;
    mapRef.current.fitBounds(boundsOfPositions(pendingFit.current), {
      padding: FIT_PADDING,
      maxZoom: 17.5,
      duration: 0,
    });
    pendingFit.current = null;
  }, [ready]);

  // Strefy: bez wybranej (rysuje ją edytor albo warstwa podglądu), z identyfikatorem do kliknięcia.
  useEffect(() => {
    const map = mapRef.current;
    if (!ready || !map || !zones) return;
    (map.getSource('zones') as GeoJSONSource).setData({
      type: 'FeatureCollection',
      features: zones.features
        .filter((f) => f.id !== selectedId)
        .map((f) => ({ ...f, properties: { ...f.properties, id: f.id } })),
    });
  }, [ready, zones, selectedId]);

  // Etykiety stref jako pigułki (makieta): kod i nazwa przy punkcie wewnątrz strefy.
  useEffect(() => {
    const map = mapRef.current;
    const MarkerClass = markerClass.current;
    if (!ready || !map || !zones || !MarkerClass) return;
    for (const m of markers.current) m.remove();
    markers.current = zones.features.map((f) => {
      const el = document.createElement('button');
      el.type = 'button';
      el.className = `zone-label ${f.properties.type.toLowerCase()}${f.id === selectedId ? ' sel' : ''}`;
      el.textContent = zoneMapLabel(f.properties);
      el.addEventListener('click', (e) => {
        e.stopPropagation();
        if (!(latest.current.editable && latest.current.tool === 'draw')) latest.current.onSelect(String(f.id));
      });
      return new MarkerClass({ element: el, anchor: 'left', offset: [10, 0] })
        .setLngLat(f.properties.anchor)
        .addTo(map);
    });
  }, [ready, zones, selectedId]);

  useEffect(() => {
    const map = mapRef.current;
    if (!ready || !map) return;
    (map.getSource('zone-readonly') as GeoJSONSource).setData(
      readonlyGeometry && !editable
        ? { type: 'Feature', geometry: readonlyGeometry, properties: { type: zoneType ?? 'PARKING' } }
        : EMPTY,
    );
  }, [ready, readonlyGeometry, editable, zoneType]);

  useEffect(() => {
    const map = mapRef.current;
    if (!ready || !map) return;
    (map.getSource('zone-previous') as GeoJSONSource).setData(
      previousPolygon && editable && !samePolygon(previousPolygon, polygon)
        ? { type: 'Feature', geometry: previousPolygon, properties: {} }
        : EMPTY,
    );
  }, [ready, previousPolygon, polygon, editable]);

  useEffect(() => {
    const map = mapRef.current;
    if (!ready || !map) return;
    const features: Feature[] = highlights.points.map((p): Feature<Point> => ({
      type: 'Feature',
      geometry: { type: 'Point', coordinates: p },
      properties: {},
    }));
    const conflict = highlights.zoneId ? zones?.features.find((f) => f.id === highlights.zoneId) : undefined;
    if (conflict) features.push({ type: 'Feature', geometry: conflict.geometry, properties: {} });
    if (highlights.invalid && polygon) features.push({ type: 'Feature', geometry: polygon, properties: {} });
    (map.getSource('zone-error') as GeoJSONSource).setData({ type: 'FeatureCollection', features });
  }, [ready, highlights, zones, polygon]);

  useEffect(() => {
    const map = mapRef.current;
    if (!ready || !map) return;
    (map.getSource('scooters') as GeoJSONSource).setData({
      type: 'FeatureCollection',
      features: scooters
        .filter((s) => s.lat !== null && s.lon !== null)
        .map((s) => ({
          type: 'Feature',
          geometry: { type: 'Point', coordinates: [s.lon!, s.lat!] },
          properties: { riding: s.fleetStatus === 'IN_USE' },
        })),
    });
  }, [ready, scooters]);

  // Edytowany wielokąt w Terra Draw: dodanie, podmiana po cofnięciu albo usunięciu punktu, usunięcie.
  useEffect(() => {
    const draw = drawRef.current;
    if (!ready || !draw) return;
    if (!editable || !polygon) {
      if (draw.hasFeature(EDIT_ID)) draw.removeFeatures([EDIT_ID]);
      return;
    }
    const geometry = { type: 'Polygon' as const, coordinates: polygon.coordinates };
    if (!draw.hasFeature(EDIT_ID)) {
      draw.addFeatures([{ id: EDIT_ID, type: 'Feature', geometry, properties: { mode: 'polygon' } }]);
      return;
    }
    const current = draw.getSnapshotFeature(EDIT_ID);
    if (current?.geometry.type === 'Polygon' && samePolygon(toZonePolygon(current.geometry), polygon)) return;
    const selected = draw.getMode() === 'select';
    if (selected) draw.deselectFeature(EDIT_ID);
    draw.updateFeatureGeometry(EDIT_ID, geometry);
    if (selected) draw.selectFeature(EDIT_ID);
  }, [ready, editable, polygon]);

  // Tryb Terra Draw z paska narzędzi; poza edycją tryb statyczny.
  const hasPolygon = polygon !== null;
  useEffect(() => {
    const draw = drawRef.current;
    if (!ready || !draw) return;
    if (!editable) {
      if (draw.getMode() !== 'static') draw.setMode('static');
      return;
    }
    if (tool === 'draw') {
      if (draw.getMode() !== 'polygon') draw.setMode('polygon');
      return;
    }
    if (draw.getMode() !== 'select') draw.setMode('select');
    if (draw.hasFeature(EDIT_ID)) draw.selectFeature(EDIT_ID);
  }, [ready, editable, tool, hasPolygon]);

  // Kolor edytora według typu strefy; nowy wielokąt przed wyborem typu jest kobaltowy.
  useEffect(() => {
    const draw = drawRef.current;
    if (!ready || !draw) return;
    const styles = editorStyles(
      zoneType ? ZONE_COLOR[zoneType] : DRAFT_COLOR,
      zoneType === 'SERVICE_AREA' ? 0.04 : 0.18,
    );
    draw.updateModeOptions<typeof TerraDrawPolygonMode>('polygon', { styles: styles.polygon });
    draw.updateModeOptions<typeof TerraDrawSelectMode>('select', { styles: styles.select });
  }, [ready, zoneType]);

  return (
    <>
      <div ref={container} className="zones-canvas" role="region" aria-label={t('zones.map.label')} />
      <div className="zm-zoom glass-zone" role="group" aria-label={t('zones.map.zoom')}>
        <button type="button" aria-label={t('zones.map.zoomIn')} onClick={() => mapRef.current?.zoomIn()}>
          <PlusIcon />
        </button>
        <button type="button" aria-label={t('zones.map.zoomOut')} onClick={() => mapRef.current?.zoomOut()}>
          <MinusIcon />
        </button>
      </div>
    </>
  );
}

function addLayers(map: MapLibreMap): void {
  map.addSource('zones', { type: 'geojson', data: EMPTY });
  map.addLayer({
    id: 'zones-fill',
    type: 'fill',
    source: 'zones',
    filter: ['!=', ['get', 'type'], 'SERVICE_AREA'],
    paint: { 'fill-color': FILL_COLOR, 'fill-opacity': FILL_OPACITY },
  });
  map.addLayer({
    id: 'zones-line',
    type: 'line',
    source: 'zones',
    filter: ['in', ['get', 'type'], ['literal', ['PARKING', 'NO_RIDE']]],
    paint: { 'line-color': FILL_COLOR, 'line-width': 1.5 },
  });
  map.addLayer({
    id: 'zones-line-dashed',
    type: 'line',
    source: 'zones',
    filter: ['in', ['get', 'type'], ['literal', ['SLOW', 'SERVICE_AREA']]],
    paint: {
      'line-color': FILL_COLOR,
      'line-opacity': typeMatch({ PARKING: 1, SLOW: 1, NO_RIDE: 1, SERVICE_AREA: 0.45 }, 1),
      'line-width': typeMatch({ PARKING: 1.5, SLOW: 1.5, NO_RIDE: 1.5, SERVICE_AREA: 2 }, 1.5),
      'line-dasharray': [3, 2],
    },
  });

  map.addSource('zone-readonly', { type: 'geojson', data: EMPTY });
  map.addLayer({
    id: 'zone-readonly-fill',
    type: 'fill',
    source: 'zone-readonly',
    paint: { 'fill-color': FILL_COLOR, 'fill-opacity': ['match', ['get', 'type'], 'SERVICE_AREA', 0.04, 0.18] },
  });
  map.addLayer({
    id: 'zone-readonly-line',
    type: 'line',
    source: 'zone-readonly',
    paint: { 'line-color': FILL_COLOR, 'line-width': 2 },
  });

  map.addSource('zone-previous', { type: 'geojson', data: EMPTY });
  map.addLayer({
    id: 'zone-previous',
    type: 'line',
    source: 'zone-previous',
    paint: { 'line-color': '#16181D', 'line-opacity': 0.45, 'line-width': 1.5, 'line-dasharray': [2, 2] },
  });

  map.addSource('scooters', { type: 'geojson', data: EMPTY });
  map.addLayer({
    id: 'scooters',
    type: 'circle',
    source: 'scooters',
    paint: {
      'circle-radius': 4.5,
      'circle-color': ['case', ['get', 'riding'], '#2B3FF5', '#16181D'],
      'circle-stroke-color': '#FFFFFF',
      'circle-stroke-width': 1.5,
    },
  });

  map.addSource('zone-error', { type: 'geojson', data: EMPTY });
  map.addLayer({
    id: 'zone-error-line',
    type: 'line',
    source: 'zone-error',
    filter: ['!=', ['geometry-type'], 'Point'],
    paint: { 'line-color': '#C62F2F', 'line-width': 2.5 },
  });
  map.addLayer({
    id: 'zone-error-point',
    type: 'circle',
    source: 'zone-error',
    filter: ['==', ['geometry-type'], 'Point'],
    paint: {
      'circle-radius': 10,
      'circle-color': '#C62F2F',
      'circle-opacity': 0.22,
      'circle-stroke-color': '#C62F2F',
      'circle-stroke-width': 2,
    },
  });
}
