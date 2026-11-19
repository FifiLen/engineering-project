'use client';

/**
 * Raporty → Historia (ADR 0071, makieta raporty-historia): zasób `report-runs` na wzorcu listy (ADR 0031) z szybkimi
 * filtrami (Moje, W toku, Gotowe, Błędy, Pliki usunięte), filtrem raportu, formatu, kodu błędu i daty, wyszukiwaniem
 * po identyfikatorze ze stopki pliku, pobraniem i menu „⋯” (pobierz, otwórz podgląd z tymi parametrami, uruchom
 * ponownie z tymi parametrami, kopiuj identyfikator). Historia pokazuje też uruchomienia innych operatorów dla
 * raportów, do których operator ma uprawnienie; po `report.ready` lista odświeża się sama.
 */
import { reportRunsResource, type ListResponse, type ReportRunListItem, type ReportRunView } from '@hulajnogi/shared';
import Link from 'next/link';
import { useCallback, useEffect, useMemo, useRef, useState, type KeyboardEvent, type ReactNode } from 'react';
import { api } from '../../../lib/api';
import { formatDate, formatDateTime, t } from '../../../lib/i18n';
import { useStaffFeed } from '../../../lib/realtime';
import { useSession } from '../../../lib/session';
import { Banner } from '../access/common';
import type { FilterSpec } from '../filter-drawer';
import { ArrowRightIcon, CopyIcon, DownloadIcon, InfoIcon, MoreIcon, RetryIcon } from '../icons';
import { ResourceList, type Column, type QuickPreset } from '../resource-list';
import { ChartBarsIcon } from './report-icons';
import {
  formatFileSize,
  formatWhen,
  openReportFile,
  paramsLine,
  paramsSub,
  previewHref,
  reportErrorMessage,
  REPORTS_PATHS,
  ReportsTabs,
  RunState,
  storedParams,
} from './reports-common';

type Item = ReportRunListItem;

const seconds = (ms: number | null) => Math.max(1, Math.round((ms ?? 0) / 1000));

/** Druga linia kolumny „Utworzono”: czas generowania, oczekiwanie, kod błędu albo data usunięcia pliku. */
function createdSub(item: Item, now: number): string {
  switch (item.state) {
    case 'SUCCEEDED':
      return t('reports.history.readyAfter', { seconds: seconds(item.durationMs) });
    case 'RUNNING':
      return t('reports.history.runningFor', {
        seconds: seconds(now - new Date(item.startedAt ?? item.createdAt).getTime()),
      });
    case 'QUEUED':
      return t('reports.history.queuedFor', { seconds: seconds(now - new Date(item.createdAt).getTime()) });
    case 'FAILED':
      return item.errorCode ?? '';
    case 'FILE_DELETED':
      return t('reports.history.fileDeleted', { date: item.fileDeletedAt ? formatDate(item.fileDeletedAt) : '' });
  }
}

const filters: FilterSpec[] = [
  { field: 'reportCode', kind: 'checklist' },
  { field: 'format', kind: 'chips' },
  { field: 'errorCode', kind: 'checklist' },
  { field: 'createdAt', kind: 'dateRange' },
];

const STATE_PRESETS: Array<{ key: string; values: Item['state'][] }> = [
  { key: 'inProgress', values: ['QUEUED', 'RUNNING'] },
  { key: 'ready', values: ['SUCCEEDED'] },
  { key: 'failed', values: ['FAILED'] },
  { key: 'deleted', values: ['FILE_DELETED'] },
];

