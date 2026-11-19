'use client';

/**
 * Flota → Telemetria (ADR 0076, makieta flota-telemetria): wyjątek od kontraktu list. Hulajnoga i zakres czasu są
 * wymagane (15 min, 1 h, 6 h, 24 h albo własny do 24 h w oknie retencji 90 dni), strony idą kursorem („Nowsze”,
 * „Starsze”) bez liczby wszystkich odczytów, a przerwa między odczytami (odstęp z `lag()` w bazie) ma własny wiersz.
 * Stan ekranu jest w adresie URL, więc odnośnik z karty hulajnogi otwiera od razu jej odczyty.
 */
import {
  TELEMETRY_MAX_RANGE_HOURS,
  TELEMETRY_PAGE_SIZE,
  telemetryReadingsResource,
  type ListResponse,
  type ScooterDetails,
  type ScooterListItem,
  type TelemetryReadingsPage,
  type TelemetryReadingView,
} from '@hulajnogi/shared';
import Link from 'next/link';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { Fragment, useEffect, useMemo, useRef, useState } from 'react';
import { api, ApiRequestError, errorMessage } from '../../../lib/api';
import { formatClock, formatDate, formatDateTime, formatTime, isToday, t } from '../../../lib/i18n';
import { useSession } from '../../../lib/session';
import { FleetTabs, useFleetSubtitle } from '../areas';
import {
  AlertIcon,
  BatteryIcon,
  ChevronDownIcon,
  ChevronRightIcon,
  InfoIcon,
  RouteIcon,
  ScooterIcon,
  SearchIcon,
  WifiOffIcon,
} from '../icons';
import { ExportButton } from '../list-export';
import { durationText } from '../list-format';
import { Battery, rentalNumber, scooterNumber } from './fleet-format';

const RANGES = { '15m': 15, '1h': 60, '6h': 360, '24h': 1440 } as const;
type RangeKey = keyof typeof RANGES | 'custom';
/** Próg baterii filtra „Bateria poniżej” (makieta: [20]%). */
const LOW_BATTERY_PCT = 20;
/** Odstęp, od którego wiersz przerwy pokazuje brak odczytów (hulajnoga wysyła co ok. 5 s). */
const GAP_SECONDS = 30;
const KEEP_DAYS = 90;
const MAX_EXPORT_ROWS = (TELEMETRY_MAX_RANGE_HOURS * 3600) / 5;

const EXPORT_COLUMNS = [
  'recordedAt',
  'lat',
  'lon',
  'batteryPct',
  'speedKmh',
  'rentalNumber',
  'locked',
  'buffered',
  'gapSeconds',
] as const;

/** `datetime-local` w czasie przeglądarki ↔ ISO. */
const toLocalInput = (iso: string) => {
  const d = new Date(iso);
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
};
const fromLocalInput = (value: string) => (value ? new Date(value).toISOString() : '');

/** „dziś” albo „18 lis” (czas polski). */
const dayText = (iso: string) => (isToday(iso) ? t('fleetLists.telemetry.today') : formatDate(iso));
const sameDay = (a: string, b: string) => formatDate(a) === formatDate(b);

const shortDate = new Intl.DateTimeFormat('pl', { dateStyle: 'short', timeZone: 'Europe/Warsaw' });
/** „19.11.2026, 14:35:05” jak w makiecie. */
const fullTime = (iso: string) =>
  t('fleetLists.telemetry.readingAt', { date: shortDate.format(new Date(iso)), time: formatTime(iso) });

interface Params {
  scooterId: string | null;
  range: RangeKey;
  from: string | null;
  to: string | null;
  battery: boolean;
  ride: boolean;
  cursor: string | null;
  dir: 'older' | 'newer';
}

function readParams(sp: URLSearchParams): Params {
  const range = sp.get('range');
  return {
    scooterId: sp.get('scooterId'),
    range: range && (range in RANGES || range === 'custom') ? (range as RangeKey) : '1h',
    from: sp.get('from'),
    to: sp.get('to'),
    battery: sp.get('battery') === '1',
    ride: sp.get('ride') === '1',
    cursor: sp.get('cursor'),
    dir: sp.get('dir') === 'newer' ? 'newer' : 'older',
  };
}

function rangeError(from: string | null, to: string | null): string | null {
  if (!from || !to) return t('fleetLists.telemetry.rangeRequired');
  const a = Date.parse(from);
  const b = Date.parse(to);
  if (!(b > a)) return t('fleetLists.telemetry.rangeOrder');
  if (b - a > TELEMETRY_MAX_RANGE_HOURS * 3_600_000)
    return t('fleetLists.telemetry.rangeTooLong', { hours: TELEMETRY_MAX_RANGE_HOURS });
  if (a < Date.now() - KEEP_DAYS * 86_400_000) return t('fleetLists.telemetry.rangeRetention', { days: KEEP_DAYS });
  return null;
}

