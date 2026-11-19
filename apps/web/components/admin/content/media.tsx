'use client';

/**
 * Biblioteka mediów (makiety tresci-media i tresci-media-wysylka, ADR 0064): siatka grafik z wyszukiwaniem,
 * filtrami „Używane” i „Nieużywane”, stronicowaniem i szczegółami w panelu bocznym (miejsca użycia, tekst
 * alternatywny i podpis działające wszędzie, „Zastąp plik” z tym samym identyfikatorem, usunięcie tylko grafiki
 * nieużytej i niesystemowej). Grafiki systemowe (`scooter.*`) mają klucz tylko do odczytu.
 */
import {
  contentSection,
  isContentSectionKey,
  MEDIA_ALT_MAX,
  MEDIA_ALT_MIN,
  MEDIA_CAPTION_MAX,
  MEDIA_NAME_MAX,
  type ListResponse,
  type MediaDetails,
  type MediaListItem,
  type MediaUsageView,
} from '@hulajnogi/shared';
import Link from 'next/link';
import { useEffect, useRef, useState } from 'react';
import { api, errorMessage } from '../../../lib/api';
import { formatDate, t } from '../../../lib/i18n';
import { useSession } from '../../../lib/session';
import { Banner } from '../access/common';
import { ConfirmDialog } from '../confirm-dialog';
import {
  CloseIcon,
  GlobeIcon,
  ImageIcon,
  LinkIcon,
  LockIcon,
  PhoneIcon,
  ReplaceIcon,
  ScooterIcon,
  SearchIcon,
  TrashIcon,
  UploadIcon,
} from '../icons';
import { ContentHead, CONTENT_PATHS, formatBytes, mediaUrl, sectionName } from './content-common';
import { MediaUploadDialog, uploadMediaFile } from './media-dialogs';

const PAGE_SIZE = 12;
type UsageFilter = 'all' | 'used' | 'unused';

const TYPE_LABEL: Record<string, string> = { 'image/jpeg': 'JPEG', 'image/png': 'PNG', 'image/webp': 'WebP' };

