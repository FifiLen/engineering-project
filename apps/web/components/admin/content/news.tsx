'use client';

/**
 * Aktualności (makieta tresci-aktualnosci, ADR 0062, ADR 0065): lista według wzorca widoku tabeli (ADR 0031) ze
 * stanem liczonym ze statusu i dat (szkic, zaplanowana, opublikowana, wygasła, archiwum) i edytor w panelu bocznym:
 * adres (stały po pierwszej publikacji), zajawka, treść w Markdown, grafika z biblioteki, publikacja od–do w czasie
 * polskim, „Zaplanuj” albo „Opublikuj teraz”. Aktualności są tylko na stronie.
 */
import {
  headingId,
  NEWS_BODY_MAX,
  NEWS_LEAD_MAX,
  NEWS_STATES,
  NEWS_TITLE_MAX,
  newsResource,
  parseMarkdown,
  type ContentHistoryEntry,
  type ContentIssueView,
  type ContentStatus,
  type MediaListItem,
  type MediaRef,
  type NewsDetails,
  type NewsListItem,
  type NewsState,
} from '@hulajnogi/shared';
import { useRouter } from 'next/navigation';
import { useCallback, useEffect, useRef, useState } from 'react';
import { api, errorMessage } from '../../../lib/api';
import { formatClock, t } from '../../../lib/i18n';
import { useSession } from '../../../lib/session';
import { Banner } from '../access/common';
import { ConfirmDialog } from '../confirm-dialog';
import type { FilterSpec } from '../filter-drawer';
import {
  AlertIcon,
  ArchiveIcon,
  CalendarIcon,
  ClockIcon,
  CloseIcon,
  DocumentIcon,
  ImageIcon,
  TrashIcon,
} from '../icons';
import { ResourceList, type Column } from '../resource-list';
import {
  apiIssues,
  changedAt,
  ContentTabs,
  CONTENT_PATHS,
  Counter,
  HistoryList,
  issueMessage,
  mediaUrl,
  textLength,
  useContentHistory,
} from './content-common';
import { MediaPicker } from './media-dialogs';
import { MarkdownField } from './md-editor';

const STATE_PILL: Record<NewsState, string> = {
  DRAFT: 'pill warn',
  SCHEDULED: 'pill',
  PUBLISHED: 'pill accent',
  EXPIRED: 'pill muted',
  ARCHIVED: 'pill muted',
};

export function NewsStatePill({ state }: { state: NewsState }) {
  return (
    <span className={STATE_PILL[state]}>
      {state === 'SCHEDULED' && <ClockIcon size={12} />}
      {t.dynamic(`content.newsState.${state}`)}
    </span>
  );
}

// --- Czas polski w polach `datetime-local` (arc42 §8.5) -----------------------------------------------

const ZONE = 'Europe/Warsaw';
const partsFormat = new Intl.DateTimeFormat('en-CA', {
  timeZone: ZONE,
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
  hour: '2-digit',
  minute: '2-digit',
  hourCycle: 'h23',
});

/** „2026-11-20T08:00” w czasie polskim dla pola formularza. */
export function toWarsawInput(iso: string | null): string {
  if (!iso) return '';
  const p = Object.fromEntries(partsFormat.formatToParts(new Date(iso)).map((x) => [x.type, x.value]));
  return `${p.year}-${p.month}-${p.day}T${p.hour}:${p.minute}`;
}

/** Przesunięcie strefy Europe/Warsaw względem UTC w chwili `date` (minuty). */
function warsawOffset(date: Date): number {
  const p = Object.fromEntries(partsFormat.formatToParts(date).map((x) => [x.type, x.value]));
  const asUtc = Date.UTC(+p.year!, +p.month! - 1, +p.day!, +p.hour!, +p.minute!);
  return Math.round((asUtc - Math.floor(date.getTime() / 60_000) * 60_000) / 60_000);
}

/** Czas z pola (czas polski) jako chwila UTC; poprawka przesunięcia przy zmianie czasu letniego. */
export function fromWarsawInput(value: string): string | null {
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(value)) return null;
  const naive = new Date(`${value}:00Z`).getTime();
  let instant = naive - warsawOffset(new Date(naive)) * 60_000;
  instant = naive - warsawOffset(new Date(instant)) * 60_000;
  return new Date(instant).toISOString();
}

