'use client';

/**
 * Zakładka Wygenerowane (ADR 0068, makieta wydruki-wygenerowane): zasób `generated-documents` na wzorcu listy
 * (ADR 0031) z szybkimi filtrami stanów, filtrem rodzaju i zlecającego (domyślnie bez paragonów klientów),
 * wyszukiwaniem po obiekcie, operatorze i identyfikatorze ze stopki, pobraniem, „Ponów” i „Wygeneruj ponownie”
 * po usunięciu plików. API zawęża listę do rodzajów z uprawnieniem odczytu, a klienta podaje tylko z `users.read`.
 */
import {
  generatedDocumentsResource,
  type DocumentType,
  type GeneratedDocumentListItem,
  type GeneratedDocumentView,
} from '@hulajnogi/shared';
import Link from 'next/link';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { useCallback, useEffect, useRef, useState } from 'react';
import { api, errorMessage } from '../../../lib/api';
import { formatDate, formatDateTime, t } from '../../../lib/i18n';
import { useStaffFeed } from '../../../lib/realtime';
import { useSession } from '../../../lib/session';
import { Banner } from '../access/common';
import type { FilterSpec } from '../filter-drawer';
import { DownloadIcon, InfoIcon, PrinterIcon } from '../icons';
import { valueLabel } from '../labels';
import { ResourceList, type Column, type QuickPreset } from '../resource-list';
import { formatWhen, openDocumentFile, PrintsTabs, PRINTS_PATHS, shortId, typeName } from './prints-common';

type Item = GeneratedDocumentListItem;

/** Karta obiektu wydruku; korekta salda (wpis księgi) nie ma własnej karty. */
const ENTITY_LINKS: Partial<Record<DocumentType, { path: string; permission: string }>> = {
  RECEIPT: { path: '/admin/platnosci/paragony', permission: 'payments.read' },
  RENTAL_CONFIRMATION: { path: '/admin/przejazdy', permission: 'rentals.read' },
  SERVICE_PROTOCOL: { path: '/admin/zadania', permission: 'service.read' },
  SCOOTER_CARD: { path: '/admin/flota', permission: 'scooters.read' },
  SCOOTER_LABEL: { path: '/admin/flota', permission: 'scooters.read' },
  INCIDENT_REPORT: { path: '/admin/zgloszenia', permission: 'tickets.read' },
};

function EntityLink({ item }: { item: Item }) {
  const { can } = useSession();
  const link = ENTITY_LINKS[item.documentType];
  if (!link || !can(link.permission)) return <span className="strong-500">{item.entityLabel}</span>;
  return (
    <Link className="link pr-entity" href={`${link.path}/${item.entityRef}`}>
      {item.entityLabel}
    </Link>
  );
}

const seconds = (ms: number | null) => Math.max(1, Math.round((ms ?? 0) / 1000));

/** Druga linia kolumny „Utworzono”: czas generowania, oczekiwanie, kod błędu albo data usunięcia plików. */
function createdSub(item: Item, now: number): string {
  switch (item.state) {
    case 'SUCCEEDED':
      return t('prints.generated.readyAfter', { seconds: seconds(item.durationMs) });
    case 'RUNNING':
      return t('prints.generated.runningFor', {
        seconds: seconds(now - new Date(item.startedAt ?? item.createdAt).getTime()),
      });
    case 'QUEUED':
      return t('prints.generated.queuedFor', { seconds: seconds(now - new Date(item.createdAt).getTime()) });
    case 'FAILED':
      return item.errorCode ?? '';
    case 'DELETED':
      return t('prints.generated.filesDeleted', { date: item.filesDeletedAt ? formatDate(item.filesDeletedAt) : '' });
  }
}

const STATE_PILL: Record<Item['state'], string> = {
  QUEUED: 'pill sm',
  RUNNING: 'pr-live',
  SUCCEEDED: 'pill accent sm',
  FAILED: 'pill danger sm',
  DELETED: 'pill muted sm',
};

/** Pobranie, „Ponów” albo „Wygeneruj ponownie”; nowy wydruk z ponowienia odświeża listę. */
function Actions({ item, onChanged }: { item: Item; onChanged: (message: string | null, error?: boolean) => void }) {
  const { can } = useSession();
  const [busy, setBusy] = useState(false);
  const retry = async () => {
    setBusy(true);
    try {
      const created = await api<GeneratedDocumentView>(`/admin/documents/${item.id}/retry`, { method: 'POST' });
      onChanged(t('prints.generated.retried', { id: shortId(created.id) }));
    } catch (e) {
      onChanged(errorMessage(e), true);
    } finally {
      setBusy(false);
    }
  };
  // Plik z danymi klienta (maskowanie wypalone przy wydruku): bez `users.read` API daje 404 na pobranie i ponowienie.
  if (item.customerDataVisible && !can('users.read') && item.state !== 'QUEUED' && item.state !== 'RUNNING') {
    return (
      <span className="muted" title={t('prints.generated.customerDataHiddenHint')}>
        {t('prints.generated.customerDataHidden')}
      </span>
    );
  }
  if (item.state === 'SUCCEEDED') {
    const kind = item.format === 'PDF' ? 'pdf' : 'docx';
    return (
      <button
        type="button"
        className="link pr-link-btn"
        onClick={() => void openDocumentFile(item.id, kind).catch((e: unknown) => onChanged(errorMessage(e), true))}
      >
        <DownloadIcon size={14} />
        {t('prints.generated.download')}
      </button>
    );
  }
  if (item.state === 'FAILED' || item.state === 'DELETED') {
    return (
      <button type="button" className="link pr-link-btn" disabled={busy} onClick={() => void retry()}>
        {item.state === 'FAILED' ? t('prints.generated.retry') : t('prints.generated.regenerate')}
      </button>
    );
  }
  return <span className="muted">{t('common.none')}</span>;
}

