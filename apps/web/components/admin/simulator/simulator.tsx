'use client';

/**
 * Symulator floty (iteracja 6, ADR 0059, makieta symulator): tylko środowisko deweloperskie. Stan z `simulator/status`
 * przekazany przez API (liczniki, aktywne scenariusze), nowy scenariusz dla jednej hulajnogi przez
 * `POST /admin/simulator/commands` i wynik ze zdarzenia `simulator.result` (pokój `simulator`). Po 30 s bez stanu panel
 * pokazuje „Symulator nie odpowiada”.
 */
import {
  SIMULATOR_STALE_AFTER_MS,
  type ListResponse,
  type ScooterListItem,
  type SimulatorAction,
  type SimulatorCommandAccepted,
  type SimulatorCommandRequest,
  type SimulatorCommandView,
  type SimulatorOverview,
  type SimulatorResult,
  type SimulatorScenario,
  type ZoneListItem,
} from '@hulajnogi/shared';
import Link from 'next/link';
import { useCallback, useEffect, useRef, useState, type ComponentType } from 'react';
import { api, ApiRequestError, errorMessage } from '../../../lib/api';
import { formatDuration, formatTime, t } from '../../../lib/i18n';
import { useStaffFeed } from '../../../lib/realtime';
import { useSession } from '../../../lib/session';
import { Banner } from '../access/common';
import { scooterNumber } from '../fleet/fleet-format';
import {
  AlertIcon,
  BanIcon,
  BatteryIcon,
  ChipIcon,
  MuteIcon,
  PinIcon,
  PlayIcon,
  RestoreIcon,
  SearchIcon,
  SquareIcon,
  WarningIcon,
  WifiOffIcon,
} from '../icons';

type Scenario = 'disconnect' | 'silence' | 'drain' | 'enter_no_ride' | 'goto';

const SCENARIOS: Array<{ key: Scenario; Icon: ComponentType<{ size?: number }> }> = [
  { key: 'disconnect', Icon: WifiOffIcon },
  { key: 'silence', Icon: MuteIcon },
  { key: 'drain', Icon: BatteryIcon },
  { key: 'enter_no_ride', Icon: BanIcon },
  { key: 'goto', Icon: PinIcon },
];

/** Rozładowanie z makiety: do 5% w 30 s (wartości domyślne kontraktu). */
const DRAIN = { targetPct: 5, durationS: 30 };

/** Przerwanie scenariusza: rozłączenie i milczenie mają własne polecenia powrotu, reszta `cancel`. */
const STOP_ACTION: Record<SimulatorScenario['kind'], SimulatorAction> = {
  disconnect: 'restore',
  silence: 'unsilence',
  drain: 'cancel',
  goto: 'cancel',
  enter_no_ride: 'cancel',
};

type Load =
  { status: 'loading' } | { status: 'unavailable' } | { status: 'error'; message: string } | { status: 'ready' };

const pad = (n: number) => String(n).padStart(4, '0');

