'use client';

/**
 * „Cennik i zasady” (makieta cennik-wersje, ADR 0053): wersje cennika ze stanem, szczegóły wybranej wersji,
 * podgląd jak w aplikacji i usunięcie zaplanowanej, jeszcze nieużytej wersji. Wersji się nie edytuje.
 */
import { formatPln, tariffsResource, type ListResponse, type TariffVersionItem } from '@hulajnogi/shared';
import Link from 'next/link';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { useState } from 'react';
import { api, errorMessage } from '../../../lib/api';
import { formatDate, formatDateTime, t } from '../../../lib/i18n';
import { useSession } from '../../../lib/session';
import { Banner } from '../access/common';
import { ConfirmDialog } from '../confirm-dialog';
import { ClockIcon, HistoryIcon, PlusIcon, TrashIcon } from '../icons';
import { ExportButton } from '../list-export';
import { useApiRecord } from '../payments/payment-format';
import { fieldLabel, formatValue, TARIFF_SECTIONS, VAT_FIELD } from './tariff-fields';

export const TARIFFS_BASE = '/admin/cennik';

const STATE_PILL: Record<TariffVersionItem['state'], string> = {
  CURRENT: 'pill accent',
  SCHEDULED: 'pill',
  ARCHIVED: 'pill muted',
};

export function TariffStatePill({ state }: { state: TariffVersionItem['state'] }) {
  return <span className={STATE_PILL[state]}>{t.dynamic(`resource.tariffs.values.state.${state}`)}</span>;
}

const dateOnly = new Intl.DateTimeFormat('pl', { dateStyle: 'medium', timeZone: 'Europe/Warsaw' });

/** „od 12 lis 2026, 08:00” albo dla archiwalnej „3 wrz – 12 lis 2026”. */
function validity(v: TariffVersionItem): string {
  if (v.validTo) return t('tariffs.range', { from: formatDate(v.validFrom), to: dateOnly.format(new Date(v.validTo)) });
  return t('tariffs.from', { date: formatDateTime(v.validFrom) });
}

function author(v: TariffVersionItem): string {
  return v.createdByName
    ? t('tariffs.author', { name: v.createdByName, date: formatDateTime(v.createdAt) })
    : t('tariffs.authorSystem');
}

export function useTariffs(revision = 0) {
  const { data, error } = useApiRecord<ListResponse<TariffVersionItem>>(
    '/admin/tariffs?pageSize=100&sort=-version',
    revision,
  );
  const versions = data?.items ?? null;
  return {
    versions,
    error,
    current: versions?.find((v) => v.state === 'CURRENT') ?? null,
    scheduled: versions?.find((v) => v.state === 'SCHEDULED') ?? null,
  };
}

