'use client';

/**
 * Eksport raportu (ADR 0071, makieta raport-eksport): okno z wyborem formatu PDF albo XLSX i parametrami, które
 * trafią do pliku, zlecenie `POST /admin/reports/{code}/runs` (202) i stany W kolejce, Generowanie, Gotowe z „Pobierz”
 * i stopką pliku oraz Błąd z „Ponów”. Okno czeka na `report.ready` w pokoju `staff:{id}`, a w zapasie pyta
 * `GET /admin/report-runs/{id}` co 2 s (jak wydruki).
 */
import {
  DOCUMENT_POLL_INTERVAL_MS,
  DOCUMENT_WAIT_TIMEOUT_MS,
  type ReportCatalogItem,
  type ReportFormat,
  type ReportRunView,
  type ResolvedReportParamsView,
} from '@hulajnogi/shared';
import Link from 'next/link';
import { useCallback, useEffect, useState } from 'react';
import { api } from '../../../lib/api';
import { t } from '../../../lib/i18n';
import { useStaffFeed } from '../../../lib/realtime';
import { AlertIcon, CheckIcon, ClockIcon, CloseIcon, DownloadIcon, RetryIcon, UploadIcon } from '../icons';
import { useModal } from '../prints/prints-common';
import {
  formatFileSize,
  formatRangeLong,
  invalidateReportCatalog,
  isWholeMonth,
  formatMonthYear,
  openReportFile,
  reportErrorMessage,
  REPORTS_PATHS,
  runErrorText,
} from './reports-common';

const footerDate = new Intl.DateTimeFormat('pl', {
  day: '2-digit',
  month: '2-digit',
  year: 'numeric',
  hour: '2-digit',
  minute: '2-digit',
  timeZone: 'Europe/Warsaw',
});

/** Stopka jak w pliku: „Raport {id} · dane na … · zlecił … · Strona 1 z N” (ADR 0071). */
export const runFooter = (run: ReportRunView) =>
  t(run.format === 'PDF' ? 'reports.export.footer' : 'reports.export.footerXlsx', {
    id: run.shortId,
    date: footerDate.format(new Date(run.dataAsOf ?? run.createdAt)),
    requester: run.requestedByName,
    pages: run.pageCount ?? 1,
  });

/**
 * Stan uruchomienia do stanu końcowego: `report.ready` przyspiesza odczyt, a odpytywanie co 2 s jest zapasem
 * (Socket.IO rozłączone, zdarzenie z przerwy). `slow` po 30 s bez wyniku.
 */
export function useReportRun(initial: ReportRunView) {
  const [run, setRun] = useState(initial);
  const [slow, setSlow] = useState(false);
  const id = initial.id;
  const finished = run.status === 'SUCCEEDED' || run.status === 'FAILED';
  const refresh = useCallback(() => {
    void api<ReportRunView>(`/admin/report-runs/${id}`)
      .then(setRun)
      .catch(() => undefined);
  }, [id]);
  useStaffFeed(
    finished
      ? {}
      : {
          reportReady: (ready) => {
            if (ready.id === id) setRun(ready);
          },
          reconnected: refresh,
        },
  );
  useEffect(() => {
    if (finished) return;
    const poll = setInterval(refresh, DOCUMENT_POLL_INTERVAL_MS);
    const timeout = setTimeout(() => setSlow(true), DOCUMENT_WAIT_TIMEOUT_MS);
    return () => {
      clearInterval(poll);
      clearTimeout(timeout);
    };
  }, [finished, refresh]);
  useEffect(() => {
    if (finished) invalidateReportCatalog();
  }, [finished]);
  return { run, slow, finished };
}

interface ExportDialogProps {
  item: ReportCatalogItem;
  /** Parametry z adresu (to samo, co podgląd wysłał do API). */
  query: Record<string, string>;
  /** Parametry po walidacji z ostatniego podglądu (opis „Parametry w pliku”). */
  resolved: ResolvedReportParamsView | null;
  /** Nazwy filtrów (strefa, model, hulajnoga) do opisu parametrów. */
  filterNames: Partial<Record<'zoneId' | 'modelId' | 'scooterId', string>>;
  onClose: () => void;
}