export function SimulatorPage() {
  const { can } = useSession();
  const allowed = can('simulator.manage');
  const [load, setLoad] = useState<Load>({ status: 'loading' });
  const [overview, setOverview] = useState<SimulatorOverview | null>(null);
  const [now, setNow] = useState(() => Date.now());
  const [zones, setZones] = useState<ZoneListItem[]>([]);
  const [notice, setNotice] = useState<{ kind: 'ok' | 'danger'; text: string } | null>(null);
  /** Polecenia wysłane z tej karty: wynik ze zdarzenia przypisujemy po `commandId`. */
  const sent = useRef(new Map<string, string>());

  const refresh = useCallback(() => {
    api<SimulatorOverview>('/admin/simulator/status')
      .then((data) => {
        setOverview(data);
        setLoad(data.enabled ? { status: 'ready' } : { status: 'unavailable' });
      })
      .catch((e: unknown) =>
        setLoad(
          e instanceof ApiRequestError && e.status === 404
            ? { status: 'unavailable' }
            : { status: 'error', message: errorMessage(e) },
        ),
      );
  }, []);

  useEffect(() => {
    if (allowed) refresh();
  }, [allowed, refresh]);

  // Strefy do celów scenariuszy (zakaz i parkowanie); bez `zones.read` lista jest pusta.
  useEffect(() => {
    if (!allowed || !can('zones.read')) return;
    api<ListResponse<ZoneListItem>>('/admin/zones?active=true&pageSize=100')
      .then((r) => setZones(r.items))
      .catch(() => setZones([]));
  }, [allowed, can]);

  // „Stan sprzed N s” i czas trwania scenariuszy co sekundę.
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, []);

  const resultTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const live = useStaffFeed(
    allowed
      ? {
          simulatorStatus: (status) => setOverview((prev) => (prev ? { ...prev, ...status } : prev)),
          simulatorResult: (result: SimulatorResult) => {
            const label = sent.current.get(result.commandId);
            if (label) {
              sent.current.delete(result.commandId);
              setNotice(
                result.ok
                  ? { kind: 'ok', text: t('simulator.result.ok', { command: label }) }
                  : {
                      kind: 'danger',
                      text: t('simulator.result.failed', {
                        command: label,
                        reason: t.dynamic(`simulator.reasons.${result.reason ?? 'unknown'}`),
                      }),
                    },
              );
            }
            // Ostatnie polecenia z wynikami są w API; odświeżenie po chwili zbiera kilka wyników naraz.
            if (resultTimer.current) clearTimeout(resultTimer.current);
            resultTimer.current = setTimeout(refresh, 500);
          },
          reconnected: refresh,
        }
      : {},
  );
  useEffect(() => () => void (resultTimer.current && clearTimeout(resultTimer.current)), []);

  const zoneLabel = (zoneId: unknown) => {
    const zone = zones.find((z) => z.id === zoneId);
    return zone ? `${zone.code} ${zone.name}` : t('simulator.unknownZone');
  };

  const send = async (request: SimulatorCommandRequest, label: string) => {
    setNotice(null);
    try {
      const accepted = await api<SimulatorCommandAccepted>('/admin/simulator/commands', {
        method: 'POST',
        json: request,
      });
      sent.current.set(accepted.commandId, label);
      setNotice({ kind: 'ok', text: t('simulator.result.sent', { command: label }) });
      refresh();
    } catch (e) {
      setNotice({ kind: 'danger', text: errorMessage(e) });
    }
  };

  if (!allowed) return <Banner kind="danger">{t('error.FORBIDDEN')}</Banner>;
  if (load.status === 'unavailable')
    return (
      <div className="card state">
        <div className="icon">
          <ChipIcon size={22} />
        </div>
        <h2>{t('simulator.unavailable.title')}</h2>
        <p>{t('simulator.unavailable.body')}</p>
      </div>
    );
  if (load.status === 'error') return <Banner kind="danger">{load.message}</Banner>;
  if (!overview) return <div className="card" aria-busy="true" />;

  const status = overview.status?.online ? overview.status : null;
  const lastAt = status?.updatedAt
    ? Date.parse(status.updatedAt)
    : overview.receivedAt
      ? Date.parse(overview.receivedAt)
      : null;
  const ageSeconds = lastAt === null ? null : Math.max(0, Math.round((now - lastAt) / 1000));
  const stale = overview.stale || lastAt === null || now - lastAt > SIMULATOR_STALE_AFTER_MS || status === null;
  const scenarios = status?.scenarios ?? [];
  const disconnected = scenarios.filter((s) => s.kind === 'disconnect').length;

  const commandLabel = (c: Pick<SimulatorCommandView, 'action' | 'scooter' | 'params'>) => {
    const params = c.params as { zoneId?: string; point?: { lat: number; lon: number } };
    const target = params.zoneId ? zoneLabel(params.zoneId) : params.point ? t('simulator.point') : '';
    return t.dynamic(`simulator.commandLabel.${c.action}`, { scooter: scooterNumber(c.scooter), target });
  };

  return (
    <>
      <div className="page-head">
        <div>
          <h1>{t('simulator.title')}</h1>
          <div className="sub">{t('simulator.subtitle')}</div>
        </div>
        <div className="actions sim-state">
          {stale ? (
            <span className="bad strong-500">
              <WarningIcon size={15} />
              {status === null && overview.status ? t('simulator.offline') : t('simulator.stale')}
            </span>
          ) : (
            <span className={live ? 'live' : 'live off'}>
              {t('simulator.runningSince', { duration: uptime(status?.since ?? null, now) })}
            </span>
          )}
          {ageSeconds !== null && <span className="small">{t('simulator.stateAge', { seconds: ageSeconds })}</span>}
        </div>
      </div>

      <div className="notice warn sim-dev">
        <span className="ic">
          <WarningIcon size={15} />
        </span>
        <span>
          <b>{t('simulator.devOnly.title')}</b> {t('simulator.devOnly.body')}
        </span>
      </div>

      {notice && <Banner kind={notice.kind}>{notice.text}</Banner>}

      <div className="sim-kpis">
        <Kpi
          label={t('simulator.kpi.connected')}
          value={
            status
              ? t('simulator.kpi.connectedValue', { connected: status.connected, total: status.fleetSize })
              : t('common.none')
          }
          sub={t('simulator.kpi.connectedSub', { count: disconnected })}
        />
        <Kpi
          label={t('simulator.kpi.telemetry')}
          value={
            status
              ? t('simulator.kpi.telemetryValue', { value: Math.round(status.messagesPerSecond) })
              : t('common.none')
          }
          sub={
            status?.telemetryIntervalMs
              ? t('simulator.kpi.telemetrySub', { seconds: status.telemetryIntervalMs / 1000 })
              : t('simulator.kpi.telemetryNoInterval')
          }
        />
        <Kpi
          label={t('simulator.kpi.rides')}
          value={status ? String(status.riding) : t('common.none')}
          sub={
            status?.ridesStarted !== undefined
              ? t('simulator.kpi.ridesSub', { started: status.ridesStarted })
              : t('simulator.kpi.ridesPerHour', { value: Math.round(status?.ridesPerHour ?? 0) })
          }
        />
        <Kpi
          label={t('simulator.kpi.commands')}
          value={
            status?.commandsReceived !== undefined
              ? t('notifications.tabs.count', { count: status.commandsReceived })
              : t('common.none')
          }
          sub={t('simulator.kpi.commandsSub', { count: status?.commandsUnacked ?? 0 })}
        />
      </div>

      <div className="sim-layout">
        <NewScenario zones={zones} disabled={stale} onSend={send} commandLabel={commandLabel} />

        <div className="sim-side">
          <section className="card sim-card">
            <div className="sim-card-head">
              <h2>{t('simulator.active.title')}</h2>
              {live && <span className="live">{t('simulator.active.live')}</span>}
            </div>
            {scenarios.length === 0 && <p className="small sim-empty">{t('simulator.active.none')}</p>}
            {scenarios.map((s) => (
              <ActiveScenario
                key={`${s.scooter}-${s.kind}`}
                scenario={s}
                now={now}
                zoneLabel={zoneLabel}
                onStop={() => {
                  const action = STOP_ACTION[s.kind];
                  const request = { scooter: s.scooter, action, params: {} } as SimulatorCommandRequest;
                  void send(request, commandLabel({ action, scooter: s.scooter, params: {} }));
                }}
              />
            ))}
          </section>

          <section className="card sim-card grow">
            <div className="sim-card-head">
              <h2>{t('simulator.recent.title')}</h2>
              {can('audit.read') && (
                <Link className="link" href="/admin/dziennik?action=simulator.command">
                  {t('simulator.recent.audit')}
                </Link>
              )}
            </div>
            {overview.commands.length === 0 && <p className="small sim-empty">{t('simulator.recent.none')}</p>}
            {overview.commands.map((c) => (
              <div key={c.commandId} className="sim-log">
                <span className="num">{formatTime(c.at)}</span>
                <span className="ellipsis">{c.staffName ?? t('audit.system')}</span>
                <span className="ellipsis">{commandLabel(c)}</span>
                <CommandResultPill result={c.result} expiresAt={c.expiresAt} now={now} />
              </div>
            ))}
          </section>
        </div>
      </div>
    </>
  );
}

