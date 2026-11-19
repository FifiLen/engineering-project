'use client';

/**
 * Edytor sekcji (makiety tresci-blok-edycja, tresci-sekcja-lista i tresci-wybor-grafiki; ADR 0062–0064): nagłówek
 * (albo blok pojedynczy) i elementy sekcji-listy zapisywane jednym żądaniem `PUT /admin/content-sections/{key}`
 * z blokadą wersji nagłówka. Pola, limity, profil Markdown, minimalna szerokość grafiki i liczba elementów pochodzą
 * z rejestru sekcji; te same reguły sprawdza core w API. „Przywróć” z historii wczytuje stan do edytora (elementy,
 * których już nie ma, wracają jako nowe), a zapis tworzy nową wersję z `restoredFrom`.
 */
import {
  CONTENT_ICONS,
  CONTENT_SECTIONS,
  contentSection,
  isAllowedHref,
  parseMarkdown,
  type ContentBlockInput,
  type ContentBlockView,
  type ContentFieldsDefinition,
  type ContentHistoryEntry,
  type ContentIcon,
  type ContentIssueView,
  type ContentSectionKey,
  type ContentSectionView,
  type ContentStatus,
  type MediaDetails,
} from '@hulajnogi/shared';
import Link from 'next/link';
import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { api, ApiRequestError, errorMessage } from '../../../lib/api';
import { t } from '../../../lib/i18n';
import { useSession } from '../../../lib/session';
import { ContentIconView } from '../../content-icon';
import { MarkdownView } from '../../markdown-view';
import { Banner } from '../access/common';
import { ConfirmDialog } from '../confirm-dialog';
import { AlertIcon, ArrowDown, ArrowUp, GripIcon, ImageIcon, MoreIcon, PlusIcon, TrashIcon } from '../icons';
import {
  apiIssues,
  changedAt,
  CONTENT_PATHS,
  Counter,
  HistoryList,
  issueMessage,
  mediaUrl,
  sectionDescription,
  sectionName,
  StatusPill,
  textLength,
  useContentHistory,
} from './content-common';
import { MediaPicker } from './media-dialogs';
import { MarkdownField } from './md-editor';

/** Grafika w edytorze: opis z biblioteki (nazwa i rozmiar, gdy znane). */
interface PickedMedia {
  id: string;
  key: string;
  url: string;
  altText: string;
  width: number;
  height: number;
  name?: string;
  contentType?: string;
}

interface Draft {
  title: string;
  bodyMd: string;
  media: PickedMedia | null;
  buttonLabel: string;
  buttonHref: string;
  icon: ContentIcon | null;
  status: ContentStatus;
}

interface ItemDraft extends Draft {
  /** Identyfikator istniejącego elementu; nowy element go nie ma. */
  id?: string;
  /** Klucz listy w React (stały przy zmianie kolejności). */
  uid: string;
}

let uidSeq = 0;
const uid = () => `n${++uidSeq}`;

const toDraft = (block: ContentBlockView): Draft => ({
  title: block.title ?? '',
  bodyMd: block.bodyMd ?? '',
  media: block.media,
  buttonLabel: block.buttonLabel ?? '',
  buttonHref: block.buttonHref ?? '',
  icon: block.icon,
  status: block.status,
});

const emptyDraft = (): Draft => ({
  title: '',
  bodyMd: '',
  media: null,
  buttonLabel: '',
  buttonHref: '',
  icon: null,
  status: 'DRAFT',
});

const toInput = (draft: Draft): ContentBlockInput => ({
  title: draft.title.trim() || null,
  bodyMd: draft.bodyMd.trim() ? draft.bodyMd : null,
  mediaId: draft.media?.id ?? null,
  buttonLabel: draft.buttonLabel.trim() || null,
  buttonHref: draft.buttonHref.trim() || null,
  icon: draft.icon,
  status: draft.status,
});

/** Stan do porównania „Niezapisane zmiany”. */
const snapshot = (header: Draft, items: ItemDraft[]) =>
  JSON.stringify({ header: toInput(header), items: items.map((i) => ({ id: i.id ?? null, ...toInput(i) })) });

/**
 * Problemy pól według rejestru (te same reguły co core `contentBlockIssues`): wymagane pola, limity znaków,
 * Markdown w profilu, grafika z minimalną szerokością, przycisk z etykietą i adresem z białej listy, ikona.
 */
