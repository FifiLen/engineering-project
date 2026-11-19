'use client';

/**
 * Raporty → katalog (ADR 0071, makieta raporty-katalog): karty aktywnych raportów z uprawnieniem operatora w kolejności
 * definicji (nazwa i opis z `report_definitions`, sekcje, formaty, ostatnie uruchomienie), „Twoje ostatnie eksporty”
 * z pobraniem albo „Ponów” i pusty stan dla roli bez raportów (albo gdy wszystkie są wyłączone).
 */
import type { ReportCatalogItem, ReportCode, ReportRunView } from '@hulajnogi/shared';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useState, type ComponentType } from 'react';
import { api } from '../../../lib/api';
import { t } from '../../../lib/i18n';
import { Banner } from '../access/common';
import {
  ArrowRightIcon,
  DownloadIcon,
  InfoIcon,
  ScooterIcon,
  SearchIcon,
  UsersIcon,
  WalletIcon,
  WrenchIcon,
} from '../icons';
import { ChartBarsIcon, CoinIcon, HeatGridIcon } from './report-icons';
import {
  formatWhen,
  openReportFile,
  paramsLine,
  paramsSub,
  reportErrorMessage,
  REPORTS_PATHS,
  ReportsHead,
  ReportsTabs,
  RunState,
  storedParams,
  useReportCatalog,
} from './reports-common';

const ICONS: Record<ReportCode, ComponentType<{ size?: number }>> = {
  revenue: CoinIcon,
  fleet_usage: ScooterIcon,
  rides_by_zone: HeatGridIcon,
  reliability: WrenchIcon,
  users: UsersIcon,
  wallet: WalletIcon,
};

export function ReportsCatalogPage() {
  const router = useRouter();
  const [revision, setRevision] = useState(0);
  const { catalog, error } = useReportCatalog(revision);
  const [query, setQuery] = useState('');
  const [notice, setNotice] = useState<{ text: string; error: boolean } | null>(null);

  const q = query.trim().toLocaleLowerCase('pl');
  const items = (catalog?.items ?? []).filter(
    (i) =>
      !q || i.name.toLocaleLowerCase('pl').includes(q) || (i.description ?? '').toLocaleLowerCase('pl').includes(q),
  );
  const noReports = catalog !== null && catalog.items.length === 0;

  return (
    <>
      <ReportsHead
        actions={
          !noReports && (
            <label className="search">
              <SearchIcon />
              <span className="visually-hidden">{t('reports.catalog.search')}</span>
              <input
                type="search"
                value={query}
                placeholder={t('reports.catalog.search')}
                onChange={(e) => setQuery(e.target.value)}
              />
            </label>
          )
        }
      />
      <ReportsTabs reports={catalog?.items.length ?? null} revision={revision} />

      {error && <Banner kind="danger">{error}</Banner>}
      {notice && <Banner kind={notice.error ? 'danger' : 'ok'}>{notice.text}</Banner>}

      {noReports ? (
        <NoReports canManage={catalog.canManage} />
      ) : (
        <>
          <div className="rp-grid" aria-busy={!catalog}>
            {!catalog &&
              Array.from({ length: 6 }, (_, i) => (
                <div key={i} className="card rp-report-card" aria-hidden="true">
                  <span className="skeleton" style={{ width: '45%', height: 16 }} />
                  <span className="skeleton" style={{ width: '90%' }} />
                  <span className="skeleton" style={{ width: '70%' }} />
                </div>
              ))}
            {items.map((item) => (
              <ReportCard key={item.code} item={item} />
            ))}
            {catalog && items.length === 0 && (
              <p className="small rp-grid-empty">{t('reports.catalog.noMatch', { query: query.trim() })}</p>
            )}
          </div>

          {catalog && (
            <RecentRuns
              runs={catalog.recentRuns}
              onRetried={(run) => {
                setNotice({ text: t('reports.catalog.retried', { id: run.shortId }), error: false });
                setRevision((n) => n + 1);
              }}
              onError={(text) => setNotice({ text, error: true })}
              onOpenHistory={() => router.push(REPORTS_PATHS.history)}
            />
          )}
        </>
      )}
    </>
  );
}