export function MediaPage() {
  const { can } = useSession();
  const [query, setQuery] = useState('');
  const [debounced, setDebounced] = useState('');
  const [usage, setUsage] = useState<UsageFilter>('all');
  const [page, setPage] = useState(1);
  const [data, setData] = useState<ListResponse<MediaListItem> | null>(null);
  const [counts, setCounts] = useState<{ all: number; used: number; unused: number } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [selected, setSelected] = useState<string | null>(null);
  const [upload, setUpload] = useState(false);
  const [revision, setRevision] = useState(0);

  useEffect(() => {
    const timer = setTimeout(() => {
      setDebounced(query.trim());
      setPage(1);
    }, 250);
    return () => clearTimeout(timer);
  }, [query]);

  useEffect(() => {
    const controller = new AbortController();
    const params = new URLSearchParams({ pageSize: String(PAGE_SIZE), page: String(page) });
    if (debounced) params.set('q', debounced);
    if (usage === 'used') params.set('usages.gte', '1');
    if (usage === 'unused') params.set('usages.lte', '0');
    api<ListResponse<MediaListItem>>(`/admin/media?${params}`, { signal: controller.signal })
      .then(setData)
      .catch((e: unknown) => {
        if ((e as Error).name !== 'AbortError') setError(errorMessage(e));
      });
    // Liczniki filtrów z tym samym wyszukiwaniem.
    const base = debounced ? `&q=${encodeURIComponent(debounced)}` : '';
    void Promise.all([
      api<ListResponse<unknown>>(`/admin/media?pageSize=10${base}`, { signal: controller.signal }),
      api<ListResponse<unknown>>(`/admin/media?pageSize=10&usages.gte=1${base}`, { signal: controller.signal }),
    ])
      .then(([all, used]) => setCounts({ all: all.total, used: used.total, unused: all.total - used.total }))
      .catch(() => undefined);
    return () => controller.abort();
  }, [debounced, usage, page, revision]);

  const pages = data ? Math.max(1, Math.ceil(data.total / PAGE_SIZE)) : 1;
  const from = data && data.total ? (page - 1) * PAGE_SIZE + 1 : 0;
  const to = data ? Math.min(data.total, page * PAGE_SIZE) : 0;

  return (
    <>
      <ContentHead
        actions={
          can('content.write') && (
            <button type="button" className="btn primary" onClick={() => setUpload(true)}>
              <UploadIcon size={16} />
              {t('content.media.add')}
            </button>
          )
        }
      />
      {error && <Banner kind="danger">{error}</Banner>}
      <div className="toolbar">
        <label className="search">
          <SearchIcon />
          <span className="visually-hidden">{t('list.search')}</span>
          <input
            type="search"
            value={query}
            placeholder={t('resource.media.searchPlaceholder')}
            onChange={(e) => setQuery(e.target.value)}
          />
        </label>
        {(['all', 'used', 'unused'] as const).map((f) => (
          <button
            key={f}
            type="button"
            className="chip"
            aria-pressed={usage === f}
            onClick={() => {
              setUsage(f);
              setPage(1);
            }}
          >
            {t.dynamic(`content.media.filter.${f}`)}
            {counts && <span className="n num">{counts[f]}</span>}
          </button>
        ))}
      </div>

      <div className="ct-media-grid" aria-busy={!data}>
        {data?.items.map((media) => (
          <button
            key={media.id}
            type="button"
            className={media.id === selected ? 'mcard on' : 'mcard'}
            aria-pressed={media.id === selected}
            onClick={() => setSelected(media.id)}
          >
            <span className="mthumb">
              <img src={mediaUrl(media.url)} alt="" loading="lazy" width={media.width} height={media.height} />
            </span>
            <span className="nm">{media.name}</span>
            <span className="mt">
              <span className="num">{t('content.media.size', { width: media.width, height: media.height })}</span>
              {media.usages > 0 ? (
                <span className="uses num">
                  <LinkIcon size={12} />
                  {media.usages}
                </span>
              ) : (
                <span className="uses zero">{t('content.media.unused')}</span>
              )}
            </span>
          </button>
        ))}
      </div>
      {data && data.items.length === 0 && (
        <div className="card ct-empty">
          <ImageIcon size={22} />
          <span>{debounced || usage !== 'all' ? t('list.noResultsTitle') : t('resource.media.emptyBody')}</span>
        </div>
      )}
      {data && data.total > 0 && (
        <div className="ct-pager">
          <span className="small">
            {t('content.media.range', { from, to, total: data.total })} · {t('content.media.sorted')}
          </span>
          <span className="right">
            {Array.from({ length: pages }, (_, i) => i + 1).map((p) => (
              <button
                key={p}
                type="button"
                className="page-btn"
                aria-current={p === page ? 'page' : undefined}
                onClick={() => setPage(p)}
              >
                {p}
              </button>
            ))}
          </span>
        </div>
      )}

      {selected && (
        <MediaDrawer
          key={selected}
          id={selected}
          onClose={() => setSelected(null)}
          onChanged={(removed) => {
            if (removed) setSelected(null);
            setRevision((n) => n + 1);
          }}
        />
      )}
      <MediaUploadDialog
        open={upload}
        onClose={() => setUpload(false)}
        onDone={() => {
          setPage(1);
          setRevision((n) => n + 1);
        }}
        takenKeys={data?.items.map((m) => m.key)}
      />
    </>
  );
}

