'use client';

/**
 * Strona raportu `/admin/raporty/{kod}` (ADR 0071, makiety raport-przychody, raport-strefy-godziny, raport-stany):
 * pasek parametrów w adresie URL, „Dane na …”, „Odśwież” i „Eksportuj”, kafelki z porównaniem (strzałka w kolorze
 * tekstu), wykresy i tabele z `GET /admin/reports/{kod}/preview`. Stany: ładowanie (szkielet), brak danych
 * z najwcześniejszą datą danych, zakres za długi z podpowiedzią i błąd albo limit czasu z „Spróbuj ponownie”.
 */
import { isReportCode, type ReportCatalogItem, type ReportPreview, type ReportTile } from '@hulajnogi/shared';
import Link from 'next/link';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react';
import { api, ApiRequestError } from '../../../lib/api';
import { t } from '../../../lib/i18n';
import { AlertIcon, ArrowDown, ArrowUp, ClockIcon, RetryIcon, UploadIcon } from '../icons';
import { ExportDialog } from './export-dialog';
import { ReportChartCard } from './report-charts';
import { ChartBarsIcon } from './report-icons';
import {
  ParamsBar,
  queryPreset,
  rangeSuggestion,
  readReportQuery,
  type ReportFilterKey,
  type ReportQuery,
} from './report-params';
import { ReportTableCard, tableIsWide } from './report-table';
import {
  formatChange,
  formatRangeLong,
  formatRangeShort,
  formatReportValue,
  reportErrorMessage,
  REPORTS_PATHS,
  useReportCatalog,
} from './reports-common';

type Preview =
  | { status: 'loading'; key: string; data: ReportPreview | null }
  | { status: 'ready'; key: string; data: ReportPreview }
  | { status: 'error'; key: string; error: unknown; data: ReportPreview | null };

const dataAsOfFormat = new Intl.DateTimeFormat('pl', {
  day: '2-digit',
  month: '2-digit',
  year: 'numeric',
  hour: '2-digit',
  minute: '2-digit',
  timeZone: 'Europe/Warsaw',
});