export function ExportDialog({ item, query, resolved, filterNames, onClose }: ExportDialogProps) {
  const ref = useModal();
  const [format, setFormat] = useState<ReportFormat>(item.formats.includes('PDF') ? 'PDF' : 'XLSX');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [run, setRun] = useState<ReportRunView | null>(null);

  const submit = async (chosen = format) => {
    setBusy(true);
    setError(null);
    try {
      setRun(
        await api<ReportRunView>(`/admin/reports/${item.code}/runs`, {
          method: 'POST',
          json: { format: chosen, params: query },
        }),
      );
    } catch (e) {
      setError(reportErrorMessage(e));
    } finally {
      setBusy(false);
    }
  };

  const retry = async (id: string) => {
    setError(null);
    try {
      setRun(await api<ReportRunView>(`/admin/report-runs/${id}/retry`, { method: 'POST' }));
    } catch (e) {
      setError(reportErrorMessage(e));
    }
  };

  const otherFormat = (current: ReportFormat) => {
    const other: ReportFormat = current === 'PDF' ? 'XLSX' : 'PDF';
    if (!item.formats.includes(other)) return;
    setFormat(other);
    setRun(null);
    void submit(other);
  };

  return (
    <dialog ref={ref} className="pr-dialog rp-dialog" onClose={onClose} aria-labelledby="report-export-title">
      <div className="pr-dlg-head">
        <span className="pr-dlg-ic accent" aria-hidden="true">
          <UploadIcon size={20} />
        </span>
        <div className="stack grow">
          <h2 id="report-export-title">{t('reports.export.title', { name: item.name })}</h2>
          <p>{t('reports.export.lead')}</p>
        </div>
        <button type="button" className="icon-btn" aria-label={t('common.close')} onClick={onClose}>
          <CloseIcon />
        </button>
      </div>

      {run ? (
        <RunProgress
          key={run.id}
          initial={run}
          onRetry={(id) => void retry(id)}
          onOtherFormat={otherFormat}
          canOther={(f) => item.formats.includes(f === 'PDF' ? 'XLSX' : 'PDF')}
        />
      ) : (
        <>
          <div className="pr-field" role="radiogroup" aria-labelledby="report-export-format">
            <span className="label" id="report-export-format">
              {t('reports.export.format')}
            </span>
            {item.formats.map((f) => (
              <label key={f} className={format === f ? 'pr-choice on' : 'pr-choice'}>
                <input type="radio" name="report-format" checked={format === f} onChange={() => setFormat(f)} />
                <span className="stack">
                  <span className="pr-choice-name">{t.dynamic(`reports.export.formats.${f}`)}</span>
                  <span className="small rp-choice-sub">
                    {f === 'PDF'
                      ? t('reports.export.pdfHint', {
                          orientation: t.dynamic(`reports.orientation.${item.orientation}`),
                        })
                      : t('reports.export.xlsxHint', {
                          sheets: item.sections.tables.map((tb) => tb.sheetName).join(', '),
                        })}
                  </span>
                </span>
              </label>
            ))}
          </div>

          <ParamsBox resolved={resolved} filterNames={filterNames} />

          {error && (
            <div className="err" role="alert">
              {error}
            </div>
          )}

          <div className="rp-dlg-foot">
            <span className="small">{t('reports.export.retention')}</span>
            <div className="actions">
              <button type="button" className="btn" onClick={onClose}>
                {t('common.cancel')}
              </button>
              <button type="button" className="btn primary" disabled={busy} onClick={() => void submit()}>
                <UploadIcon size={16} />
                {t.dynamic(`reports.export.submit.${format}`)}
              </button>
            </div>
          </div>
        </>
      )}
      {run && error && (
        <div className="err" role="alert">
          {error}
        </div>
      )}
    </dialog>
  );
}

/** „Parametry w pliku”: okres z etykietą zakresu, porównanie, granulacja, filtry, strefa czasowa i chwila danych. */
function ParamsBox({
  resolved,
  filterNames,
}: {
  resolved: ResolvedReportParamsView | null;
  filterNames: ExportDialogProps['filterNames'];
}) {
  if (!resolved) return null;
  const rows: Array<[string, string]> = [
    [
      t('reports.export.params.period'),
      [
        formatRangeLong(resolved.from, resolved.to),
        resolved.preset !== 'custom' ? t.dynamic(`reports.presets.${resolved.preset}`).toLowerCase() : null,
      ]
        .filter(Boolean)
        .join(' · '),
    ],
    [
      t('reports.export.params.comparison'),
      resolved.comparison
        ? isWholeMonth(resolved.comparison.from, resolved.comparison.to)
          ? formatMonthYear(resolved.comparison.from).toLowerCase()
          : formatRangeLong(resolved.comparison.from, resolved.comparison.to)
        : t('reports.export.params.noComparison'),
    ],
  ];
  if (resolved.granularity)
    rows.push([
      t('reports.export.params.granularity'),
      t.dynamic(`reports.granularity.${resolved.granularity}`).toLowerCase(),
    ]);
  for (const f of ['zoneId', 'modelId', 'scooterId'] as const) {
    if (resolved.filters[f])
      rows.push([t.dynamic(`reports.params.filters.${f}`), filterNames[f] ?? resolved.filters[f] ?? '']);
  }
  rows.push([t('reports.export.params.timeZone'), t('reports.export.params.timeZoneValue')]);
  rows.push([t('reports.export.params.dataAsOf'), t('reports.export.params.dataAsOfValue')]);
  return (
    <div className="pr-box rp-params-box">
      <span className="label">{t('reports.export.params.title')}</span>
      <dl className="rp-kv">
        {rows.map(([k, v]) => (
          <div key={k}>
            <dt>{k}</dt>
            <dd>{v}</dd>
          </div>
        ))}
      </dl>
    </div>
  );
}

