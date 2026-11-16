'use client';

/**
 * Mapa floty na żywo (makieta admin-mapa): stan początkowy z `GET /admin/fleet/map`, zmiany przez
 * Socket.IO w pokoju `fleet` (ADR 0012), mapa MapLibre z kafelkami OpenFreeMap (ADR 0017).
 */
import {
  scootersResource,
  type ClientToServerEvents,
  type CommandView,
  type FleetMapScooter,
  type FleetStatus,
  type PanelCommand,
  type ScooterDetails,
  type ServerToClientEvents,
} from '@hulajnogi/shared';
import type { FeatureCollection, MultiPolygon } from 'geojson';
import type { ExpressionSpecification, GeoJSONSource, Map as MapLibreMap } from 'maplibre-gl';
import 'maplibre-gl/dist/maplibre-gl.css';
import Link from 'next/link';
import { useEffect, useMemo, useRef, useState } from 'react';
import { io, type Socket } from 'socket.io-client';
import { api, API_URL, errorMessage } from '../../../lib/api';
import { formatKm, formatRelative, formatTime, t } from '../../../lib/i18n';
import { BellIcon, CloseIcon, LockIcon, WrenchIcon } from '../icons';
import { valueLabel } from '../labels';
import { Battery, scooterNumber, STATUS_COLOR, StatusPill } from './fleet-format';

const MAP_STYLE = 'https://tiles.openfreemap.org/styles/positron';
/** Wątek roboczy MapLibre kopiowany do public/ przez scripts/maplibre-worker.mjs. */
const MAP_WORKER_URL = '/maplibre-gl-worker.mjs';
const QUICK: FleetStatus[] = ['AVAILABLE', 'IN_USE', 'LOW_BATTERY', 'MAINTENANCE', 'OFFLINE'];
const LEGEND: FleetStatus[] = ['AVAILABLE', 'IN_USE', 'LOW_BATTERY', 'MAINTENANCE', 'OFFLINE'];
const DETAILS_REFRESH_MS = 5000;
const STATUS_COLOR_EXPRESSION = [
  'match',
  ['get', 'status'],
  ...Object.entries(STATUS_COLOR).flat(),
  '#16181D',
] as unknown as ExpressionSpecification;

type ZoneCollection = FeatureCollection<MultiPolygon, { code: string; type: string; name: string }>;

function toGeoJson(scooters: FleetMapScooter[], selected: string | null): FeatureCollection {
  return {
    type: 'FeatureCollection',
    features: scooters
      .filter((s) => s.lat !== null && s.lon !== null)
      .map((s) => ({
        type: 'Feature',
        id: s.number,
        geometry: { type: 'Point', coordinates: [s.lon!, s.lat!] },
        properties: { id: s.id, status: s.fleetStatus, selected: s.id === selected },
      })),
  };
}

/**
 * Pierwszy widok: zasięg floty, a gdy hulajnogi nie mają jeszcze pozycji, obszar działania. Mapa nie ma
 * wpisanych na sztywno współrzędnych miasta.
 */
function bounds(zones: ZoneCollection, scooters: FleetMapScooter[]): [[number, number], [number, number]] {
  const located = scooters.filter((s) => s.lat !== null && s.lon !== null).map((s) => [s.lon!, s.lat!]);
  const area = zones.features.find((f) => f.properties.type === 'SERVICE_AREA') ?? zones.features[0];
  const points = located.length >= 2 ? located : (area?.geometry.coordinates.flat(2) ?? [[0, 0]]);
  const lons = points.map((p) => p[0]!);
  const lats = points.map((p) => p[1]!);
  return [
    [Math.min(...lons), Math.min(...lats)],
    [Math.max(...lons), Math.max(...lats)],
  ];
}