export function ReportPage({ code }: { code: string }) {
  const router = useRouter();
  const pathname = usePathname();
  const search = useSearchParams();
  const { catalog, error: catalogError } = useReportCatalog();
  const item = catalog?.items.find((i) => i.code === code) ?? null;
  const query = useMemo(() => readReportQuery(new URLSearchParams(search.toString()), item), [search, item]);
  const queryString = new URLSearchParams(query as Record<string, string>).toString();
  const [revision, setRevision] = useState(0);
  const [preview, setPreview] = useState<Preview>({ status: 'loading', key: '', data: null });
  const [exportOpen, setExportOpen] = useState(false);
  const [datesSignal, setDatesSignal] = useState(0);
  const [filterNames, setFilterNames] = useState<Partial<Record<ReportFilterKey, string>>>({});

  const setQuery = useCallback(
    (next: ReportQuery) => {
      const params = new URLSearchParams(next as Record<string, string>);
      router.replace(params.size ? `${pathname}?${params}` : pathname, { scroll: false });
    },
    [router, pathname],
  );

  // Podgląd po każdej zmianie parametrów i po „Odśwież”; poprzednie dane zostają na czas odświeżenia tych samych
  // parametrów, a przy nowych parametrach jest szkielet.
  useEffect(() => {
    if (!item) return;
    const controller = new AbortController();
    const key = queryString;
    setPreview((p) => ({ status: 'loading', key, data: p.key === key ? p.data : null }));
    api<ReportPreview>(`/admin/reports/${item.code}/preview${key ? `?${key}` : ''}`, { signal: controller.signal })
      .then((data) => setPreview({ status: 'ready', key, data }))
      .catch((error: unknown) => {
        if ((error as Error).name === 'AbortError') return;
        setPreview((p) => ({ status: 'error', key, error, data: p.key === key ? p.data : null }));
      });
    return () => controller.abort();
  }, [item, queryString, revision]);

  if (!isReportCode(code) || (catalog && !item) || catalogError) {
    return <Unavailable message={catalogError} />;
  }
  if (!item) {
    return (
      <div className="page-head">
        <div>
          <span className="skeleton" style={{ width: 220, height: 28 }} />
        </div>
      </div>
    );
  }

  const data = preview.data;
  const errorCode = preview.status === 'error' && preview.error instanceof ApiRequestError ? preview.error.code : null;
  const tooLong = errorCode === 'REPORT_RANGE_TOO_LONG';
  const empty = preview.status === 'ready' && data?.empty;
  const exportDisabled = tooLong || Boolean(empty) || (preview.status === 'error' && errorCode !== 'REPORT_TIMEOUT');

  return (
    <>
      <div className="page-head rp-head">
        <div>
          <nav className="crumbs" aria-label={t('reports.crumbs')}>
            <Link href={REPORTS_PATHS.catalog} className="link">
              {t('reports.title')}
            </Link>
            <span aria-hidden="true">{'/'}</span>
            <span>{data?.name ?? item.name}</span>
          </nav>
          <h1>{data?.name ?? item.name}</h1>
          {(data?.description ?? item.description) && (
            <div className="sub">{data?.description ?? item.description}</div>
          )}
        </div>
        <div className="actions rp-head-actions">
          {data && (
            <span className="rp-asof">
              <ClockIcon size={15} />
              {t('reports.dataAsOf')}
              <span className="num">{dataAsOfFormat.format(new Date(data.dataAsOf)).replace(',', '')}</span>
            </span>
          )}
          <button
            type="button"
            className="btn"
            onClick={() => setRevision((n) => n + 1)}
            disabled={preview.status === 'loading'}
          >
            <RetryIcon size={16} />
            {t('reports.refresh')}
          </button>
          <button type="button" className="btn primary" disabled={exportDisabled} onClick={() => setExportOpen(true)}>
            <UploadIcon size={16} />
            {t('reports.exportButton')}
          </button>
        </div>
      </div>

      <ParamsBar
        item={item}
        query={query}
        resolved={data?.params ?? null}
        rangeError={tooLong}
        onChange={setQuery}
        datesOpenSignal={datesSignal}
        onFilterNames={setFilterNames}
      />

      {preview.status === 'loading' && !data ? (
        <LoadingState item={item} query={query} />
      ) : tooLong ? (
        <TooLongState
          query={query}
          error={preview.status === 'error' ? preview.error : null}
          onSet={(from, to) => {
            const next = { ...query, from, to };
            delete next.preset;
            delete next.granularity;
            setQuery(next);
          }}
          onChangeDates={() => setDatesSignal((n) => n + 1)}
        />
      ) : preview.status === 'error' ? (
        <ErrorState error={preview.error} onRetry={() => setRevision((n) => n + 1)} />
      ) : data?.empty ? (
        <EmptyState
          data={data}
          onShow={(preset) => {
            const next = { ...query, preset };
            delete next.from;
            delete next.to;
            delete next.granularity;
            setQuery(next);
          }}
        />
      ) : data ? (
        <ReportBody data={data} busy={preview.status === 'loading'} />
      ) : null}

      {exportOpen && (
        <ExportDialog
          item={item}
          query={query as Record<string, string>}
          resolved={data?.params ?? null}
          filterNames={filterNames}
          onClose={() => setExportOpen(false)}
        />
      )}
    </>
  );
}

function Unavailable({ message }: { message: string | null }) {
  return (
    <>
      <div className="page-head">
        <div>
          <nav className="crumbs" aria-label={t('reports.crumbs')}>
            <Link href={REPORTS_PATHS.catalog} className="link">
              {t('reports.title')}
            </Link>
          </nav>
          <h1>{t('reports.unavailable.title')}</h1>
        </div>
      </div>
      <div className="card">
        <div className="state" role="alert">
          <div className="icon">
            <ChartBarsIcon size={22} />
          </div>
          <h2>{t('reports.unavailable.title')}</h2>
          <p>{message ?? t('reports.unavailable.body')}</p>
          <Link className="btn" href={REPORTS_PATHS.catalog}>
            {t('reports.unavailable.back')}
          </Link>
        </div>
      </div>
    </>
  );
}

// ---------------------------------------------------------------------------------------------
// Treść raportu
// ---------------------------------------------------------------------------------------------

type Block = { kind: 'chart' | 'table'; key: string; node: ReactNode; wide: boolean; weight: number };

/**
 * Układ sekcji: wykres słupkowy i szeroka tabela na całą szerokość, mapa ciepła, pasek udziałów i wąskie tabele
 * parami (pierwsza wolna para dostaje miejsce obok); samotna wąska sekcja zostaje na swoim miejscu na całą szerokość.
 */
