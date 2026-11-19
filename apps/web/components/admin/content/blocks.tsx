'use client';

/**
 * Bloki treści (makieta tresci-bloki, ADR 0062): sekcje z rejestru pogrupowane według klienta (strona, aplikacja,
 * panel), ze stanem nagłówka, liczbą elementów sekcji-list i szkicami. Sekcji nie dodaje się w panelu (D1), więc
 * lista prowadzi tylko do edytora sekcji. Dane: `GET /admin/content-sections` (stan sekcji) i zasób
 * `content-blocks` (treść nagłówków i elementów).
 */
import {
  CONTENT_SECTIONS,
  inlineText,
  parseMarkdown,
  type ContentBlockListItem,
  type ContentClient,
  type ContentSectionKey,
  type ContentSectionSummary,
  type ListResponse,
  type MediaListItem,
} from '@hulajnogi/shared';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { Fragment, useEffect, useMemo, useState, type ReactNode } from 'react';
import { api, errorMessage } from '../../../lib/api';
import { t } from '../../../lib/i18n';
import { Banner } from '../access/common';
import { ChevronDownIcon, ChevronRightIcon, GlobeIcon, GripIcon, MoreIcon, PhoneIcon, SearchIcon } from '../icons';
import {
  changedAt,
  ContentHead,
  CONTENT_PATHS,
  mediaUrl,
  sectionKind,
  sectionName,
  StatusPill,
} from './content-common';

type StatusFilter = 'all' | 'drafts' | 'archived';

const CLIENT_ICON: Record<ContentClient, ReactNode> = {
  WEB: <GlobeIcon size={15} />,
  MOBILE: <PhoneIcon size={15} />,
  ADMIN: <GripIcon size={15} />,
};

/** Krótki tekst bloku do kolumny „Treść”: tytuł albo treść bez znaczników. */
function excerpt(block: Pick<ContentBlockListItem, 'title' | 'bodyMd' | 'buttonLabel'> | undefined): string {
  if (!block) return '';
  if (block.title) return block.title;
  if (block.bodyMd) {
    const first = parseMarkdown(block.bodyMd, 'faq').blocks[0];
    if (first) return first.type === 'list' ? first.items.map(inlineText).join(', ') : inlineText(first.children);
  }
  return block.buttonLabel ?? '';
}

export const sectionHref = (key: string) => `${CONTENT_PATHS.blocks}/${key}`;