const dayMonth = new Intl.DateTimeFormat('pl', { day: 'numeric', month: 'short', timeZone: ZONE });
const longWhen = new Intl.DateTimeFormat('pl', {
  weekday: 'long',
  day: 'numeric',
  month: 'long',
  hour: 'numeric',
  minute: '2-digit',
  timeZone: ZONE,
});
const when = (iso: string) => t('content.news.when', { date: dayMonth.format(new Date(iso)), time: formatClock(iso) });

/** Kolumna „Publikacja”: od kiedy i do kiedy (makieta). */
function publication(item: NewsListItem): { main: string; sub: string } {
  if (item.state === 'DRAFT' || (!item.publishFrom && item.status !== 'PUBLISHED'))
    return {
      main: t('content.news.unpublished'),
      sub: t('content.news.by', {
        name: item.updatedByName ?? t('content.history.seed'),
        when: changedAt(item.updatedAt),
      }),
    };
  const from = item.publishFrom ? when(item.publishFrom) : changedAt(item.updatedAt);
  if (item.state === 'EXPIRED' && item.publishTo)
    return {
      main: t('content.news.range', { from, to: when(item.publishTo) }),
      sub: t('content.news.expired', { when: when(item.publishTo) }),
    };
  return {
    main: t('content.news.from', { when: from }),
    sub: item.publishTo ? t('content.news.to', { when: when(item.publishTo) }) : t('content.news.noEnd'),
  };
}

/** Odświeżenie listy po zapisie w panelu bocznym (lista ma własny stan w adresie URL). */
function useListRefresh() {
  const listeners = useRef(new Set<(item: NewsListItem | null) => void>());
  const subscribe = useCallback((listener: (item: NewsListItem | null) => void) => {
    listeners.current.add(listener);
    return () => {
      listeners.current.delete(listener);
    };
  }, []);
  const refresh = useCallback(() => {
    for (const listener of listeners.current) listener(null);
  }, []);
  return { subscribe, refresh };
}

export function NewsPage({ creating = false }: { creating?: boolean }) {
  const router = useRouter();
  const [openId, setOpenId] = useState<string | 'new' | null>(creating ? 'new' : null);
  const { subscribe, refresh } = useListRefresh();

  const columns: Column<NewsListItem>[] = [
    {
      field: 'title',
      width: 'minmax(0,2.4fr)',
      render: (item) => (
        <span className="ct-news-title">
          <span className="ct-thumb wide">
            {item.media ? (
              <img src={mediaUrl(item.media.url)} alt="" width={56} height={40} />
            ) : (
              <DocumentIcon size={16} />
            )}
          </span>
          <span className="stack">
            <span className="strong ellipsis">{item.title}</span>
            <span className="mono-key ellipsis">{t('content.news.path', { slug: item.slug })}</span>
          </span>
        </span>
      ),
    },
    { field: 'state', width: '140px', render: (item) => <NewsStatePill state={item.state} /> },
    {
      field: 'publishFrom',
      width: 'minmax(0,1fr)',
      render: (item) => {
        const p = publication(item);
        return (
          <span className="stack">
            <span>{p.main}</span>
            <small className="muted">{p.sub}</small>
          </span>
        );
      },
    },
  ];
  const filters: FilterSpec[] = [
    { field: 'state', kind: 'checklist' },
    { field: 'publishFrom', kind: 'dateRange' },
    { field: 'updatedAt', kind: 'dateRange' },
  ];
  const close = () => {
    setOpenId(null);
    if (creating) router.replace(CONTENT_PATHS.news);
  };

  return (
    <>
      <ResourceList<NewsListItem>
        resource={newsResource}
        basePath={CONTENT_PATHS.news}
        columns={columns}
        quick={{ field: 'state', values: NEWS_STATES, pluralKey: 'content.newsStatePlural' }}
        filters={filters}
        rowLabel={(item) => item.title}
        summary={() => t('content.lead')}
        emptyIcon={<DocumentIcon size={22} />}
        createLabel={t('resource.news.new')}
        selectable={false}
        onOpen={(item) => setOpenId(item.id)}
        activeId={openId}
        subscribe={subscribe}
        tabs={<ContentTabs />}
      />
      <p className="small ct-note">{t('content.news.note')}</p>
      {openId && (
        <NewsEditor
          key={openId}
          id={openId === 'new' ? null : openId}
          onClose={close}
          onSaved={(saved) => {
            refresh();
            if (saved) setOpenId(saved.id);
            else close();
          }}
        />
      )}
    </>
  );
}

interface NewsDraft {
  title: string;
  slug: string;
  lead: string;
  bodyMd: string;
  media: MediaRef | null;
  publishFrom: string;
  publishTo: string;
}