function ReportCard({ item }: { item: ReportCatalogItem }) {
  const Icon = ICONS[item.code];
  const sections = [
    item.sections.tiles.length > 0 ? t('reports.catalog.tiles') : null,
    ...item.sections.charts.map((c) => c.title.toLocaleLowerCase('pl')),
    ...item.sections.tables.slice(0, 2).map((tb) => tb.title.toLocaleLowerCase('pl')),
  ]
    .filter(Boolean)
    .join(' · ');
  return (
    <article className="card rp-report-card">
      <div className="rp-report-head">
        <span className="rp-report-ic" aria-hidden="true">
          <Icon size={18} />
        </span>
        <h2>
          <Link href={REPORTS_PATHS.report(item.code)} className="rp-report-title">
            {item.name}
          </Link>
        </h2>
      </div>
      <p className="rp-report-desc">{item.description ?? t('reports.catalog.noDescription')}</p>
      <div className="rp-report-meta">
        <span className="small rp-report-sections" title={sections}>
          {sections}
        </span>
        {item.formats.map((f) => (
          <span key={f} className="pill sm">
            {f}
          </span>
        ))}
      </div>
      <div className="rp-report-foot">
        <Link
          className="link rp-open"
          href={REPORTS_PATHS.report(item.code)}
          aria-label={t('reports.catalog.openNamed', { name: item.name })}
        >
          {t('reports.catalog.open')}
          <ArrowRightIcon size={14} />
        </Link>
        <span className="small">
          {item.lastRun
            ? t('reports.catalog.lastRun', { when: formatWhen(item.lastRun.createdAt), format: item.lastRun.format })
            : t('reports.catalog.neverRun')}
        </span>
      </div>
    </article>
  );
}

function RecentRuns({
  runs,
  onRetried,
  onError,
  onOpenHistory,
}: {
  runs: ReportRunView[];
  onRetried: (run: ReportRunView) => void;
  onError: (text: string) => void;
  onOpenHistory: () => void;
}) {
  const [busy, setBusy] = useState<string | null>(null);
  const retry = async (run: ReportRunView) => {
    setBusy(run.id);
    try {
      onRetried(await api<ReportRunView>(`/admin/report-runs/${run.id}/retry`, { method: 'POST' }));
    } catch (e) {
      onError(reportErrorMessage(e));
    } finally {
      setBusy(null);
    }
  };
  return (
    <section className="card rp-recent" aria-labelledby="recent-runs">
      <div className="rp-card-head">
        <h2 className="rp-card-title" id="recent-runs">
          {t('reports.catalog.recent')}
        </h2>
        <button type="button" className="link" onClick={onOpenHistory}>
          {t('reports.catalog.allHistory')}
        </button>
      </div>
      {runs.length === 0 ? (
        <p className="small rp-recent-empty">{t('reports.catalog.recentEmpty')}</p>
      ) : (
        <div role="table" className="rp-recent-table">
          {runs.map((run) => {
            const params = storedParams(run.params);
            return (
              <div key={run.id} role="row" className="rp-recent-row">
                <span role="cell" className="code ink">
                  {run.shortId}
                </span>
                <span role="cell" className="stack">
                  <span className="strong-500">{run.reportName}</span>
                  <span className="small">{[paramsLine(params), paramsSub(params)].filter(Boolean).join(' · ')}</span>
                </span>
                <span role="cell" className="strong-500 small-ink">
                  {run.format}
                </span>
                <span role="cell" className="num">
                  {formatWhen(run.createdAt)}
                </span>
                <span role="cell">
                  <RunState state={run.state} />
                </span>
                <span role="cell" className="rp-recent-action">
                  {run.state === 'SUCCEEDED' ? (
                    <button
                      type="button"
                      className="link pr-link-btn"
                      onClick={() => void openReportFile(run).catch((e: unknown) => onError(reportErrorMessage(e)))}
                    >
                      <DownloadIcon size={14} />
                      {t('reports.history.download')}
                    </button>
                  ) : run.state === 'FAILED' || run.state === 'FILE_DELETED' ? (
                    <button
                      type="button"
                      className="link pr-link-btn"
                      disabled={busy === run.id}
                      onClick={() => void retry(run)}
                    >
                      {run.state === 'FAILED' ? t('reports.history.retry') : t('reports.history.rerun')}
                    </button>
                  ) : (
                    <span className="muted">{t('common.none')}</span>
                  )}
                </span>
              </div>
            );
          })}
        </div>
      )}
      <div className="notice rp-note">
        <span className="ic">
          <InfoIcon size={15} />
        </span>
        <span>{t('reports.retention')}</span>
      </div>
    </section>
  );
}

function NoReports({ canManage }: { canManage: boolean }) {
  return (
    <div className="card">
      <div className="state">
        <div className="icon">
          <ChartBarsIcon size={22} />
        </div>
        <h2>{t('reports.catalog.noneTitle')}</h2>
        <p>{canManage ? t('reports.catalog.noneManage') : t('reports.catalog.noneBody')}</p>
        {canManage ? (
          <Link className="btn" href={REPORTS_PATHS.definitions}>
            {t('reports.tabs.definitions')}
          </Link>
        ) : (
          <Link className="btn" href="/admin">
            {t('reports.catalog.backToDashboard')}
          </Link>
        )}
      </div>
    </div>
  );
}