/** „2 h 14 min” od startu symulatora. */
function uptime(since: string | null, now: number): string {
  if (!since) return t('common.none');
  const minutes = Math.max(0, Math.floor((now - Date.parse(since)) / 60_000));
  return t('simulator.uptime', { hours: Math.floor(minutes / 60), minutes: minutes % 60 });
}

function Kpi({ label, value, sub }: { label: string; value: string; sub: string }) {
  return (
    <div className="kpi">
      <span className="l">{label}</span>
      <span className="v">{value}</span>
      <span className="s">{sub}</span>
    </div>
  );
}

function CommandResultPill({
  result,
  expiresAt,
  now,
}: {
  result: SimulatorCommandView['result'];
  expiresAt: string;
  now: number;
}) {
  if (result?.ok) return <span className="pill sm">{t('simulator.recent.ok')}</span>;
  if (result)
    return (
      <span className="pill sm danger" title={t.dynamic(`simulator.reasons.${result.reason ?? 'unknown'}`)}>
        {t('simulator.recent.failed')}
      </span>
    );
  if (Date.parse(expiresAt) < now) return <span className="pill sm muted">{t('simulator.recent.noResult')}</span>;
  return <span className="pill sm accent">{t('simulator.recent.waiting')}</span>;
}

function ActiveScenario({
  scenario,
  now,
  zoneLabel,
  onStop,
}: {
  scenario: SimulatorScenario;
  now: number;
  zoneLabel: (zoneId: unknown) => string;
  onStop: () => void;
}) {
  const { kind, progress, target } = scenario;
  const elapsed = formatDuration((now - Date.parse(scenario.startedAt)) / 1000);
  const targetLabel = target?.code ?? (target?.zoneId ? zoneLabel(target.zoneId) : t('simulator.point'));
  const title = t.dynamic(`simulator.active.kind.${kind}`, { target: targetLabel });
  let detail: string;
  switch (kind) {
    case 'drain':
      detail = t('simulator.active.drain', {
        battery: Math.round(progress.batteryPct ?? 0),
        target: progress.targetPct ?? DRAIN.targetPct,
        seconds: Math.round(progress.remainingS ?? 0),
      });
      break;
    case 'silence':
      detail = t('simulator.active.silence', { elapsed, count: progress.unackedCommands ?? 0 });
      break;
    case 'goto':
    case 'enter_no_ride':
      detail =
        progress.remainingM !== undefined
          ? t('simulator.active.remaining', { meters: Math.round(progress.remainingM) })
          : elapsed;
      break;
    default:
      detail = elapsed;
  }
  const restore = kind === 'disconnect' || kind === 'silence';
  return (
    <div className="arow">
      <span className="mono">{scooterNumber(scenario.scooter)}</span>
      <span className="stack grow">
        <span className="strong-500">{title}</span>
        <span className="small">{detail}</span>
      </span>
      {kind === 'drain' && progress.batteryPct !== undefined && (
        <span className="sim-bar" aria-hidden="true">
          <span style={{ width: `${Math.min(100, Math.max(0, progress.batteryPct))}%` }} />
        </span>
      )}
      <button type="button" className="btn sm-btn" onClick={onStop}>
        {restore ? <RestoreIcon size={14} /> : <SquareIcon size={14} />}
        {restore ? t('simulator.active.restore') : t('simulator.active.stop')}
      </button>
    </div>
  );
}