export function TariffsPage() {
  const { can } = useSession();
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const [revision, setRevision] = useState(0);
  const { versions, error, current, scheduled } = useTariffs(revision);
  const [confirm, setConfirm] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);

  const requested = Number(searchParams.get('wersja'));
  const selected = versions?.find((v) => v.version === requested) ?? current ?? versions?.[0] ?? null;
  const select = (version: number) => router.replace(`${pathname}?wersja=${version}`, { scroll: false });
  const deletable = selected?.state === 'SCHEDULED' && selected.rentalsCount === 0 && can('tariffs.write');

  const remove = async () => {
    if (!selected) return;
    setConfirm(false);
    setActionError(null);
    try {
      await api(`/admin/tariffs/${selected.id}`, { method: 'DELETE' });
      setNotice(t('tariffs.deleted', { version: selected.version }));
      router.replace(pathname, { scroll: false });
      setRevision((n) => n + 1);
    } catch (e) {
      setActionError(errorMessage(e));
    }
  };

  return (
    <>
      <div className="page-head">
        <div>
          <h1>{t('tariffs.title')}</h1>
          <div className="sub">{t('tariffs.sub')}</div>
        </div>
        <div className="actions">
          <ExportButton
            resource={tariffsResource}
            params={{}}
            rows={versions?.length ?? null}
            filters={[]}
            columns={[
              'version',
              'state',
              'validFrom',
              'validTo',
              'unlockFee',
              'minuteRate',
              'pauseMinuteRate',
              'outOfZoneFee',
              'freeReservationMinutes',
              'minWalletBalance',
              'minBatteryPct',
              'minUserAge',
              'vatRate',
              'rentalsCount',
              'createdByName',
              'createdAt',
            ]}
            disabled={!versions}
          />
          {can('audit.read') && (
            <Link className="btn" href="/admin/dziennik?entityType=tariff">
              <HistoryIcon />
              {t('tariffs.history')}
            </Link>
          )}
          {can('tariffs.write') && (
            <Link className="btn primary" href={`${TARIFFS_BASE}/nowa`}>
              <PlusIcon />
              {t('tariffs.new')}
            </Link>
          )}
        </div>
      </div>

      {notice && <Banner kind="ok">{notice}</Banner>}
      {(actionError ?? error) && <Banner kind="danger">{actionError ?? error}</Banner>}

      {scheduled && current && (
        <div className="notice info" role="status">
          <span className="ic">
            <ClockIcon />
          </span>
          <span className="grow">
            {t('tariffs.scheduledNotice', {
              version: scheduled.version,
              date: formatDateTime(scheduled.validFrom),
              current: current.version,
            })}
          </span>
          {selected?.id !== scheduled.id && (
            <button type="button" className="link" onClick={() => select(scheduled.version)}>
              {t('tariffs.showVersion', { version: scheduled.version })}
            </button>
          )}
        </div>
      )}

      {!versions && !error && <div className="card" aria-busy="true" style={{ minHeight: 320 }} />}

      {versions && selected && (
        <div className="tariffs-grid">
          <section className="card tariff-versions">
            <div className="card-head">
              <h2>{t('tariffs.versions')}</h2>
              <span className="small">{t('tariffs.newestFirst')}</span>
            </div>
            <ul className="ver-list">
              {versions.map((v) => (
                <li key={v.id}>
                  <button
                    type="button"
                    className="ver"
                    aria-current={v.id === selected.id ? 'true' : undefined}
                    onClick={() => select(v.version)}
                  >
                    <span className="ver-top">
                      <span className="ver-name">{t('tariffs.version', { version: v.version })}</span>
                      <TariffStatePill state={v.state} />
                    </span>
                    <span className="num">{validity(v)}</span>
                    <span className="small">{author(v)}</span>
                    <span className="small">
                      {v.rentalsCount === 0 ? (
                        t('tariffs.noRentals')
                      ) : (
                        <>
                          <span className="num ink">{v.rentalsCount}</span>{' '}
                          {t('tariffs.rentalsWord', { count: v.rentalsCount })}
                        </>
                      )}
                    </span>
                  </button>
                </li>
              ))}
            </ul>
            <span className="small card-foot">{t('tariffs.versionsNote')}</span>
          </section>

          <section className="card tariff-details">
            <div className="tariff-details-head">
              <div className="stack">
                <span className="title-with-pills">
                  <span className="tariff-title">{t('tariffs.version', { version: selected.version })}</span>
                  <TariffStatePill state={selected.state} />
                </span>
                <span className="small">
                  {validity(selected)}
                  {' · '}
                  {selected.createdByName
                    ? t('tariffs.createdBy', { name: selected.createdByName })
                    : t('tariffs.authorSystem')}
                </span>
              </div>
              <div className="stack end">
                <span className="big-stat num">{selected.rentalsCount}</span>
                <span className="small">{t('tariffs.rentalsInVersion', { count: selected.rentalsCount })}</span>
              </div>
            </div>
            {TARIFF_SECTIONS.map((section) => (
              <div key={section.key}>
                <div className="sect">{t.dynamic(`tariffs.sections.${section.key}`)}</div>
                {section.fields.map((spec) => (
                  <div key={spec.field} className="kvline">
                    <span className="k">
                      <b>{fieldLabel(spec.field)}</b>
                      {t.has(`tariffs.hints.${spec.field}`) && (
                        <span className="small">{t.dynamic(`tariffs.hints.${spec.field}`)}</span>
                      )}
                    </span>
                    <span className="v num">{formatValue(spec, selected[spec.field])}</span>
                  </div>
                ))}
              </div>
            ))}
            <span className="small card-foot">
              {t('tariffs.vatNote', { vat: formatValue(VAT_FIELD, selected.vatRate) })}{' '}
              {can('zones.read') ? (
                <Link className="link small-link" href="/admin/strefy">
                  {t('tariffs.zonesLink')}
                </Link>
              ) : (
                t('tariffs.zonesLink')
              )}
              {t('tariffs.vatNoteEnd')}
            </span>
            {deletable && (
              <div className="tariff-delete">
                <button type="button" className="btn danger" onClick={() => setConfirm(true)}>
                  <TrashIcon size={16} />
                  {t('tariffs.delete')}
                </button>
                <span className="small">{t('tariffs.deleteHint', { date: formatDateTime(selected.validFrom) })}</span>
              </div>
            )}
          </section>

          <TariffPreview tariff={selected} scheduled={scheduled} />
        </div>
      )}

      <ConfirmDialog
        open={confirm}
        danger
        title={t('tariffs.deleteTitle', { version: selected?.version ?? '' })}
        body={t('tariffs.deleteBody', { current: current?.version ?? '' })}
        action={t('tariffs.delete')}
        onConfirm={() => void remove()}
        onClose={() => setConfirm(false)}
      />
    </>
  );
}