export function FleetMap() {
  const container = useRef<HTMLDivElement>(null);
  const mapRef = useRef<MapLibreMap | null>(null);
  const [ready, setReady] = useState(false);
  const [scooters, setScooters] = useState<Map<string, FleetMapScooter>>(new Map());
  const [zones, setZones] = useState<ZoneCollection | null>(null);
  const [filter, setFilter] = useState<FleetStatus | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [zonesVisible, setZonesVisible] = useState(true);
  const [live, setLive] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [lastCommand, setLastCommand] = useState<CommandView | null>(null);

  // Stan początkowy i aktualizacje na żywo; po ponownym połączeniu stan źródłowy pobieramy od nowa.
  useEffect(() => {
    const loadSnapshot = () =>
      api<FleetMapScooter[]>('/admin/fleet/map')
        .then((list) => setScooters(new Map(list.map((s) => [s.id, s]))))
        .catch((e: unknown) => setError(errorMessage(e)));
    api<ZoneCollection>('/zones')
      .then(setZones)
      .catch((e: unknown) => setError(errorMessage(e)));
    const socket: Socket<ServerToClientEvents, ClientToServerEvents> = io(API_URL, { transports: ['websocket'] });
    socket.on('connect', () => {
      setLive(true);
      void loadSnapshot();
      // Potwierdzenie z kodem błędu obsłuży logowanie operatora (ADR 0035); token dochodzi z sesją panelu.
      socket.emit('fleet.subscribe', () => undefined);
    });
    socket.on('disconnect', () => setLive(false));
    socket.on('fleet.updates', (updates) =>
      setScooters((current) => {
        const next = new Map(current);
        for (const u of updates) {
          const previous = next.get(u.id);
          // Zdarzenie zmiany łączności nie niesie prędkości ani blokady; zostają ostatnie znane wartości.
          next.set(
            u.id,
            previous
              ? { ...previous, ...u, speedKmh: u.speedKmh ?? previous.speedKmh, locked: u.locked ?? previous.locked }
              : u,
          );
        }
        return next;
      }),
    );
    socket.on('fleet.command', setLastCommand);
    void loadSnapshot();
    return () => {
      socket.disconnect();
    };
  }, []);

  // Pierwszy widok liczymy raz, gdy są strefy i flota; mapa powstaje od razu we właściwym miejscu.
  const [initialBounds, setInitialBounds] = useState<[[number, number], [number, number]] | null>(null);
  useEffect(() => {
    if (!initialBounds && zones && scooters.size) setInitialBounds(bounds(zones, [...scooters.values()]));
  }, [initialBounds, zones, scooters]);

  // Mapa MapLibre ładowana dynamicznie (tylko w przeglądarce).
  useEffect(() => {
    if (!initialBounds) return;
    let disposed = false;
    void import('maplibre-gl').then(({ Map: MapLibre, NavigationControl, setWorkerUrl }) => {
      if (disposed || !container.current) return;
      setWorkerUrl(MAP_WORKER_URL);
      const map = new MapLibre({
        container: container.current,
        style: MAP_STYLE,
        bounds: initialBounds,
        fitBoundsOptions: { padding: { top: 120, bottom: 90, left: 60, right: 440 }, maxZoom: 16 },
        attributionControl: { compact: true },
      });
      map.addControl(new NavigationControl({ showCompass: false }), 'bottom-right');
      // Warstwy po wczytaniu stylu, bez czekania na pełny render kafelków.
      map.once('style.load', () => {
        map.addSource('zones', { type: 'geojson', data: { type: 'FeatureCollection', features: [] } });
        map.addSource('scooters', { type: 'geojson', data: { type: 'FeatureCollection', features: [] } });
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
        map.addLayer({
          id: 'scooters-halo',
          type: 'circle',
          source: 'scooters',
          filter: ['==', ['get', 'selected'], true],
          paint: { 'circle-radius': 16, 'circle-color': STATUS_COLOR_EXPRESSION, 'circle-opacity': 0.18 },
        });
        map.addLayer({
          id: 'scooters',
          type: 'circle',
          source: 'scooters',
          paint: {
            'circle-radius': ['case', ['==', ['get', 'selected'], true], 8, 5.5],
            'circle-color': STATUS_COLOR_EXPRESSION,
            'circle-stroke-color': '#FFFFFF',
            'circle-stroke-width': 2,
          },
        });
        map.on('click', 'scooters', (e) =>
          setSelectedId((e.features?.[0]?.properties?.id as string | undefined) ?? null),
        );
        map.on('mouseenter', 'scooters', () => (map.getCanvas().style.cursor = 'pointer'));
        map.on('mouseleave', 'scooters', () => (map.getCanvas().style.cursor = ''));
        mapRef.current = map;
        setReady(true);
      });
    });
    return () => {
      disposed = true;
      mapRef.current?.remove();
      mapRef.current = null;
    };
  }, [initialBounds]);

  useEffect(() => {
    const map = mapRef.current;
    if (!ready || !map || !zones) return;
    (map.getSource('zones') as GeoJSONSource).setData(zones);
  }, [ready, zones]);

  useEffect(() => {
    const map = mapRef.current;
    if (!ready || !map) return;
    for (const id of ['zones-fill', 'zones-line'])
      map.setLayoutProperty(id, 'visibility', zonesVisible ? 'visible' : 'none');
  }, [ready, zonesVisible]);

  const all = useMemo(() => [...scooters.values()], [scooters]);
  const visible = useMemo(() => (filter ? all.filter((s) => s.fleetStatus === filter) : all), [all, filter]);
  useEffect(() => {
    if (ready)
      (mapRef.current?.getSource('scooters') as GeoJSONSource | undefined)?.setData(toGeoJson(visible, selectedId));
  }, [ready, visible, selectedId]);

  const counts = useMemo(() => {
    const c: Partial<Record<FleetStatus, number>> = {};
    for (const s of all) c[s.fleetStatus] = (c[s.fleetStatus] ?? 0) + 1;
    return c;
  }, [all]);

  const selected = selectedId ? (scooters.get(selectedId) ?? null) : null;

  return (
    <div className="map-page">
      <div ref={container} className="map-canvas" role="region" aria-label={t('map.title')} />
      <div className="map-top">
        <div className="map-title">
          {t('map.title')}
          <span className={live ? 'live-dot' : 'live-dot off'} title={live ? t('map.live') : t('map.reconnecting')} />
          <span className="visually-hidden">{live ? t('map.live') : t('map.reconnecting')}</span>
        </div>
        <button type="button" className="chip" aria-pressed={filter === null} onClick={() => setFilter(null)}>
          {t('common.all')}
          <span className="n num">{all.length}</span>
        </button>
        {QUICK.map((status) => (
          <button
            key={status}
            type="button"
            className="chip"
            aria-pressed={filter === status}
            onClick={() => setFilter(filter === status ? null : status)}
          >
            {t.dynamic(`fleetStatusPlural.${status}`)}
            <span className="n num">{counts[status] ?? 0}</span>
          </button>
        ))}
      </div>

      <div className="legend" aria-label={t('map.legend')}>
        {LEGEND.map((status) => (
          <span key={status}>
            <i className="dot" style={{ background: STATUS_COLOR[status] }} />
            {t.dynamic(`fleetStatus.${status}`)}
          </span>
        ))}
        <span className="sep" />
        <label className="switch">
          <input type="checkbox" checked={zonesVisible} onChange={(e) => setZonesVisible(e.target.checked)} />
          {t('map.zones')}
        </label>
      </div>

      {error && (
        <div className="banner danger map-error" role="alert">
          {t('map.loadError')}
          {': '}
          {error}
        </div>
      )}

      {selected && (
        <ScooterPanel
          key={selected.id}
          scooter={selected}
          lastCommand={lastCommand}
          onClose={() => setSelectedId(null)}
        />
      )}
    </div>
  );
}