// ---------------------------------------------------------------------------------------------
// Nowy scenariusz
// ---------------------------------------------------------------------------------------------

interface NewScenarioProps {
  zones: ZoneListItem[];
  disabled: boolean;
  onSend: (request: SimulatorCommandRequest, label: string) => Promise<void>;
  commandLabel: (c: Pick<SimulatorCommandView, 'action' | 'scooter' | 'params'>) => string;
}

function NewScenario({ zones, disabled, onSend, commandLabel }: NewScenarioProps) {
  const [scooter, setScooter] = useState<ScooterListItem | null>(null);
  const [scenario, setScenario] = useState<Scenario>('disconnect');
  const [noRideZone, setNoRideZone] = useState('');
  const [gotoMode, setGotoMode] = useState<'zone' | 'point'>('zone');
  const [gotoZone, setGotoZone] = useState('');
  const [lat, setLat] = useState('');
  const [lon, setLon] = useState('');
  const [busy, setBusy] = useState(false);

  const noRide = zones.filter((z) => z.type === 'NO_RIDE');
  const targets = zones.filter((z) => z.type !== 'SERVICE_AREA');
  const noRideId = noRideZone || noRide[0]?.id || '';
  const gotoId = gotoZone || targets.find((z) => z.type === 'PARKING')?.id || '';
  const point = { lat: Number(lat.replace(',', '.')), lon: Number(lon.replace(',', '.')) };
  const pointValid =
    lat.trim() !== '' &&
    lon.trim() !== '' &&
    Math.abs(point.lat) <= 90 &&
    Math.abs(point.lon) <= 180 &&
    !Number.isNaN(point.lat + point.lon);

  const request = (): SimulatorCommandRequest | null => {
    if (!scooter) return null;
    const n = scooter.number;
    switch (scenario) {
      case 'disconnect':
      case 'silence':
        return { scooter: n, action: scenario, params: {} };
      case 'drain':
        return { scooter: n, action: 'drain', params: DRAIN };
      case 'enter_no_ride':
        return noRideId ? { scooter: n, action: 'enter_no_ride', params: { zoneId: noRideId } } : null;
      case 'goto':
        if (gotoMode === 'zone') return gotoId ? { scooter: n, action: 'goto', params: { zoneId: gotoId } } : null;
        return pointValid ? { scooter: n, action: 'goto', params: { point } } : null;
    }
  };
  const ready = request();
  const zoneName = (id: string) => zones.find((z) => z.id === id);
  const noRideTarget = zoneName(noRideId);

  const submit = async () => {
    if (!ready) return;
    setBusy(true);
    await onSend(ready, commandLabel(ready));
    setBusy(false);
  };

  return (
    <section className="card sim-new">
      <div className="sim-card-head">
        <h2>{t('simulator.new.title')}</h2>
        <span className="small">{t('simulator.new.oneAtATime')}</span>
      </div>
      <ScooterPicker value={scooter} onChange={setScooter} />

      <div role="radiogroup" aria-label={t('simulator.new.scenario')} className="sc-grid">
        {SCENARIOS.map(({ key, Icon }) => (
          <label key={key} className={key === 'goto' ? 'sc wide' : 'sc'}>
            <input type="radio" name="scenario" checked={scenario === key} onChange={() => setScenario(key)} />
            <span className="ic2">
              <Icon size={16} />
            </span>
            <span className="stack grow">
              <span className="sc-title">{t.dynamic(`simulator.scenario.${key}.title`, DRAIN)}</span>
              <span className="small sc-body">
                {t.dynamic(`simulator.scenario.${key}.body`, {
                  zone: noRideTarget ? `${noRideTarget.code} ${noRideTarget.name}` : t('simulator.unknownZone'),
                })}
              </span>
              {key === 'enter_no_ride' && scenario === key && noRide.length > 1 && (
                <select
                  className="mini-select"
                  value={noRideId}
                  aria-label={t('simulator.new.noRideZone')}
                  onChange={(e) => setNoRideZone(e.target.value)}
                >
                  {noRide.map((z) => (
                    <option key={z.id} value={z.id}>
                      {z.code} {z.name}
                    </option>
                  ))}
                </select>
              )}
              {key === 'goto' && (
                <span className={scenario === 'goto' ? 'sc-target' : 'sc-target off'}>
                  <span className="zc-seg sc-seg" role="radiogroup" aria-label={t('simulator.new.targetKind')}>
                    {(['zone', 'point'] as const).map((m) => (
                      <button
                        key={m}
                        type="button"
                        role="radio"
                        aria-checked={gotoMode === m}
                        disabled={scenario !== 'goto'}
                        onClick={() => setGotoMode(m)}
                      >
                        {t.dynamic(`simulator.new.target.${m}`)}
                      </button>
                    ))}
                  </span>
                  {gotoMode === 'zone' ? (
                    <select
                      className="mini-select"
                      value={gotoId}
                      disabled={scenario !== 'goto'}
                      aria-label={t('simulator.new.targetZone')}
                      onChange={(e) => setGotoZone(e.target.value)}
                    >
                      {targets.map((z) => (
                        <option key={z.id} value={z.id}>
                          {z.code} {z.name}
                        </option>
                      ))}
                    </select>
                  ) : (
                    <>
                      <input
                        className="mini-select num"
                        inputMode="decimal"
                        value={lat}
                        disabled={scenario !== 'goto'}
                        placeholder={t('simulator.new.lat')}
                        aria-label={t('simulator.new.lat')}
                        onChange={(e) => setLat(e.target.value)}
                      />
                      <input
                        className="mini-select num"
                        inputMode="decimal"
                        value={lon}
                        disabled={scenario !== 'goto'}
                        placeholder={t('simulator.new.lon')}
                        aria-label={t('simulator.new.lon')}
                        onChange={(e) => setLon(e.target.value)}
                      />
                    </>
                  )}
                </span>
              )}
            </span>
          </label>
        ))}
      </div>

      <div className="sim-foot">
        <span className="small">
          {scooter
            ? t('simulator.new.footer', { action: scenario, scooter: pad(scooter.number) })
            : t('simulator.new.pickScooter')}
        </span>
        <button
          type="button"
          className="btn primary"
          disabled={!ready || busy || disabled}
          onClick={() => void submit()}
        >
          <PlayIcon size={15} />
          {scooter ? t('simulator.new.run', { scooter: scooterNumber(scooter.number) }) : t('simulator.new.runEmpty')}
        </button>
      </div>
    </section>
  );
}