function draftIssues(draft: Draft, fields: ContentFieldsDefinition, item: number | null): ContentIssueView[] {
  const issues: ContentIssueView[] = [];
  const text = (value: string, rules: { max: number; required: boolean }, field: string) => {
    if (!value.trim()) {
      if (rules.required) issues.push({ item, field, code: 'CONTENT_FIELD_REQUIRED' });
      return;
    }
    const length = textLength(value);
    if (length > rules.max) issues.push({ item, field, code: 'CONTENT_TOO_LONG', max: rules.max, length });
  };
  if (fields.title) text(draft.title, fields.title, 'title');
  if (fields.body) {
    text(draft.bodyMd, fields.body, 'bodyMd');
    if (draft.bodyMd.trim() && textLength(draft.bodyMd) <= fields.body.max) {
      for (const issue of parseMarkdown(draft.bodyMd, fields.body.profile).issues)
        issues.push({ ...issue, item, field: 'bodyMd' });
    }
  }
  if (fields.media) {
    if (!draft.media) {
      if (fields.media.required) issues.push({ item, field: 'mediaId', code: 'CONTENT_FIELD_REQUIRED' });
    } else if (fields.media.minWidth && draft.media.width < fields.media.minWidth) {
      issues.push({
        item,
        field: 'mediaId',
        code: 'MEDIA_TOO_NARROW',
        minWidth: fields.media.minWidth,
        width: draft.media.width,
      });
    }
  }
  if (fields.button) {
    const label = draft.buttonLabel.trim();
    const href = draft.buttonHref.trim();
    if (!label && !href) {
      if (fields.button.required) issues.push({ item, field: 'button', code: 'CONTENT_FIELD_REQUIRED' });
    } else if (!label || !href) {
      issues.push({ item, field: 'button', code: 'CONTENT_BUTTON_INCOMPLETE' });
    } else {
      if (textLength(label) > fields.button.labelMax)
        issues.push({
          item,
          field: 'buttonLabel',
          code: 'CONTENT_TOO_LONG',
          max: fields.button.labelMax,
          length: textLength(label),
        });
      if (!isAllowedHref(href)) issues.push({ item, field: 'buttonHref', code: 'CONTENT_HREF_NOT_ALLOWED' });
    }
  }
  if (fields.icon?.required && !draft.icon) issues.push({ item, field: 'icon', code: 'CONTENT_FIELD_REQUIRED' });
  return issues;
}

const forField = (issues: ContentIssueView[], item: number | null, ...fields: string[]) =>
  issues.filter((i) => (i.item ?? null) === item && fields.includes(i.field));

function FieldIssues({ issues, section }: { issues: ContentIssueView[]; section: ContentSectionKey }) {
  if (!issues.length) return null;
  return (
    <ul className="ct-issues">
      {issues.map((issue, i) => (
        <li key={i}>
          <AlertIcon size={14} />
          {issueMessage(issue, { section })}
        </li>
      ))}
    </ul>
  );
}