/** Karta hulajnogi na mapie: dane na żywo, szczegóły z API, komendy i ostatnie komunikaty. */
function ScooterPanel({
  scooter,
  lastCommand,
  onClose,
}: {
  scooter: FleetMapScooter;
  lastCommand: CommandView | null;
  onClose: () => void;
}) {
  const [details, setDetails] = useState<ScooterDetails | null>(null);
  const [commands, setCommands] = useState<CommandView[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [now, setNow] = useState(() => Date.now());
  const fetchedAt = useRef(0);

  const refresh = () => {
    fetchedAt.current = Date.now();
    api<ScooterDetails>(`/admin/scooters/${scooter.id}`)
      .then(setDetails)
      .catch((e: unknown) => setError(errorMessage(e)));
  };

  useEffect(() => {
    refresh();
    api<CommandView[]>(`/admin/scooters/${scooter.id}/commands`)
      .then(setCommands)
      .catch(() => setCommands([]));
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
    // Karta jest tworzona osobno dla każdej hulajnogi (klucz), więc wczytujemy ją raz.
  }, []);

  // Przebieg i strefa zmieniają się z telemetrią; szczegóły odświeżamy nie częściej niż co 5 s.
  useEffect(() => {
    if (Date.now() - fetchedAt.current > DETAILS_REFRESH_MS) refresh();
  }, [scooter.lastSeenAt, scooter.fleetStatus]);

  useEffect(() => {
    if (lastCommand?.scooterId !== scooter.id) return;
    setCommands((list) => [lastCommand, ...list.filter((c) => c.id !== lastCommand.id)].slice(0, 10));
  }, [lastCommand, scooter.id]);

  const send = (type: PanelCommand) => {
    setError(null);
    api<CommandView>(`/admin/scooters/${scooter.id}/commands`, { method: 'POST', json: { type } }).catch((e: unknown) =>
      setError(errorMessage(e)),
    );
  };

  const setStatus = (status: 'MAINTENANCE' | 'AVAILABLE') => {
    if (!details) return;
    setError(null);
    api<ScooterDetails>(`/admin/scooters/${scooter.id}`, {
      method: 'PATCH',
      json: { version: details.version, status },
    })
      .then(setDetails)
      .catch((e: unknown) => setError(errorMessage(e)));
  };

  const zone = details?.parkingZoneCode
    ? t('resource.scooters.zoneLabel', { code: details.parkingZoneCode, name: details.parkingZoneName ?? '' })
    : t('map.outsideZone');
  const range = details?.rangeKm ?? null;

  return (
    <aside className="scooter-panel" aria-label={scooterNumber(scooter.number)}>
      <div className="head">
        <div>
          <h2>{scooterNumber(scooter.number)}</h2>
          <StatusPill status={scooter.fleetStatus} />
        </div>
        <button type="button" className="icon-btn" aria-label={t('common.close')} onClick={onClose}>
          <CloseIcon />
        </button>
      </div>

      <div className="stats">
        <div>
          <div className="value">
            <Battery pct={scooter.batteryPct} low={scooter.fleetStatus === 'LOW_BATTERY'} bar={false} />
          </div>
          <div className="caption">{t('map.battery')}</div>
        </div>
        <div>
          <div className="value num">{range === null ? t('common.none') : t('common.km', { value: range })}</div>
          <div className="caption">{t('map.range')}</div>
        </div>
        <div>
          <div className="value">
            {details ? valueLabel(scootersResource, 'variant', details.variant) : t('common.none')}
          </div>
          <div className="caption">{t('map.variant')}</div>
        </div>
      </div>

      <dl style={{ margin: 0 }}>
        <div className="kv">
          <dt>{t('map.lastSignal')}</dt>
          <dd className="num">{formatRelative(scooter.lastSeenAt, now)}</dd>
        </div>
        <div className="kv">
          <dt>{t('map.zone')}</dt>
          <dd>{zone}</dd>
        </div>
        <div className="kv">
          <dt>{t('map.lastRental')}</dt>
          <dd className="num">{details?.rentalNumber ?? t('common.none')}</dd>
        </div>
        <div className="kv">
          <dt>{t('map.odometer')}</dt>
          <dd className="num">{details ? formatKm(details.odometerM) : t('common.none')}</dd>
        </div>
        <div className="kv">
          <dt>{t('map.firmware')}</dt>
          <dd>{details?.firmware ?? t('common.none')}</dd>
        </div>
      </dl>

      {error && (
        <div className="banner danger" role="alert">
          {error}
        </div>
      )}

      <div className="panel-actions">
        <button type="button" className="btn block" onClick={() => send('LOCK')}>
          <LockIcon />
          {t('command.LOCK')}
        </button>
        <button type="button" className="btn block" onClick={() => send('RING')}>
          <BellIcon />
          {t('command.RING')}
        </button>
        {details?.status === 'MAINTENANCE' ? (
          <button type="button" className="btn dark block" onClick={() => setStatus('AVAILABLE')}>
            <WrenchIcon />
            {t('map.backToFleet')}
          </button>
        ) : (
          <button
            type="button"
            className="btn dark block"
            disabled={!details || details.status !== 'AVAILABLE'}
            onClick={() => setStatus('MAINTENANCE')}
          >
            <WrenchIcon />
            {t('map.toService')}
          </button>
        )}
        <Link className="btn primary block" href={`/admin/flota/${scooter.id}`}>
          {t('map.details')}
        </Link>
      </div>

      <div className="messages">
        <h3>{t('map.recent')}</h3>
        <ul aria-live="polite">
          {scooter.lastSeenAt && (
            <li>
              <span className="num">
                {formatTime(scooter.lastSeenAt)} {t('map.telemetryLine')}
              </span>
              <span className="num">
                {t('map.telemetryValue', { battery: scooter.batteryPct ?? 0, speed: scooter.speedKmh ?? 0 })}
              </span>
            </li>
          )}
          {commands.map((c) => (
            <li key={c.id}>
              <span className="num">
                {formatTime(c.sentAt)} {t.dynamic(`command.${c.type}`).toLowerCase()}
              </span>
              <span className="num">
                {c.status === 'ACKED' && c.ackedAt
                  ? t('command.ackedIn', {
                      ms: Math.max(0, new Date(c.ackedAt).getTime() - new Date(c.sentAt).getTime()),
                    })
                  : t.dynamic(`command.status.${c.status}`)}
              </span>
            </li>
          ))}
          {!scooter.lastSeenAt && commands.length === 0 && <li>{t('map.noMessages')}</li>}
        </ul>
      </div>
    </aside>
  );
}