/** Wybór hulajnogi: numer albo fragment numeru seryjnego, podpowiedzi z listy floty (`scooters.read`). */
function ScooterPicker({
  value,
  onChange,
}: {
  value: ScooterListItem | null;
  onChange: (s: ScooterListItem | null) => void;
}) {
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<ScooterListItem[]>([]);
  const [open, setOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    const controller = new AbortController();
    const timer = setTimeout(() => {
      const q = query.trim().replace(/^#/, '');
      api<ListResponse<ScooterListItem>>(`/admin/scooters?pageSize=10${q ? `&q=${encodeURIComponent(q)}` : ''}`, {
        signal: controller.signal,
      })
        .then((r) => {
          setResults(r.items);
          setError(null);
        })
        .catch((e: unknown) => {
          if ((e as Error).name !== 'AbortError') setError(errorMessage(e));
        });
    }, 200);
    return () => {
      clearTimeout(timer);
      controller.abort();
    };
  }, [query, open]);

  const describe = (s: ScooterListItem) =>
    [
      t.dynamic(`fleetStatus.${s.fleetStatus}`).toLowerCase(),
      s.batteryPct !== null ? t('simulator.picker.battery', { value: s.batteryPct }) : null,
      s.parkingZoneCode ? `${s.parkingZoneCode} ${s.parkingZoneName ?? ''}`.trim() : null,
    ]
      .filter(Boolean)
      .join(' · ');

  return (
    <div className="field sim-picker">
      <label className="label" htmlFor="sim-scooter">
        {t('simulator.picker.label')}
      </label>
      <div className="picker-box">
        <SearchIcon size={16} />
        <input
          id="sim-scooter"
          className="picker-input"
          value={open ? query : value ? scooterNumber(value.number) : query}
          placeholder={t('simulator.picker.placeholder')}
          role="combobox"
          aria-expanded={open}
          aria-controls="sim-scooter-list"
          aria-autocomplete="list"
          onFocus={() => {
            setOpen(true);
            setQuery('');
          }}
          onBlur={() => setTimeout(() => setOpen(false), 150)}
          onChange={(e) => setQuery(e.target.value)}
        />
        {value && !open && <span className="small ellipsis">{` · ${describe(value)}`}</span>}
      </div>
      {open && (
        <ul id="sim-scooter-list" className="picker-list" role="listbox">
          {error && <li className="small bad">{error}</li>}
          {results.map((s) => (
            <li key={s.id} role="option" aria-selected={value?.id === s.id}>
              <button
                type="button"
                onMouseDown={(e) => e.preventDefault()}
                onClick={() => {
                  onChange(s);
                  setOpen(false);
                }}
              >
                <span className="mono">{scooterNumber(s.number)}</span>
                <span className="small ellipsis">{describe(s)}</span>
                {!s.online && <AlertIcon size={14} />}
              </button>
            </li>
          ))}
          {!error && results.length === 0 && <li className="small sim-empty">{t('simulator.picker.none')}</li>}
        </ul>
      )}
    </div>
  );
}