function UsageRow({ usage }: { usage: MediaUsageView }) {
  if (usage.kind === 'CONTENT_BLOCK' && usage.sectionKey && isContentSectionKey(usage.sectionKey)) {
    const client = contentSection(usage.sectionKey).client;
    return (
      <li>
        {client === 'MOBILE' ? <PhoneIcon size={15} /> : <GlobeIcon size={15} />}
        <span className="grow">
          {t.dynamic(`content.clients.${client}`)} · {sectionName(usage.sectionKey)}
        </span>
        <Link className="link" href={`${CONTENT_PATHS.blocks}/${usage.sectionKey}`}>
          {t('content.media.usageBlock')}
        </Link>
      </li>
    );
  }
  if (usage.kind === 'NEWS')
    return (
      <li>
        <GlobeIcon size={15} />
        <span className="grow">{t('content.media.usageNewsLabel', { title: usage.label })}</span>
        <Link className="link" href={CONTENT_PATHS.news}>
          {t('content.media.usageNews')}
        </Link>
      </li>
    );
  return (
    <li>
      <ScooterIcon size={15} />
      <span className="grow">{t('content.media.usageModelLabel', { code: usage.label })}</span>
      <Link className="link" href={`/admin/modele/${usage.id}`}>
        {t('content.media.usageModel')}
      </Link>
    </li>
  );
}