export function BlocksPage() {
  const router = useRouter();
  const [sections, setSections] = useState<ContentSectionSummary[] | null>(null);
  const [blocks, setBlocks] = useState<ContentBlockListItem[]>([]);
  const [media, setMedia] = useState<Map<string, MediaListItem>>(new Map());
  const [error, setError] = useState<string | null>(null);
  const [client, setClient] = useState<ContentClient>('WEB');
  const [status, setStatus] = useState<StatusFilter>('all');
  const [query, setQuery] = useState('');
  const [open, setOpen] = useState<Set<string>>(new Set());

  useEffect(() => {
    Promise.all([
      api<ContentSectionSummary[]>('/admin/content-sections'),
      api<ListResponse<ContentBlockListItem>>('/admin/content-blocks?pageSize=100'),
      api<ListResponse<MediaListItem>>('/admin/media?pageSize=100').catch(() => null),
    ])
      .then(([s, b, m]) => {
        setSections(s);
        setBlocks(b.items);
        setMedia(new Map((m?.items ?? []).map((item) => [item.id, item])));
      })
      .catch((e: unknown) => setError(errorMessage(e)));
  }, []);

  const byKey = useMemo(() => {
    const map = new Map<string, ContentBlockListItem[]>();
    for (const block of blocks) map.set(block.key, [...(map.get(block.key) ?? []), block]);
    for (const list of map.values()) list.sort((a, b) => a.position - b.position);
    return map;
  }, [blocks]);

  const clients = (['WEB', 'MOBILE', 'ADMIN'] as const).filter((c) => sections?.some((s) => s.client === c));
  const ofClient = (sections ?? []).filter((s) => s.client === client);
  const isDraft = (s: ContentSectionSummary) => s.status === 'DRAFT' || s.drafts > 0;
  const q = query.trim().toLowerCase();
  const matches = (s: ContentSectionSummary) =>
    !q ||
    s.key.includes(q) ||
    sectionName(s.key).toLowerCase().includes(q) ||
    (byKey.get(s.key) ?? []).some((b) =>
      `${b.title ?? ''} ${b.bodyMd ?? ''} ${b.buttonLabel ?? ''}`.toLowerCase().includes(q),
    );
  const shown = ofClient.filter(
    (s) => matches(s) && (status === 'all' || (status === 'drafts' ? isDraft(s) : s.status === 'ARCHIVED')),
  );
  const toggle = (key: string) =>
    setOpen((set) => {
      const next = new Set(set);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  const grid = '36px minmax(0,1.3fr) 150px minmax(0,1.9fr) minmax(0,1.1fr) 130px 36px';

  return (
    <>
      <ContentHead
        actions={
          <label className="search">
            <SearchIcon />
            <span className="visually-hidden">{t('list.search')}</span>
            <input
              type="search"
              value={query}
              placeholder={t('content.blocks.search')}
              onChange={(e) => setQuery(e.target.value)}
            />
          </label>
        }
      />
      {error && <Banner kind="danger">{error}</Banner>}

      <div className="toolbar">
        <span className="seg">
          {clients.map((c) => (
            <button key={c} type="button" className="chip" aria-pressed={client === c} onClick={() => setClient(c)}>
              {CLIENT_ICON[c]}
              {t.dynamic(`content.clients.${c}`)}
              <span className="n num">
                {t('content.blocks.sectionCount', { count: sections?.filter((s) => s.client === c).length ?? 0 })}
              </span>
            </button>
          ))}
        </span>
        <span className="ct-sep" aria-hidden="true" />
        {(['all', 'drafts', 'archived'] as const).map((f) => (
          <button key={f} type="button" className="chip" aria-pressed={status === f} onClick={() => setStatus(f)}>
            {t.dynamic(`content.blocks.filter.${f}`)}
            <span className="n num">
              {f === 'all'
                ? ofClient.length
                : f === 'drafts'
                  ? ofClient.filter(isDraft).length
                  : ofClient.filter((s) => s.status === 'ARCHIVED').length}
            </span>
          </button>
        ))}
        <span className="spacer" />
        <span className="small">{t('content.blocks.note')}</span>
      </div>

      <div className="card" style={{ padding: '14px 0 0' }} aria-busy={!sections}>
        <div className="table" role="table">
          <div className="row head" role="row" style={{ gridTemplateColumns: grid }}>
            <span />
            {(['section', 'kind', 'content', 'status', 'changed'] as const).map((c) => (
              <span key={c} role="columnheader">
                {t.dynamic(`content.blocks.columns.${c}`)}
              </span>
            ))}
            <span />
          </div>
          {!sections &&
            !error &&
            Array.from({ length: 6 }, (_, i) => (
              <div key={i} className="row" style={{ gridTemplateColumns: grid }}>
                <span />
                <span>
                  <i className="skeleton" style={{ width: '60%' }} />
                </span>
              </div>
            ))}
          {shown.map((section) => {
            const key = section.key as ContentSectionKey;
            const def = CONTENT_SECTIONS[key];
            const list = byKey.get(key) ?? [];
            const header = list.find((b) => b.position === 0);
            const items = list.filter((b) => b.position > 0);
            const thumb = header?.mediaId ? media.get(header.mediaId) : undefined;
            const expanded = open.has(key);
            const sources = 'sources' in def ? def.sources : [];
            return (
              <Fragment key={key}>
                <div
                  className={expanded ? 'row link-row selected ct-brow' : 'row link-row ct-brow'}
                  role="row"
                  style={{ gridTemplateColumns: grid }}
                  onClick={() => router.push(sectionHref(key))}
                >
                  <span role="cell">
                    {def.kind === 'list' && (
                      <button
                        type="button"
                        className="icon-btn plain"
                        aria-expanded={expanded}
                        aria-label={t('content.blocks.toggle', { section: sectionName(key) })}
                        onClick={(e) => {
                          e.stopPropagation();
                          toggle(key);
                        }}
                      >
                        {expanded ? <ChevronDownIcon size={16} /> : <ChevronRightIcon size={16} />}
                      </button>
                    )}
                  </span>
                  <span role="cell" className="stack">
                    <span className="ct-sname">
                      <Link href={sectionHref(key)} className="strong" onClick={(e) => e.stopPropagation()}>
                        {sectionName(key)}
                      </Link>
                      {section.required && <span className="pill sm">{t('content.blocks.required')}</span>}
                    </span>
                    <span className="mono-key">{key}</span>
                  </span>
                  <span role="cell">{sectionKind(key, section.items)}</span>
                  <span role="cell" className="ct-excerpt">
                    {thumb && (
                      <span className="ct-thumb">
                        <img src={mediaUrl(thumb.url)} alt="" width={34} height={34} />
                      </span>
                    )}
                    <span className={section.status === 'ARCHIVED' ? 'ellipsis muted' : 'ellipsis'}>
                      {def.kind === 'list' && key === 'web.stores'
                        ? items.map((i) => i.title).join(', ')
                        : excerpt(header)}
                      {sources.length > 0 && (
                        <span className="small">
                          {' · '}
                          {sources.map((s) => t.dynamic(`content.sources.${s}`)).join(', ')}
                        </span>
                      )}
                    </span>
                  </span>
                  <span role="cell" className="ct-status">
                    <StatusPill status={section.status} />
                    {section.drafts > 0 && (
                      <span className="pill warn">{t('content.blocks.drafts', { count: section.drafts })}</span>
                    )}
                  </span>
                  <span role="cell" className="stack">
                    <span>{section.updatedByName ?? t('content.history.seed')}</span>
                    <small className="muted">{changedAt(section.updatedAt)}</small>
                  </span>
                  <span role="cell">
                    <Link
                      href={sectionHref(key)}
                      className="icon-btn plain"
                      aria-label={t('content.blocks.edit', { section: sectionName(key) })}
                      onClick={(e) => e.stopPropagation()}
                    >
                      <MoreIcon size={16} />
                    </Link>
                  </span>
                </div>
                {expanded &&
                  items.map((item) => (
                    <div key={item.id} className="row ct-irow" role="row" style={{ gridTemplateColumns: grid }}>
                      <span />
                      <span role="cell" className="ct-ipos">
                        <GripIcon size={14} />
                        <span className="num">{item.position}</span>
                      </span>
                      <span role="cell" className="small">
                        {t('content.blocks.element', { position: item.position })}
                      </span>
                      <span role="cell" className="ellipsis">
                        {excerpt(item)}
                      </span>
                      <span role="cell">
                        <StatusPill status={item.status} />
                      </span>
                      <span />
                      <span />
                    </div>
                  ))}
              </Fragment>
            );
          })}
          {sections && shown.length === 0 && (
            <div className="row">
              <span className="small">{t('list.noResultsTitle')}</span>
            </div>
          )}
        </div>
      </div>
    </>
  );
}