/** Podgląd cennika jak w aplikacji (ekran platnosci-cennik): te same pozycje i opisy. */
function TariffPreview({ tariff, scheduled }: { tariff: TariffVersionItem; scheduled: TariffVersionItem | null }) {
  const rows = [
    { key: 'unlock', value: formatPln(tariff.unlockFee), hint: t('tariffs.preview.unlockHint') },
    { key: 'minute', value: formatPln(tariff.minuteRate), hint: null },
    { key: 'pause', value: formatPln(tariff.pauseMinuteRate), hint: t('tariffs.preview.pauseHint') },
    {
      key: 'reservation',
      value: t('tariffs.preview.free'),
      hint: t('tariffs.preview.reservationHint', { minutes: tariff.freeReservationMinutes }),
    },
    { key: 'towing', value: formatPln(tariff.outOfZoneFee), hint: t('tariffs.preview.towingHint') },
  ];
  const note =
    tariff.state === 'SCHEDULED'
      ? t('tariffs.preview.noteScheduled', { date: formatDate(tariff.validFrom) })
      : tariff.state === 'ARCHIVED'
        ? t('tariffs.preview.noteArchived')
        : scheduled
          ? t('tariffs.preview.noteWithScheduled', {
              version: scheduled.version,
              date: formatDate(scheduled.validFrom),
            })
          : t('tariffs.preview.note');
  return (
    <section className="card tariff-preview">
      <div className="card-head">
        <h2>{t('tariffs.preview.title')}</h2>
        <span className="small">{t('tariffs.preview.version', { version: tariff.version })}</span>
      </div>
      <div className="phone-card">
        <span className="phone-title">{t('tariffs.preview.heading')}</span>
        {/* Render hulajnogi z docs/projekt/rendery (ten sam co w aplikacji). */}
        <img src="/rendery/hulajnoga-grafit-bok.png" alt="" className="phone-img" />
        {rows.map((row) => (
          <div key={row.key} className="pv">
            <span className="stack">
              <span>{t.dynamic(`tariffs.preview.rows.${row.key}`)}</span>
              {row.hint && <span className="small">{row.hint}</span>}
            </span>
            <span className="num">{row.value}</span>
          </div>
        ))}
      </div>
      <span className="small preview-note">{note}</span>
    </section>
  );
}
