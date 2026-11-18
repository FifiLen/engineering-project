'use client';

/**
 * Szczegóły przejazdu (makieta przejazd-szczegoly, ADR 0036): trasa na mapie z licznikami, opłata według
 * wersji cennika, komendy MQTT przejazdu, oś czasu, klient i hulajnoga oraz zdalne zakończenie.
 * Zmiany przychodzą z pokoju `rentals`, a pozycja i prędkość hulajnogi z pokoju `fleet`.
 */
import { formatPln, scootersResource, topics, type FleetMapScooter, type ScooterDetails } from '@hulajnogi/shared';
import Link from 'next/link';
import { useEffect, useState, type ReactNode } from 'react';
import { api, errorMessage } from '../../../lib/api';
import {
  formatClock,
  formatDateTime,
  formatDuration,
  formatKm,
  formatRelative,
  formatTime,
  t,
} from '../../../lib/i18n';
import { useStaffFeed } from '../../../lib/realtime';
import { useSession } from '../../../lib/session';
import { Banner, initials } from '../access/common';
import { rentalNumber, scooterNumber } from '../fleet/fleet-format';
import { fileUrl } from '../service/service-format';
import { BellIcon, ChevronRightIcon, MapIcon, ScooterIcon, StopIcon, UndoIcon } from '../icons';
import { RentalSettlementCard, settlementPill } from './rental-settlement';
import { RefundDialog } from './refund-dialog';
import { valueLabel } from '../labels';
import { useRentalDetails } from './rental-data';
import {
  buildTimeline,
  CommandResponse,
  CommandResult,
  commandLabel,
  commandRows,
  customerName,
  liveCounters,
  problemPill,
  REMOTE_END_STATES,
  RentalStatePill,
  rentalProblem,
  RUNNING_STATES,
  Timeline,
  useNow,
} from './rental-parts';
import { RemoteEndDialog } from './remote-end-dialog';
import { RouteMap } from './route-map';

type LiveScooter = Pick<FleetMapScooter, 'lat' | 'lon' | 'speedKmh' | 'online' | 'lastSeenAt' | 'batteryPct'>;