/** Szczegóły grafiki (makieta tresci-media, panel po prawej). */
function MediaDrawer({
  id,
  onClose,
  onChanged,
}: {
  id: string;
  onClose: () => void;
  onChanged: (removed?: boolean) => void;
}) {
  const { can } = useSession();
  const canWrite = can('content.write');
  const [media, setMedia] = useState<MediaDetails | null>(null);
  const [name, setName] = useState('');
  const [alt, setAlt] = useState('');
  const [caption, setCaption] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [confirm, setConfirm] = useState(false);
  const file = useRef<HTMLInputElement>(null);

  const apply = (m: MediaDetails) => {
    setMedia(m);
    setName(m.name);
    setAlt(m.altText);
    setCaption(m.caption ?? '');
  };
  useEffect(() => {
    api<MediaDetails>(`/admin/media/${id}`)
      .then(apply)
      .catch((e: unknown) => setError(errorMessage(e)));
  }, [id]);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && !confirm && onClose();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose, confirm]);

  const altLength = [...alt.trim()].length;
  const altInvalid = altLength < MEDIA_ALT_MIN || altLength > MEDIA_ALT_MAX;
  const dirty = media !== null && (name !== media.name || alt !== media.altText || caption !== (media.caption ?? ''));
  const locked = media !== null && (media.isSystem || media.usages.length > 0);

  async function save() {
    if (!media) return;
    setBusy(true);
    setError(null);
    try {
      apply(
        await api<MediaDetails>(`/admin/media/${media.id}`, {
          method: 'PATCH',
          json: { version: media.version, name: name.trim(), altText: alt.trim(), caption: caption.trim() || null },
        }),
      );
      setNotice(t('content.media.saved'));
      onChanged();
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy(false);
    }
  }

  async function replace(selectedFile: File) {
    if (!media) return;
    setBusy(true);
    setError(null);
    try {
      const uploaded = await uploadMediaFile(selectedFile);
      apply(
        await api<MediaDetails>(`/admin/media/${media.id}/file`, {
          method: 'POST',
          json: { fileId: uploaded.id, version: media.version },
        }),
      );
      setNotice(t('content.media.replaced'));
      onChanged();
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy(false);
    }
  }

  async function remove() {
    if (!media) return;
    setConfirm(false);
    try {
      await api(`/admin/media/${media.id}?version=${media.version}`, { method: 'DELETE' });
      onChanged(true);
    } catch (e) {
      setError(errorMessage(e));
    }
  }

  return (
    <aside className="rental-drawer ct-drawer" aria-label={media?.name ?? t('common.loading')}>
      <div className="rd-head">
        <div className="rd-title">
          <h2 className="ellipsis">{media?.name ?? t('common.loading')}</h2>
        </div>
        <button type="button" className="icon-btn plain" aria-label={t('common.close')} onClick={onClose}>
          <CloseIcon size={18} />
        </button>
      </div>
      {media && (
        <div className="rd-body ct-drawer-body">
          {error && <Banner kind="danger">{error}</Banner>}
          {notice && <Banner kind="ok">{notice}</Banner>}
          <div className="ct-media-big">
            <img src={mediaUrl(media.url)} alt={media.altText} width={media.width} height={media.height} />
          </div>
          <span className="small">
            {TYPE_LABEL[media.contentType] ?? media.contentType}
            {' · '}
            <span className="num strong-500">
              {t('content.media.sizePx', { width: media.width, height: media.height })}
            </span>
            {' · '}
            <span className="num strong-500">{formatBytes(media.sizeBytes)}</span>
            {' · '}
            {t('content.media.added', { date: formatDate(media.createdAt) })}
          </span>
          <label className="field">
            <span className="label">{t('resource.media.fields.key')}</span>
            <span className="ct-locked">
              <input className="input mono" value={media.key} readOnly aria-readonly="true" />
              <LockIcon size={14} />
            </span>
            <span className="hint">{media.isSystem ? t('content.media.systemKey') : t('content.media.keyLocked')}</span>
          </label>
          <label className="field">
            <span className="label">{t('resource.media.fields.name')}</span>
            <input
              className="input"
              value={name}
              maxLength={MEDIA_NAME_MAX}
              readOnly={!canWrite}
              onChange={(e) => setName(e.target.value)}
            />
          </label>
          <label className="field">
            <span className="label">{t('resource.media.fields.altText')}</span>
            <textarea
              className="input"
              rows={2}
              value={alt}
              maxLength={MEDIA_ALT_MAX}
              readOnly={!canWrite}
              aria-invalid={altInvalid}
              onChange={(e) => setAlt(e.target.value)}
            />
            <span className="hint">{t('content.media.altHint')}</span>
          </label>
          <label className="field">
            <span className="label">
              {t('resource.media.fields.caption')} <span className="opt">{t('common.optional')}</span>
            </span>
            <input
              className="input"
              value={caption}
              maxLength={MEDIA_CAPTION_MAX}
              readOnly={!canWrite}
              onChange={(e) => setCaption(e.target.value)}
            />
          </label>
          <div className="field">
            <span className="label">
              {t('content.media.usagesTitle')}{' '}
              <span className="opt num">{t('content.media.count', { count: media.usages.length })}</span>
            </span>
            {media.usages.length ? (
              <ul className="ct-usages">
                {media.usages.map((u) => (
                  <UsageRow key={`${u.kind}-${u.id}`} usage={u} />
                ))}
              </ul>
            ) : (
              <span className="small">{t('content.media.noUsages')}</span>
            )}
          </div>
          {locked && (
            <div className="banner">
              <LockIcon size={16} />
              <span>
                {media.isSystem
                  ? t('content.media.lockedSystem', { count: media.usages.length })
                  : t('content.media.lockedUsed', { count: media.usages.length })}
              </span>
            </div>
          )}
        </div>
      )}
      {media && canWrite && (
        <div className="rd-foot">
          <button type="button" className="btn danger" disabled={locked || busy} onClick={() => setConfirm(true)}>
            <TrashIcon size={15} />
            {t('content.actions.delete')}
          </button>
          <span className="spacer" />
          <button type="button" className="btn" disabled={busy} onClick={() => file.current?.click()}>
            <ReplaceIcon size={15} />
            {t('content.media.replace')}
          </button>
          <input
            ref={file}
            type="file"
            hidden
            accept="image/jpeg,image/png,image/webp"
            onChange={(e) => {
              const f = e.target.files?.[0];
              e.target.value = '';
              if (f) void replace(f);
            }}
          />
          <button
            type="button"
            className="btn primary"
            disabled={!dirty || altInvalid || !name.trim() || busy}
            onClick={() => void save()}
          >
            {t('common.save')}
          </button>
        </div>
      )}
      <ConfirmDialog
        open={confirm}
        danger
        title={t('content.media.deleteTitle', { name: media?.name ?? '' })}
        body={t('content.media.deleteBody')}
        action={t('content.actions.delete')}
        onConfirm={() => void remove()}
        onClose={() => setConfirm(false)}
      />
    </aside>
  );
}