type State =
  | { status: 'idle' }
  | { status: 'loading' }
  | { status: 'error'; message: string }
  | { status: 'ready'; data: TelemetryReadingsPage };

export function TelemetryPage() {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const { can } = useSession();
  const subtitle = useFleetSubtitle();
  const p = useMemo(() => readParams(new URLSearchParams(searchParams)), [searchParams]);
  const [state, setState] = useState<State>({ status: 'idle' });
  const [notice, setNotice] = useState<string | null>(null);
  const [customFrom, setCustomFrom] = useState(p.from ? toLocalInput(p.from) : '');
  const [customTo, setCustomTo] = useState(p.to ? toLocalInput(p.to) : '');

  const update = (next: Partial<Params>, resetCursor = true) => {
    const merged: Params = { ...p, ...next, ...(resetCursor ? { cursor: null, dir: 'older' as const } : {}) };
    const sp = new URLSearchParams();
    if (merged.scooterId) sp.set('scooterId', merged.scooterId);
    sp.set('range', merged.range);
    if (merged.from) sp.set('from', merged.from);
    if (merged.to) sp.set('to', merged.to);
    if (merged.battery) sp.set('battery', '1');
    if (merged.ride) sp.set('ride', '1');
    if (merged.cursor) sp.set('cursor', merged.cursor);
    if (merged.cursor && merged.dir === 'newer') sp.set('dir', 'newer');
    router.replace(`${pathname}?${sp}`, { scroll: false });
  };

  const setRange = (range: RangeKey) => {
    if (range === 'custom') {
      const to = p.to ?? new Date().toISOString();
      const from = p.from ?? new Date(Date.parse(to) - 3_600_000).toISOString();
      setCustomFrom(toLocalInput(from));
      setCustomTo(toLocalInput(to));
      update({ range, from, to });
      return;
    }
    const to = new Date();
    update({ range, from: new Date(to.getTime() - RANGES[range] * 60_000).toISOString(), to: to.toISOString() });
  };

  // Pierwsze wejście bez zakresu: ostatnia godzina od teraz.
  useEffect(() => {
    if (!p.from || !p.to) setRange(p.range === 'custom' ? '1h' : p.range);
    // Tylko przy braku zakresu w adresie (pozostałe zależności celowo pominięte).
  }, [p.from, p.to]);

  const invalid = rangeError(p.from, p.to);
  const query = useMemo(() => {
    if (!p.scooterId || !p.from || !p.to || invalid) return null;
    const sp = new URLSearchParams({ scooterId: p.scooterId, from: p.from, to: p.to });
    if (p.battery) sp.set('batteryBelow', String(LOW_BATTERY_PCT));
    if (p.ride) sp.set('inRide', 'true');
    return sp;
  }, [p.scooterId, p.from, p.to, p.battery, p.ride, invalid]);

  useEffect(() => {
    if (!query) {
      setState({ status: 'idle' });
      return;
    }
    const controller = new AbortController();
    const sp = new URLSearchParams(query);
    sp.set('pageSize', String(TELEMETRY_PAGE_SIZE));
    if (p.cursor) {
      sp.set('cursor', p.cursor);
      sp.set('direction', p.dir);
    }
    setState({ status: 'loading' });
    api<TelemetryReadingsPage>(`/admin/telemetry?${sp}`, { signal: controller.signal })
      .then((data) => setState({ status: 'ready', data }))
      .catch((error: unknown) => {
        if ((error as Error).name !== 'AbortError') setState({ status: 'error', message: errorMessage(error) });
      });
    return () => controller.abort();
  }, [query, p.cursor, p.dir]);

  const data = state.status === 'ready' ? state.data : null;
  const items = data?.items ?? [];
  const exportParams: Record<string, string> = query ? Object.fromEntries(query.entries()) : {};
  const filtersText = [
    p.battery && t('fleetLists.telemetry.batteryBelow', { pct: LOW_BATTERY_PCT }),
    p.ride && t('fleetLists.telemetry.inRide'),
  ].filter((x): x is string => Boolean(x));
  const grid = '190px minmax(0,1fr) 130px 120px 110px 120px';

  return (
    <>
      <div className="page-head">
        <div>
          <h1>{t('resource.scooters.title')}</h1>
          {subtitle && <div className="sub">{subtitle}</div>}
        </div>
        <div className="actions">
          {query && p.from && p.to && (
            <ExportButton
              resource={telemetryReadingsResource}
              endpoint="/admin/telemetry/export"
              params={exportParams}
              rows={null}
              rowsText={t('fleetLists.telemetry.exportRows', { max: MAX_EXPORT_ROWS })}
              filters={[
                t('fleetLists.telemetry.exportRange', {
                  from: formatDateTime(p.from),
                  to: formatDateTime(p.to),
                }),
                ...filtersText,
              ]}
              sort={t('fleetLists.telemetry.sort')}
              columns={EXPORT_COLUMNS}
              onDone={(file) => setNotice(t('listExport.done', { file }))}
            />
          )}
        </div>
      </div>
      <FleetTabs />

      {!can('telemetry.read') ? (
        <div className="banner danger" role="alert">
          {t('error.FORBIDDEN')}
        </div>
      ) : (
        <>
          <div className="tm-bar">
            <div className="field tm-scooter">
              <span className="label">
                {t('fleetLists.telemetry.scooter')} <span className="req">{t('fleetLists.telemetry.required')}</span>
              </span>
              <ScooterPicker value={p.scooterId} onChange={(scooterId) => update({ scooterId })} />
            </div>
            <div className="field">
              <span className="label" id="tm-range">
                {t('fleetLists.telemetry.range')} <span className="req">{t('fleetLists.telemetry.required')}</span>
              </span>
              <span className="tm-range">
                <span className="zc-seg tm-seg" role="radiogroup" aria-labelledby="tm-range">
                  {(['15m', '1h', '6h', '24h', 'custom'] as const).map((key) => (
                    <button
                      key={key}
                      type="button"
                      role="radio"
                      aria-checked={p.range === key}
                      onClick={() => setRange(key)}
                    >
                      {t.dynamic(`fleetLists.telemetry.ranges.${key}`)}
                    </button>
                  ))}
                </span>
                {p.from && p.to && (
                  <span className="hint num">
                    {sameDay(p.from, p.to)
                      ? t('fleetLists.telemetry.rangeText', {
                          day: dayText(p.to),
                          from: formatClock(p.from),
                          to: formatClock(p.to),
                        })
                      : t('fleetLists.telemetry.rangeTextDays', {
                          from: `${dayText(p.from)}, ${formatClock(p.from)}`,
                          to: `${dayText(p.to)}, ${formatClock(p.to)}`,
                        })}
                  </span>
                )}
              </span>
            </div>
            <span className="spacer" />
            <button
              type="button"
              className="chip"
              aria-pressed={p.battery}
              onClick={() => update({ battery: !p.battery })}
            >
              <BatteryIcon size={16} />
              {t('fleetLists.telemetry.batteryBelow', { pct: LOW_BATTERY_PCT })}
            </button>
            <button type="button" className="chip" aria-pressed={p.ride} onClick={() => update({ ride: !p.ride })}>
              <RouteIcon size={16} />
              {t('fleetLists.telemetry.inRide')}
            </button>
          </div>

          {p.range === 'custom' && (
            <div className="tm-custom">
              <label className="field">
                <span className="label">{t('list.from')}</span>
                <input
                  className="input"
                  type="datetime-local"
                  value={customFrom}
                  onChange={(e) => setCustomFrom(e.target.value)}
                />
              </label>
              <label className="field">
                <span className="label">{t('list.to')}</span>
                <input
                  className="input"
                  type="datetime-local"
                  value={customTo}
                  onChange={(e) => setCustomTo(e.target.value)}
                />
              </label>
              <button
                type="button"
                className="btn primary"
                disabled={!customFrom || !customTo}
                onClick={() => update({ from: fromLocalInput(customFrom), to: fromLocalInput(customTo) })}
              >
                {t('fleetLists.telemetry.applyRange')}
              </button>
              <span className="hint">{t('fleetLists.telemetry.customHint', { hours: TELEMETRY_MAX_RANGE_HOURS })}</span>
            </div>
          )}

          <div className="tm-meta">
            <span className="tm-ro">
              <InfoIcon size={14} />
              {t('fleetLists.telemetry.readOnly', { days: KEEP_DAYS })}
            </span>
            <span className="summary">{t('fleetLists.telemetry.sortInfo')}</span>
          </div>

          {notice && (
            <div className="banner ok" role="status">
              <span>{notice}</span>
            </div>
          )}

          <div className="card" aria-busy={state.status === 'loading'}>
            {!p.scooterId ? (
              <div className="state">
                <div className="icon">
                  <ScooterIcon size={22} />
                </div>
                <h2>{t('fleetLists.telemetry.pickTitle')}</h2>
                <p>{t('fleetLists.telemetry.pickBody', { hours: TELEMETRY_MAX_RANGE_HOURS })}</p>
              </div>
            ) : invalid ? (
              <div className="state" role="alert">
                <div className="icon danger">
                  <AlertIcon />
                </div>
                <h2>{t('fleetLists.telemetry.invalidTitle')}</h2>
                <p>{invalid}</p>
              </div>
            ) : state.status === 'error' ? (
              <div className="state" role="alert">
                <div className="icon danger">
                  <AlertIcon />
                </div>
                <h2>{t('list.errorTitle')}</h2>
                <p>{state.message}</p>
              </div>
            ) : (
              <div className="table" role="table" aria-label={t('areas.fleet.telemetry')}>
                <div className="row head" role="row" style={{ gridTemplateColumns: grid }}>
                  <span role="columnheader" className="th-sort active">
                    {t('resource.telemetry.fields.recordedAt')}
                    <ChevronDownIcon size={14} />
                  </span>
                  <span role="columnheader">{t('fleetLists.telemetry.position')}</span>
                  <span role="columnheader">{t('resource.telemetry.fields.batteryPct')}</span>
                  <span role="columnheader">{t('resource.telemetry.fields.speedKmh')}</span>
                  <span role="columnheader">{t('resource.telemetry.fields.rentalNumber')}</span>
                  <span role="columnheader">{t('resource.telemetry.fields.gapSeconds')}</span>
                </div>
                {state.status === 'loading' && <div className="row" aria-busy="true" />}
                {data && items.length === 0 && (
                  <div className="state">
                    <div className="icon">
                      <SearchIcon size={22} />
                    </div>
                    <h2>{t('fleetLists.telemetry.emptyTitle')}</h2>
                    <p>{t('fleetLists.telemetry.emptyBody')}</p>
                  </div>
                )}
                {items.map((r, i) => (
                  <Fragment key={r.recordedAt}>
                    <ReadingRow reading={r} grid={grid} />
                    {r.gapSeconds !== null && r.gapSeconds >= GAP_SECONDS && (
                      <GapRow reading={r} previous={items[i + 1] ?? null} />
                    )}
                  </Fragment>
                ))}
              </div>
            )}

            {data && items.length > 0 && (
              <div className="pager">
                <div className="left">
                  <span className="num">
                    {t('fleetLists.telemetry.pageInfo', {
                      from: formatTime(items[items.length - 1]!.recordedAt),
                      to: formatTime(items[0]!.recordedAt),
                      count: TELEMETRY_PAGE_SIZE,
                    })}
                  </span>
                </div>
                <div className="right">
                  <button
                    type="button"
                    className="btn"
                    disabled={!data.newerCursor}
                    onClick={() => update({ cursor: data.newerCursor, dir: 'newer' }, false)}
                  >
                    <ChevronRightIcon size={14} style={{ transform: 'rotate(180deg)' }} />
                    {t('fleetLists.telemetry.newer')}
                  </button>
                  <button
                    type="button"
                    className="btn"
                    disabled={!data.olderCursor}
                    onClick={() => update({ cursor: data.olderCursor, dir: 'older' }, false)}
                  >
                    {t('fleetLists.telemetry.older')}
                    <ChevronRightIcon size={14} />
                  </button>
                </div>
              </div>
            )}
          </div>
          <p className="small tm-foot">{t('fleetLists.telemetry.footnote')}</p>
        </>
      )}
    </>
  );
}