const filters: FilterSpec[] = [
  { field: 'documentType', kind: 'checklist' },
  { field: 'requesterKind', kind: 'chips' },
  { field: 'format', kind: 'chips' },
  { field: 'createdAt', kind: 'dateRange' },
];

const STATE_PRESETS: Array<{ key: string; values: Item['state'][] }> = [
  { key: 'inProgress', values: ['QUEUED', 'RUNNING'] },
  { key: 'ready', values: ['SUCCEEDED'] },
  { key: 'failed', values: ['FAILED'] },
  { key: 'deleted', values: ['DELETED'] },
];

const presets = {
  facets: ['state'],
  total: (facets: Record<string, Record<string, number>>) =>
    Object.values(facets.state ?? {}).reduce((a, b) => a + b, 0),
  items: STATE_PRESETS.map((preset): QuickPreset => ({
    key: preset.key,
    label: t.dynamic(`prints.generated.quick.${preset.key}`),
    filters: [{ field: 'state', op: 'eq', values: preset.values }],
    count: (facets) => preset.values.reduce((sum, v) => sum + (facets.state?.[v] ?? 0), 0),
  })),
};

export function GeneratedList() {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const [notice, setNotice] = useState<{ text: string; error: boolean } | null>(null);
  const [now, setNow] = useState(() => Date.now());
  const listeners = useRef(new Set<(item: Item | null) => void>());

  // Widok domyślny (ADR 0068): bez paragonów zleconych przez klientów w aplikacji; filtr da się usunąć.
  const initial = useRef(true);
  useEffect(() => {
    if (!initial.current) return;
    initial.current = false;
    if (searchParams.size === 0) router.replace(`${pathname}?requesterKind=STAFF`, { scroll: false });
  }, [searchParams, pathname, router]);

  // Czas „od 6 s” w wierszach w toku.
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 5000);
    return () => clearInterval(timer);
  }, []);

  const refresh = useCallback(() => listeners.current.forEach((listener) => listener(null)), []);
  useStaffFeed({ documentReady: refresh, reconnected: refresh });
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

  const columns: Column<Item>[] = [
    { field: 'id', width: '84px', render: (d) => <span className="code ink">{shortId(d.id)}</span> },
    { field: 'entityLabel', width: '140px', render: (d) => <EntityLink item={d} /> },
    {
      field: 'templateName',
      width: 'minmax(0,1fr)',
      render: (d) => (
        <span className="stack">
          <span>
            {d.builtIn || !d.templateName
              ? t('prints.builtIn')
              : t('prints.templateVersion', { name: d.templateName, version: d.templateVersionNo ?? 0 })}
          </span>
          <span className="small">{typeName(d.documentType)}</span>
        </span>
      ),
    },
    { field: 'format', width: '52px', render: (d) => <span className="strong-500 small-ink">{d.format}</span> },
    {
      field: 'staffName',
      width: '180px',
      render: (d) =>
        d.requesterKind === 'STAFF'
          ? (d.staffName ?? t('common.none'))
          : t('prints.generated.customerApp', { name: d.userName ?? t('service.customer') }),
    },
    {
      field: 'createdAt',
      width: '132px',
      render: (d) => (
        <span className="stack" title={formatDateTime(d.createdAt)}>
          <span className="num">{formatWhen(d.createdAt)}</span>
          <span className="small">{createdSub(d, now)}</span>
        </span>
      ),
    },
    {
      field: 'state',
      width: '110px',
      render: (d) => (
        <span className={STATE_PILL[d.state]}>{valueLabel(generatedDocumentsResource, 'state', d.state)}</span>
      ),
    },
    {
      field: 'errorCode',
      width: '150px',
      render: (d) => (
        <span className="pr-actions-cell">
          <Actions item={d} onChanged={onChanged} />
        </span>
      ),
    },
  ];

  return (
    <>
      {notice && <Banner kind={notice.error ? 'danger' : 'ok'}>{notice.text}</Banner>}
      <ResourceList<Item>
        resource={generatedDocumentsResource}
        basePath={PRINTS_PATHS.generated}
        columns={columns}
        presets={presets}
        filters={filters}
        rowLabel={(d) => `${d.entityLabel} ${shortId(d.id)}`}
        itemHref={() => null}
        summary={() => t('prints.subtitle')}
        emptyIcon={<PrinterIcon size={22} />}
        tabs={<PrintsTabs />}
        createLabel={null}
        selectable={false}
        subscribe={subscribe}
      />
      <div className="notice info">
        <span className="ic">
          <InfoIcon size={15} />
        </span>
        <span>{t('prints.generated.retention')}</span>
      </div>
    </>
  );
}