function layout(blocks: Block[]): Array<Block | [Block, Block]> {
  const out: Array<Block | [Block, Block] | null> = [];
  let pending: { block: Block; slot: number } | null = null;
  for (const block of blocks) {
    if (block.wide) {
      out.push(block);
      continue;
    }
    if (pending) {
      out[pending.slot] = [pending.block, block];
      pending = null;
    } else {
      pending = { block, slot: out.length };
      out.push(null);
    }
  }
  if (pending) out[pending.slot] = { ...pending.block, wide: true };
  return out.filter((b): b is Block | [Block, Block] => b !== null);
}

function ReportBody({ data, busy }: { data: ReportPreview; busy: boolean }) {
  // Tabela szeregu w czasie i mapy ciepła jest pod „Pokaż jako tabelę” wykresu (i w XLSX), nie powtarzamy jej.
  const chartTables = new Set(
    data.charts.filter((c) => c.type === 'heatmap' || (c.type === 'bar' && c.axis === 'time')).map((c) => c.tableKey),
  );
  const blocks: Block[] = [
    ...data.charts.map((chart): Block => ({
      kind: 'chart',
      key: `c-${chart.key}`,
      node: <ReportChartCard chart={chart} preview={data} />,
      wide: chart.type === 'bar',
      weight: chart.type === 'heatmap' ? 3 : 2,
    })),
    ...data.tables
      .filter((table) => !chartTables.has(table.key))
      .map((table): Block => ({
        kind: 'table',
        key: `t-${table.key}`,
        node: <ReportTableCard table={table} />,
        wide: tableIsWide(table),
        weight: table.columns.length > 4 ? 3 : 2,
      })),
  ];

  return (
    <div className="rp-body" aria-busy={busy}>
      {data.tiles.length > 0 && (
        <div className="rp-tiles" style={{ gridTemplateColumns: `repeat(${data.tiles.length}, minmax(0, 1fr))` }}>
          {data.tiles.map((tile) => (
            <Tile key={tile.key} tile={tile} />
          ))}
        </div>
      )}
      {layout(blocks).map((entry) =>
        Array.isArray(entry) ? (
          <div
            key={`${entry[0].key}+${entry[1].key}`}
            className="rp-pair"
            style={{ gridTemplateColumns: `minmax(0, ${entry[0].weight}fr) minmax(0, ${entry[1].weight}fr)` }}
          >
            {entry[0].node}
            {entry[1].node}
          </div>
        ) : (
          <div key={entry.key} className="rp-full">
            {entry.node}
          </div>
        ),
      )}
    </div>
  );
}