function ReadingRow({ reading: r, grid }: { reading: TelemetryReadingView; grid: string }) {
  const gap = r.gapSeconds;
  return (
    <div className="row" role="row" style={{ gridTemplateColumns: grid }}>
      <span role="cell" className="num" title={formatDateTime(r.recordedAt)}>
        {fullTime(r.recordedAt)}
      </span>
      <span role="cell" className="num">
        {t('fleetLists.telemetry.coords', { lat: r.lat.toFixed(5), lon: r.lon.toFixed(5) })}
      </span>
      <span role="cell">
        <Battery pct={r.batteryPct} low={r.batteryPct !== null && r.batteryPct < LOW_BATTERY_PCT} />
      </span>
      <span role="cell" className="num">
        {r.speedKmh !== null ? t('fleetLists.telemetry.speed', { value: r.speedKmh }) : t('common.none')}
      </span>
      <span role="cell">
        {r.rentalId && r.rentalNumber !== null ? (
          <Link href={`/admin/przejazdy/${r.rentalId}`} className="link num">
            {rentalNumber(r.rentalNumber)}
          </Link>
        ) : (
          <span className="muted">{t('common.none')}</span>
        )}
      </span>
      <span role="cell" className={gap !== null && gap >= GAP_SECONDS ? 'num tm-gap' : 'num'}>
        {gap === null ? t('common.none') : durationText(gap)}
      </span>
    </div>
  );
}