const toDraft = (news: NewsDetails | null): NewsDraft => ({
  title: news?.title ?? '',
  slug: news?.slug ?? '',
  lead: news?.lead ?? '',
  bodyMd: news?.bodyMd ?? '',
  media: news?.media ?? null,
  publishFrom: toWarsawInput(news?.publishFrom ?? null),
  publishTo: toWarsawInput(news?.publishTo ?? null),
});

const asMediaRef = (media: MediaListItem): MediaRef => ({
  id: media.id,
  key: media.key,
  url: media.url,
  altText: media.altText,
  caption: media.caption,
  width: media.width,
  height: media.height,
});

/** Panel edycji aktualności (makieta tresci-aktualnosci). */
function NewsEditor({
  id,
  onClose,
  onSaved,
}: {
  id: string | null;
  onClose: () => void;
  onSaved: (news: NewsDetails | null) => void;
}) {
  const { can } = useSession();
  const readOnly = !can('content.write');
  const [news, setNews] = useState<NewsDetails | null>(null);
  const [draft, setDraft] = useState<NewsDraft>(() => toDraft(null));
  const [slugTouched, setSlugTouched] = useState(false);
  const [restoredFrom, setRestoredFrom] = useState<number | null>(null);
  const [issues, setIssues] = useState<ContentIssueView[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [picker, setPicker] = useState(false);
  const [showHistory, setShowHistory] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const history = useContentHistory(id ? `/admin/news/${id}/history` : null, news?.version);

  useEffect(() => {
    if (!id) return;
    api<NewsDetails>(`/admin/news/${id}`)
      .then((n) => {
        setNews(n);
        setDraft(toDraft(n));
        setSlugTouched(true);
      })
      .catch((e: unknown) => setError(errorMessage(e)));
  }, [id]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && !picker && onClose();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose, picker]);

  const set = (patch: Partial<NewsDraft>) => setDraft((d) => ({ ...d, ...patch }));
  // Adres z tytułu tą samą funkcją co kotwice (ADR 0063), dopóki operator go nie zmieni; po publikacji stały.
  const slugLocked = Boolean(news?.firstPublishedAt);
  const slug = slugTouched || slugLocked ? draft.slug : headingId(draft.title, 100);
  const fromIso = draft.publishFrom ? fromWarsawInput(draft.publishFrom) : null;
  const toIso = draft.publishTo ? fromWarsawInput(draft.publishTo) : null;
  const future = fromIso !== null && Date.parse(fromIso) > Date.now();
  const datesInvalid = fromIso !== null && toIso !== null && Date.parse(toIso) <= Date.parse(fromIso);
  const bodyBlocked = parseMarkdown(draft.bodyMd, 'document').issues.length > 0;
  const blocked =
    !draft.title.trim() ||
    !draft.lead.trim() ||
    !draft.bodyMd.trim() ||
    textLength(draft.title) > NEWS_TITLE_MAX ||
    textLength(draft.lead) > NEWS_LEAD_MAX ||
    textLength(draft.bodyMd) > NEWS_BODY_MAX ||
    bodyBlocked ||
    datesInvalid ||
    !/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(slug);
  const status: ContentStatus = news?.status ?? 'DRAFT';
  const state: NewsState = news?.state ?? 'DRAFT';

  async function save(next: ContentStatus) {
    setBusy(true);
    setError(null);
    try {
      const body = {
        title: draft.title.trim(),
        slug: slugLocked ? null : slug,
        lead: draft.lead.trim(),
        bodyMd: draft.bodyMd,
        mediaId: draft.media?.id ?? null,
        publishFrom: fromIso,
        publishTo: toIso,
        status: next,
      };
      const saved = news
        ? await api<NewsDetails>(`/admin/news/${news.id}`, {
            method: 'PATCH',
            json: { ...body, slug: slugLocked ? news.slug : slug, version: news.version, restoredFrom },
          })
        : await api<NewsDetails>('/admin/news', { method: 'POST', json: body });
      setNews(saved);
      setDraft(toDraft(saved));
      setRestoredFrom(null);
      setIssues([]);
      onSaved(saved);
    } catch (e) {
      setIssues(apiIssues(e));
      setError(errorMessage(e));
    } finally {
      setBusy(false);
    }
  }

  async function remove() {
    if (!news) return;
    setConfirmDelete(false);
    try {
      await api(`/admin/news/${news.id}?version=${news.version}`, { method: 'DELETE' });
      onSaved(null);
    } catch (e) {
      setError(errorMessage(e));
    }
  }

  async function restore(entry: ContentHistoryEntry) {
    const after = entry.after ?? {};
    const text = (v: unknown) => (typeof v === 'string' ? v : '');
    const mediaId = typeof after.mediaId === 'string' ? after.mediaId : null;
    const media =
      mediaId === null
        ? null
        : mediaId === draft.media?.id
          ? draft.media
          : await api<MediaRef>(`/admin/media/${mediaId}`).catch(() => null);
    setDraft((d) => ({
      ...d,
      title: text(after.title) || d.title,
      lead: text(after.lead) || d.lead,
      bodyMd: text(after.bodyMd) || d.bodyMd,
      media,
      publishFrom: toWarsawInput(typeof after.publishFrom === 'string' ? after.publishFrom : null),
      publishTo: toWarsawInput(typeof after.publishTo === 'string' ? after.publishTo : null),
    }));
    setRestoredFrom(entry.auditId);
    setShowHistory(false);
  }

  const otherIssues = issues.filter((i) => i.field !== 'bodyMd');
  return (
    <aside className="rental-drawer ct-drawer" aria-label={news?.title ?? t('resource.news.new')}>
      <div className="rd-head">
        <div className="rd-title">
          <h2>{news?.title || draft.title || t('resource.news.new')}</h2>
          <NewsStatePill state={state} />
        </div>
        <button type="button" className="icon-btn plain" aria-label={t('common.close')} onClick={onClose}>
          <CloseIcon size={18} />
        </button>
      </div>
      <div className="rd-body ct-drawer-body">
        {error && <Banner kind="danger">{error}</Banner>}
        <div className="field">
          <div className="label-row">
            <label className="label" htmlFor="news-title">
              {t('resource.news.fields.title')}
            </label>
            <Counter value={textLength(draft.title)} max={NEWS_TITLE_MAX} />
          </div>
          <input
            id="news-title"
            className="input"
            value={draft.title}
            readOnly={readOnly}
            onChange={(e) => set({ title: e.target.value })}
          />
        </div>
        <label className="field">
          <span className="label">{t('content.news.address')}</span>
          <span className="ct-prefix">
            <span className="muted">{t('content.news.pathPrefix')}</span>
            <input
              className="mono"
              value={slug}
              readOnly={readOnly || slugLocked}
              onChange={(e) => {
                setSlugTouched(true);
                set({ slug: e.target.value.toLowerCase() });
              }}
            />
          </span>
          {slugLocked && <span className="hint">{t('content.news.slugLocked')}</span>}
        </label>
        <div className="field">
          <div className="label-row">
            <label className="label" htmlFor="news-lead">
              {t('resource.news.fields.lead')} <span className="opt">{t('content.news.leadNote')}</span>
            </label>
            <Counter value={textLength(draft.lead)} max={NEWS_LEAD_MAX} />
          </div>
          <textarea
            id="news-lead"
            className="input"
            rows={3}
            value={draft.lead}
            readOnly={readOnly}
            onChange={(e) => set({ lead: e.target.value })}
          />
        </div>
        <MarkdownField
          id="news-body"
          label={t('content.fields.bodyMd')}
          labelNote={t('content.editor.markdown')}
          value={draft.bodyMd}
          onChange={(bodyMd) => set({ bodyMd })}
          profile="document"
          max={NEWS_BODY_MAX}
          readOnly={readOnly}
          layout="toggle"
          minRows={6}
          serverIssues={issues.filter((i) => i.field === 'bodyMd')}
        />
        <div className="field">
          <span className="label">
            {t('content.fields.mediaId')} <span className="opt">{t('common.optional')}</span>
          </span>
          <div className="ct-media-field">
            {draft.media ? (
              <>
                <span className="ct-thumb wide lg">
                  <img src={mediaUrl(draft.media.url)} alt="" width={88} height={56} />
                </span>
                <span className="grow stack">
                  <b className="ellipsis">{draft.media.key}</b>
                  <span className="small ellipsis">{t('content.editor.alt', { alt: draft.media.altText })}</span>
                </span>
              </>
            ) : (
              <span className="grow small">{t('content.editor.noMedia')}</span>
            )}
            {!readOnly && (
              <span className="actions">
                {draft.media && (
                  <button type="button" className="btn" onClick={() => set({ media: null })}>
                    {t('content.editor.removeMedia')}
                  </button>
                )}
                <button type="button" className="btn" onClick={() => setPicker(true)}>
                  <ImageIcon size={15} />
                  {draft.media ? t('content.editor.changeMediaShort') : t('content.editor.pickMedia')}
                </button>
              </span>
            )}
          </div>
        </div>
        <div className="field">
          <span className="label">{t('content.news.publication')}</span>
          <div className="ct-two">
            <label className="field">
              <span className="small">{t('content.news.fromLabel')}</span>
              <input
                type="datetime-local"
                className="input"
                value={draft.publishFrom}
                readOnly={readOnly}
                onChange={(e) => set({ publishFrom: e.target.value })}
              />
            </label>
            <label className="field">
              <span className="small">{t('content.news.toLabel')}</span>
              <input
                type="datetime-local"
                className="input"
                value={draft.publishTo}
                readOnly={readOnly}
                aria-invalid={datesInvalid}
                onChange={(e) => set({ publishTo: e.target.value })}
              />
            </label>
          </div>
          {datesInvalid && (
            <span className="err ct-line">
              <AlertIcon size={14} />
              {t('content.issues.NEWS_DATES_INVALID')}
            </span>
          )}
          {!readOnly && status !== 'ARCHIVED' && (
            <div className="ct-info">
              <ClockIcon size={16} />
              <span>
                {future
                  ? t('content.news.scheduleInfo', { when: longWhen.format(new Date(fromIso!)) })
                  : t('content.news.publishInfo')}
                {toIso && ` ${t('content.news.endInfo', { when: longWhen.format(new Date(toIso)) })}`}
              </span>
            </div>
          )}
        </div>
        {otherIssues.map((issue, i) => (
          <span key={i} className="err ct-line">
            <AlertIcon size={14} />
            {issueMessage(issue)}
          </span>
        ))}
        {news && (
          <div className="ct-panel-meta">
            <span className="small">
              {t('content.faq.meta', {
                version: news.version,
                name: news.updatedByName ?? t('content.history.seed'),
                when: changedAt(news.updatedAt),
              })}
              {restoredFrom !== null && ` · ${t('content.history.restoredPending')}`}
            </span>
            <button type="button" className="link" onClick={() => setShowHistory((v) => !v)}>
              {t('content.faq.history', { count: history?.length ?? 0 })}
            </button>
          </div>
        )}
        {showHistory && <HistoryList entries={history} canRestore={!readOnly} onRestore={(e) => void restore(e)} />}
      </div>
      {!readOnly && (
        <div className="rd-foot">
          {news && status !== 'ARCHIVED' && (
            <button type="button" className="btn" disabled={busy || blocked} onClick={() => void save('ARCHIVED')}>
              <ArchiveIcon size={15} />
              {t('content.actions.archive')}
            </button>
          )}
          {news && status !== 'PUBLISHED' && (
            <button
              type="button"
              className="btn danger"
              aria-label={t('content.actions.delete')}
              title={t('content.actions.delete')}
              disabled={busy}
              onClick={() => setConfirmDelete(true)}
            >
              <TrashIcon size={15} />
            </button>
          )}
          <span className="spacer" />
          {status === 'PUBLISHED' ? (
            <>
              <button type="button" className="btn" disabled={busy || blocked} onClick={() => void save('DRAFT')}>
                {t('content.actions.unpublish')}
              </button>
              <button
                type="button"
                className="btn primary"
                disabled={busy || blocked}
                onClick={() => void save('PUBLISHED')}
              >
                {t('common.save')}
              </button>
            </>
          ) : (
            <>
              <button type="button" className="btn" disabled={busy || blocked} onClick={() => void save('DRAFT')}>
                {t('content.actions.saveDraft')}
              </button>
              <button
                type="button"
                className="btn primary"
                disabled={busy || blocked}
                onClick={() => void save('PUBLISHED')}
              >
                {future ? <CalendarIcon size={15} /> : null}
                {future ? t('content.news.schedule') : t('content.news.publishNow')}
              </button>
            </>
          )}
        </div>
      )}
      <MediaPicker
        open={picker}
        title={t('content.news.pickerTitle')}
        selectedId={draft.media?.id ?? null}
        onClose={() => setPicker(false)}
        onSelect={(media) => {
          set({ media: asMediaRef(media) });
          setPicker(false);
        }}
      />
      <ConfirmDialog
        open={confirmDelete}
        danger
        title={t('content.news.deleteTitle')}
        body={t('content.news.deleteBody')}
        action={t('content.actions.delete')}
        onConfirm={() => void remove()}
        onClose={() => setConfirmDelete(false)}
      />
    </aside>
  );
}