export function RentalDetailsPage({ id }: { id: string }) {
  const { can } = useSession();
  const [revision, setRevision] = useState(0);
  const { rental, receivedAt, error, apply, refresh } = useRentalDetails(id, revision);
  const [scooter, setScooter] = useState<ScooterDetails | null>(null);
  const [live, setLive] = useState<LiveScooter | null>(null);
  const [ending, setEnding] = useState(false);
  const [refunding, setRefunding] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const scooterId = rental?.scooterId ?? null;

  const connected = useStaffFeed({
    rentals: (changed) => {
      if (changed.id === id) setRevision((n) => n + 1);
    },
    // Pozycja i prędkość z telemetrii tylko z uprawnieniem do floty; bez niego trasa odświeża się z REST.
    fleet: can('scooters.read')
      ? (updates) => {
          const update = updates.findLast((u) => u.id === scooterId);
          if (update) setLive((prev) => ({ ...prev, ...update, speedKmh: update.speedKmh ?? prev?.speedKmh ?? null }));
        }
      : undefined,
    reconnected: refresh,
  });

  // Wariant i ostatni sygnał hulajnogi z karty floty (szczegóły przejazdu ich nie zawierają).
  useEffect(() => {
    if (!scooterId || !can('scooters.read')) return;
    api<ScooterDetails>(`/admin/scooters/${scooterId}`)
      .then(setScooter)
      .catch(() => setScooter(null));
  }, [scooterId, can]);

  // Liczniki jazdy i „sygnał N s temu” odświeżane co sekundę.
  const now = useNow(rental !== null);

  if (!rental) return error ? <Banner kind="danger">{error}</Banner> : <div className="card" aria-busy="true" />;

  const counters = liveCounters(rental, receivedAt, now);
  const problem = rentalProblem(rental);
  const timeline = buildTimeline(rental);
  const commands = commandRows(rental);
  const open = RUNNING_STATES.includes(rental.state);
  const lat = live?.lat ?? rental.scooterLat;
  const lon = live?.lon ?? rental.scooterLon;
  // Zakończony przejazd kończy się na ostatnim punkcie trasy; hulajnoga mogła już odjechać z kolejnym klientem.
  const position: [number, number] | null = !open
    ? (rental.route.at(-1) ?? null)
    : lat != null && lon != null
      ? [lon, lat]
      : null;
  // Trasa z REST kończy się na ostatnim zapisanym punkcie; pozycja na żywo ją przedłuża do „Teraz”.
  const route = open && position && rental.route.length ? [...rental.route, position] : rental.route;
  const online = live?.online ?? rental.scooterOnline;
  const battery = live?.batteryPct ?? rental.scooterBatteryPct;
  const lastSeenAt = live?.lastSeenAt ?? scooter?.lastSeenAt ?? null;
  const number = rentalNumber(rental.number);
  // Opłata za odholowanie (ADR 0060): z zakończenia zdalnego albo z pozycji ceny.
  const towingFee = rental.towingFee ?? rental.price.towingFee ?? 0;
  const photo = rental.parkingPhoto ?? null;
  const showEnding = Boolean(rental.endMode || rental.billingStoppedAt || photo);

  const ring = () => {
    setActionError(null);
    api(`/admin/scooters/${rental.scooterId}/commands`, { method: 'POST', json: { type: 'RING' } })
      .then(() => setNotice(t('rentals.ringSent', { scooter: scooterNumber(rental.scooterNumber) })))
      .catch((e: unknown) => setActionError(errorMessage(e)));
  };

  const sub = [
    customerName(rental),
    `${t('rentals.scooter')} ${scooterNumber(rental.scooterNumber)}`,
    rental.reservedAt && t('rentals.sub.reserved', { date: formatDateTime(rental.reservedAt) }),
    rental.startedAt &&
      t('rentals.sub.unlocked', {
        time: rental.reservedAt ? formatClock(rental.startedAt) : formatDateTime(rental.startedAt),
      }),
    rental.endedAt && t('rentals.sub.ended', { time: formatClock(rental.endedAt) }),
  ].filter(Boolean);

  return (
    <>
      <div className="page-head">
        <div>
          <nav className="crumbs" aria-label={t('form.backToList')}>
            <Link href="/admin/przejazdy">{t('resource.rentals.title')}</Link>
            <span aria-hidden="true">/</span>
            <span>{number}</span>
          </nav>
          <h1 className="title-with-pills">
            {t('rentals.titleDetails', { number })}
            <span className="pill-row">
              <RentalStatePill state={rental.state} />
              {problem && problem.kind !== 'UNLOCK_FAILED' && <span className="pill warn">{problemPill(problem)}</span>}
            </span>
          </h1>
          <div className="sub">{sub.join(' · ')}</div>
        </div>
        <div className="actions">
          {can('scooters.command') && open && online && (
            <button type="button" className="btn" onClick={ring}>
              <BellIcon />
              {t('command.RING')}
            </button>
          )}
          {can('scooters.read') && (
            <Link className="btn" href={`/admin/mapa?hulajnoga=${rental.scooterId}`}>
              <MapIcon size={16} />
              {t('rentals.showOnMap')}
            </Link>
          )}
          {can('rentals.manage') && rental.refundable > 0 && (
            <button type="button" className="btn" onClick={() => setRefunding(true)}>
              <UndoIcon />
              {t('rentals.refund.open')}
            </button>
          )}
          {can('rentals.manage') && REMOTE_END_STATES.includes(rental.state) && (
            <button type="button" className="btn danger" onClick={() => setEnding(true)}>
              <StopIcon />
              {t('rentals.endRemotely')}
            </button>
          )}
        </div>
      </div>

      {notice && <Banner kind="ok">{notice}</Banner>}
      {(actionError ?? error) && <Banner kind="danger">{actionError ?? error}</Banner>}

      <div className="rental-layout">
        <div className="col">
          <section className="card route-card">
            <RouteMap route={route} position={position} ended={!open} label={t('rentals.map.label')} />
            <div className="glass map-chip">
              {open ? (
                <span className={connected ? 'live' : 'live off'}>{t('rentals.map.live')}</span>
              ) : (
                <span className="strong">{t('rentals.map.ended')}</span>
              )}
              <span className="muted">{t('rentals.map.fromTelemetry')}</span>
            </div>
            <div className="glass map-legend">
              <span>
                <i className="mk start" />
                {t('rentals.map.start')}
              </span>
              <span>
                <i className={open ? 'mk now' : 'mk end'} />
                {open ? t('rentals.map.now') : t('rentals.map.end')}
              </span>
            </div>
            <div className="glass map-stats stat-row">
              <Stat value={formatDuration(counters.rideSeconds)} label={t('rentals.stats.rideTime')} />
              <Stat value={formatDuration(counters.pauseSeconds)} label={t('rentals.stats.pause')} />
              <Stat value={formatKm(rental.distanceM)} label={t('rentals.stats.distance')} />
              {open && (
                <Stat
                  value={
                    live?.speedKmh != null ? t('common.kmh', { value: Math.round(live.speedKmh) }) : t('common.none')
                  }
                  label={t('rentals.stats.speed')}
                />
              )}
            </div>
          </section>

          <div className="rental-cards">
            <section className="card price-card">
              <div className="card-head">
                <h2>{t('rentals.price.title')}</h2>
                {settlementPill(rental)}
              </div>
              <div className="lines">
                <Line label={t('rentals.price.tariff')}>
                  <span>
                    <span className="strong">
                      {t('rentals.price.tariffVersion', { version: rental.tariff.version })}
                    </span>{' '}
                    <small className="muted">
                      {rental.reservedAt ? t('rentals.price.fromReservation') : t('rentals.price.fromUnlock')}
                    </small>
                  </span>
                </Line>
                <Line label={t('rentals.price.unlock')}>
                  <span className="num">{formatPln(rental.price.unlockFee)}</span>
                </Line>
                <Line label={t('rentals.price.ride', { minutes: rental.price.rideMinutes })}>
                  <span className="num">
                    {t('rentals.price.times', {
                      count: rental.price.rideMinutes,
                      rate: formatPln(rental.tariff.minuteRate),
                    })}
                  </span>
                </Line>
                <Line label={t('rentals.price.pause', { minutes: rental.price.pauseMinutes })}>
                  <span className="num">
                    {t('rentals.price.times', {
                      count: rental.price.pauseMinutes,
                      rate: formatPln(rental.tariff.pauseMinuteRate),
                    })}
                  </span>
                </Line>
                {towingFee > 0 && (
                  <Line label={t('rentals.price.towingFee')}>
                    <span className="num">{formatPln(towingFee)}</span>
                  </Line>
                )}
              </div>
              <div className="price-total">
                <span>
                  {rental.settlement.paidAmount > 0
                    ? t('rentals.price.paid')
                    : rental.billedUntil === null
                      ? t('rentals.price.soFar')
                      : t('rentals.price.total')}
                </span>
                <b className="num">
                  {formatPln(rental.settlement.paidAmount > 0 ? rental.settlement.paidAmount : rental.price.total)}
                </b>
              </div>
              <p className="small">{t('rentals.price.note')}</p>
            </section>

            <RentalSettlementCard rental={rental} />
          </div>

          <section className="card commands-card">
            <div className="card-head">
              <h2>{t('rentals.commands.title')}</h2>
              <span className="code">{topics.command(String(rental.scooterNumber).padStart(4, '0'))}</span>
            </div>
            <div className="table" role="table">
              <div className="row head" role="row">
                <span role="columnheader">{t('rentals.commands.sent')}</span>
                <span role="columnheader">{t('rentals.commands.command')}</span>
                <span role="columnheader">{t('rentals.commands.response')}</span>
                <span role="columnheader">{t('rentals.commands.result')}</span>
              </div>
              {commands.length === 0 && <p className="muted">{t('rentals.commands.none')}</p>}
              {commands.map(({ entry, context }) => (
                <div key={entry.commandId ?? entry.at} className="row" role="row">
                  <span role="cell" className="num">
                    {formatTime(entry.at)}
                  </span>
                  <span role="cell" className="stack">
                    <span className="strong">{commandLabel(entry)}</span>
                    <small>{context}</small>
                  </span>
                  <span role="cell">
                    <CommandResponse entry={entry} />
                  </span>
                  <span role="cell">
                    <CommandResult entry={entry} />
                  </span>
                </div>
              ))}
            </div>
          </section>
        </div>

        <div className="col">
          <section className="card timeline-card">
            <div className="card-head">
              <h2>{t('rentals.timeline.title')}</h2>
              <span className="small">{t('rentals.timeline.hint')}</span>
            </div>
            <Timeline items={timeline} showState />
          </section>

          {showEnding && (
            <section className="card ending-card">
              <div className="card-head">
                <h2>{t('rentals.ending.title')}</h2>
              </div>
              <div className="lines">
                {rental.endMode && (
                  <Line label={t('rentals.ending.mode')}>
                    <span>{t.dynamic(`rentals.ending.modes.${rental.endMode}`)}</span>
                  </Line>
                )}
                {rental.billingStoppedAt && (
                  <Line label={t('rentals.ending.billingStopped')}>
                    <span className="num">{formatDateTime(rental.billingStoppedAt)}</span>
                  </Line>
                )}
                {towingFee > 0 && (
                  <Line label={t('rentals.price.towingFee')}>
                    <span className="num">{formatPln(towingFee)}</span>
                  </Line>
                )}
              </div>
              {photo && (
                <figure className="parking-photo">
                  {fileUrl(photo.url) ? (
                    // Podpisany adres z API (10 min) z innego pochodzenia, więc zwykły <img>.
                    <img src={fileUrl(photo.url) ?? undefined} alt={t('rentals.ending.photoAlt', { number })} />
                  ) : (
                    <span className="muted">{t('service.photoDeleted')}</span>
                  )}
                  <figcaption className="small">
                    {t('rentals.ending.photo', { time: formatDateTime(photo.createdAt) })}
                  </figcaption>
                </figure>
              )}
            </section>
          )}

          <section className="card people-card">
            <h2>{t('rentals.people.title')}</h2>
            <PersonLink href={can('users.read') ? `/admin/klienci/${rental.userId}` : null}>
              <span className="av big" aria-hidden="true">
                {initials(rental.userName)}
              </span>
              <span className="stack grow">
                <span className="name">{customerName(rental)}</span>
                <small>
                  {[rental.userPhone, t('rentals.people.rides', { count: rental.userRidesCount })]
                    .filter(Boolean)
                    .join(' · ')}
                </small>
              </span>
            </PersonLink>
            <PersonLink href={can('scooters.read') ? `/admin/flota/${rental.scooterId}` : null}>
              <span className="av big scooter" aria-hidden="true">
                <ScooterIcon size={22} />
              </span>
              <span className="stack grow">
                <span className="name">{scooterNumber(rental.scooterNumber)}</span>
                <small>
                  {[
                    scooter && valueLabel(scootersResource, 'variant', scooter.variant),
                    t(online ? 'rentals.people.online' : 'rentals.people.offline', {
                      relative: formatRelative(lastSeenAt, now),
                    }),
                  ]
                    .filter(Boolean)
                    .join(' · ')}
                </small>
              </span>
              {battery !== null && (
                <span className="stack end">
                  <span className="num big-num">{t('common.percent', { value: battery })}</span>
                  <small>{t('rentals.people.battery')}</small>
                </span>
              )}
            </PersonLink>
          </section>
        </div>
      </div>

      {refunding && (
        <RefundDialog
          rental={rental}
          onClose={() => setRefunding(false)}
          onRefunded={(next, amount) => {
            setRefunding(false);
            apply(next);
            setNotice(t('rentals.refund.done', { amount: formatPln(amount), number }));
          }}
        />
      )}
      {ending && (
        <RemoteEndDialog
          rental={rental}
          onClose={() => setEnding(false)}
          onEnded={(ended) => {
            setEnding(false);
            apply(ended);
            setNotice(t('rentals.ended', { number }));
          }}
        />
      )}
    </>
  );
}

function Stat({ value, label }: { value: string; label: string }) {
  return (
    <div className="stat">
      <span className="v">{value}</span>
      <span className="l">{label}</span>
    </div>
  );
}

function Line({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="line-item">
      <span className="muted">{label}</span>
      {children}
    </div>
  );
}

function PersonLink({ href, children }: { href: string | null; children: ReactNode }) {
  if (!href) return <div className="person-link">{children}</div>;
  return (
    <Link className="person-link" href={href}>
      {children}
      <ChevronRightIcon />
    </Link>
  );
}