/** Wiersz przerwy: odczyt ma odstęp od poprzedniego (starszego) powyżej progu. */
function GapRow({ reading, previous }: { reading: TelemetryReadingView; previous: TelemetryReadingView | null }) {
  const end = reading.recordedAt;
  const start = previous?.recordedAt ?? new Date(Date.parse(end) - (reading.gapSeconds ?? 0) * 1000).toISOString();
  return (
    <div className="tm-gap-row" role="row">
      <WifiOffIcon size={16} />
      <span role="cell">
        <b>{t('fleetLists.telemetry.gapTitle', { duration: durationText(reading.gapSeconds ?? 0) })}</b>
        {' · '}
        {t('fleetLists.telemetry.gapBody', { from: formatTime(start), to: formatTime(end) })}
      </span>
    </div>
  );
}

/** Wybór hulajnogi z wyszukiwaniem po numerze (lista floty), z bieżącym stanem i przejazdem w podpowiedzi. */
function ScooterPicker({ value, onChange }: { value: string | null; onChange: (id: string) => void }) {
  const [selected, setSelected] = useState<ScooterDetails | null>(null);
  const [open, setOpen] = useState(false);
  const [text, setText] = useState('');
  const [options, setOptions] = useState<ScooterListItem[]>([]);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!value) {
      setSelected(null);
      return;
    }
    if (selected?.id === value) return;
    api<ScooterDetails>(`/admin/scooters/${value}`)
      .then(setSelected)
      .catch((e: unknown) => {
        if (e instanceof ApiRequestError) setSelected(null);
      });
  }, [value, selected?.id]);

  useEffect(() => {
    if (!open) return;
    const controller = new AbortController();
    const timer = setTimeout(() => {
      const q = text.replace(/^#/, '').trim();
      api<ListResponse<ScooterListItem>>(
        `/admin/scooters?pageSize=10&sort=number${q ? `&q=${encodeURIComponent(q.replace(/^0+(?=\d)/, ''))}` : ''}`,
        { signal: controller.signal },
      )
        .then((r) => setOptions(r.items))
        .catch(() => undefined);
    }, 200);
    return () => {
      clearTimeout(timer);
      controller.abort();
    };
  }, [open, text]);

  useEffect(() => {
    if (!open) return;
    const close = (e: MouseEvent) => {
      if (!ref.current?.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', close);
    return () => document.removeEventListener('mousedown', close);
  }, [open]);

  return (
    <div className="tm-picker" ref={ref}>
      <label className="tm-picker-input">
        <SearchIcon size={16} />
        <span className="visually-hidden">{t('fleetLists.telemetry.scooter')}</span>
        <input
          role="combobox"
          aria-expanded={open}
          aria-controls="tm-options"
          value={open ? text : selected ? scooterNumber(selected.number) : ''}
          placeholder={t('fleetLists.telemetry.scooterPlaceholder')}
          onFocus={() => {
            setText('');
            setOpen(true);
          }}
          onChange={(e) => setText(e.target.value)}
        />
        {!open && selected && <small className="tm-picker-state">{scooterHint(selected)}</small>}
        <ChevronDownIcon size={16} />
      </label>
      {open && (
        <ul className="tm-options" id="tm-options" role="listbox">
          {options.length === 0 && <li className="muted">{t('fleetLists.telemetry.noScooters')}</li>}
          {options.map((s) => (
            <li key={s.id} role="option" aria-selected={s.id === value}>
              <button
                type="button"
                onClick={() => {
                  setOpen(false);
                  setSelected(null);
                  onChange(s.id);
                }}
              >
                <span className="num strong">{scooterNumber(s.number)}</span>
                <small>{t.dynamic(`fleetStatus.${s.fleetStatus}`)}</small>
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function scooterHint(s: ScooterDetails): string {
  if (s.fleetStatus === 'IN_USE' && s.rentalNumber !== null)
    return t('fleetLists.telemetry.inRental', { rental: rentalNumber(s.rentalNumber) });
  return t.dynamic(`fleetStatus.${s.fleetStatus}`).toLowerCase();
}