/** Kafelek z porównaniem: strzałka w kolorze tekstu, zmiana i wartość poprzedniego okresu (ADR 0072). */
function Tile({ tile }: { tile: ReportTile }) {
  return (
    <div className="rp-tile">
      <span className="l">{tile.label}</span>
      <span className="v num">{formatReportValue(tile.kind, tile.value, tile.decimals)}</span>
      {tile.previous !== null && (
        <span
          className="d"
          aria-label={t('reports.tile.compare', {
            change: tile.change === null ? t('common.none') : formatChange(tile.change),
            previous: formatReportValue(tile.kind, tile.previous, tile.decimals),
          })}
        >
          {tile.change !== null && tile.change > 0.0005 && <ArrowUp size={13} />}
          {tile.change !== null && tile.change < -0.0005 && <ArrowDown size={13} />}
          {tile.change !== null && <span className="num">{formatChange(tile.change)}</span>}
          {tile.change !== null && <span aria-hidden="true">{'·'}</span>}
          <span>{formatReportValue(tile.kind, tile.previous, tile.decimals)}</span>
        </span>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------------------------
// Stany podglądu (plansza raport-stany)
// ---------------------------------------------------------------------------------------------

const SKELETON_BARS = [44, 62, 30, 78, 52, 86, 64, 48, 70, 92, 58, 40, 74, 80, 54, 66, 46, 82, 62, 88, 56, 72];

function LoadingState({ item, query }: { item: ReportCatalogItem; query: ReportQuery }) {
  const preset = queryPreset(query);
  const label =
    query.from && query.to
      ? formatRangeLong(query.from, query.to)
      : t.dynamic(`reports.presets.${preset}`).toLowerCase();
  const tiles = Math.max(3, item.sections.tiles.length);
  return (
    <div className="rp-body" aria-busy="true">
      <div className="rp-tiles" style={{ gridTemplateColumns: `repeat(${tiles}, minmax(0, 1fr))` }}>
        {Array.from({ length: tiles }, (_, i) => (
          <div key={i} className="rp-tile skeleton-tile" aria-hidden="true">
            <span className="skeleton" style={{ width: '50%' }} />
            <span className="skeleton" style={{ width: '75%', height: 16 }} />
            <span className="skeleton" style={{ width: '40%' }} />
          </div>
        ))}
      </div>
      <div className="card rp-card">
        <div className="rp-skeleton-bars" aria-hidden="true">
          {SKELETON_BARS.map((h, i) => (
            <span key={i} style={{ height: `${h}%` }} />
          ))}
        </div>
        <p className="rp-loading" role="status">
          <span className="pr-spin sm" aria-hidden="true" />
          {t('reports.states.loading', { period: label })}
        </p>
      </div>
    </div>
  );
}

function EmptyState({
  data,
  onShow,
}: {
  data: ReportPreview;
  onShow: (preset: 'previous_month' | 'this_month') => void;
}) {
  const other = data.params.preset === 'previous_month' ? 'this_month' : 'previous_month';
  return (
    <div className="card">
      <div className="state rp-state" role="status">
        <div className="icon">
          <ChartBarsIcon size={22} />
        </div>
        <h2>{t('reports.states.emptyTitle', { period: formatRangeLong(data.params.from, data.params.to) })}</h2>
        <p>
          {t.dynamic(`reports.states.emptyBody.${data.code}`)}{' '}
          {data.earliestDataAt
            ? t('reports.states.earliest', {
                date: formatRangeLong(data.earliestDataAt.slice(0, 10), data.earliestDataAt.slice(0, 10)),
              })
            : t('reports.states.noData')}
        </p>
        <button type="button" className="btn" onClick={() => onShow(other)}>
          {t.dynamic(`reports.states.show.${other}`)}
        </button>
        <small>{t('reports.states.emptyExport')}</small>
      </div>
    </div>
  );
}

function TooLongState({
  query,
  error,
  onSet,
  onChangeDates,
}: {
  query: ReportQuery;
  error: unknown;
  onSet: (from: string, to: string) => void;
  onChangeDates: () => void;
}) {
  const details = (error instanceof ApiRequestError ? error.details : null) as {
    days?: number;
    maxDays?: number;
  } | null;
  const from = query.from;
  const to = query.to;
  const suggestion = from && to ? rangeSuggestion(from, to) : null;
  return (
    <div className="card rp-card rp-toolong">
      <div className="rp-alert" role="alert">
        <span className="rp-alert-ic" aria-hidden="true">
          <AlertIcon size={15} />
        </span>
        <span className="stack">
          <b>{t('reports.states.tooLongTitle', { days: details?.days ?? 0, maxDays: details?.maxDays ?? 366 })}</b>
          {from && to && <span>{t('reports.states.tooLongRange', { range: formatRangeLong(from, to) })}</span>}
          <span className="small">{t('reports.states.errorCode', { code: 'REPORT_RANGE_TOO_LONG' })}</span>
        </span>
      </div>
      {suggestion?.parts && (
        <div className="rp-hint">
          {t('reports.states.tooLongHint', {
            maxDays: details?.maxDays ?? 366,
            first: formatRangeShort(suggestion.parts[0]!.from, suggestion.parts[0]!.to),
            second: formatRangeShort(suggestion.parts[1]!.from, suggestion.parts[1]!.to),
          })}
        </div>
      )}
      <div className="actions">
        {suggestion && (
          <button
            type="button"
            className="btn primary"
            onClick={() => onSet(suggestion.shortened.from, suggestion.shortened.to)}
          >
            {t('reports.states.tooLongSet', {
              range: formatRangeShort(suggestion.shortened.from, suggestion.shortened.to),
            })}
          </button>
        )}
        <button type="button" className="btn" onClick={onChangeDates}>
          {t('reports.states.changeDates')}
        </button>
      </div>
    </div>
  );
}

function ErrorState({ error, onRetry }: { error: unknown; onRetry: () => void }) {
  const code = error instanceof ApiRequestError ? error.code : 'INTERNAL_ERROR';
  return (
    <div className="card">
      <div className="state rp-state" role="alert">
        <div className="icon danger">
          <AlertIcon />
        </div>
        <h2>{t('reports.states.errorTitle')}</h2>
        <p>
          {code === 'REPORT_TIMEOUT' ? t('reports.states.timeoutBody', { seconds: 15 }) : reportErrorMessage(error)}
        </p>
        <small>{t('reports.states.errorCode', { code })}</small>
        <button type="button" className="btn" onClick={onRetry}>
          <RetryIcon size={16} />
          {t('reports.states.retry')}
        </button>
      </div>
    </div>
  );
}