/** Stany okna po zleceniu (makieta: W kolejce, Generowanie, Gotowe, Błąd). */
function RunProgress({
  initial,
  onRetry,
  onOtherFormat,
  canOther,
}: {
  initial: ReportRunView;
  onRetry: (id: string) => void;
  onOtherFormat: (current: ReportFormat) => void;
  canOther: (current: ReportFormat) => boolean;
}) {
  const { run, slow } = useReportRun(initial);
  const [error, setError] = useState<string | null>(null);
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, []);
  const download = () => void openReportFile(run).catch((e: unknown) => setError(reportErrorMessage(e)));
  const historyLink = (
    <Link className="link" href={`${REPORTS_PATHS.history}?q=${run.shortId}`}>
      {t('reports.export.showInHistory')}
    </Link>
  );

  if (run.status === 'SUCCEEDED' && run.state !== 'FILE_DELETED') {
    return (
      <div className="pr-state" role="status">
        <div className="pr-state-head">
          <span className="pr-state-ic accent" aria-hidden="true">
            <CheckIcon size={15} />
          </span>
          <span className="stack">
            <span className="pr-state-title">{t('reports.export.ready')}</span>
            <span className="small">
              {[
                run.fileName ?? run.file?.fileName,
                run.pageCount !== null && run.format === 'PDF'
                  ? t('reports.export.pages', { count: run.pageCount })
                  : null,
                run.rowCount !== null && run.format === 'XLSX'
                  ? t('reports.export.rows', { count: run.rowCount })
                  : null,
                run.fileSizeBytes !== null ? formatFileSize(run.fileSizeBytes) : null,
              ]
                .filter(Boolean)
                .join(' · ')}
            </span>
          </span>
        </div>
        <div className="actions">
          <button type="button" className="btn primary" onClick={download}>
            <DownloadIcon size={16} />
            {t.dynamic(`reports.export.download.${run.format}`)}
          </button>
          <Link className="btn" href={`${REPORTS_PATHS.history}?q=${run.shortId}`}>
            {t('reports.export.showInHistory')}
          </Link>
        </div>
        <div className="pr-foot">
          {run.format === 'PDF' ? t('reports.export.footerLabel') : t('reports.export.footerLabelXlsx')}
          <br />
          <span>{runFooter(run)}</span>
        </div>
        {error && <span className="err">{error}</span>}
      </div>
    );
  }

  if (run.status === 'FAILED') {
    const code = run.errorCode ?? 'REPORT_FAILED';
    return (
      <div className="pr-state" role="alert">
        <div className="pr-state-head">
          <span className="pr-state-ic danger" aria-hidden="true">
            <AlertIcon size={15} />
          </span>
          <span className="stack">
            <span className="pr-state-title">{t.dynamic(`reports.export.failed.${run.format}`)}</span>
            <span className="small code">{t('reports.export.failedCode', { code, id: run.shortId })}</span>
          </span>
        </div>
        <span className="pr-state-body">{runErrorText(run.errorCode)}</span>
        <div className="actions">
          <button type="button" className="btn primary" onClick={() => onRetry(run.id)}>
            <RetryIcon size={16} />
            {t('reports.export.retry')}
          </button>
          {canOther(run.format) && (
            <button type="button" className="btn" onClick={() => onOtherFormat(run.format)}>
              {t.dynamic(`reports.export.submit.${run.format === 'PDF' ? 'XLSX' : 'PDF'}`)}
            </button>
          )}
        </div>
        {error && <span className="err">{error}</span>}
      </div>
    );
  }

  const seconds = Math.max(1, Math.round((now - new Date(run.startedAt ?? run.createdAt).getTime()) / 1000));
  if (run.status === 'QUEUED') {
    return (
      <div className="pr-state" role="status" aria-live="polite">
        <div className="pr-state-head">
          <span className="pr-state-ic" aria-hidden="true">
            <ClockIcon size={16} />
          </span>
          <span className="stack">
            <span className="pr-state-title">{t('reports.export.queued')}</span>
            <span className="small">{t('reports.export.queuedSub', { id: run.shortId })}</span>
          </span>
        </div>
        <span className="small">
          {slow ? t('reports.export.slow') : t('reports.export.canClose')} {historyLink}
        </span>
      </div>
    );
  }

  return (
    <div className="pr-state" role="status" aria-live="polite">
      <div className="pr-state-head">
        <span className="pr-spin" aria-hidden="true" />
        <span className="stack">
          <span className="pr-state-title">{t.dynamic(`reports.export.generating.${run.format}`)}</span>
          <span className="small">{t('reports.export.runningSub', { seconds })}</span>
        </span>
      </div>
      <div className="pr-bar" aria-hidden="true">
        <span />
      </div>
      <span className="small">
        {slow ? t('reports.export.slow') : t('reports.export.canClose')} {historyLink}
      </span>
    </div>
  );
}