export function ReportHistoryList() {
  const { staff } = useSession();
  const [notice, setNotice] = useState<{ text: string; error: boolean } | null>(null);
  const [now, setNow] = useState(() => Date.now());
  const [mine, setMine] = useState<number | null>(null);
  const [revision, setRevision] = useState(0);
  const listeners = useRef(new Set<(item: Item | null) => void>());

  // Czas „od 18 s” w wierszach w toku.
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 5000);
    return () => clearInterval(timer);
  }, []);

  // Licznik „Moje”: liczniki listy nie grupują po zlecającym, więc osobne zapytanie o liczbę.
  useEffect(() => {
    void api<ListResponse<Item>>(`/admin/report-runs?requestedBy=${staff.id}&pageSize=10`)
      .then((r) => setMine(r.total))
      .catch(() => setMine(null));
  }, [staff.id, revision]);

  const refresh = useCallback(() => {
    setRevision((n) => n + 1);
    listeners.current.forEach((listener) => listener(null));
  }, []);
  useStaffFeed({ reportReady: refresh, reconnected: refresh });
  const subscribe = useCallback((listener: (item: Item | null) => void) => {
    listeners.current.add(listener);
    return () => void listeners.current.delete(listener);
  }, []);

  const onChanged = useCallback(
    (text: string | null, error = false) => {
      setNotice(text ? { text, error } : null);
      if (!error) refresh();
    },
    [refresh],
  );

  const presets = useMemo(
    () => ({
      facets: ['state'],
      total: (facets: Record<string, Record<string, number>>) =>
        Object.values(facets.state ?? {}).reduce((a, b) => a + b, 0),
      items: [
        {
          key: 'mine',
          label: t('reports.history.quick.mine'),
          filters: [{ field: 'requestedBy', op: 'eq', values: [staff.id] }],
          count: () => mine ?? 0,
        } satisfies QuickPreset,
        ...STATE_PRESETS.map((preset): QuickPreset => ({
          key: preset.key,
          label: t.dynamic(`reports.history.quick.${preset.key}`),
          filters: [{ field: 'state', op: 'eq', values: preset.values }],
          count: (facets) => preset.values.reduce((sum, v) => sum + (facets.state?.[v] ?? 0), 0),
        })),
      ],
    }),
    [staff.id, mine],
  );

  const columns: Column<Item>[] = [
    { field: 'shortId', width: '84px', render: (r) => <span className="code ink">{r.shortId}</span> },
    { field: 'reportName', width: 'minmax(0,1fr)', render: (r) => <span className="strong-500">{r.reportName}</span> },
    {
      field: 'params',
      width: 'minmax(0,1.2fr)',
      render: (r) => {
        const params = storedParams(r.params);
        return (
          <span className="stack">
            <span className="num">{paramsLine(params)}</span>
            <span className="small">{paramsSub(params)}</span>
          </span>
        );
      },
    },
    { field: 'format', width: '56px', render: (r) => <span className="strong-500 small-ink">{r.format}</span> },
    {
      field: 'requestedByName',
      width: 'minmax(0,0.9fr)',
      render: (r) => (
        <span className="stack">
          <span>{r.requestedByName}</span>
          <span className="small">{r.requestedByRoles.join(', ')}</span>
        </span>
      ),
    },
    {
      field: 'createdAt',
      width: '140px',
      render: (r) => (
        <span className="stack" title={formatDateTime(r.createdAt)}>
          <span className="num">{formatWhen(r.createdAt)}</span>
          <span className="small">{createdSub(r, now)}</span>
        </span>
      ),
    },
    { field: 'state', width: '116px', render: (r) => <RunState state={r.state} /> },
    {
      field: 'fileId',
      width: '170px',
      render: (r) => (
        <span className="pr-actions-cell rp-history-actions">
          <Actions item={r} onChanged={onChanged} />
        </span>
      ),
    },
  ];

  return (
    <>
      {notice && <Banner kind={notice.error ? 'danger' : 'ok'}>{notice.text}</Banner>}
      <ResourceList<Item>
        resource={reportRunsResource}
        basePath={REPORTS_PATHS.history}
        columns={columns}
        presets={presets}
        filters={filters}
        rowLabel={(r) => `${r.reportName} ${r.shortId}`}
        itemHref={() => null}
        summary={() => t('reports.subtitle')}
        emptyIcon={<ChartBarsIcon size={22} />}
        tabs={<ReportsTabs revision={revision} />}
        createLabel={null}
        selectable={false}
        subscribe={subscribe}
      />
      <div className="notice info">
        <span className="ic">
          <InfoIcon size={15} />
        </span>
        <span>{t('reports.history.note')}</span>
      </div>
    </>
  );
}