export function SectionEditor({ sectionKey }: { sectionKey: string }) {
  const { can } = useSession();
  const canWrite = can('content.write');
  const known = Object.hasOwn(CONTENT_SECTIONS, sectionKey);
  const key = sectionKey as ContentSectionKey;
  const def = known ? contentSection(key) : null;
  const [section, setSection] = useState<ContentSectionView | null>(null);
  const [header, setHeader] = useState<Draft>(emptyDraft);
  const [items, setItems] = useState<ItemDraft[]>([]);
  const [baseline, setBaseline] = useState('');
  const [restoredFrom, setRestoredFrom] = useState<number | null>(null);
  const [serverIssues, setServerIssues] = useState<ContentIssueView[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [expanded, setExpanded] = useState<string | null>(null);
  const [picker, setPicker] = useState<'header' | string | null>(null);
  const [confirmDiscard, setConfirmDiscard] = useState(false);
  const dragFrom = useRef<number | null>(null);

  const apply = useCallback((view: ContentSectionView) => {
    const nextHeader = toDraft(view.header);
    const nextItems = view.items.map((item) => ({ ...toDraft(item), id: item.id, uid: item.id }));
    setSection(view);
    setHeader(nextHeader);
    setItems(nextItems);
    setBaseline(snapshot(nextHeader, nextItems));
    setRestoredFrom(null);
    setServerIssues([]);
  }, []);

  useEffect(() => {
    if (!known) return;
    api<ContentSectionView>(`/admin/content-sections/${sectionKey}`)
      .then(apply)
      .catch((e: unknown) => setError(errorMessage(e)));
  }, [sectionKey, known, apply]);

  const history = useContentHistory(
    known ? `/admin/content-sections/${sectionKey}/history` : null,
    section?.header.version,
  );

  const localIssues = useMemo(() => {
    if (!def) return [];
    const issues = draftIssues(header, def.header, null);
    if (def.item) items.forEach((item, i) => issues.push(...draftIssues(item, def.item!, i)));
    if (def.items) {
      const published = items.filter((i) => i.status === 'PUBLISHED').length;
      const { min, max } = def.items;
      if (items.length > max)
        issues.push({ item: null, field: 'items', code: 'CONTENT_ITEMS_LIMIT', min, max, count: items.length });
      else if (header.status === 'PUBLISHED' && published < min)
        issues.push({ item: null, field: 'items', code: 'CONTENT_ITEMS_LIMIT', min, max, count: published });
    }
    return issues;
  }, [def, header, items]);

  if (!known || !def) return <Banner kind="danger">{t('content.editor.unknownSection', { key: sectionKey })}</Banner>;
  if (!section)
    return error ? (
      <Banner kind="danger">{error}</Banner>
    ) : (
      <div className="card" aria-busy="true" style={{ minHeight: 320 }} />
    );

  const dirty = snapshot(header, items) !== baseline;
  const issues = [
    ...localIssues,
    ...serverIssues.filter((s) => !localIssues.some((l) => l.field === s.field && l.item === s.item)),
  ];
  const readOnly = !canWrite;
  const nextVersion = section.header.version + 1;
  const clientPath = def.client === 'MOBILE' ? 'mobile' : def.client === 'ADMIN' ? 'admin' : 'web';
  const isList = def.kind === 'list';
  const max = def.items?.max ?? 0;

  const patchItem = (id: string, patch: Partial<Draft>) =>
    setItems((list) => list.map((item) => (item.uid === id ? { ...item, ...patch } : item)));
  const move = (from: number, to: number) =>
    setItems((list) => {
      if (to < 0 || to >= list.length || from === to) return list;
      const next = [...list];
      const [moved] = next.splice(from, 1);
      next.splice(to, 0, moved!);
      return next;
    });
  const addItem = () => {
    const item: ItemDraft = { ...emptyDraft(), uid: uid() };
    setItems((list) => [...list, item]);
    setExpanded(item.uid);
  };

  async function mediaById(id: string | null, known: PickedMedia | null): Promise<PickedMedia | null> {
    if (!id) return null;
    if (known?.id === id) return known;
    return api<MediaDetails>(`/admin/media/${id}`).catch(() => null);
  }

  /** „Przywróć”: stan z wpisu historii do edytora; elementy, których już nie ma, zapiszą się jako nowe. */
  async function restore(entry: ContentHistoryEntry) {
    const after = entry.after as { header?: Record<string, unknown>; items?: Array<Record<string, unknown>> } | null;
    if (!after?.header || !section) return;
    const existing = new Map(section.items.map((i) => [i.id, i]));
    const read = async (raw: Record<string, unknown>, current: PickedMedia | null): Promise<Draft> => ({
      title: typeof raw.title === 'string' ? raw.title : '',
      bodyMd: typeof raw.bodyMd === 'string' ? raw.bodyMd : '',
      media: await mediaById(typeof raw.mediaId === 'string' ? raw.mediaId : null, current),
      buttonLabel: typeof raw.buttonLabel === 'string' ? raw.buttonLabel : '',
      buttonHref: typeof raw.buttonHref === 'string' ? raw.buttonHref : '',
      icon:
        typeof raw.icon === 'string' && (CONTENT_ICONS as readonly string[]).includes(raw.icon)
          ? (raw.icon as ContentIcon)
          : null,
      status: (['DRAFT', 'PUBLISHED', 'ARCHIVED'] as const).find((s) => s === raw.status) ?? 'DRAFT',
    });
    const nextHeader = await read(after.header, header.media);
    if (def!.required) nextHeader.status = 'PUBLISHED';
    const nextItems: ItemDraft[] = [];
    for (const raw of after.items ?? []) {
      const id = typeof raw.id === 'string' && existing.has(raw.id) ? raw.id : undefined;
      const current = id ? (items.find((i) => i.id === id)?.media ?? null) : null;
      nextItems.push({ ...(await read(raw, current)), ...(id ? { id } : {}), uid: id ?? uid() });
    }
    // Opublikowanego elementu nie da się usunąć (CONTENT_DELETE_PUBLISHED): element opublikowany dziś, którego nie ma
    // w przywracanej wersji, zostaje w sekcji jako archiwalny zamiast blokować zapis.
    const restoredIds = new Set(nextItems.map((item) => item.id).filter(Boolean));
    const archived = section.items
      .filter((item) => item.status === 'PUBLISHED' && !restoredIds.has(item.id))
      .map((item): ItemDraft => ({ ...toDraft(item), status: 'ARCHIVED', id: item.id, uid: item.id }));
    nextItems.push(...archived);
    setHeader(nextHeader);
    setItems(nextItems);
    setRestoredFrom(entry.auditId);
    setServerIssues([]);
    const loaded = t('content.history.loaded', { version: entry.versionTo ?? 0 });
    setNotice(
      archived.length ? `${loaded} ${t('content.history.archivedOnRestore', { count: archived.length })}` : loaded,
    );
  }

  async function save() {
    setSaving(true);
    setError(null);
    setNotice(null);
    try {
      const view = await api<ContentSectionView>(`/admin/content-sections/${key}`, {
        method: 'PUT',
        json: {
          version: section!.header.version,
          header: toInput(header),
          items: items.map((item) => ({ ...(item.id ? { id: item.id } : {}), ...toInput(item) })),
          restoredFrom,
        },
      });
      apply(view);
      setNotice(t('content.editor.saved', { version: view.header.version }));
    } catch (e) {
      const found = apiIssues(e);
      setServerIssues(found);
      setError(found.length ? t('content.editor.fix') : errorMessage(e));
      if (e instanceof ApiRequestError && e.code === 'CONFLICT') setError(t('content.editor.conflict'));
    } finally {
      setSaving(false);
    }
  }

  const discard = () => {
    setConfirmDiscard(false);
    apply(section);
    setNotice(null);
    setError(null);
  };

  const pickerMinWidth =
    picker === 'header' ? def.header.media?.minWidth : picker ? def.item?.media?.minWidth : undefined;
  const pickerSelected = picker === 'header' ? header.media?.id : items.find((i) => i.uid === picker)?.media?.id;

  return (
    <>
      <div className="page-head">
        <div>
          <nav className="crumbs" aria-label={t('form.backToList')}>
            <Link href={CONTENT_PATHS.blocks}>{t('content.tabs.blocks')}</Link>
            <span aria-hidden="true">/</span>
            <Link href={CONTENT_PATHS.blocks}>{t.dynamic(`content.clients.${def.client}`)}</Link>
            <span aria-hidden="true">/</span>
            <span>{sectionName(key)}</span>
          </nav>
          <h1 className="title-with-pills">
            {sectionName(key)}
            <StatusPill status={section.header.status} />
            {dirty && <span className="pill">{t('content.editor.unsaved')}</span>}
          </h1>
          <div className="sub">
            <span className="mono-key">{key}</span>
            {' · '}
            {[
              sectionDescription(key),
              isList && t('content.editor.listMeta', { min: def.items!.min, max }),
              t('content.editor.versionMeta', {
                version: section.header.version,
                name: section.header.updatedByName ?? t('content.history.seed'),
                when: changedAt(section.header.updatedAt),
              }),
            ]
              .filter(Boolean)
              .join(' · ')}
          </div>
        </div>
      </div>
      {error && <Banner kind="danger">{error}</Banner>}
      {notice && <Banner kind="ok">{notice}</Banner>}

      <div className="ct-editor-layout">
        <div className="col">
          {Object.keys(def.header).length > 0 && (
            <section className="card section-card ct-form">
              {isList && <h2>{t('content.editor.header')}</h2>}
              <BlockFields
                id="header"
                draft={header}
                fields={def.header}
                onChange={(patch) => setHeader((h) => ({ ...h, ...patch }))}
                issues={issues}
                item={null}
                section={key}
                readOnly={readOnly}
                compact={isList}
                onPickMedia={() => setPicker('header')}
              />
              {!isList && editorFoot()}
            </section>
          )}

          {isList && (
            <section className="card section-card ct-items">
              <div className="section-head">
                <h2>
                  {t('content.editor.items')}{' '}
                  <span className="muted num">
                    {t('content.editor.itemsCount', { count: items.length, min: def.items!.min, max })}
                  </span>
                </h2>
                <span className="small">{t('content.editor.reorderHint')}</span>
              </div>
              <div className="ct-item-list">
                {items.map((item, index) => {
                  const open = expanded === item.uid;
                  const itemIssues = issues.filter((i) => i.item === index);
                  return (
                    <div
                      key={item.uid}
                      className={['ct-item', open && 'open', itemIssues.length > 0 && 'bad'].filter(Boolean).join(' ')}
                      draggable={!readOnly && !open}
                      onDragStart={() => {
                        dragFrom.current = index;
                      }}
                      onDragOver={(e) => e.preventDefault()}
                      onDrop={() => {
                        if (dragFrom.current !== null) move(dragFrom.current, index);
                        dragFrom.current = null;
                      }}
                    >
                      <div className="ct-item-row">
                        <span className="handle" aria-hidden="true">
                          <GripIcon size={14} />
                        </span>
                        <span className="num ct-item-no">{index + 1}</span>
                        {def.item?.icon && (
                          <span className="rico">
                            {item.icon ? <ContentIconView icon={item.icon} size={16} /> : null}
                          </span>
                        )}
                        <button
                          type="button"
                          className="ct-item-text"
                          onClick={() => setExpanded(open ? null : item.uid)}
                        >
                          <b>{item.title || t('content.editor.newItem')}</b>
                          {!open && (item.bodyMd || item.buttonHref) && (
                            <span className="small ellipsis">{item.bodyMd || item.buttonHref}</span>
                          )}
                        </button>
                        <StatusPill status={item.status} />
                        {!readOnly && (
                          <span className="ct-item-tools">
                            <button
                              type="button"
                              className="icon-btn plain"
                              disabled={index === 0}
                              aria-label={t('content.editor.moveUp', { position: index + 1 })}
                              onClick={() => move(index, index - 1)}
                            >
                              <ArrowUp />
                            </button>
                            <button
                              type="button"
                              className="icon-btn plain"
                              disabled={index === items.length - 1}
                              aria-label={t('content.editor.moveDown', { position: index + 1 })}
                              onClick={() => move(index, index + 1)}
                            >
                              <ArrowDown />
                            </button>
                          </span>
                        )}
                        <button
                          type="button"
                          className="icon-btn plain"
                          aria-expanded={open}
                          aria-label={t('content.editor.editItem', { position: index + 1 })}
                          onClick={() => setExpanded(open ? null : item.uid)}
                        >
                          <MoreIcon size={16} />
                        </button>
                      </div>
                      {open && def.item && (
                        <div className="ct-item-edit">
                          <BlockFields
                            id={`item-${item.uid}`}
                            draft={item}
                            fields={def.item}
                            onChange={(patch) => patchItem(item.uid, patch)}
                            issues={issues}
                            item={index}
                            section={key}
                            readOnly={readOnly}
                            compact
                            withStatus
                            onPickMedia={() => setPicker(item.uid)}
                          />
                          {!readOnly && (
                            <div className="ct-item-foot">
                              <button
                                type="button"
                                className="btn danger"
                                disabled={item.status === 'PUBLISHED'}
                                title={item.status === 'PUBLISHED' ? t('content.editor.deletePublished') : undefined}
                                onClick={() => {
                                  setItems((list) => list.filter((i) => i.uid !== item.uid));
                                  setExpanded(null);
                                }}
                              >
                                <TrashIcon size={15} />
                                {t('content.editor.deleteItem')}
                              </button>
                              {item.status === 'PUBLISHED' && (
                                <span className="small">{t('content.editor.deletePublished')}</span>
                              )}
                            </div>
                          )}
                        </div>
                      )}
                      {!open && itemIssues.length > 0 && <FieldIssues issues={itemIssues} section={key} />}
                    </div>
                  );
                })}
              </div>
              <FieldIssues issues={forField(issues, null, 'items')} section={key} />
              {!readOnly && (
                <div className="ct-add-row">
                  <button type="button" className="btn" disabled={items.length >= max} onClick={addItem}>
                    <PlusIcon />
                    {t('content.editor.addItem')}
                  </button>
                  <span className="small">
                    {items.length >= max
                      ? t('content.editor.limitReached', { max })
                      : t('content.editor.itemsLeft', { count: max - items.length, max })}
                  </span>
                </div>
              )}
              {editorFoot()}
            </section>
          )}
        </div>

        <div className="col">
          <section className="card side-card">
            <h2>{t('content.editor.statusTitle')}</h2>
            <StatusSeg
              value={header.status}
              required={def.required}
              disabled={readOnly}
              onChange={(status) => setHeader((h) => ({ ...h, status }))}
            />
            <p>
              {def.required
                ? t('content.editor.requiredNote')
                : t.dynamic(`content.editor.statusNote.${header.status}`)}
            </p>
          </section>
          <section className="card side-card">
            <div className="section-head">
              <h2>{t.dynamic(`content.preview.title.${clientPath}`)}</h2>
              {isList && <span className="small">{t('content.preview.published')}</span>}
            </div>
            <SectionPreview client={def.client} header={header} items={items} sectionKey={key} />
          </section>
          <section className="card side-card">
            <div className="section-head">
              <h2>{t('content.history.title')}</h2>
              <span className="small">{t('content.history.source')}</span>
            </div>
            <HistoryList entries={history} canRestore={canWrite} onRestore={(entry) => void restore(entry)} />
            <p>{t('content.history.note')}</p>
          </section>
        </div>
      </div>

      <MediaPicker
        open={picker !== null}
        title={sectionName(key)}
        minWidth={pickerMinWidth}
        selectedId={pickerSelected ?? null}
        onClose={() => setPicker(null)}
        onSelect={(media) => {
          const picked: PickedMedia = {
            id: media.id,
            key: media.key,
            url: media.url,
            altText: media.altText,
            width: media.width,
            height: media.height,
            name: media.name,
            contentType: media.contentType,
          };
          if (picker === 'header') setHeader((h) => ({ ...h, media: picked }));
          else if (picker) patchItem(picker, { media: picked });
          setPicker(null);
        }}
      />
      <ConfirmDialog
        open={confirmDiscard}
        danger
        title={t('content.editor.discardTitle')}
        body={t('content.editor.discardBody')}
        action={t('content.editor.discard')}
        onConfirm={discard}
        onClose={() => setConfirmDiscard(false)}
      />
    </>
  );

  function editorFoot() {
    if (readOnly) return null;
    const blocked = localIssues.length > 0;
    return (
      <div className="ct-foot">
        <button type="button" className="btn" disabled={!dirty || saving} onClick={() => setConfirmDiscard(true)}>
          {t('content.editor.discard')}
        </button>
        <span className="small grow">
          {blocked
            ? t('content.editor.blocked')
            : isList
              ? t('content.editor.listNote')
              : header.status === 'PUBLISHED'
                ? t('content.editor.publishedNote')
                : t('content.editor.draftNote')}
        </span>
        <button
          type="button"
          className="btn primary"
          disabled={!dirty || blocked || saving}
          onClick={() => void save()}
        >
          {isList ? t('content.editor.saveSection') : t('content.editor.saveVersion', { version: nextVersion })}
        </button>
      </div>
    );
  }
}

function StatusSeg({
  value,
  required,
  disabled,
  onChange,
}: {
  value: ContentStatus;
  required: boolean;
  disabled: boolean;
  onChange: (status: ContentStatus) => void;
}) {
  return (
    <div className="ct-seg" role="radiogroup" aria-label={t('content.editor.statusTitle')}>
      {(['DRAFT', 'PUBLISHED', 'ARCHIVED'] as const).map((status) => (
        <button
          key={status}
          type="button"
          role="radio"
          aria-checked={value === status}
          disabled={disabled || (required && status !== 'PUBLISHED')}
          onClick={() => onChange(status)}
        >
          {t.dynamic(`content.status.${status}`)}
        </button>
      ))}
    </div>
  );
}

interface BlockFieldsProps {
  id: string;
  draft: Draft;
  fields: ContentFieldsDefinition;
  onChange: (patch: Partial<Draft>) => void;
  issues: ContentIssueView[];
  item: number | null;
  section: ContentSectionKey;
  readOnly: boolean;
  /** Węższy układ (nagłówek listy, element): treść w polu z przełącznikiem podglądu. */
  compact?: boolean;
  /** Element sekcji-listy ma własny stan. */
  withStatus?: boolean;
  onPickMedia: () => void;
}

/** Pola bloku według rejestru: tytuł, treść, grafika, przycisk, ikona (element listy także stan). */
function BlockFields(props: BlockFieldsProps) {
  const { id, draft, fields, onChange, issues, item, section, readOnly, compact, withStatus, onPickMedia } = props;
  const out: ReactNode[] = [];
  if (fields.icon)
    out.push(
      <div key="icon" className="field">
        <span className="label">
          {t('content.fields.icon')} <span className="opt">{t('content.editor.iconNote')}</span>
        </span>
        <div className="ct-iconsel" role="radiogroup" aria-label={t('content.fields.icon')}>
          {CONTENT_ICONS.map((icon) => (
            <button
              key={icon}
              type="button"
              role="radio"
              aria-checked={draft.icon === icon}
              aria-label={t.dynamic(`content.icons.${icon}`)}
              title={t.dynamic(`content.icons.${icon}`)}
              disabled={readOnly}
              onClick={() => onChange({ icon })}
            >
              <ContentIconView icon={icon} size={17} />
            </button>
          ))}
        </div>
        <FieldIssues issues={forField(issues, item, 'icon')} section={section} />
      </div>,
    );
  if (fields.title)
    out.push(
      <div key="title" className="field">
        <div className="label-row">
          <label className="label" htmlFor={`${id}-title`}>
            {t('content.fields.title')}
          </label>
          <Counter value={textLength(draft.title)} max={fields.title.max} />
        </div>
        <input
          id={`${id}-title`}
          className="input"
          value={draft.title}
          readOnly={readOnly}
          aria-invalid={forField(issues, item, 'title').length > 0}
          onChange={(e) => onChange({ title: e.target.value })}
        />
        <FieldIssues issues={forField(issues, item, 'title')} section={section} />
      </div>,
    );
  if (fields.body)
    out.push(
      <div key="body" className="field wide">
        <MarkdownField
          id={`${id}-body`}
          label={t('content.fields.bodyMd')}
          labelNote={fields.body.required ? t('content.editor.markdown') : t('content.editor.markdownOptional')}
          value={draft.bodyMd}
          onChange={(bodyMd) => onChange({ bodyMd })}
          profile={fields.body.profile}
          max={fields.body.max}
          section={section}
          readOnly={readOnly}
          layout={compact ? 'toggle' : 'split'}
          minRows={compact ? 2 : 4}
          serverIssues={forField(issues, item, 'bodyMd').filter((i) => !i.code.startsWith('MD_'))}
        />
      </div>,
    );
  if (fields.media)
    out.push(
      <div key="media" className="field wide">
        <div className="label-row">
          <span className="label">{t('content.fields.mediaId')}</span>
          <span className="small">
            {[
              t('content.editor.fromLibrary'),
              fields.media.required ? t('content.editor.mediaRequired') : t('content.editor.mediaOptional'),
              fields.media.minWidth && t('content.editor.minWidth', { width: fields.media.minWidth }),
            ]
              .filter(Boolean)
              .join(' · ')}
          </span>
        </div>
        <div className="ct-media-field">
          {draft.media ? (
            <>
              <span className="ct-thumb lg">
                <img src={mediaUrl(draft.media.url)} alt="" width={64} height={64} />
              </span>
              <span className="grow stack">
                <b>{draft.media.name ?? draft.media.key}</b>
                <span className="small">{t('content.editor.alt', { alt: draft.media.altText })}</span>
                <span className="small num">
                  {t('content.media.size', { width: draft.media.width, height: draft.media.height })}
                  {' · '}
                  {t('content.editor.mediaKey', { key: draft.media.key })}
                </span>
              </span>
            </>
          ) : (
            <span className="grow small">{t('content.editor.noMedia')}</span>
          )}
          {!readOnly && (
            <span className="actions">
              {draft.media && !fields.media.required && (
                <button type="button" className="btn" onClick={() => onChange({ media: null })}>
                  {t('content.editor.removeMedia')}
                </button>
              )}
              <button type="button" className="btn" onClick={onPickMedia}>
                <ImageIcon size={15} />
                {draft.media ? t('content.editor.changeMedia') : t('content.editor.pickMedia')}
              </button>
            </span>
          )}
        </div>
        <FieldIssues issues={forField(issues, item, 'mediaId')} section={section} />
      </div>,
    );
  if (fields.button)
    out.push(
      <div key="button" className="ct-two wide">
        <label className="field">
          <span className="label">
            {t('content.fields.buttonLabel')}{' '}
            {!fields.button.required && <span className="opt">{t('common.optional')}</span>}
          </span>
          <input
            className="input"
            value={draft.buttonLabel}
            readOnly={readOnly}
            maxLength={fields.button.labelMax + 20}
            onChange={(e) => onChange({ buttonLabel: e.target.value })}
          />
          <FieldIssues issues={forField(issues, item, 'buttonLabel')} section={section} />
        </label>
        <label className="field">
          <span className="label">{t('content.fields.buttonHref')}</span>
          <input
            className="input"
            value={draft.buttonHref}
            readOnly={readOnly}
            aria-invalid={forField(issues, item, 'buttonHref', 'button').length > 0}
            onChange={(e) => onChange({ buttonHref: e.target.value })}
          />
          <span className="hint">{t('content.editor.hrefHint')}</span>
          <FieldIssues issues={forField(issues, item, 'buttonHref', 'button')} section={section} />
        </label>
      </div>,
    );
  if (withStatus)
    out.push(
      <div key="status" className="field">
        <span className="label">{t('content.editor.statusTitle')}</span>
        <StatusSeg
          value={draft.status}
          required={false}
          disabled={readOnly}
          onChange={(status) => onChange({ status })}
        />
      </div>,
    );
  return <div className={compact ? 'ct-fields compact' : 'ct-fields'}>{out}</div>;
}

/**
 * Podgląd sekcji (makiety: „Podgląd na stronie”, „Podgląd w aplikacji”): treść z edytora przed zapisem, w aplikacji
 * w ramce telefonu. Elementy listy tylko opublikowane, jak u klienta.
 */
function SectionPreview({
  client,
  header,
  items,
  sectionKey,
}: {
  client: string;
  header: Draft;
  items: ItemDraft[];
  sectionKey: ContentSectionKey;
}) {
  const visible = items.filter((i) => i.status === 'PUBLISHED');
  const def = contentSection(sectionKey);
  const body = (
    <>
      {header.title && <b className="ct-pv-title">{header.title}</b>}
      {header.bodyMd && def.header.body && (
        <MarkdownView source={header.bodyMd} profile={def.header.body.profile} className="ct-md ct-pv-body" />
      )}
      {header.buttonLabel && <span className="ct-pv-btn">{header.buttonLabel}</span>}
      {header.media && <img className="ct-pv-img" src={mediaUrl(header.media.url)} alt="" />}
      {visible.length > 0 && (
        <div className="ct-pv-items">
          {visible.map((item, i) => (
            <div key={item.uid} className="ct-pv-item">
              {item.icon ? (
                <span className="rico sm">
                  <ContentIconView icon={item.icon} size={14} />
                </span>
              ) : (
                <span className="ct-pv-no num">{i + 1}</span>
              )}
              <span className="stack">
                <b>{item.title || item.buttonLabel}</b>
                {item.bodyMd && def.item?.body && (
                  <MarkdownView source={item.bodyMd} profile={def.item.body.profile} className="ct-md small" />
                )}
              </span>
            </div>
          ))}
        </div>
      )}
      {header.status !== 'PUBLISHED' && <span className="small warn-text">{t('content.preview.hidden')}</span>}
    </>
  );
  if (client === 'MOBILE')
    return (
      <div className="ct-phone">
        <div className="scr">{body}</div>
      </div>
    );
  return <div className="ct-pv">{body}</div>;
}