/** Pobranie albo „Uruchom ponownie” i menu „⋯” z pozostałymi poleceniami (makieta raporty-historia). */
function Actions({ item, onChanged }: { item: Item; onChanged: (text: string | null, error?: boolean) => void }) {
  const [busy, setBusy] = useState(false);
  const rerun = async () => {
    setBusy(true);
    try {
      const created = await api<ReportRunView>(`/admin/report-runs/${item.id}/retry`, { method: 'POST' });
      onChanged(t('reports.history.rerunDone', { id: created.shortId }));
    } catch (e) {
      onChanged(reportErrorMessage(e), true);
    } finally {
      setBusy(false);
    }
  };
  const download = () => void openReportFile(item).catch((e: unknown) => onChanged(reportErrorMessage(e), true));
  const finished = item.state !== 'QUEUED' && item.state !== 'RUNNING';
  return (
    <>
      {item.state === 'SUCCEEDED' ? (
        <button type="button" className="link pr-link-btn" onClick={download}>
          <DownloadIcon size={14} />
          {t('reports.history.download')}
        </button>
      ) : item.state === 'FAILED' || item.state === 'FILE_DELETED' ? (
        <button type="button" className="link pr-link-btn" disabled={busy} onClick={() => void rerun()}>
          {t('reports.history.rerun')}
        </button>
      ) : null}
      <RowMenu
        label={t('reports.history.menu', { id: item.shortId })}
        items={[
          ...(item.state === 'SUCCEEDED'
            ? [
                {
                  key: 'download',
                  icon: <DownloadIcon size={15} />,
                  label: t.dynamic(`reports.export.download.${item.format}`),
                  sub: item.fileSizeBytes !== null ? formatFileSize(item.fileSizeBytes) : undefined,
                  onSelect: download,
                },
              ]
            : []),
          {
            key: 'preview',
            icon: <ArrowRightIcon size={15} />,
            label: t('reports.history.openPreview'),
            href: previewHref(item.reportCode, storedParams(item.params)),
          },
          ...(finished
            ? [
                {
                  key: 'rerun',
                  icon: <RetryIcon size={15} />,
                  label: t('reports.history.rerunWithParams'),
                  sub: t('reports.history.rerunSub'),
                  onSelect: () => void rerun(),
                },
              ]
            : []),
          {
            key: 'copy',
            icon: <CopyIcon size={15} />,
            label: t('reports.history.copyId', { id: item.shortId }),
            onSelect: () =>
              void navigator.clipboard
                .writeText(item.shortId)
                .then(() => onChanged(t('reports.history.copied', { id: item.shortId })))
                .catch(() => undefined),
          },
        ]}
      />
    </>
  );
}

interface MenuItem {
  key: string;
  icon: ReactNode;
  label: string;
  sub?: string;
  href?: string;
  onSelect?: () => void;
}

/** Menu wiersza: przycisk „⋯”, lista poleceń (`role="menu"`), strzałki, Escape i kliknięcie poza menu zamykają. */
function RowMenu({ label, items }: { label: string; items: MenuItem[] }) {
  // Menu w warstwie `fixed` przy przycisku: komórka wiersza listy przycina zawartość (`overflow: hidden`).
  const [open, setOpen] = useState<{ top: number; right: number } | null>(null);
  const ref = useRef<HTMLSpanElement>(null);
  useEffect(() => {
    if (!open) return;
    const close = () => setOpen(null);
    const onDown = (e: MouseEvent) => {
      if (!ref.current?.contains(e.target as Node)) close();
    };
    document.addEventListener('mousedown', onDown);
    window.addEventListener('scroll', close, true);
    window.addEventListener('resize', close);
    ref.current?.querySelector<HTMLElement>('[role="menuitem"]')?.focus();
    return () => {
      document.removeEventListener('mousedown', onDown);
      window.removeEventListener('scroll', close, true);
      window.removeEventListener('resize', close);
    };
  }, [open]);
  const toggle = (button: HTMLElement) => {
    if (open) return setOpen(null);
    const rect = button.getBoundingClientRect();
    setOpen({ top: rect.bottom + 4, right: window.innerWidth - rect.right });
  };
  const onKey = (e: KeyboardEvent) => {
    const entries = [...(ref.current?.querySelectorAll<HTMLElement>('[role="menuitem"]') ?? [])];
    const at = entries.indexOf(document.activeElement as HTMLElement);
    if (e.key === 'Escape') {
      setOpen(null);
      ref.current?.querySelector<HTMLElement>('.rp-menu-btn')?.focus();
    } else if (e.key === 'ArrowDown') {
      e.preventDefault();
      entries[(at + 1) % entries.length]?.focus();
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      entries[(at - 1 + entries.length) % entries.length]?.focus();
    }
  };
  return (
    <span className="rp-menu-anchor" ref={ref} onKeyDown={onKey}>
      <button
        type="button"
        className="icon-btn plain rp-menu-btn"
        aria-label={label}
        aria-haspopup="menu"
        aria-expanded={open !== null}
        onClick={(e) => toggle(e.currentTarget)}
      >
        <MoreIcon size={16} />
      </button>
      {open && (
        <span className="rp-menu" role="menu" aria-label={label} style={{ top: open.top, right: open.right }}>
          {items.map((entry) => {
            const body = (
              <>
                <span className="rp-menu-ic">{entry.icon}</span>
                <span className="stack">
                  <span>{entry.label}</span>
                  {entry.sub && <span className="small">{entry.sub}</span>}
                </span>
              </>
            );
            return entry.href ? (
              <Link
                key={entry.key}
                role="menuitem"
                className="rp-menu-item"
                href={entry.href}
                onClick={() => setOpen(null)}
              >
                {body}
              </Link>
            ) : (
              <button
                key={entry.key}
                type="button"
                role="menuitem"
                className="rp-menu-item"
                onClick={() => {
                  setOpen(null);
                  entry.onSelect?.();
                }}
              >
                {body}
              </button>
            );
          })}
        </span>
      )}
    </span>
  );
}
